// The scheduled work: publishing, follow-ups, and daily maintenance.
//
// Two crons drive this file.
//   every 15 min  publishDuePosts + processScheduledSends
//   daily 06:10   dailyMaintenance (tokens, insights, backup, pruning)
//
// Every pass writes a heartbeat. A Cloudflare cron that stops firing fails
// silently, so the app watches its own pulse and shows a banner when it goes
// stale. That is how a dead scheduler becomes visible without paying for an
// external monitoring service.

import { decryptToken, encryptToken } from './crypto.js';
import {
  createMediaContainer,
  createCarouselItemContainer,
  createCarouselContainer,
  waitForContainer,
  publishContainer,
  getPermalink,
  commentOnMedia,
  refreshLongLivedToken,
  getMediaInsights,
  sendDirectMessage,
} from './meta.js';
import * as db from './db.js';
import { isoPlusSeconds, isoPlusDays, isoPlusMinutes, nowIso, parseJsonColumn } from './util.js';

// Backoff between publish attempts, in minutes, indexed by attempt number.
// A transient failure waits progressively longer instead of burning all three
// attempts inside 45 minutes.
const BACKOFF_MINUTES = [15, 60, 240];

/**
 * Is this R2 object actually a video? Trusted content-type metadata beats a
 * filename guess: uploadMedia only ever stores an allow-listed content type,
 * so this is reliable even when the caller's own `ext` field does not match
 * what the file actually is. Falls back to a filename check only if the
 * metadata lookup itself fails.
 */
async function isVideoKey(env, key) {
  try {
    const obj = await env.MEDIA.head(key);
    const contentType = obj?.httpMetadata?.contentType || '';
    if (contentType.startsWith('video/')) return true;
    if (contentType.startsWith('image/')) return false;
  } catch {
    // fall through
  }
  return /\.(mp4|mov|webm)$/i.test(key);
}

// ===========================================================================
// publishing
// ===========================================================================

export async function publishDuePosts(env) {
  const posts = await db.duePosts(env);
  let published = 0;
  let failed = 0;
  let deferred = 0;

  for (const post of posts) {
    const outcome = await publishOne(env, post);
    if (outcome === 'published') published++;
    else if (outcome === 'deferred') deferred++;
    else failed++;
  }

  await db.setSystemState(env, 'last_publish_pass', JSON.stringify({
    at: nowIso(), checked: posts.length, published, failed, deferred,
  }));
  if (posts.length) {
    await db.logEvent(env, null, 'publish_pass', { checked: posts.length, published, failed, deferred });
  }
  return { checked: posts.length, published, failed, deferred };
}

