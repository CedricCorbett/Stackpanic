// The reply half: this is what replaces ManyChat.
//
// SHAPE OF THE FLOW
//   Meta calls us (we do not poll). We verify the signature, answer 200
//   immediately so Meta does not retry, then process the event in the
//   background.
//
//   Comment containing a code  ->  fixed-template private reply. No AI. Fast
//                                  and deterministic, because a booking-link
//                                  reply must never be creative.
//   Direct message             ->  AI reply, grounded only in your resources
//                                  table, with escalation enforced in code.
//
// EVERY automated send passes: the account is active, the reply half is
// enabled, the hourly cap is not exceeded (reserved atomically, not just
// checked, so two overlapping deliveries cannot both slip under it), and the
// contact is not mid-escalation on EITHER channel, not just this one. DMs also
// pass a daily AI-reply ceiling. Fail any gate and nothing is sent, but the
// reason is always written to the event log.

import { verifyMetaSignature, decryptToken } from './crypto.js';
import { sendPrivateReply, sendDirectMessage, replyToComment } from './meta.js';
import * as db from './db.js';
import { json, escapeRegex, truncateWords, parseJsonColumn, isoPlusHours } from './util.js';

// ---------------------------------------------------------------------------
// Meta's verification handshake. Meta calls this once when you add the webhook
// URL in the developer dashboard, and expects the challenge echoed back as
// plain text.
// ---------------------------------------------------------------------------
export function handleWebhookVerify(request, env) {
  const url = new URL(request.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');

  if (mode === 'subscribe' && token && token === env.WEBHOOK_VERIFY_TOKEN) {
    return new Response(challenge || '', { status: 200, headers: { 'content-type': 'text/plain' } });
  }
  return new Response('Verification failed', { status: 403 });
}

// ---------------------------------------------------------------------------
// Inbound events.
// ---------------------------------------------------------------------------
export async function handleWebhookEvent(request, env, ctx) {
  // The signature is computed over the exact bytes Meta sent. Read the body as
  // text and never re-serialise it before verifying, or the hash will not match.
  const raw = await request.text();
  const signature = request.headers.get('x-hub-signature-256');

  const check = await verifyMetaSignature(raw, signature, env.META_APP_SECRET);
  if (!check.ok) {
    await db.logEvent(env, null, 'webhook_rejected', { reason: check.reason });
    // 403, not 200: an unsigned request is not a Meta delivery to acknowledge.
    return new Response('Invalid signature', { status: 403 });
  }

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    await db.logEvent(env, null, 'webhook_rejected', { reason: 'body was not JSON' });
    return new Response('Bad payload', { status: 400 });
  }

  // Answer Meta fast, do the work after. Meta retries anything slow, and a
  // retry means a duplicate DM to a real person.
  ctx.waitUntil(processEnvelope(env, body));
  return new Response('EVENT_RECEIVED', { status: 200 });
}

async function processEnvelope(env, body) {
  try {
    for (const entry of body.entry || []) {
      // Comment events arrive under changes[], messages under messaging[].
      for (const change of entry.changes || []) {
        if (change.field === 'comments') {
          await handleComment(env, entry, change.value || {});
        }
      }
      for (const event of entry.messaging || []) {
        await handleMessaging(env, entry, event);
      }
    }
  } catch (err) {
    await db.logEvent(env, null, 'webhook_processing_error', { error: err?.message || String(err) });
  }
}

