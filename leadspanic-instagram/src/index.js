// leadspanic-instagram
//
// One Cloudflare Worker, one database, three groups of routes.
//
//   SCHEDULER   /api/posts, /api/media, /api/slots, /api/queue, /media/*
//               + the 15-minute publish cron
//   REPLIES     /webhook/instagram
//               + comment codes, DM replies, timed follow-ups
//   PUBLIC      /r/<code>       tracked short links, counts the click, redirects
//               /webhook/deletion  Meta's data deletion callback
//               /privacy           the policy page Meta App Review requires
//
// Everything under /api requires a bearer token, reads included.
// /media/* and /r/* are deliberately public: Meta has to fetch your media, and
// the people clicking your links are not logged in to anything.

import {
  json, HttpError, badRequest, notFound, authenticate, ingestMayReach, readJson,
  uuid, isoPlusSeconds, shortCode, withUtm, resolvePostStatus,
} from './util.js';
import { encryptToken, decryptToken, parseSignedRequest } from './crypto.js';
import * as db from './db.js';
import {
  publishDuePosts, processScheduledSends, dailyMaintenance,
  refreshExpiringTokens, refreshInsights, writeBackup,
} from './publish.js';
import { handleWebhookVerify, handleWebhookEvent } from './webhook.js';
import { whoAmI, refreshLongLivedToken } from './meta.js';
import { nextFreeSlot } from './schedule.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    try {
      // ---------- Meta webhooks (authenticated by signature, not bearer) ----
      if (path === '/webhook/instagram') {
        if (method === 'GET') return handleWebhookVerify(request, env);
        // `return await`, not bare `return`. Returning the promise un-awaited lets a
        // rejection escape this try block entirely, so the error handler below
        // never sees it and the caller gets an opaque 500 instead of the real
        // status code. Every async handler in this router is awaited for that
        // reason.
        if (method === 'POST') return await handleWebhookEvent(request, env, ctx);
        return new Response('Method not allowed', { status: 405 });
      }
      if (path === '/webhook/deletion' && method === 'POST') {
        return await handleDeletionRequest(request, env);
      }
      if (path === '/deletion-status' && method === 'GET') {
        return await handleDeletionStatus(url, env);
      }

      // ---------- tracked short links ----------
      if (path.startsWith('/r/') && method === 'GET') {
        return await handleRedirect(path.slice(3), request, env, ctx);
      }

      // ---------- public media (Meta fetches from here) ----------
      if (path.startsWith('/media/') && method === 'GET') {
        return await serveMedia(env, decodeURIComponent(path.slice('/media/'.length)));
      }

      // ---------- authenticated API ----------
      if (path.startsWith('/api/')) {
        const level = authenticate(request, env);
        return await handleApi(path, method, request, env, ctx, url, level);
      }

      return withSecurityHeaders(await env.ASSETS.fetch(request));
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status >= 500) console.error(err);
      return json({ error: err?.message || String(err) }, status);
    }
  },

  async scheduled(event, env, ctx) {
    // Which cron fired is identified by its expression, so one Worker runs two
    // unrelated jobs on different schedules.
    if (event.cron === '10 6 * * *') {
      ctx.waitUntil(dailyMaintenance(env));
    } else {
      ctx.waitUntil(
        (async () => {
          await publishDuePosts(env);
          await processScheduledSends(env);
        })()
      );
    }
  },
};

/**
 * The dashboard keeps its bearer token in localStorage (see README's setup
 * section), so anything served from this origin is worth locking down even
 * though every current interpolation into the DOM is already escaped. This is
 * a backstop, not the primary defense: connect-src 'self' means that even if a
 * future change ever let a script run on this page, it could not phone the
 * token home to another domain. style-src needs 'unsafe-inline' for the
 * handful of inline style attributes already in the dashboard markup, and
 * style/font sources add Google Fonts, which the dashboard loads directly.
 */
function withSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set('x-content-type-options', 'nosniff');
  headers.set('content-security-policy', [
    "default-src 'self'",
    "connect-src 'self'",
    "img-src 'self' data:",
    "media-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join('; '));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

// ===========================================================================
// public: tracked short links
// ===========================================================================

/**
 * Count the click, then redirect. This is the whole attribution story, and it
 * needs no Meta permission because the data is yours.
 *
 * The redirect happens immediately and the write is deferred with waitUntil, so
 * a slow database never shows up as a slow link for the person clicking it.
 */
async function handleRedirect(code, request, env, ctx) {
  const link = await db.getShortLink(env, code);
  if (!link) return new Response('Link not found', { status: 404 });

  ctx.waitUntil(
    db.recordClick(env, {
      code,
      accountId: link.account_id,
      referer: request.headers.get('referer'),
      userAgent: request.headers.get('user-agent'),
    }).catch(() => {})
  );

  return Response.redirect(link.target_url, 302);
}

// ===========================================================================
// public: Meta data deletion callback
//
// Meta requires this for the permissions you are requesting. It must verify the
// signed request, actually delete the data, and return a status URL plus a
// confirmation code.
// ===========================================================================

async function handleDeletionRequest(request, env) {
  const form = await request.formData().catch(() => null);
  const signed = form?.get('signed_request');
  if (!signed) throw badRequest('Missing signed_request');

  const payload = await parseSignedRequest(signed, env.META_APP_SECRET);
  const userId = payload.user_id;
  if (!userId) throw badRequest('signed_request contained no user_id');

  const removed = await db.deleteContactData(env, userId);
  const confirmationCode = `del_${uuid().replace(/-/g, '').slice(0, 16)}`;
  await db.recordDeletionRequest(env, confirmationCode, userId, removed);
  await db.logEvent(env, null, 'deletion_request', { rows_deleted: removed, confirmation_code: confirmationCode });

  const origin = (env.PUBLIC_ORIGIN || new URL(request.url).origin).replace(/\/$/, '');
  return json({
    url: `${origin}/deletion-status?code=${confirmationCode}`,
    confirmation_code: confirmationCode,
  });
}

async function handleDeletionStatus(url, env) {
  const code = url.searchParams.get('code');
  const row = code ? await db.getDeletionRequest(env, code) : null;
  const body = row
    ? `<h1>Data deletion complete</h1>
       <p>Confirmation code: <code>${code}</code></p>
       <p>Requested ${row.created_at} UTC. ${row.rows_deleted} contact record(s) were deleted, along with all
       associated conversations, messages and click records.</p>`
    : `<h1>Unknown confirmation code</h1>
       <p>No deletion request matches that code.</p>`;

  return new Response(
    `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
     <meta name="viewport" content="width=device-width,initial-scale=1">
     <title>Data deletion status</title>
     <style>body{font-family:system-ui,sans-serif;background:#0E0F12;color:#F0F0EC;
     max-width:36rem;margin:3rem auto;padding:0 1rem;line-height:1.6}
     code{background:#1D2027;padding:.15rem .35rem;border-radius:4px}</style>
     </head><body>${body}</body></html>`,
    { status: row ? 200 : 404, headers: { 'content-type': 'text/html; charset=utf-8' } }
  );
}

// ===========================================================================
// API router
// ===========================================================================

async function handleApi(path, method, request, env, ctx, url, level = 'admin') {
  const seg = path.split('/').filter(Boolean); // ['api', 'posts', ':id', ':sub']
  const resource = seg[1];
  const id = seg[2] ? decodeURIComponent(seg[2]) : null;
  const sub = seg[3] || null;
  const accountParam = url.searchParams.get('account_id');

  // An ingest token gets a tiny allow-list and nothing else. 403 rather than
  // 401, because the token is valid, it just is not allowed here.
  if (level === 'ingest' && !ingestMayReach(resource, method, id)) {
    throw new HttpError(
      403,
      'This is an ingest token. It can upload media and create drafts, nothing else. Use the admin API_TOKEN for this route.'
    );
  }

  // ---------------- status and health ----------------
  if (resource === 'status' && method === 'GET') {
    const accounts = await db.listAccounts(env);
    const [lastEvent] = await db.readLog(env, { limit: 1 });
    const system = await db.getSystemState(env);
    return json({
      ok: true,
      public_origin: env.PUBLIC_ORIGIN,
      public_origin_configured: !!env.PUBLIC_ORIGIN && !env.PUBLIC_ORIGIN.includes('YOUR-SUBDOMAIN'),
      graph_version: env.GRAPH_VERSION,
      send_cap_per_hour: Number(env.SEND_CAP_PER_HOUR) || 150,
      secrets_present: {
        API_TOKEN: !!env.API_TOKEN,
        INGEST_TOKEN: !!env.INGEST_TOKEN,
        TOKEN_ENC_KEY: !!env.TOKEN_ENC_KEY,
        META_APP_SECRET: !!env.META_APP_SECRET,
        WEBHOOK_VERIFY_TOKEN: !!env.WEBHOOK_VERIFY_TOKEN,
        ANTHROPIC_API_KEY: !!env.ANTHROPIC_API_KEY,
      },
      accounts,
      heartbeats: system,
      last_event_at: lastEvent?.created_at || null,
    });
  }

  // ---------------- accounts ----------------
  if (resource === 'accounts') {
    if (method === 'GET' && !id) return json(await db.listAccounts(env));

    // POST /api/accounts/:id/token  { token: "IGAA..." }
    // How a token gets in. Encrypted before it touches the database; the
    // plaintext exists only for the length of this request.
    if (method === 'POST' && id && sub === 'token') {
      const body = await readJson(request);
      const token = String(body.token || '').trim();
      if (!token) throw badRequest('Provide { "token": "..." }');

      const account = await db.getAccount(env, id);

      // Confirm the token works, and that it belongs to this account, before
      // storing it. Storing a wrong token is a confusing failure much later.
      const me = await whoAmI(env, token);
      if (me.id && String(me.id) !== String(account.ig_user_id)) {
        throw badRequest(
          `That token belongs to Instagram account id ${me.id} (@${me.username || '?'}), but '${id}' is configured as ${account.ig_user_id}. Nothing was saved.`
        );
      }

      // Exchange immediately for a fresh long-lived token so we know the real
      // expiry instead of guessing 60 days.
      let stored = token;
      let expiresAt = isoPlusSeconds(60 * 86400);
      try {
        const refreshed = await refreshLongLivedToken(env, token);
        stored = refreshed.token;
        expiresAt = isoPlusSeconds(refreshed.expiresInSeconds);
      } catch {
        // A token under 24 hours old cannot be refreshed yet. Store as given;
        // the daily cron picks it up.
      }

      await db.setAccountToken(env, id, await encryptToken(stored, env), expiresAt);
      await db.logEvent(env, id, 'token_stored', { username: me.username || null, expires_at: expiresAt });
      return json({ ok: true, username: me.username || null, token_expires_at: expiresAt });
    }

    if (method === 'GET' && id && sub === 'test') {
      const account = await db.getAccount(env, id);
      const token = await decryptToken(account.token_ciphertext, env);
      const me = await whoAmI(env, token);
      return json({ ok: true, id: me.id, username: me.username });
    }

    if (method === 'PATCH' && id && !sub) {
      const body = await readJson(request);
      if (body.status && !['active', 'paused'].includes(body.status)) {
        throw badRequest("status must be 'active' or 'paused'");
      }
      if (body.timezone) {
        // Reject a bad timezone here rather than at 9am on a Tuesday when a
        // queued post silently fails to place.
        try {
          new Intl.DateTimeFormat('en-US', { timeZone: body.timezone });
        } catch {
          throw badRequest(`'${body.timezone}' is not a valid IANA timezone, e.g. America/New_York`);
        }
      }
      await db.getAccount(env, id);
      await db.setAccountFlags(env, id, body);
      await db.logEvent(env, id, 'account_settings_changed', body);
      return json({ ok: true });
    }
  }

  // ---------------- posts ----------------
  if (resource === 'posts') {
    if (method === 'GET' && !id) {
      return json(await db.listPosts(env, {
        month: url.searchParams.get('month'),
        from: url.searchParams.get('from'),
        to: url.searchParams.get('to'),
        accountId: accountParam,
        status: url.searchParams.get('status'),
      }));
    }
    if (method === 'POST' && !id) {
      const body = await readJson(request);
      return json(await createPostFromBody(env, body, level), 201);
    }
    // PATCH /api/posts/:id/approve  — a draft becomes a scheduled post
    if (method === 'POST' && id && sub === 'approve') {
      const post = await db.getPost(env, id);
      if (!post) throw notFound('No such post');
      if (post.status !== 'draft') throw badRequest(`That post is '${post.status}', not a draft.`);
      await db.updatePost(env, id, { status: 'scheduled' });
      await db.logEvent(env, post.account_id, 'post_approved', { post_id: id });
      return json({ ok: true });
    }
    if (method === 'PATCH' && id) {
      const ok = await db.updatePost(env, id, await readJson(request));
      if (!ok) throw badRequest('No editable fields provided, or no such post');
      return json({ ok: true });
    }
    if (method === 'DELETE' && id) {
      await db.deletePost(env, id);
      return json({ ok: true });
    }
  }

  // ---------------- queue: drop content into the next free slot ----------
  if (resource === 'queue' && method === 'POST') {
    const body = await readJson(request);
    if (!body.account_id) throw badRequest('Missing field: account_id');
    const account = await db.getAccount(env, body.account_id);

    const slots = await db.listSlots(env, account.id);
    if (!slots.some((s) => s.active)) {
      throw badRequest(
        'This account has no active posting slots. Add at least one on the Schedule tab, or post with an explicit scheduled_time instead.'
      );
    }

    const from = Date.now();
    const taken = await db.scheduledTimesInUse(env, account.id, new Date(from).toISOString());
    const slot = nextFreeSlot(slots, account.timezone, taken, from);
    if (!slot) throw badRequest('No free slot in the next 90 days. Add more slots or schedule explicitly.');

    const created = await createPostFromBody(env, {
      ...body, scheduled_time: slot.iso, source: body.source || 'queue',
    }, level);
    return json({ ...created, scheduled_time: slot.iso, slot_id: slot.slot.id }, 201);
  }

  // ---------------- slots: the recurring schedule ----------------
  if (resource === 'slots') {
    if (method === 'GET') return json(await db.listSlots(env, accountParam));
    if (method === 'POST') {
      const body = await readJson(request);
      for (const f of ['account_id', 'weekday', 'hour']) {
        if (body[f] === undefined) throw badRequest(`Missing field: ${f}`);
      }
      await db.getAccount(env, body.account_id);
      try {
        return json({ id: await db.createSlot(env, body) }, 201);
      } catch (err) {
        if (String(err?.message).includes('UNIQUE')) throw badRequest('That slot already exists.');
        throw err;
      }
    }
    if (method === 'PATCH' && id) {
      const ok = await db.updateSlot(env, id, await readJson(request));
      if (!ok) throw badRequest('No editable fields provided, or no such slot');
      return json({ ok: true });
    }
    if (method === 'DELETE' && id) {
      await db.deleteSlot(env, id);
      return json({ ok: true });
    }
  }

  // ---------------- media library ----------------
  if (resource === 'media') {
    if (method === 'POST' && !id) return await uploadMedia(request, env, url);

    if (method === 'GET' && !id) {
      const listing = await env.MEDIA.list({
        limit: Math.min(500, Number(url.searchParams.get('limit')) || 100),
        cursor: url.searchParams.get('cursor') || undefined,
      });
      const origin = (env.PUBLIC_ORIGIN || url.origin).replace(/\/$/, '');
      return json({
        objects: listing.objects
          // Backups live in the same bucket under backups/. They are not media.
          .filter((o) => !o.key.startsWith('backups/'))
          .map((o) => ({
            key: o.key,
            size: o.size,
            uploaded: o.uploaded,
            content_type: o.httpMetadata?.contentType || null,
            url: `${origin}/media/${o.key}`,
          })),
        truncated: listing.truncated,
        cursor: listing.truncated ? listing.cursor : null,
      });
    }

    if (method === 'DELETE' && id) {
      if (id.includes('/') || id.includes('..')) throw badRequest('Invalid media key');
      const inUse = await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM posts WHERE (media_key = ? OR media_keys LIKE ?) AND status IN ('draft','scheduled','publishing')"
      ).bind(id, `%"${id}"%`).first();
      if ((inUse?.n ?? 0) > 0) {
        throw badRequest(`That file is still attached to ${inUse.n} unpublished post(s). Delete or re-point those first.`);
      }
      await env.MEDIA.delete(id);
      return json({ ok: true });
    }
  }

  // ---------------- triggers: the comment codes ----------------
  if (resource === 'triggers') {
    if (method === 'GET' && !id) return json(await db.listTriggers(env, accountParam));

    if (method === 'POST' && !id) {
      const body = await readJson(request);
      for (const f of ['account_id', 'keyword', 'reply_template']) {
        if (!body[f]) throw badRequest(`Missing field: ${f}`);
      }
      await db.getAccount(env, body.account_id);
      if (body.link && !String(body.reply_template).includes('{{link}}')) {
        throw badRequest(
          'reply_template has a link set but no {{link}} placeholder, so the link would never appear in the reply. Add {{link}} where you want it.'
        );
      }
      if (body.followup_active && !body.followup_text) {
        throw badRequest('followup_active is on but followup_text is empty.');
      }
      try {
        const newId = await db.createTrigger(env, body);
        await syncShortLink(env, newId, body.account_id, body.link, body.keyword);
        return json({ id: newId }, 201);
      } catch (err) {
        if (String(err?.message).includes('UNIQUE')) {
          throw badRequest(`That account already has a code for keyword '${body.keyword}'`);
        }
        throw err;
      }
    }

    if (method === 'PATCH' && id) {
      const body = await readJson(request);
      const ok = await db.updateTrigger(env, id, body);
      if (!ok) throw badRequest('No editable fields provided, or no such trigger');
      const trigger = await db.getTrigger(env, id);
      if (trigger) await syncShortLink(env, id, trigger.account_id, trigger.link, trigger.keyword);
      return json({ ok: true });
    }

    if (method === 'DELETE' && id) {
      await db.deleteTrigger(env, id);
      return json({ ok: true });
    }
  }

  // ---------------- analytics ----------------
  if (resource === 'analytics' && method === 'GET') {
    const accountId = accountParam;
    if (!accountId) throw badRequest('Specify ?account_id=');
    const days = Number(url.searchParams.get('days')) || 30;

    const [clicks, posts, triggers] = await Promise.all([
      db.clickStats(env, accountId, days),
      db.listPosts(env, { accountId, status: 'published' }),
      db.listTriggers(env, accountId),
    ]);

    const recent = posts.slice(-30);
    const sum = (key) => recent.reduce((acc, p) => acc + (Number(p[key]) || 0), 0);

    return json({
      window_days: days,
      links: clicks,
      total_clicks: clicks.reduce((a, c) => a + (Number(c.recent_clicks) || 0), 0),
      codes: triggers.map((t) => ({
        keyword: t.keyword, label: t.label, hits: t.hit_count,
        clicks: t.clicks || 0, active: !!t.active,
      })),
      posts_published: posts.length,
      insights_totals: {
        reach: sum('reach'),
        saved: sum('saved'),
        follows: sum('follows'),
        total_interactions: sum('total_interactions'),
      },
      // Named plainly so it is obvious this is a count of posts that have
      // insights at all, not a claim about coverage.
      posts_with_insights: recent.filter((p) => p.reach !== null && p.reach !== undefined).length,
    });
  }

  if (resource === 'insights' && method === 'POST' && id === 'refresh') {
    return json({ ok: true, ...(await refreshInsights(env)) });
  }

  // ---------------- resources: the DM knowledge base ----------------
  if (resource === 'resources') {
    if (method === 'GET' && !id) return json(await db.listResources(env, accountParam));
    if (method === 'POST' && !id) {
      const body = await readJson(request);
      for (const f of ['account_id', 'topic', 'content']) {
        if (!body[f]) throw badRequest(`Missing field: ${f}`);
      }
      await db.getAccount(env, body.account_id);
      return json({ id: await db.createResource(env, body) }, 201);
    }
    if (method === 'PATCH' && id) {
      const ok = await db.updateResource(env, id, await readJson(request));
      if (!ok) throw badRequest('No editable fields provided, or no such resource');
      return json({ ok: true });
    }
    if (method === 'DELETE' && id) {
      await db.deleteResource(env, id);
      return json({ ok: true });
    }
  }

  // ---------------- guardrails ----------------
  if (resource === 'guardrails') {
    const accountId = id || accountParam;
    if (!accountId) throw badRequest('Specify an account, e.g. /api/guardrails/leadspanic');
    if (method === 'GET') return json(await db.getGuardrails(env, accountId));
    if (method === 'PUT' || method === 'PATCH') {
      await db.getGuardrails(env, accountId);
      await db.updateGuardrails(env, accountId, await readJson(request));
      await db.logEvent(env, accountId, 'guardrails_updated', {});
      return json({ ok: true });
    }
  }

  // ---------------- contacts and segmentation ----------------
  if (resource === 'contacts') {
    if (method === 'GET' && !id) {
      return json(await db.listContacts(env, {
        accountId: accountParam,
        tag: url.searchParams.get('tag'),
        limit: Number(url.searchParams.get('limit')) || 200,
      }));
    }
    if (method === 'PATCH' && id) {
      const ok = await db.setContact(env, id, await readJson(request));
      if (!ok) throw badRequest('Provide tags or note');
      return json({ ok: true });
    }
  }

  // ---------------- inbox ----------------
  if (resource === 'conversations') {
    // The !id guard matters: without it this also matches
    // /api/conversations/:id/messages and returns the thread list instead.
    if (method === 'GET' && !id) {
      return json(await db.listConversations(env, {
        status: url.searchParams.get('status'),
        accountId: accountParam,
        limit: Number(url.searchParams.get('limit')) || 50,
      }));
    }
    if (method === 'GET' && id && sub === 'messages') {
      return json(await db.recentMessages(env, id, Number(url.searchParams.get('limit')) || 50));
    }
    if (method === 'POST' && id && sub === 'reply') {
      return await manualReply(env, id, await readJson(request));
    }
    if (method === 'PATCH' && id) {
      const body = await readJson(request);
      if (!['open', 'escalated', 'closed'].includes(body.status)) {
        throw badRequest("status must be 'open', 'escalated' or 'closed'");
      }
      await db.setConversationStatus(env, id, body.status);
      return json({ ok: true });
    }
  }

  if (resource === 'scheduled-sends' && method === 'GET') {
    if (!accountParam) throw badRequest('Specify ?account_id=');
    return json(await db.listScheduledSends(env, accountParam));
  }

  // ---------------- log and export ----------------
  if (resource === 'log' && method === 'GET') {
    return json(await db.readLog(env, {
      limit: Number(url.searchParams.get('limit')) || 100,
      accountId: accountParam,
      eventType: url.searchParams.get('event_type'),
    }));
  }

  if (resource === 'export' && method === 'GET') {
    const snapshot = await db.exportEverything(env);
    return new Response(JSON.stringify(snapshot, null, 2), {
      headers: {
        'content-type': 'application/json',
        'content-disposition': `attachment; filename="leadspanic-export-${new Date().toISOString().slice(0, 10)}.json"`,
      },
    });
  }

  if (resource === 'backup' && method === 'POST') {
    return json(await writeBackup(env));
  }

  // ---------------- manual triggers, for testing without waiting on cron ----
  if (resource === 'run-now' && method === 'POST') {
    const published = await publishDuePosts(env);
    const followups = await processScheduledSends(env);
    return json({ ok: true, published, followups });
  }

  if (resource === 'refresh-tokens' && method === 'POST') {
    return json({ ok: true, results: await refreshExpiringTokens(env) });
  }

  // What would this comment do? Answers without touching Instagram.
  if (resource === 'test-match' && method === 'POST') {
    const body = await readJson(request);
    if (!body.account_id || body.text === undefined) {
      throw badRequest('Provide { "account_id": "...", "text": "..." }');
    }
    const { matchTrigger } = await import('./webhook.js');
    const trigger = await matchTrigger(env, body.account_id, body.text, body.ig_media_id);
    let sentLink = null;
    if (trigger) {
      const short = await db.getShortLinkByTrigger(env, trigger.id);
      sentLink = short && env.PUBLIC_ORIGIN && !env.PUBLIC_ORIGIN.includes('YOUR-SUBDOMAIN')
        ? `${env.PUBLIC_ORIGIN.replace(/\/$/, '')}/r/${short.code}`
        : trigger.link || '';
    }
    return json({
      matched: !!trigger,
      keyword: trigger?.keyword || null,
      trigger_id: trigger?.id || null,
      tracked_link: sentLink,
      would_send: trigger ? String(trigger.reply_template).replaceAll('{{link}}', sentLink || '') : null,
      would_public_reply: trigger?.public_reply_text || null,
      would_follow_up: trigger?.followup_active
        ? { in_hours: trigger.followup_delay_hours, text: trigger.followup_text }
        : null,
      would_tag: trigger?.tag || null,
      blocked_reason: trigger && String(trigger.link || '').includes('REPLACE_ME')
        ? 'link is still a placeholder, this code will not send'
        : null,
    });
  }

  throw notFound(`No route for ${method} ${path}`);
}

// ===========================================================================
// helpers
// ===========================================================================

/**
 * Shared by POST /api/posts and POST /api/queue.
 *
 * The require_approval check is the safety catch on autonomous posting: with it
 * on, anything arriving from a skill or the API lands as a draft and waits for
 * you. Something you created by hand in the app is not held back.
 */
async function createPostFromBody(env, body, level = 'admin') {
  for (const f of ['account_id', 'scheduled_time']) {
    if (!body[f]) throw badRequest(`Missing field: ${f}`);
  }
  if (Number.isNaN(Date.parse(body.scheduled_time))) {
    throw badRequest('scheduled_time must be an ISO 8601 timestamp, e.g. 2026-08-01T14:00:00.000Z');
  }

  const account = await db.getAccount(env, body.account_id);
  const mediaType = body.media_type || 'IMAGE';

  let mediaKey = body.media_key;
  let mediaKeys = null;

  if (mediaType === 'CAROUSEL') {
    mediaKeys = Array.isArray(body.media_keys) ? body.media_keys : null;
    if (!mediaKeys || mediaKeys.length < 2 || mediaKeys.length > 10) {
      throw badRequest('A carousel needs media_keys: an array of 2 to 10 R2 keys, in slide order.');
    }
    // Keep the first slide in media_key so the calendar thumbnail and the
    // media-in-use check both keep working unchanged.
    mediaKey = mediaKeys[0];
  } else if (!mediaKey) {
    throw badRequest('Missing field: media_key');
  }

  // An ingest token can only ever create a draft. This is the property that
  // makes it safe to leave in a skill bundle or a scheduled routine: whatever
  // it creates still has to pass your eyes before Instagram sees it. It cannot
  // be overridden by passing status in the body. resolvePostStatus is the pure
  // decision, asserted directly in scripts/check.mjs.
  const fromAutomation = body.source && body.source !== 'manual';
  const status = resolvePostStatus({
    level, requestedStatus: body.status, requireApproval: account.require_approval, fromAutomation,
  });

  const id = await db.createPost(env, {
    ...body, media_key: mediaKey, media_keys: mediaKeys, media_type: mediaType, status,
  });

  if (status === 'draft') {
    await db.logEvent(env, account.id, 'post_drafted', { post_id: id, source: body.source });
  }
  return { id, status };
}

/**
 * Keep a code's tracked short link in step with its destination.
 *
 * UTM tags are applied here rather than asking you to hand-build them, and any
 * you already set on the URL are left alone.
 */
async function syncShortLink(env, triggerId, accountId, link, keyword) {
  if (!link || link.includes('REPLACE_ME')) {
    await db.deleteShortLinksForTrigger(env, triggerId);
    return null;
  }

  const target = withUtm(link, {
    utm_source: 'instagram',
    utm_medium: 'comment_code',
    utm_campaign: String(keyword || '').toLowerCase() || 'code',
    utm_content: accountId,
  });

  const existing = await db.getShortLinkByTrigger(env, triggerId);
  if (existing) {
    if (existing.target_url !== target) await db.updateShortLinkTarget(env, existing.code, target);
    return existing.code;
  }
  return db.createShortLink(env, {
    code: shortCode(),
    accountId,
    targetUrl: target,
    triggerId,
    label: keyword || null,
  });
}

/**
 * Reply to a DM yourself. Your words, sent as typed, no AI.
 *
 * Deliberately not gated on dm_enabled or the hourly cap: those restrain the
 * automation, not you. Pause still applies, because paused means off.
 */
async function manualReply(env, conversationId, body) {
  const text = String(body.text || '').trim();
  if (!text) throw badRequest('Provide { "text": "..." }');

  const thread = await db.getConversationFull(env, conversationId);
  if (!thread) throw notFound('No such conversation');
  if (thread.channel !== 'dm') {
    throw badRequest('Manual replies are only possible on DM threads, not comment threads.');
  }

  const account = await db.getAccount(env, thread.account_id);
  if (account.status !== 'active') throw badRequest(`Account '${account.id}' is paused.`);

  const token = await decryptToken(account.token_ciphertext, env);
  const { sendDirectMessage } = await import('./meta.js');
  await sendDirectMessage(env, {
    igUserId: account.ig_user_id, token, recipientId: thread.ig_scoped_id, text,
  });

  await db.recordSend(env, account.id, 'dm');
  await db.addMessage(env, conversationId, 'out', text, 'human');
  if (thread.status === 'escalated') await db.setConversationStatus(env, conversationId, 'open');
  await db.logEvent(env, account.id, 'dm_sent_manual', {
    contact: thread.username || thread.ig_scoped_id, text,
  });
  return json({ ok: true });
}

// ===========================================================================
// media storage
// ===========================================================================

// Only real media types may ever be stored. Without this allow-list, a caller
// (including the low-privilege INGEST_TOKEN, which is meant to only be able to
// upload media and create drafts) could store an HTML/JS payload and have it
// served back, same-origin, from the public /media/* route -- and the admin
// dashboard on that same origin keeps its bearer token in localStorage.
const ALLOWED_MEDIA_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'video/mp4', 'video/quicktime',
]);