async function publishOne(env, post) {
  // Claim the row first. If this returns false another pass already has it.
  if (!(await db.markPublishing(env, post.id))) return 'skipped';

  // Tracked outside the try block: once mediaId is set, Instagram already has
  // a live post. Anything that throws after that point is a bookkeeping
  // failure, not a publishing one, and must never be treated as "never
  // published" -- see the catch block below.
  let containerId = null;
  let mediaId = null;

  try {
    if (!env.PUBLIC_ORIGIN || env.PUBLIC_ORIGIN.includes('YOUR-SUBDOMAIN')) {
      throw new Error(
        'PUBLIC_ORIGIN in wrangler.toml is still the placeholder. Meta fetches media from this URL, so publishing cannot work until it is the real deployed URL. See README step 6.'
      );
    }

    const account = await db.getAccount(env, post.account_id);
    if (account.status !== 'active') throw new Error(`Account '${account.id}' is paused`);

    const token = await decryptToken(account.token_ciphertext, env);
    const origin = env.PUBLIC_ORIGIN.replace(/\/$/, '');
    const mediaUrl = (key) => `${origin}/media/${key}`;

    if (post.media_type === 'CAROUSEL') {
      // Carousels are three round trips instead of one: a container per slide,
      // a parent tying them together, then publish the parent.
      const keys = parseJsonColumn(post.media_keys, []);
      if (keys.length < 2 || keys.length > 10) {
        throw new Error(`A carousel needs 2 to 10 slides, this post has ${keys.length}.`);
      }

      const childIds = [];
      for (const key of keys) {
        childIds.push(
          await createCarouselItemContainer(env, {
            igUserId: account.ig_user_id,
            token,
            mediaUrl: mediaUrl(key),
            isVideo: await isVideoKey(env, key),
          })
        );
      }
      // Slides are processed asynchronously too. Wait for all of them before
      // building the parent, or the parent creation fails on an unready child.
      for (const childId of childIds) {
        await waitForContainer(env, { containerId: childId, token, maxAttempts: 20 });
      }

      containerId = await createCarouselContainer(env, {
        igUserId: account.ig_user_id,
        token,
        childIds,
        caption: post.caption,
      });
      await db.setPostContainerId(env, post.id, containerId);
      await waitForContainer(env, { containerId, token });
    } else {
      const isVideoFile = post.media_type === 'STORIES'
        ? await isVideoKey(env, post.media_key)
        : (post.media_type === 'VIDEO' || post.media_type === 'REELS');

      containerId = await createMediaContainer(env, {
        igUserId: account.ig_user_id,
        token,
        mediaUrl: mediaUrl(post.media_key),
        caption: post.caption,
        mediaType: post.media_type,
        isVideo: isVideoFile,
      });
      await db.setPostContainerId(env, post.id, containerId);
      if (isVideoFile) {
        await waitForContainer(env, { containerId, token });
      }
    }

    mediaId = await publishContainer(env, { igUserId: account.ig_user_id, token, containerId });
    // Instagram now has a live post. Record that immediately, before anything
    // else (getPermalink, the DB status flip) gets a chance to fail.
    await db.setPostPublishedMediaId(env, post.id, mediaId);

    const permalink = await getPermalink(env, { mediaId, token });

    await db.markPublished(env, post.id, { containerId, mediaId, permalink });
    await db.logEvent(env, account.id, 'post_published', {
      post_id: post.id, media_type: post.media_type, permalink,
    });

    // The first comment is a nice-to-have. If it fails, the post is still live,
    // so it is logged rather than allowed to mark the post failed.
    if (post.first_comment) {
      try {
        await commentOnMedia(env, { mediaId, token, message: post.first_comment });
        await db.logEvent(env, account.id, 'first_comment_posted', { post_id: post.id });
      } catch (err) {
        await db.logEvent(env, account.id, 'first_comment_failed', {
          post_id: post.id, error: err?.message || String(err),
        });
      }
    }

    return 'published';
  } catch (err) {
    const message = err?.message || String(err);

    // Instagram already has this live. Retrying the publish flow from here
    // would create a second live post or carousel, which is strictly worse
    // than a post stuck showing 'publishing' -- duePosts only ever selects
    // 'scheduled' rows, so a stuck one is never auto-retried, and this event
    // says exactly what happened and gives the ids needed to reconcile by hand.
    if (mediaId) {
      await db.logEvent(env, post.account_id, 'post_published_but_unrecorded', {
        post_id: post.id, container_id: containerId, media_id: mediaId, error: message,
      });
      return 'published';
    }

    // Transient means Meta was busy or rate limiting, not that this post is
    // broken. Send it back to the queue with backoff instead of failing it.
    if (err?.transient && post.attempts + 1 < 3) {
      const wait = BACKOFF_MINUTES[post.attempts] ?? 240;
      await db.deferPost(env, post.id, isoPlusMinutes(wait), message);
      await db.logEvent(env, post.account_id, 'post_deferred', {
        post_id: post.id, retry_in_minutes: wait, error: message,
      });
      return 'deferred';
    }

    await db.markFailed(env, post.id, message);
    await db.logEvent(env, post.account_id, 'post_failed', { post_id: post.id, error: message });
    return 'failed';
  }
}

// ===========================================================================
// timed follow-ups
// ===========================================================================

/**
 * Send any follow-up whose time has come, and cancel any where the person has
 * replied since it was queued.
 *
 * The cancel check is the important half. Chasing someone who already answered
 * is the fastest way to read as a bot, and it is exactly what a naive timer
 * does.
 */
export async function processScheduledSends(env) {
  const due = await db.dueScheduledSends(env);
  let sent = 0;
  let cancelled = 0;
  let failed = 0;

  for (const item of due) {
    try {
      const account = await db.getAccount(env, item.account_id);

      if (account.status !== 'active' || !account.dm_enabled) {
        await db.resolveScheduledSend(env, item.id, 'cancelled', 'account paused or replies disabled');
        cancelled++;
        continue;
      }

      // Did they reply after we queued this?
      if (await db.hasInboundSince(env, item.conversation_id, item.queued_at)) {
        await db.resolveScheduledSend(env, item.id, 'cancelled', 'contact replied first');
        await db.logEvent(env, item.account_id, 'followup_cancelled', {
          conversation_id: item.conversation_id, reason: 'contact replied first',
        });
        cancelled++;
        continue;
      }

      // An escalated thread belongs to a human. No automation re-enters it.
      const convo = await db.getConversationFull(env, item.conversation_id);
      if (!convo || convo.status === 'escalated') {
        await db.resolveScheduledSend(env, item.id, 'cancelled', 'conversation escalated or missing');
        cancelled++;
        continue;
      }

      // Claim it before sending. Without this, an overlapping pass (a slow
      // cron tick still running when the next one fires, or a manual
      // /api/run-now overlapping the cron) can pick up and send this same row
      // a second time.
      if (!(await db.claimScheduledSend(env, item.id))) continue;

      const token = await decryptToken(account.token_ciphertext, env);
      await sendDirectMessage(env, {
        igUserId: account.ig_user_id,
        token,
        recipientId: item.recipient_id,
        text: item.body,
      });

      await db.recordSend(env, account.id, 'followup');
      await db.addMessage(env, item.conversation_id, 'out', item.body, 'followup');
      await db.resolveScheduledSend(env, item.id, 'sent', null);
      await db.logEvent(env, account.id, 'followup_sent', {
        conversation_id: item.conversation_id, trigger_id: item.trigger_id,
      });
      sent++;
    } catch (err) {
      const message = err?.message || String(err);
      await db.resolveScheduledSend(env, item.id, 'failed', message);
      await db.logEvent(env, item.account_id, 'followup_failed', { error: message });
      failed++;
    }
  }

  if (due.length) {
    await db.logEvent(env, null, 'followup_pass', { due: due.length, sent, cancelled, failed });
  }
  return { due: due.length, sent, cancelled, failed };
}

