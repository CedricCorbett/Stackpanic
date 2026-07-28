// Every database read and write goes through here. Keeping SQL in one file
// means the business logic stays readable and there is exactly one place to look
// when a column changes.

import { uuid, nowIso, notFound, parseJsonColumn } from './util.js';

// ===========================================================================
// accounts
// ===========================================================================

export async function listAccounts(env) {
  const { results } = await env.DB.prepare(
    `SELECT id, label, ig_user_id, status, dm_enabled, timezone, require_approval,
            max_ai_replies_per_day, token_expires_at, token_last_error,
            (token_ciphertext IS NOT NULL) AS has_token
     FROM accounts ORDER BY label`
  ).all();
  return results;
}

export async function getAccount(env, id) {
  const row = await env.DB.prepare('SELECT * FROM accounts WHERE id = ?').bind(id).first();
  if (!row) throw notFound(`No account with id '${id}'`);
  return row;
}

export async function getAccountByIgUserId(env, igUserId) {
  return env.DB.prepare('SELECT * FROM accounts WHERE ig_user_id = ?').bind(String(igUserId)).first();
}

export async function setAccountToken(env, id, ciphertext, expiresAt) {
  await env.DB.prepare(
    'UPDATE accounts SET token_ciphertext = ?, token_expires_at = ?, token_last_error = NULL WHERE id = ?'
  ).bind(ciphertext, expiresAt, id).run();
}

export async function setAccountTokenError(env, id, message) {
  await env.DB.prepare('UPDATE accounts SET token_last_error = ? WHERE id = ?')
    .bind(String(message).slice(0, 500), id).run();
}

export async function setAccountFlags(env, id, patch) {
  const sets = [];
  const binds = [];
  if (patch.status !== undefined) { sets.push('status = ?'); binds.push(patch.status); }
  if (patch.dm_enabled !== undefined) { sets.push('dm_enabled = ?'); binds.push(patch.dm_enabled ? 1 : 0); }
  if (patch.require_approval !== undefined) { sets.push('require_approval = ?'); binds.push(patch.require_approval ? 1 : 0); }
  if (patch.timezone !== undefined) { sets.push('timezone = ?'); binds.push(patch.timezone); }
  if (patch.max_ai_replies_per_day !== undefined) {
    sets.push('max_ai_replies_per_day = ?');
    binds.push(Math.max(0, Number(patch.max_ai_replies_per_day) || 0));
  }
  if (!sets.length) return false;
  binds.push(id);
  await env.DB.prepare(`UPDATE accounts SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
  return true;
}

// ===========================================================================
// posts
// ===========================================================================

export async function listPosts(env, { month, from, to, accountId, status } = {}) {
  const where = [];
  const binds = [];
  // from/to is a UTC instant range and is what the calendar view uses: it can
  // ask for a day of slack on each side of a local month, which a fuzzy
  // 'YYYY-MM' prefix match cannot express. month is kept for anyone calling
  // the API directly with the simpler param.
  if (from) { where.push('p.scheduled_time >= ?'); binds.push(from); }
  if (to) { where.push('p.scheduled_time < ?'); binds.push(to); }
  if (month && !from && !to) { where.push('p.scheduled_time LIKE ?'); binds.push(`${month}%`); }
  if (accountId) { where.push('p.account_id = ?'); binds.push(accountId); }
  if (status) { where.push('p.status = ?'); binds.push(status); }

  // Insights are joined on so the calendar can show performance without a
  // second round trip per post.
  const sql =
    `SELECT p.*, i.reach, i.likes AS insight_likes, i.saved, i.follows, i.total_interactions
     FROM posts p LEFT JOIN post_insights i ON i.post_id = p.id` +
    (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
    ' ORDER BY p.scheduled_time ASC';
  const stmt = binds.length ? env.DB.prepare(sql).bind(...binds) : env.DB.prepare(sql);
  const { results } = await stmt.all();
  return results;
}

export async function getPost(env, id) {
  return env.DB.prepare('SELECT * FROM posts WHERE id = ?').bind(id).first();
}

export async function createPost(env, p) {
  const id = uuid();
  const keys = Array.isArray(p.media_keys) ? p.media_keys : null;
  await env.DB.prepare(
    `INSERT INTO posts (id, account_id, caption, media_key, media_keys, media_type,
                        scheduled_time, status, source, first_comment)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id,
    p.account_id,
    p.caption || '',
    p.media_key,
    keys ? JSON.stringify(keys) : null,
    p.media_type || 'IMAGE',
    p.scheduled_time,
    p.status || 'scheduled',
    p.source || 'manual',
    p.first_comment || null
  ).run();
  return id;
}