function assertAllowedContentType(rawContentType) {
  const normalized = String(rawContentType || '').split(';')[0].trim().toLowerCase();
  if (!ALLOWED_MEDIA_TYPES.has(normalized)) {
    throw badRequest(
      `Unsupported content type '${rawContentType || '(none)'}'. Allowed: ${[...ALLOWED_MEDIA_TYPES].join(', ')}`
    );
  }
  return normalized;
}

// source_url is fetched server-side, so it needs the same scrutiny as any
// other SSRF-shaped input: no scheme but http(s), no private/loopback/
// link-local literal, and no following a redirect to one (a same-origin check
// on the original URL alone would miss that). This does not defend against
// DNS rebinding on a hostname that currently resolves to a public address --
// that would need a resolve-then-connect API this runtime doesn't expose --
// but it closes the "just paste an internal or attacker-chosen host" case.
function assertSafeSourceUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl));
  } catch {
    throw badRequest('source_url is not a valid URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw badRequest('source_url must be http:// or https://');
  }
  if (isBlockedHostname(parsed.hostname)) {
    throw badRequest('source_url points to a private or internal address, which is not allowed');
  }
  return parsed;
}

function isBlockedHostname(hostname) {
  const h = String(hostname).toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (h.includes(':')) {
    // IPv6 literal: block loopback (::1), link-local (fe80::/10), unique-local (fc00::/7).
    if (h === '::1' || h === '::') return true;
    const firstGroup = h.split(':')[0];
    if (/^fe[89ab][0-9a-f]$/.test(firstGroup) || /^f[cd][0-9a-f]{2}$/.test(firstGroup)) return true;
    return false;
  }
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (!m) return false; // a DNS name, not an IP literal -- allow (see comment above)
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a === 127 || a === 10 || a === 0) return true; // loopback, 10/8, "this network"
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 168) return true; // 192.168/16
  if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata endpoints
  return false;
}