// ===========================================================================
// daily maintenance
// ===========================================================================

export async function dailyMaintenance(env) {
  const tokens = await refreshExpiringTokens(env);
  const insights = await refreshInsights(env);
  const backup = await writeBackup(env);
  await db.pruneOldRows(env);

  await db.setSystemState(env, 'last_daily_pass', JSON.stringify({
    at: nowIso(),
    tokens_checked: tokens.length,
    insights_updated: insights.updated,
    backup_key: backup.key,
  }));
  return { tokens, insights, backup };
}

/**
 * Instagram long-lived tokens last 60 days. Miss the window and every part of
 * this stops working with confusing auth errors. Acting 10 days early means a
 * failed refresh has nine more chances before anything actually breaks, and the
 * failure is visible on the dashboard the whole time.
 */
export async function refreshExpiringTokens(env) {
  const accounts = await db.listAccounts(env);
  const cutoff = isoPlusDays(10);
  const results = [];

  for (const summary of accounts) {
    if (!summary.has_token) continue;
    if (summary.token_expires_at && summary.token_expires_at > cutoff) continue;

    const account = await db.getAccount(env, summary.id);
    try {
      const current = await decryptToken(account.token_ciphertext, env);
      const { token, expiresInSeconds } = await refreshLongLivedToken(env, current);
      const expiresAt = isoPlusSeconds(expiresInSeconds);
      await db.setAccountToken(env, account.id, await encryptToken(token, env), expiresAt);
      await db.logEvent(env, account.id, 'token_refreshed', { expires_at: expiresAt });
      results.push({ account: account.id, ok: true });
    } catch (err) {
      const message = err?.message || String(err);
      await db.setAccountTokenError(env, account.id, message);
      await db.logEvent(env, account.id, 'token_refresh_failed', { error: message });
      results.push({ account: account.id, ok: false, error: message });
    }
  }
  return results;
}

/**
 * Pull Insights for anything published in the last 30 days.
 *
 * Not just new posts: reach and saves keep climbing for days after publishing,
 * so a number captured an hour after posting is wrong by the end of the week.
 */
export async function refreshInsights(env) {
  const posts = await db.publishedPostsForInsights(env, 30);
  let updated = 0;
  let skipped = 0;

  for (const post of posts) {
    try {
      const account = await db.getAccount(env, post.account_id);
      if (account.status !== 'active' || !account.token_ciphertext) {
        skipped++;
        continue;
      }
      const token = await decryptToken(account.token_ciphertext, env);
      const metrics = await getMediaInsights(env, { mediaId: post.published_media_id, token });
      await db.upsertInsights(env, post.id, post.account_id, metrics);
      updated++;
    } catch (err) {
      skipped++;
      await db.logEvent(env, post.account_id, 'insights_failed', {
        post_id: post.id, error: (err?.message || String(err)).slice(0, 300),
      });
    }
  }

  if (updated || skipped) {
    await db.logEvent(env, null, 'insights_pass', { updated, skipped });
  }
  return { updated, skipped };
}

/**
 * Weekly-ish backup of everything into R2.
 *
 * D1 is durable, but nothing protects you from your own DELETE. This writes a
 * dated JSON snapshot alongside your media, which is the cheapest possible
 * insurance and needs no extra service.
 */
export async function writeBackup(env) {
  try {
    const snapshot = await db.exportEverything(env);
    const key = `backups/${new Date().toISOString().slice(0, 10)}.json`;
    await env.MEDIA.put(key, JSON.stringify(snapshot), {
      httpMetadata: { contentType: 'application/json' },
    });
    await db.logEvent(env, null, 'backup_written', { key, tables: Object.keys(snapshot).length });
    return { key, ok: true };
  } catch (err) {
    const message = err?.message || String(err);
    await db.logEvent(env, null, 'backup_failed', { error: message });
    return { key: null, ok: false, error: message };
  }
}