export async function updatePost(env, id, patch) {
  const sets = [];
  const binds = [];
  for (const f of ['caption', 'scheduled_time', 'media_key', 'media_type', 'status', 'first_comment']) {
    if (patch[f] === undefined) continue;
    sets.push(`${f} = ?`);
    binds.push(patch[f]);
  }
  if (patch.media_keys !== undefined) {
    sets.push('media_keys = ?');
    binds.push(Array.isArray(patch.media_keys) ? JSON.stringify(patch.media_keys) : patch.media_keys);
  }
  if (!sets.length) return false;
  // Re-scheduling or approving a post clears the old error and lets it retry.
  if (patch.status === 'scheduled') sets.push('error = NULL', 'attempts = 0', 'next_attempt_at = NULL');
  binds.push(id);
  const res = await env.DB.prepare(`UPDATE posts SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
  return (res.meta?.changes ?? 0) > 0;
}

export async function deletePost(env, id) {
  await env.DB.prepare('DELETE FROM posts WHERE id = ?').bind(id).run();
}

/**
 * Posts that are due, on an active account, not drafts, not backing off.
 *
 * attempts < 3 is the guard against a permanently broken post being retried
 * every 15 minutes forever.
 */
export async function duePosts(env) {
  const now = nowIso();
  const { results } = await env.DB.prepare(
    `SELECT p.* FROM posts p
     JOIN accounts a ON a.id = p.account_id
     WHERE p.status = 'scheduled'
       AND p.scheduled_time <= ?
       AND p.attempts < 3
       AND (p.next_attempt_at IS NULL OR p.next_attempt_at <= ?)
       AND a.status = 'active'
     ORDER BY p.scheduled_time ASC
     LIMIT 20`
  ).bind(now, now).all();
  return results;
}

export async function markPublishing(env, id) {
  const res = await env.DB.prepare(
    `UPDATE posts SET status = 'publishing', attempts = attempts + 1
     WHERE id = ? AND status = 'scheduled'`
  ).bind(id).run();
  // False means another cron pass already claimed this row. That check is what
  // stops two overlapping runs from double-posting.
  return (res.meta?.changes ?? 0) > 0;
}

export async function markPublished(env, id, { containerId, mediaId, permalink }) {
  await env.DB.prepare(
    `UPDATE posts SET status = 'published', container_id = ?, published_media_id = ?,
            published_url = ?, published_at = ?, error = NULL WHERE id = ?`
  ).bind(containerId, mediaId, permalink, nowIso(), id).run();
}

/**
 * Record progress as soon as it happens, not just at the end. If Instagram
 * accepts the publish and something after that throws, these two calls are
 * what let the failure handler tell "already live, just not recorded yet"
 * apart from "never actually published" -- the difference between a stuck row
 * and a silent duplicate post.
 */
export async function setPostContainerId(env, id, containerId) {
  await env.DB.prepare('UPDATE posts SET container_id = ? WHERE id = ?').bind(containerId, id).run();
}

export async function setPostPublishedMediaId(env, id, mediaId) {
  await env.DB.prepare('UPDATE posts SET published_media_id = ? WHERE id = ?').bind(mediaId, id).run();
}

export async function markFailed(env, id, message) {
  await env.DB.prepare('UPDATE posts SET status = \'failed\', error = ? WHERE id = ?')
    .bind(String(message).slice(0, 1000), id).run();
}

/** Transient failure: back to the queue, with a wait, keeping the attempt count. */
export async function deferPost(env, id, nextAttemptAt, message) {
  await env.DB.prepare(
    'UPDATE posts SET status = \'scheduled\', next_attempt_at = ?, error = ? WHERE id = ?'
  ).bind(nextAttemptAt, String(message).slice(0, 1000), id).run();
}

export async function scheduledTimesInUse(env, accountId, fromIso) {
  const { results } = await env.DB.prepare(
    `SELECT scheduled_time FROM posts
     WHERE account_id = ? AND scheduled_time >= ? AND status IN ('draft','scheduled','publishing')`
  ).bind(accountId, fromIso).all();
  return new Set(results.map((r) => r.scheduled_time));
}

export async function publishedPostsForInsights(env, days = 30) {
  const { results } = await env.DB.prepare(
    `SELECT id, account_id, published_media_id FROM posts
     WHERE status = 'published' AND published_media_id IS NOT NULL
       AND published_at > datetime('now', ?)
     ORDER BY scheduled_time DESC LIMIT 100`
  ).bind(`-${days} days`).all();
  return results;
}

export async function upsertInsights(env, postId, accountId, metrics) {
  const n = (key) => (Number.isFinite(Number(metrics[key])) ? Number(metrics[key]) : null);
  await env.DB.prepare(
    `INSERT INTO post_insights (post_id, account_id, reach, impressions, likes, comments,
                                saved, shares, profile_visits, follows, total_interactions, raw, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(post_id) DO UPDATE SET
       reach = excluded.reach, impressions = excluded.impressions, likes = excluded.likes,
       comments = excluded.comments, saved = excluded.saved, shares = excluded.shares,
       profile_visits = excluded.profile_visits, follows = excluded.follows,
       total_interactions = excluded.total_interactions, raw = excluded.raw,
       fetched_at = excluded.fetched_at`
  ).bind(
    postId, accountId, n('reach'), n('impressions'), n('likes'), n('comments'),
    n('saved'), n('shares'), n('profile_visits'), n('follows'), n('total_interactions'),
    JSON.stringify(metrics).slice(0, 4000), nowIso()
  ).run();
}

// ===========================================================================
// slots (posting schedule)
// ===========================================================================

export async function listSlots(env, accountId) {
  const sql = accountId
    ? 'SELECT * FROM slots WHERE account_id = ? ORDER BY weekday, hour, minute'
    : 'SELECT * FROM slots ORDER BY account_id, weekday, hour, minute';
  const stmt = accountId ? env.DB.prepare(sql).bind(accountId) : env.DB.prepare(sql);
  const { results } = await stmt.all();
  return results;
}

export async function createSlot(env, s) {
  const id = `slot_${uuid().slice(0, 8)}`;
  await env.DB.prepare(
    'INSERT INTO slots (id, account_id, weekday, hour, minute, label) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(id, s.account_id, Number(s.weekday), Number(s.hour), Number(s.minute) || 0, s.label || null).run();
  return id;
}

export async function updateSlot(env, id, patch) {
  const sets = [];
  const binds = [];
  for (const f of ['weekday', 'hour', 'minute', 'label']) {
    if (patch[f] === undefined) continue;
    sets.push(`${f} = ?`);
    binds.push(f === 'label' ? patch[f] : Number(patch[f]));
  }
  if (patch.active !== undefined) { sets.push('active = ?'); binds.push(patch.active ? 1 : 0); }
  if (!sets.length) return false;
  binds.push(id);
  const res = await env.DB.prepare(`UPDATE slots SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
  return (res.meta?.changes ?? 0) > 0;
}

export async function deleteSlot(env, id) {
  await env.DB.prepare('DELETE FROM slots WHERE id = ?').bind(id).run();
}

// ===========================================================================
// triggers (comment codes)
// ===========================================================================

const TRIGGER_FIELDS = [
  'keyword', 'label', 'reply_template', 'link', 'public_reply_text',
  'followup_text', 'followup_delay_hours', 'followup_active', 'tag',
  'match_mode', 'priority', 'active', 'ig_media_id',
];

export async function listTriggers(env, accountId) {
  const sql = accountId
    ? `SELECT t.*, (SELECT code FROM short_links WHERE trigger_id = t.id LIMIT 1) AS short_code,
              (SELECT clicks FROM short_links WHERE trigger_id = t.id LIMIT 1) AS clicks
       FROM triggers t WHERE t.account_id = ? ORDER BY t.priority, t.keyword`
    : `SELECT t.*, (SELECT code FROM short_links WHERE trigger_id = t.id LIMIT 1) AS short_code,
              (SELECT clicks FROM short_links WHERE trigger_id = t.id LIMIT 1) AS clicks
       FROM triggers t ORDER BY t.account_id, t.priority, t.keyword`;
  const stmt = accountId ? env.DB.prepare(sql).bind(accountId) : env.DB.prepare(sql);
  const { results } = await stmt.all();
  return results;
}

export async function getTrigger(env, id) {
  return env.DB.prepare('SELECT * FROM triggers WHERE id = ?').bind(id).first();
}

export async function activeTriggers(env, accountId) {
  const { results } = await env.DB.prepare(
    'SELECT * FROM triggers WHERE account_id = ? AND active = 1 ORDER BY priority ASC, length(keyword) DESC'
  ).bind(accountId).all();
  return results;
}

export async function createTrigger(env, t) {
  const id = t.id || `trg_${uuid().slice(0, 8)}`;
  await env.DB.prepare(
    `INSERT INTO triggers (id, account_id, keyword, label, reply_template, link, public_reply_text,
                           followup_text, followup_delay_hours, followup_active, tag,
                           match_mode, priority, active, ig_media_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, t.account_id, String(t.keyword).trim().toUpperCase(), t.label || null,
    t.reply_template, t.link || null, t.public_reply_text || null,
    t.followup_text || null, Number(t.followup_delay_hours) || 20, t.followup_active ? 1 : 0,
    t.tag || null, t.match_mode || 'word',
    Number.isFinite(t.priority) ? t.priority : 100,
    t.active === false ? 0 : 1, t.ig_media_id || null
  ).run();
  return id;
}

export async function updateTrigger(env, id, patch) {
  const sets = [];
  const binds = [];
  for (const f of TRIGGER_FIELDS) {
    if (patch[f] === undefined) continue;
    sets.push(`${f} = ?`);
    if (f === 'keyword') binds.push(String(patch[f]).trim().toUpperCase());
    else if (f === 'active' || f === 'followup_active') binds.push(patch[f] ? 1 : 0);
    else if (f === 'priority' || f === 'followup_delay_hours') binds.push(Number(patch[f]) || 0);
    else binds.push(patch[f]);
  }
  if (!sets.length) return false;
  binds.push(id);
  const res = await env.DB.prepare(`UPDATE triggers SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
  return (res.meta?.changes ?? 0) > 0;
}

export async function deleteTrigger(env, id) {
  await env.DB.prepare('DELETE FROM short_links WHERE trigger_id = ?').bind(id).run();
  await env.DB.prepare('DELETE FROM triggers WHERE id = ?').bind(id).run();
}

export async function bumpTriggerHit(env, id) {
  await env.DB.prepare('UPDATE triggers SET hit_count = hit_count + 1 WHERE id = ?').bind(id).run();
}

// ===========================================================================
// short links and click tracking
// ===========================================================================

export async function getShortLinkByTrigger(env, triggerId) {
  return env.DB.prepare('SELECT * FROM short_links WHERE trigger_id = ? LIMIT 1').bind(triggerId).first();
}

export async function getShortLink(env, code) {
  return env.DB.prepare('SELECT * FROM short_links WHERE code = ?').bind(code).first();
}

export async function createShortLink(env, { code, accountId, targetUrl, triggerId, label }) {
  await env.DB.prepare(
    'INSERT INTO short_links (code, account_id, target_url, trigger_id, label) VALUES (?, ?, ?, ?, ?)'
  ).bind(code, accountId, targetUrl, triggerId || null, label || null).run();
  return code;
}

export async function updateShortLinkTarget(env, code, targetUrl) {
  await env.DB.prepare('UPDATE short_links SET target_url = ? WHERE code = ?').bind(targetUrl, code).run();
}

export async function deleteShortLinksForTrigger(env, triggerId) {
  await env.DB.prepare('DELETE FROM short_links WHERE trigger_id = ?').bind(triggerId).run();
}

export async function listShortLinks(env, accountId) {
  const sql = accountId
    ? 'SELECT * FROM short_links WHERE account_id = ? ORDER BY clicks DESC'
    : 'SELECT * FROM short_links ORDER BY clicks DESC';
  const stmt = accountId ? env.DB.prepare(sql).bind(accountId) : env.DB.prepare(sql);
  const { results } = await stmt.all();
  return results;
}

export async function recordClick(env, { code, accountId, contactId, referer, userAgent }) {
  await env.DB.prepare('UPDATE short_links SET clicks = clicks + 1 WHERE code = ?').bind(code).run();
  await env.DB.prepare(
    'INSERT INTO link_clicks (id, code, account_id, contact_id, referer, user_agent) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(uuid(), code, accountId, contactId || null, (referer || '').slice(0, 300), (userAgent || '').slice(0, 300)).run();
}

/** Clicks per code over a window, for the analytics view. */
export async function clickStats(env, accountId, days = 30) {
  const { results } = await env.DB.prepare(
    `SELECT s.code, s.label, s.target_url, s.trigger_id, t.keyword, s.clicks AS total_clicks,
            (SELECT COUNT(*) FROM link_clicks c
              WHERE c.code = s.code AND c.created_at > datetime('now', ?)) AS recent_clicks
     FROM short_links s LEFT JOIN triggers t ON t.id = s.trigger_id
     WHERE s.account_id = ? ORDER BY recent_clicks DESC, s.clicks DESC`
  ).bind(`-${days} days`, accountId).all();
  return results;
}

// ===========================================================================
// contacts, conversations, messages
// ===========================================================================

/**
 * A plain SELECT-then-INSERT races against the UNIQUE(account_id, ig_scoped_id)
 * constraint: two near-simultaneous webhook deliveries for the same person
 * (e.g. a comment and a DM in the same burst) can both see "no existing row"
 * and both try to INSERT, and the loser throws instead of resolving to the row
 * the winner just created. INSERT ... ON CONFLICT DO NOTHING makes the insert
 * itself race-safe, so every caller just re-selects afterward no matter which
 * concurrent call actually created the row.
 */
export async function upsertContact(env, accountId, igScopedId, username) {
  const scoped = String(igScopedId);
  await env.DB.prepare(
    `INSERT INTO contacts (id, account_id, ig_scoped_id, username) VALUES (?, ?, ?, ?)
     ON CONFLICT(account_id, ig_scoped_id) DO NOTHING`
  ).bind(uuid(), accountId, scoped, username || null).run();

  const row = await env.DB.prepare(
    'SELECT * FROM contacts WHERE account_id = ? AND ig_scoped_id = ?'
  ).bind(accountId, scoped).first();

  const lastInteractionAt = nowIso();
  await env.DB.prepare(
    'UPDATE contacts SET last_interaction_at = ?, username = COALESCE(?, username) WHERE id = ?'
  ).bind(lastInteractionAt, username || null, row.id).run();

  return { ...row, last_interaction_at: lastInteractionAt, username: row.username || username || null };
}

/** Add a tag without duplicating it. Tags are how you segment later. */
export async function addContactTag(env, contactId, tag) {
  if (!tag) return;
  const row = await env.DB.prepare('SELECT tags FROM contacts WHERE id = ?').bind(contactId).first();
  const tags = parseJsonColumn(row?.tags, []);
  if (tags.includes(tag)) return;
  tags.push(tag);
  await env.DB.prepare('UPDATE contacts SET tags = ? WHERE id = ?')
    .bind(JSON.stringify(tags), contactId).run();
}

export async function setContact(env, contactId, patch) {
  const sets = [];
  const binds = [];
  if (patch.tags !== undefined) {
    sets.push('tags = ?');
    binds.push(typeof patch.tags === 'string' ? patch.tags : JSON.stringify(patch.tags));
  }
  if (patch.note !== undefined) { sets.push('note = ?'); binds.push(patch.note); }
  if (!sets.length) return false;
  binds.push(contactId);
  await env.DB.prepare(`UPDATE contacts SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
  return true;
}

export async function listContacts(env, { accountId, tag, limit = 200 } = {}) {
  const where = [];
  const binds = [];
  if (accountId) { where.push('account_id = ?'); binds.push(accountId); }
  // LIKE on the JSON text is crude but exact enough with quoted tags, and it
  // avoids a join table for what is a handful of labels.
  if (tag) { where.push('tags LIKE ?'); binds.push(`%"${tag}"%`); }
  binds.push(Math.min(500, Number(limit) || 200));
  const { results } = await env.DB.prepare(
    `SELECT * FROM contacts${where.length ? ` WHERE ${where.join(' AND ')}` : ''}
     ORDER BY last_interaction_at DESC LIMIT ?`
  ).bind(...binds).all();
  return results;
}

export async function getOrCreateConversation(env, contactId, channel) {
  // Same race as upsertContact, same fix: an atomic insert-or-nothing followed
  // by an unconditional re-select, instead of a SELECT that can lose a race to
  // another concurrent call's INSERT.
  await env.DB.prepare(
    `INSERT INTO conversations (id, contact_id, channel) VALUES (?, ?, ?)
     ON CONFLICT(contact_id, channel) DO NOTHING`
  ).bind(uuid(), contactId, channel).run();

  return env.DB.prepare(
    'SELECT * FROM conversations WHERE contact_id = ? AND channel = ?'
  ).bind(contactId, channel).first();
}

/** Is this contact's OTHER channel currently escalated to a human? A contact
 * mid-escalation over DM should not still get an automated reply triggered by
 * a comment code on the same account, or vice versa. */
export async function contactHasEscalatedConversation(env, contactId) {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM conversations WHERE contact_id = ? AND status = 'escalated'"
  ).bind(contactId).first();
  return (row?.n ?? 0) > 0;
}

export async function getConversationFull(env, id) {
  return env.DB.prepare(
    `SELECT cv.id, cv.channel, cv.status, cv.created_at,
            c.id AS contact_id, c.account_id, c.ig_scoped_id, c.username, c.tags, c.last_interaction_at
     FROM conversations cv JOIN contacts c ON c.id = cv.contact_id
     WHERE cv.id = ?`
  ).bind(id).first();
}

export async function setConversationStatus(env, id, status) {
  await env.DB.prepare('UPDATE conversations SET status = ? WHERE id = ?').bind(status, id).run();
}

export async function addMessage(env, conversationId, direction, body, source) {
  await env.DB.prepare(
    'INSERT INTO messages (id, conversation_id, direction, body, source) VALUES (?, ?, ?, ?, ?)'
  ).bind(uuid(), conversationId, direction, String(body).slice(0, 4000), source || null).run();
}

export async function recentMessages(env, conversationId, limit = 10) {
  const { results } = await env.DB.prepare(
    'SELECT direction, body, source, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT ?'
  ).bind(conversationId, limit).all();
  return results.reverse(); // oldest first, which is the order a model expects
}

/**
 * Has the contact said anything, on either channel, since a given moment?
 * Cancels a follow-up.
 *
 * Two things a naive version gets wrong:
 *  - Comparing created_at (SQLite's own 'YYYY-MM-DD HH:MM:SS') against an
 *    ISO 8601 value ('YYYY-MM-DDTHH:MM:SS.SSSZ') as raw strings: the 'T' sorts
 *    after a space, so same-day comparisons are false regardless of actual
 *    time order. Wrapping the bound value in datetime(...) normalizes it to
 *    SQLite's own format first.
 *  - Only checking the one conversation a follow-up was queued against. A
 *    follow-up queued from a comment-code reply lives on the 'comment'
 *    channel, but the natural way to reply to that DM is on the 'dm' channel
 *    -- a different conversations row for the same contact. Checking across
 *    every conversation for that contact, not just this one, is what makes
 *    "they already replied" actually catch the common case.
 */
export async function hasInboundSince(env, conversationId, sinceIso) {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM messages m
     WHERE m.direction = 'in' AND m.created_at > datetime(?)
       AND m.conversation_id IN (
         SELECT id FROM conversations WHERE contact_id = (
           SELECT contact_id FROM conversations WHERE id = ?
         )
       )`
  ).bind(sinceIso, conversationId).first();
  return (row?.n ?? 0) > 0;
}

export async function listConversations(env, { status, accountId, limit = 50 } = {}) {
  const where = [];
  const binds = [];
  if (status) { where.push('cv.status = ?'); binds.push(status); }
  if (accountId) { where.push('c.account_id = ?'); binds.push(accountId); }
  binds.push(Math.min(200, Number(limit) || 50));
  const { results } = await env.DB.prepare(
    `SELECT cv.id, cv.channel, cv.status, cv.created_at,
            c.id AS contact_id, c.username, c.ig_scoped_id, c.account_id, c.tags, c.last_interaction_at
     FROM conversations cv JOIN contacts c ON c.id = cv.contact_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY c.last_interaction_at DESC LIMIT ?`
  ).bind(...binds).all();
  return results;
}

// ===========================================================================
// scheduled sends (timed follow-ups)
// ===========================================================================

export async function queueScheduledSend(env, s) {
  const id = uuid();
  await env.DB.prepare(
    `INSERT INTO scheduled_sends (id, account_id, conversation_id, recipient_id, body, send_after, queued_at, trigger_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, s.account_id, s.conversation_id, s.recipient_id, s.body, s.send_after, nowIso(), s.trigger_id || null).run();
  return id;
}

export async function dueScheduledSends(env) {
  const { results } = await env.DB.prepare(
    'SELECT * FROM scheduled_sends WHERE status = \'pending\' AND send_after <= ? ORDER BY send_after LIMIT 25'
  ).bind(nowIso()).all();
  return results;
}

/**
 * Claim a follow-up before sending it, the same way markPublishing claims a
 * post. Without this, dueScheduledSends alone is a read with no claim, so two
 * overlapping passes (a slow cron tick still running when the next one fires,
 * or a manual /api/run-now overlapping the cron) can both pick up the same row
 * and both send it. False means another pass already claimed this one.
 */
export async function claimScheduledSend(env, id) {
  const res = await env.DB.prepare(
    `UPDATE scheduled_sends SET status = 'sending' WHERE id = ? AND status = 'pending'`
  ).bind(id).run();
  return (res.meta?.changes ?? 0) > 0;
}

export async function resolveScheduledSend(env, id, status, result) {
  await env.DB.prepare('UPDATE scheduled_sends SET status = ?, result = ? WHERE id = ?')
    .bind(status, result ? String(result).slice(0, 500) : null, id).run();
}

export async function listScheduledSends(env, accountId, limit = 50) {
  const { results } = await env.DB.prepare(
    'SELECT * FROM scheduled_sends WHERE account_id = ? ORDER BY send_after DESC LIMIT ?'
  ).bind(accountId, limit).all();
  return results;
}

// ===========================================================================
// resources and guardrails
// ===========================================================================

export async function listResources(env, accountId) {
  const sql = accountId
    ? 'SELECT * FROM resources WHERE account_id = ? ORDER BY topic'
    : 'SELECT * FROM resources ORDER BY account_id, topic';
  const stmt = accountId ? env.DB.prepare(sql).bind(accountId) : env.DB.prepare(sql);
  const { results } = await stmt.all();
  return results;
}

export async function createResource(env, r) {
  const id = uuid();
  await env.DB.prepare(
    'INSERT INTO resources (id, account_id, topic, content, links, keywords) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(
    id, r.account_id, r.topic, r.content,
    typeof r.links === 'string' ? r.links : JSON.stringify(r.links || []),
    typeof r.keywords === 'string' ? r.keywords : JSON.stringify(r.keywords || [])
  ).run();
  return id;
}

export async function updateResource(env, id, patch) {
  const sets = [];
  const binds = [];
  for (const f of ['topic', 'content', 'active']) {
    if (patch[f] === undefined) continue;
    sets.push(`${f} = ?`);
    binds.push(f === 'active' ? (patch[f] ? 1 : 0) : patch[f]);
  }
  for (const f of ['links', 'keywords']) {
    if (patch[f] === undefined) continue;
    sets.push(`${f} = ?`);
    binds.push(typeof patch[f] === 'string' ? patch[f] : JSON.stringify(patch[f]));
  }
  if (!sets.length) return false;
  sets.push('updated_at = ?');
  binds.push(nowIso(), id);
  const res = await env.DB.prepare(`UPDATE resources SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
  return (res.meta?.changes ?? 0) > 0;
}

export async function deleteResource(env, id) {
  await env.DB.prepare('DELETE FROM resources WHERE id = ?').bind(id).run();
}

export async function getGuardrails(env, accountId) {
  let row = await env.DB.prepare('SELECT * FROM guardrails WHERE account_id = ?').bind(accountId).first();
  if (!row) {
    await env.DB.prepare('INSERT OR IGNORE INTO guardrails (account_id) VALUES (?)').bind(accountId).run();
    row = await env.DB.prepare('SELECT * FROM guardrails WHERE account_id = ?').bind(accountId).first();
  }
  return row;
}

export async function updateGuardrails(env, accountId, patch) {
  const sets = [];
  const binds = [];
  for (const f of ['voice', 'fallback_line']) {
    if (patch[f] === undefined) continue;
    sets.push(`${f} = ?`);
    binds.push(patch[f]);
  }
  if (patch.reply_length_cap !== undefined) {
    sets.push('reply_length_cap = ?');
    binds.push(Math.max(40, Math.min(950, Number(patch.reply_length_cap) || 300)));
  }
  for (const f of ['banned_topics', 'must_include', 'escalate_conditions']) {
    if (patch[f] === undefined) continue;
    sets.push(`${f} = ?`);
    binds.push(typeof patch[f] === 'string' ? patch[f] : JSON.stringify(patch[f]));
  }
  if (!sets.length) return false;
  sets.push('updated_at = ?');
  binds.push(nowIso(), accountId);
  await env.DB.prepare(`UPDATE guardrails SET ${sets.join(', ')} WHERE account_id = ?`).bind(...binds).run();
  return true;
}

// ===========================================================================
// events, idempotency, rate limiting, spend cap
// ===========================================================================

export async function logEvent(env, accountId, eventType, payload = {}, igScopedId = null) {
  try {
    await env.DB.prepare(
      'INSERT INTO events_log (id, account_id, event_type, payload, ig_scoped_id) VALUES (?, ?, ?, ?, ?)'
    ).bind(uuid(), accountId || null, eventType, JSON.stringify(payload).slice(0, 8000), igScopedId ? String(igScopedId) : null).run();
  } catch (err) {
    // Logging must never be the reason a reply fails to send.
    console.error('logEvent failed', eventType, err?.message);
  }
}

export async function readLog(env, { limit = 100, accountId, eventType } = {}) {
  const where = [];
  const binds = [];
  if (accountId) { where.push('account_id = ?'); binds.push(accountId); }
  if (eventType) { where.push('event_type = ?'); binds.push(eventType); }
  binds.push(Math.min(500, Number(limit) || 100));
  const { results } = await env.DB.prepare(
    `SELECT * FROM events_log${where.length ? ` WHERE ${where.join(' AND ')}` : ''}
     ORDER BY created_at DESC LIMIT ?`
  ).bind(...binds).all();
  return results;
}

/** True the first time an event key is seen, false on every Meta retry. */
export async function claimEvent(env, eventKey) {
  try {
    await env.DB.prepare('INSERT INTO processed_events (event_key) VALUES (?)').bind(eventKey).run();
    return true;
  } catch {
    return false;
  }
}

export async function recordSend(env, accountId, kind) {
  await env.DB.prepare('INSERT INTO sends (id, account_id, kind) VALUES (?, ?, ?)')
    .bind(uuid(), accountId, kind).run();
}

/**
 * Atomically reserve one hourly-cap send slot for an account, in a single SQL
 * statement: the count check and the insert happen as one atomic unit, so two
 * overlapping webhook deliveries for the same account cannot both read "under
 * cap" before either one's send is recorded -- the gap a separate
 * count-then-insert has, since a real Instagram API call sits in between them.
 *
 * If the actual send to Instagram fails after a successful reservation, the
 * slot stays spent rather than refunded: undercounting remaining capacity by
 * one is the safe direction, overcounting it is not.
 */
export async function reserveSendSlot(env, accountId, kind, capPerHour) {
  const res = await env.DB.prepare(
    `INSERT INTO sends (id, account_id, kind)
     SELECT ?, ?, ?
     WHERE (SELECT COUNT(*) FROM sends WHERE account_id = ? AND created_at > datetime('now', '-1 hours')) < ?`
  ).bind(uuid(), accountId, kind, accountId, capPerHour).run();
  return (res.meta?.changes ?? 0) > 0;
}

/**
 * Same atomic reserve-in-one-statement pattern as reserveSendSlot, for the
 * daily AI-reply ceiling. Reserved before drafting even starts, so a capped
 * account never spends an Anthropic call it isn't allowed to send.
 */
export async function reserveDailyAiSlot(env, accountId, capPerDay) {
  const res = await env.DB.prepare(
    `INSERT INTO sends (id, account_id, kind)
     SELECT ?, ?, 'ai_reply_reserved'
     WHERE (SELECT COUNT(*) FROM sends WHERE account_id = ? AND kind = 'ai_reply_reserved'
            AND created_at > datetime('now', '-1 days')) < ?`
  ).bind(uuid(), accountId, accountId, capPerDay).run();
  return (res.meta?.changes ?? 0) > 0;
}

// ===========================================================================
// heartbeats and system state
// ===========================================================================

export async function setSystemState(env, key, value) {
  await env.DB.prepare(
    `INSERT INTO system_state (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).bind(key, value, nowIso()).run();
}

export async function getSystemState(env) {
  const { results } = await env.DB.prepare('SELECT * FROM system_state').all();
  const out = {};
  for (const row of results) out[row.key] = { value: row.value, updated_at: row.updated_at };
  return out;
}

// ===========================================================================
// export, deletion requests, housekeeping
// ===========================================================================

const EXPORT_TABLES = [
  'accounts', 'posts', 'post_insights', 'slots', 'triggers', 'short_links',
  'link_clicks', 'contacts', 'conversations', 'messages', 'scheduled_sends',
  'resources', 'guardrails', 'events_log',
];

/**
 * A full snapshot, for the backup cron and the manual export button.
 *
 * The token ciphertext is stripped. A backup containing it would be a copy of
 * your credentials sitting in a bucket, and it is useless anyway without the
 * TOKEN_ENC_KEY secret, which is not in here either.
 */
export async function exportEverything(env) {
  const out = { exported_at: nowIso() };
  for (const table of EXPORT_TABLES) {
    try {
      const { results } = await env.DB.prepare(`SELECT * FROM ${table}`).all();
      out[table] = table === 'accounts'
        ? results.map(({ token_ciphertext, ...rest }) => rest)
        : results;
    } catch (err) {
      out[table] = { error: String(err?.message || err) };
    }
  }
  return out;
}

/**
 * Meta's data deletion callback: erase everything tied to one scoped user id.
 * Cascades handle conversations and messages once the contact row is gone.
 *
 * events_log is purged separately, by ig_scoped_id directly, not by joining
 * through contacts: a comment that never matched a code never creates a
 * contacts row at all, but comment_received/dm_received events still record
 * that person's username and message text. Gating the purge on a contacts row
 * existing would leave exactly that data behind after a "completed" deletion.
 */
export async function deleteContactData(env, igScopedId) {
  const scoped = String(igScopedId);
  const { results } = await env.DB.prepare('SELECT id FROM contacts WHERE ig_scoped_id = ?')
    .bind(scoped).all();
  let removed = 0;
  for (const row of results) {
    await env.DB.prepare('DELETE FROM link_clicks WHERE contact_id = ?').bind(row.id).run();
    await env.DB.prepare('DELETE FROM contacts WHERE id = ?').bind(row.id).run();
    removed++;
  }
  await env.DB.prepare('DELETE FROM events_log WHERE ig_scoped_id = ?').bind(scoped).run();
  return removed;
}

export async function recordDeletionRequest(env, confirmationCode, igScopedId, rowsDeleted) {
  await env.DB.prepare(
    'INSERT OR REPLACE INTO deletion_requests (confirmation_code, ig_scoped_id, status, rows_deleted) VALUES (?, ?, ?, ?)'
  ).bind(confirmationCode, String(igScopedId), 'completed', rowsDeleted).run();
}

export async function getDeletionRequest(env, confirmationCode) {
  return env.DB.prepare('SELECT * FROM deletion_requests WHERE confirmation_code = ?')
    .bind(confirmationCode).first();
}

/** Keep the housekeeping tables from growing without bound. */
export async function pruneOldRows(env) {
  await env.DB.prepare('DELETE FROM processed_events WHERE created_at < datetime(\'now\', \'-7 days\')').run();
  await env.DB.prepare('DELETE FROM sends WHERE created_at < datetime(\'now\', \'-2 days\')').run();
  await env.DB.prepare('DELETE FROM events_log WHERE created_at < datetime(\'now\', \'-90 days\')').run();
  await env.DB.prepare(
    'DELETE FROM scheduled_sends WHERE status != \'pending\' AND created_at < datetime(\'now\', \'-30 days\')'
  ).run();
}