async function uploadMedia(request, env, requestUrl) {
  const body = await readJson(request);

  if (body.source_url) {
    const safeUrl = assertSafeSourceUrl(body.source_url);
    let res;
    try {
      // redirect: 'manual' so a redirect to a blocked host can't bypass the
      // hostname check above, which only ever sees the original URL.
      res = await fetch(safeUrl.toString(), { redirect: 'manual' });
    } catch (err) {
      throw badRequest(`Could not reach source_url: ${err?.message || err}`);
    }
    if (res.status >= 300 && res.status < 400) {
      throw badRequest('source_url redirected; point it at the final media URL directly.');
    }
    if (!res.ok) throw badRequest(`Could not fetch source_url (HTTP ${res.status})`);
    const contentType = assertAllowedContentType(res.headers.get('content-type'));
    const ext = (body.ext || guessExt(contentType) || 'jpg').replace(/[^a-z0-9]/gi, '');
    const key = `${uuid()}.${ext}`;
    await env.MEDIA.put(key, res.body, { httpMetadata: { contentType } });
    return finishUpload(env, requestUrl, key);
  }

  if (body.data_base64) {
    const contentType = assertAllowedContentType(body.content_type);
    const ext = (body.ext || guessExt(contentType) || 'jpg').replace(/[^a-z0-9]/gi, '');
    const key = `${uuid()}.${ext}`;
    let bytes;
    try {
      bytes = Uint8Array.from(atob(body.data_base64), (c) => c.charCodeAt(0));
    } catch {
      throw badRequest('data_base64 was not valid base64');
    }
    await env.MEDIA.put(key, bytes, { httpMetadata: { contentType } });
    return finishUpload(env, requestUrl, key);
  }

  throw badRequest('Provide either source_url or data_base64');
}