// ---------------------------------------------------------------------------
// Gate checks, shared by both flows.
// ---------------------------------------------------------------------------
async function sendGate(env, account, kind) {
  if (account.status !== 'active') {
    await db.logEvent(env, account.id, 'send_blocked', { reason: 'account_paused', kind });
    return false;
  }
  if (!account.dm_enabled) {
    await db.logEvent(env, account.id, 'send_blocked', { reason: 'replies_disabled', kind });
    return false;
  }
  const cap = Number(env.SEND_CAP_PER_HOUR) || 150;
  // Reserve the slot atomically, right here, rather than reading a count and
  // recording the send later once Meta responds: two overlapping webhook
  // deliveries for the same account both reading "under cap" before either
  // one's send is recorded is exactly how the cap gets exceeded, and the gap
  // between a read and a later insert spans a whole Instagram API call.
  const reserved = await db.reserveSendSlot(env, account.id, kind, cap);
  if (!reserved) {
    // Honest limitation: this skips rather than queues. At your volume the cap
    // will not be reached, and a real queue is a documented follow-up rather
    // than speculative machinery built today. The event log makes it visible
    // if it ever does happen.
    await db.logEvent(env, account.id, 'send_delayed', { reason: 'hourly_cap', cap, kind });
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// COMMENT FLOW: many codes, one reply.
// ---------------------------------------------------------------------------
async function handleComment(env, entry, value) {
  const commentId = value.id;
  const text = value.text || '';
  const fromId = value.from?.id;
  const fromUsername = value.from?.username;
  const mediaId = value.media?.id;
  const igUserId = entry.id;

  if (!commentId) return;

  // Dedupe before doing anything that has a side effect.
  if (!(await db.claimEvent(env, `comment:${commentId}`))) return;

  const account = await db.getAccountByIgUserId(env, igUserId);
  if (!account) {
    await db.logEvent(env, null, 'webhook_unknown_account', { ig_user_id: igUserId, kind: 'comment' });
    return;
  }

  // Ignore the account's own comments, otherwise replying to yourself is
  // possible and looks broken.
  if (fromId && String(fromId) === String(account.ig_user_id)) return;

  await db.logEvent(env, account.id, 'comment_received', {
    comment_id: commentId,
    from: fromUsername || fromId,
    text: text.slice(0, 300),
  }, fromId);

  const trigger = await matchTrigger(env, account.id, text, mediaId);
  if (!trigger) {
    await db.logEvent(env, account.id, 'comment_no_match', { comment_id: commentId }, fromId);
    return;
  }

  // Record the person and their comment BEFORE attempting to send.
  //
  // Someone who used a code is a lead whether or not the reply succeeded. If
  // this were done after the send, every failure would silently lose the
  // contact, and the inbox would show nothing to follow up on. Ordering here is
  // deliberate.
  let convo = null;
  let contact = null;
  if (fromId) {
    contact = await db.upsertContact(env, account.id, fromId, fromUsername);
    convo = await db.getOrCreateConversation(env, contact.id, 'comment');
    await db.addMessage(env, convo.id, 'in', text, null);
    // Tag on the way in, so segmentation survives a failed send too.
    if (trigger.tag) await db.addContactTag(env, contact.id, trigger.tag);

    // Escalation is per-contact in spirit even though it is stored per
    // conversation: someone mid-escalation to a human over a DM should not
    // still get a fully automated reply because they also commented a code.
    if (await db.contactHasEscalatedConversation(env, contact.id)) {
      await db.logEvent(env, account.id, 'send_blocked', {
        reason: 'contact_escalated', comment_id: commentId, keyword: trigger.keyword,
      }, fromId);
      return;
    }
  }

  // A half-configured code must fail loudly rather than DM a dead link.
  const rawLink = trigger.link || '';
  if (rawLink.includes('REPLACE_ME')) {
    await db.logEvent(env, account.id, 'send_blocked', {
      reason: 'trigger_link_is_placeholder',
      keyword: trigger.keyword,
      trigger_id: trigger.id,
    }, fromId);
    return;
  }

  if (!(await sendGate(env, account, 'private_reply'))) return;

  // Send the tracked short link when one exists, so clicks are attributable to
  // this specific code. Falls back to the raw URL if short-link creation never
  // happened, because a working link beats a measurable one.
  const link = await resolveTriggerLink(env, trigger, rawLink);
  const replyText = trigger.reply_template.replaceAll('{{link}}', link).trim();

  try {
    const token = await decryptToken(account.token_ciphertext, env);
    await sendPrivateReply(env, {
      igUserId: account.ig_user_id,
      token,
      commentId,
      text: replyText,
    });

    // Not recordSend here: sendGate already reserved this send's slot
    // atomically, before the call to Meta above, which is what actually
    // prevents two overlapping deliveries from both passing the hourly cap.
    await db.bumpTriggerHit(env, trigger.id);
    if (convo) await db.addMessage(env, convo.id, 'out', replyText, 'keyword_trigger');

    await db.logEvent(env, account.id, 'private_reply_sent', {
      comment_id: commentId,
      keyword: trigger.keyword,
      trigger_id: trigger.id,
    }, fromId);

    // The public reply in the comment thread. Separate from the private reply,
    // non-fatal if it fails: the person already has their link, and a public
    // reply failing should not read as the whole mechanic failing.
    if (trigger.public_reply_text) {
      try {
        await replyToComment(env, { commentId, token, message: trigger.public_reply_text });
        await db.recordSend(env, account.id, 'public_reply');
        await db.logEvent(env, account.id, 'public_reply_sent', { comment_id: commentId });
      } catch (err) {
        await db.logEvent(env, account.id, 'public_reply_failed', {
          comment_id: commentId, error: err?.message || String(err),
        });
      }
    }

    // Queue the single timed follow-up. It is cancelled automatically if the
    // person replies before it fires.
    if (trigger.followup_active && trigger.followup_text && convo && fromId) {
      const delay = Number(trigger.followup_delay_hours) || 20;
      await db.queueScheduledSend(env, {
        account_id: account.id,
        conversation_id: convo.id,
        recipient_id: String(fromId),
        body: trigger.followup_text.replaceAll('{{link}}', link),
        send_after: isoPlusHours(delay),
        trigger_id: trigger.id,
      });
      await db.logEvent(env, account.id, 'followup_queued', {
        conversation_id: convo.id, in_hours: delay, keyword: trigger.keyword,
      }, fromId);
    }
  } catch (err) {
    await db.logEvent(env, account.id, 'send_failed', {
      kind: 'private_reply',
      comment_id: commentId,
      keyword: trigger.keyword,
      error: err?.message || String(err),
    }, fromId);
  }
}

/** The tracked short URL for a code, or the raw destination if there is none. */
async function resolveTriggerLink(env, trigger, rawLink) {
  try {
    const short = await db.getShortLinkByTrigger(env, trigger.id);
    if (short && env.PUBLIC_ORIGIN && !env.PUBLIC_ORIGIN.includes('YOUR-SUBDOMAIN')) {
      return `${env.PUBLIC_ORIGIN.replace(/\/$/, '')}/r/${short.code}`;
    }
  } catch {
    // Tracking is a nice-to-have. Never let it stop the reply going out.
  }
  return rawLink;
}

/**
 * Pick exactly one trigger for a comment.
 *
 * Ordering is priority first, then longer keywords before shorter ones, so a
 * comment saying "MAP AUDIT" produces one reply rather than two, and a specific
 * code beats a generic one. Word mode requires a whole-word match, so 'MAP'
 * does not fire on "mapping".
 */
export async function matchTrigger(env, accountId, text, mediaId) {
  const triggers = await db.activeTriggers(env, accountId);
  for (const t of triggers) {
    // A trigger scoped to one post only fires on that post.
    if (t.ig_media_id && String(t.ig_media_id) !== String(mediaId || '')) continue;
    if (triggerMatches(t, text)) return t;
  }
  return null;
}

/**
 * Does one trigger match one comment? Pulled out as a pure function so it can
 * be tested without a database, which is what scripts/check.mjs does.
 */
export function triggerMatches(trigger, text) {
  const kw = escapeRegex(trigger.keyword);
  const re =
    trigger.match_mode === 'contains'
      ? new RegExp(kw, 'i')
      // Deliberately not \b. \b counts an underscore as a word character, so
      // \bMAP\b would refuse to match 'MAP_2'. Someone commenting 'MAP_2' has
      // typed the code, so an underscore counts as a separator here. What this
      // still refuses to match is the case that matters: the code appearing
      // inside a real word, like 'mapping' or 'roadmap'.
      : new RegExp(`(^|[^a-z0-9])${kw}([^a-z0-9]|$)`, 'i');
  return re.test(String(text || ''));
}

// ---------------------------------------------------------------------------
// DM FLOW: AI reply, grounded, with escalation enforced in code.
// ---------------------------------------------------------------------------
async function handleMessaging(env, entry, event) {
  const igUserId = entry.id;
  const senderId = event.sender?.id;
  const messageId = event.message?.mid;
  const text = event.message?.text;

  // is_echo marks our own outbound message being reflected back. Replying to it
  // would start an infinite loop with ourselves.
  if (event.message?.is_echo) return;
  if (event.read || event.delivery || event.reaction) return; // status events, not messages
  if (!senderId || !messageId) return;

  if (!(await db.claimEvent(env, `message:${messageId}`))) return;

  const account = await db.getAccountByIgUserId(env, igUserId);
  if (!account) {
    await db.logEvent(env, null, 'webhook_unknown_account', { ig_user_id: igUserId, kind: 'message' });
    return;
  }
  if (String(senderId) === String(account.ig_user_id)) return;

  const contact = await db.upsertContact(env, account.id, senderId, event.sender?.username);
  const convo = await db.getOrCreateConversation(env, contact.id, 'dm');

  if (!text) {
    // An attachment, a sticker, a shared post. Nothing to ground a reply in,
    // so it is logged for a human rather than guessed at.
    await db.addMessage(env, convo.id, 'in', '[non-text message]', null);
    await db.logEvent(env, account.id, 'dm_received_non_text', { contact: contact.username || senderId }, senderId);
    return;
  }

  await db.addMessage(env, convo.id, 'in', text, null);
  await db.logEvent(env, account.id, 'dm_received', {
    contact: contact.username || senderId,
    text: text.slice(0, 300),
  }, senderId);

  // An already-escalated thread stays with the human. The bot does not
  // re-enter a conversation it has handed off.
  if (convo.status === 'escalated') {
    await db.logEvent(env, account.id, 'dm_skipped', { reason: 'conversation_already_escalated' }, senderId);
    return;
  }

  // Same cross-channel check as the comment flow: a contact escalated via one
  // channel should not get an automated reply on the other.
  if (await db.contactHasEscalatedConversation(env, contact.id)) {
    await db.logEvent(env, account.id, 'dm_skipped', { reason: 'contact_escalated_elsewhere' }, senderId);
    return;
  }

  if (!(await sendGate(env, account, 'dm'))) return;

  // Daily ceiling on AI-written replies. This bounds the Anthropic bill if the
  // account ever gets flooded, and it is a hard stop rather than a warning:
  // reserved atomically before drafting even starts, so two concurrent DMs for
  // the same account cannot both read "under cap" before either reservation is
  // recorded, and a capped account never spends an Anthropic call it was not
  // allowed to send.
  const aiCap = Number(account.max_ai_replies_per_day);
  if (!Number.isFinite(aiCap) || aiCap <= 0 || !(await db.reserveDailyAiSlot(env, account.id, aiCap))) {
    await db.logEvent(env, account.id, 'send_blocked', {
      reason: 'daily_ai_reply_cap', cap: aiCap, kind: 'dm',
    }, senderId);
    return;
  }

  const guardrails = await db.getGuardrails(env, account.id);
  const resources = await db.listResources(env, account.id);
  const history = await db.recentMessages(env, convo.id, 8);

  let draft;
  try {
    draft = await draftReply(env, { guardrails, resources, history, text, account });
  } catch (err) {
    await db.logEvent(env, account.id, 'dm_draft_failed', { error: err?.message || String(err) }, senderId);
    return;
  }

  // THE GUARDRAIL THAT ACTUALLY HOLDS.
  // Escalation is a branch in this code, not a request in a prompt. If the
  // model says ESCALATE we send nothing at all. A prompt instruction can be
  // talked around; this cannot.
  if (draft.escalate) {
    await db.setConversationStatus(env, convo.id, 'escalated');
    await db.logEvent(env, account.id, 'escalated', {
      contact: contact.username || senderId,
      text: text.slice(0, 300),
      conversation_id: convo.id,
    }, senderId);
    return;
  }

  const replyText = truncateWords(draft.text, guardrails.reply_length_cap || 300);
  if (!replyText) {
    await db.logEvent(env, account.id, 'dm_skipped', { reason: 'empty_draft' }, senderId);
    return;
  }

  try {
    const token = await decryptToken(account.token_ciphertext, env);
    await sendDirectMessage(env, {
      igUserId: account.ig_user_id,
      token,
      recipientId: senderId,
      text: replyText,
    });
    // Not recordSend here: sendGate already reserved this send's slot
    // atomically before the call to Meta above.
    await db.addMessage(env, convo.id, 'out', replyText, 'ai_generated');
    await db.logEvent(env, account.id, 'dm_sent', {
      contact: contact.username || senderId,
      text: replyText,
    }, senderId);
  } catch (err) {
    const message = err?.message || String(err);
    await db.logEvent(env, account.id, 'send_failed', { kind: 'dm', error: message }, senderId);
  }
}

/**
 * Build the system prompt from live database rows and ask Claude for a reply.
 *
 * Nothing about the voice, the banned topics, or the escalation list is
 * hardcoded here. All of it is read from the guardrails row on every message,
 * which is what makes the dashboard form take effect with no redeploy.
 */
async function draftReply(env, { guardrails, resources, history, text, account }) {
  if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY secret is not set');

  const banned = parseJsonColumn(guardrails.banned_topics, []);
  const must = parseJsonColumn(guardrails.must_include, []);
  const escalate = parseJsonColumn(guardrails.escalate_conditions, []);

  const matched = matchResources(resources, text);
  const context = matched.length
    ? matched
        .map((r) => {
          const links = parseJsonColumn(r.links, [])
            .map((l) => `${l.label || 'link'}: ${l.url}`)
            .join('\n');
          return `TOPIC: ${r.topic}\n${r.content}${links ? `\n${links}` : ''}`;
        })
        .join('\n\n---\n\n')
    : '(nothing relevant found)';

  const system = [
    `You are the Instagram assistant for @${account.label}.`,
    ``,
    `Voice: ${guardrails.voice}`,
    banned.length ? `Never discuss: ${banned.join(', ')}.` : '',
    must.length ? `Every reply must: ${must.join('; ')}.` : '',
    `Hard limit: ${guardrails.reply_length_cap} characters.`,
    ``,
    escalate.length
      ? `If the message involves any of: ${escalate.join(', ')} - reply with exactly the string ESCALATE and nothing else. A human will follow up. Do not attempt to handle it yourself.`
      : '',
    ``,
    `Only state facts present in the CONTEXT block below. Never invent a statistic, a price, a date, or a claim that is not in CONTEXT. If CONTEXT has nothing relevant to the question, reply with exactly: ${guardrails.fallback_line}`,
    ``,
    `CONTEXT:`,
    context,
  ]
    .filter((line) => line !== '')
    .join('\n');

  const messages = history.map((m) => ({
    role: m.direction === 'in' ? 'user' : 'assistant',
    content: m.body,
  }));
  // The message currently being answered is already the last inbound row, but
  // guard against an empty history.
  if (!messages.length) messages.push({ role: 'user', content: text });
  if (messages[messages.length - 1].role !== 'user') messages.push({ role: 'user', content: text });

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: env.CLAUDE_MODEL || 'claude-sonnet-4-6',
      max_tokens: 400,
      system,
      messages,
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Claude API ${res.status}: ${detail.slice(0, 300)}`);
  }

  const data = await res.json();
  const out = (data.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();

  // Checked as a substring, not exact equality: the prompt asks for exactly
  // the bare word, but an exact match is brittle against anything the model
  // wraps around it ("I'll ESCALATE this." or the normal-case "Escalate.")
  // failing open to a normal, unreviewed reply -- the opposite of what this
  // branch exists for. A false-positive escalation (a normal reply gets
  // held for a human instead of sent) is the safe direction to be wrong in;
  // a false negative here is not. Nothing user-supplied reaches this check --
  // it only ever runs against the model's own output.
  const escalated = out.toUpperCase().includes('ESCALATE');
  return { escalate: escalated, text: escalated ? '' : out };
}

/**
 * Topic matching, deliberately simple.
 *
 * Scores each resource by how many of its keywords (and its topic words) appear
 * in the message, and returns the best few. The original spec reached for
 * pgvector and a second database service for this. That is worth doing when the
 * resource table has dozens of rows and keyword matching starts missing things.
 * Until then it is infrastructure bought against a problem you do not have, and
 * this function is the honest version of the same job.
 */
export function matchResources(resources, text, limit = 4) {
  const lower = String(text || '').toLowerCase();
  const words = new Set(lower.split(/[^a-z0-9]+/).filter((w) => w.length > 2));

  const scored = resources
    .filter((r) => r.active !== 0)
    .map((r) => {
      const keywords = parseJsonColumn(r.keywords, []).map((k) => String(k).toLowerCase());
      const topicWords = String(r.topic).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
      let score = 0;
      for (const k of keywords) if (k && lower.includes(k)) score += 3;
      for (const w of topicWords) if (words.has(w)) score += 2;
      return { r, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  // Nothing matched: return nothing, on purpose. draftReply treats an empty
  // result as "(nothing relevant found)" and instructs the model to send the
  // fallback line -- the one guarantee this file makes about never inventing
  // an answer. Handing over the whole knowledge base here would leave that
  // guarantee resting on the model choosing not to use topically-unrelated
  // content it was never asked to consider, which is the same kind of
  // prompt-only promise this codebase otherwise refuses to rely on.
  if (!scored.length) return [];
  return scored.slice(0, limit).map((x) => x.r);
}

export { json };
