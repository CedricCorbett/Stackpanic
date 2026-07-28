// Every call to Instagram goes through this file.
//
// READ THIS BEFORE YOU GO LIVE
//
// Meta changes endpoint shapes and permission requirements between API versions
// more often than most platforms. The calls below match the Instagram API with
// Instagram Login as documented at the time this was written, and the version is
// pinned in wrangler.toml (GRAPH_VERSION).
//
// The README has a "Verify against Meta's docs" checklist. Work through it
// before you point this at a real account. Do not take my word for the exact
// endpoint shapes, and do not take a blog post's word either. Meta's own docs
// are the only source that counts here.

import { HttpError } from './util.js';

function base(env) {
  return `https://graph.instagram.com/${env.GRAPH_VERSION || 'v25.0'}`;
}

/**
 * Meta error codes that mean "try again later" rather than "this will never
 * work". Anything in here sends a post back to the queue with backoff instead
 * of marking it permanently failed, so a rate limit or a transient 5xx does not
 * burn all three attempts inside 45 minutes.
 *
 *   4, 17, 32, 613  application or user request limit reached
 *   2               temporary Meta-side issue
 *   1               unknown, frequently transient
 */
const TRANSIENT_META_CODES = new Set([1, 2, 4, 17, 32, 613]);

export class MetaError extends HttpError {
  constructor(status, message, { code, httpStatus } = {}) {
    super(status, message);
    this.metaCode = code ?? null;
    this.httpStatus = httpStatus ?? null;
    this.transient =
      TRANSIENT_META_CODES.has(Number(code)) ||
      httpStatus === 429 ||
      (httpStatus >= 500 && httpStatus <= 599);
  }
}

/**
 * One place where every Meta response is checked, so an error message from Meta
 * reaches your event log intact instead of being swallowed.
 */
async function call(url, options, what) {
  let res;
  try {
    res = await fetch(url, options);
  } catch (err) {
    // A network failure reaching Meta is always worth retrying.
    throw new MetaError(502, `${what} failed: could not reach Meta (${err?.message || err})`, {
      httpStatus: 503,
    });
  }

  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text.slice(0, 500) };
  }

  if (!res.ok) {
    const detail = data?.error?.message || data?.raw || `HTTP ${res.status}`;
    const code = data?.error?.code;
    throw new MetaError(502, `${what} failed: ${detail}${code ? ` (code ${code})` : ''}`, {
      code,
      httpStatus: res.status,
    });
  }
  return data;
}

// ---------------------------------------------------------------------------
// publishing
// ---------------------------------------------------------------------------

/**
 * Step 1 of publishing: ask Meta to build a "container" pointing at your media.
 * Meta downloads the file from the URL you give it, which is why PUBLIC_ORIGIN
 * has to be the real deployed URL.
 */
export async function createMediaContainer(env, { igUserId, token, mediaUrl, caption, mediaType, isVideo }) {
  const params = { access_token: token };
  if (caption !== undefined && caption !== null) params.caption = caption;

  if (mediaType === 'VIDEO' || mediaType === 'REELS') {
    params.video_url = mediaUrl;
    params.media_type = 'REELS'; // Instagram treats feed video as Reels
  } else if (mediaType === 'STORIES') {
    // A Story can be either an image or a video file; unlike VIDEO/REELS,
    // media_type alone does not say which, so the caller tells us based on
    // the uploaded file's actual content type.
    if (isVideo) params.video_url = mediaUrl;
    else params.image_url = mediaUrl;
    params.media_type = 'STORIES';
  } else {
    params.image_url = mediaUrl;
  }

  const data = await call(
    `${base(env)}/${igUserId}/media`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
    },
    'Creating media container'
  );
  if (!data.id) throw new MetaError(502, 'Meta returned no container id');
  return data.id;
}

/**
 * One slide of a carousel. Slides are containers too, but flagged as carousel
 * items and carrying no caption of their own: the caption belongs to the parent.
 */
export async function createCarouselItemContainer(env, { igUserId, token, mediaUrl, isVideo }) {
  const params = { access_token: token, is_carousel_item: 'true' };
  if (isVideo) {
    params.video_url = mediaUrl;
    params.media_type = 'VIDEO';
  } else {
    params.image_url = mediaUrl;
  }

  const data = await call(
    `${base(env)}/${igUserId}/media`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
    },
    'Creating carousel slide'
  );
  if (!data.id) throw new MetaError(502, 'Meta returned no container id for a carousel slide');
  return data.id;
}

/** The parent container that ties the slides together and carries the caption. */
export async function createCarouselContainer(env, { igUserId, token, childIds, caption }) {
  if (!Array.isArray(childIds) || childIds.length < 2 || childIds.length > 10) {
    throw new HttpError(400, 'An Instagram carousel needs between 2 and 10 slides.');
  }
  const data = await call(
    `${base(env)}/${igUserId}/media`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        media_type: 'CAROUSEL',
        children: childIds.join(','),
        caption: caption || '',
        access_token: token,
      }),
    },
    'Creating carousel container'
  );
  if (!data.id) throw new MetaError(502, 'Meta returned no carousel container id');
  return data.id;
}

/**
 * Video and carousel containers are processed asynchronously. Publishing before
 * processing finishes fails, so we poll. Total wait is bounded so a stuck
 * container cannot hold a cron invocation open indefinitely.
 */