function finishUpload(env, requestUrl, key) {
  const origin = (env.PUBLIC_ORIGIN || requestUrl.origin).replace(/\/$/, '');
  return json({ key, url: `${origin}/media/${key}` }, 201);
}

function guessExt(contentType) {
  if (!contentType) return null;
  const c = contentType.toLowerCase();
  if (c.includes('png')) return 'png';
  if (c.includes('gif')) return 'gif';
  if (c.includes('webp')) return 'webp';
  if (c.includes('mp4')) return 'mp4';
  if (c.includes('quicktime')) return 'mov';
  if (c.includes('jpeg') || c.includes('jpg')) return 'jpg';
  return null;
}

async function serveMedia(env, key) {
  // Keys are flat UUID filenames. Reject anything with a path separator so a
  // crafted URL cannot walk out of the intended namespace, and so the backups/
  // prefix is unreachable from the public internet.
  if (!key || key.includes('/') || key.includes('..')) {
    return new Response('Not found', { status: 404 });
  }
  const obj = await env.MEDIA.get(key);
  if (!obj) return new Response('Not found', { status: 404 });

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('etag', obj.httpEtag);
  headers.set('cache-control', 'public, max-age=31536000, immutable');
  // Defense in depth on top of the upload-time allow-list: never let a browser
  // sniff its way into treating a stored object as something other than its
  // recorded (now allow-listed) content type.
  headers.set('x-content-type-options', 'nosniff');
  return new Response(obj.body, { headers });
}