export async function waitForContainer(env, { containerId, token, maxAttempts = 20, delayMs = 3000 }) {
  for (let i = 0; i < maxAttempts; i++) {
    const data = await call(
      `${base(env)}/${containerId}?fields=status_code,status&access_token=${encodeURIComponent(token)}`,
      { method: 'GET' },
      'Checking container status'
    );
    if (data.status_code === 'FINISHED') return;
    if (data.status_code === 'ERROR' || data.status_code === 'EXPIRED') {
      throw new MetaError(502, `Meta could not process the media: ${data.status || data.status_code}`);
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new MetaError(504, `Timed out waiting on media processing after ${(maxAttempts * delayMs) / 1000}s`, {
    httpStatus: 504,
  });
}

export async function publishContainer(env, { igUserId, token, containerId }) {
  const data = await call(
    `${base(env)}/${igUserId}/media_publish`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ creation_id: containerId, access_token: token }),
    },
    'Publishing container'
  );
  return data.id;
}

export async function getPermalink(env, { mediaId, token }) {
  try {
    const data = await call(
      `${base(env)}/${mediaId}?fields=permalink&access_token=${encodeURIComponent(token)}`,
      { method: 'GET' },
      'Fetching permalink'
    );
    return data.permalink || null;
  } catch {
    // The post is live either way. A missing permalink is cosmetic.
    return null;
  }
}

/**
 * A public comment on one of your own posts, used for the first comment
 * (hashtags, or "comment MAP for the breakdown").
 */
export async function commentOnMedia(env, { mediaId, token, message }) {
  return call(
    `${base(env)}/${mediaId}/comments`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ message, access_token: token }),
    },
    'Posting a comment'
  );
}

/**
 * A public reply inside someone else's comment thread, e.g. "sent, check your
 * DMs". This is the half of the ManyChat behaviour that feeds the post back
 * into the algorithm, separate from the private reply.
 */
export async function replyToComment(env, { commentId, token, message }) {
  return call(
    `${base(env)}/${commentId}/replies`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ message, access_token: token }),
    },
    'Replying to a comment'
  );
}

// ---------------------------------------------------------------------------
// insights
// ---------------------------------------------------------------------------

// Metric names Meta accepts vary by media type and by API version, and asking
// for one that does not apply fails the whole request. So metrics are requested
// in small groups and a failing group is skipped rather than losing everything.
const INSIGHT_GROUPS = [
  ['reach', 'likes', 'comments', 'saved', 'shares', 'total_interactions'],
  ['profile_visits', 'follows'],
  ['impressions'],
];

/**
 * Per-post Insights. Requires the instagram_business_manage_insights permission,
 * which is the third permission in your App Review request.
 */
export async function getMediaInsights(env, { mediaId, token }) {
  const merged = {};
  for (const group of INSIGHT_GROUPS) {
    try {
      const data = await call(
        `${base(env)}/${mediaId}/insights?metric=${group.join(',')}&access_token=${encodeURIComponent(token)}`,
        { method: 'GET' },
        `Fetching insights (${group[0]})`
      );
      for (const row of data.data || []) {
        const value = row.values?.[0]?.value;
        if (value !== undefined) merged[row.name] = value;
      }
    } catch (err) {
      // Expected for metrics that do not apply to this media type. Recorded so
      // it is visible, not silently swallowed.
      merged[`_skipped_${group[0]}`] = String(err?.message || err).slice(0, 200);
    }
  }
  return merged;
}

// ---------------------------------------------------------------------------
// messaging
// ---------------------------------------------------------------------------

/**
 * Private reply to a comment. The recipient is the comment id, not a user id.
 *
 * Meta allows exactly one private reply per comment, and only within a limited
 * window after the comment is posted. A duplicate attempt is an error, which is
 * one more reason the processed_events dedupe table matters.
 */
export async function sendPrivateReply(env, { igUserId, token, commentId, text }) {
  return call(
    `${base(env)}/${igUserId}/messages`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ recipient: { comment_id: commentId }, message: { text } }),
    },
    'Sending private reply'
  );
}

/** Ordinary DM reply, inside the 24 hour window from the user's last message. */
export async function sendDirectMessage(env, { igUserId, token, recipientId, text }) {
  return call(
    `${base(env)}/${igUserId}/messages`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ recipient: { id: recipientId }, message: { text } }),
    },
    'Sending direct message'
  );
}

// ---------------------------------------------------------------------------
// token lifecycle
// ---------------------------------------------------------------------------

/**
 * Exchange a still-valid long-lived token for a fresh one.
 *
 * This is the call that keeps the whole system alive past day 60. It only works
 * on a token at least 24 hours old and not yet expired, which is why the refresh
 * cron runs daily and acts 10 days before expiry rather than on the last day.
 */
export async function refreshLongLivedToken(env, token) {
  const data = await call(
    `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(token)}`,
    { method: 'GET' },
    'Refreshing access token'
  );
  if (!data.access_token) throw new MetaError(502, 'Refresh returned no access_token');
  return { token: data.access_token, expiresInSeconds: Number(data.expires_in) || 60 * 86400 };
}

/** Cheap validity probe, used by the dashboard "test token" button. */
export async function whoAmI(env, token) {
  return call(
    `${base(env)}/me?fields=id,username&access_token=${encodeURIComponent(token)}`,
    { method: 'GET' },
    'Checking token'
  );
}
