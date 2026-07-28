// Small shared helpers. Nothing clever lives in here on purpose.

export function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

/**
 * Throw one of these anywhere and the router turns it into a clean JSON
 * response with the right status code instead of a 500.
 */
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const badRequest = (m) => new HttpError(400, m);
export const unauthorized = (m = 'Unauthorized') => new HttpError(401, m);
export const notFound = (m = 'Not found') => new HttpError(404, m);

export function uuid() {
  return crypto.randomUUID();
}

export function nowIso() {
  return new Date().toISOString();
}

export function isoPlusDays(days) {
  return new Date(Date.now() + days * 86400_000).toISOString();
}

export function isoPlusSeconds(seconds) {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

export function isoPlusMinutes(minutes) {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

export function isoPlusHours(hours) {
  return new Date(Date.now() + hours * 3600_000).toISOString();
}

/**
 * A short, unambiguous code for a public short link.
 *
 * Excludes characters that get misread out loud or in a screenshot (0/O, 1/l/I)
 * because these end up in DMs people retype.
 */
export function shortCode(length = 7) {
  const alphabet = '23456789abcdefghjkmnpqrstuvwxyz';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
}

/**
 * Append UTM parameters to a URL without clobbering any the user already set.
 *
 * Their explicit choice wins: if a link already carries utm_campaign, we leave
 * it alone rather than overwriting it with a generated value.
 */
export function withUtm(rawUrl, params) {
  try {
    const url = new URL(rawUrl);
    for (const [key, value] of Object.entries(params)) {
      if (value && !url.searchParams.has(key)) url.searchParams.set(key, value);
    }
    return url.toString();
  } catch {
    // Not a parseable URL. Hand it back untouched rather than mangling it; the
    // trigger validation will have already complained about it.
    return rawUrl;
  }
}

/**
 * Compare two strings without leaking length or content through timing.
 * Used for the API bearer token and the webhook signature. A plain ===
 * returns early on the first differing byte, which is measurable.
 */
export function timingSafeEqual(a, b) {
  const enc = new TextEncoder();
  const ab = enc.encode(String(a));
  const bb = enc.encode(String(b));
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

/**
 * Bearer-token gate for every /api route, reads included.
 *
 * Two tokens, two privilege levels:
 *
 *   API_TOKEN     'admin'  — everything. This is you, in the dashboard.
 *   INGEST_TOKEN  'ingest' — upload media and create drafts. Nothing else.
 *
 * The second one exists so an unattended pipeline can have a credential without
 * that credential being able to read your inbox, pause the account, or replace
 * an access token. A skill running in a cloud container or a scheduled routine
 * carries the ingest token; worst case it fills your media library with drafts
 * you never approve.
 *
 * Returns the level rather than throwing on success, so the router can decide
 * what each level is allowed to reach.
 *
 * (The original ig-scheduler left GET /api/posts and GET /api/accounts open
 * entirely, so anyone with the URL could read the whole content calendar.)
 */
export function authenticate(request, env) {
  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!env.API_TOKEN) {
    throw new HttpError(500, 'API_TOKEN secret is not set on this Worker. See README step 4.');
  }
  if (!token) throw unauthorized('Send Authorization: Bearer <token>');

  // Admin is checked first, so setting both secrets to the same value degrades
  // to admin rather than silently granting admin through the ingest path.
  if (timingSafeEqual(token, env.API_TOKEN)) return 'admin';
  if (env.INGEST_TOKEN && timingSafeEqual(token, env.INGEST_TOKEN)) return 'ingest';
  throw unauthorized('That token is not valid for this Worker.');
}

/**
 * Which routes an ingest token may reach. Deliberately a tiny allow-list rather
 * than a deny-list: a new admin route added later is locked down by default
 * instead of being accidentally exposed.
 */
export function ingestMayReach(resource, method, id) {
  if (resource === 'media' && method === 'POST' && !id) return true;   // upload
  if (resource === 'queue' && method === 'POST') return true;          // next free slot
  if (resource === 'posts' && method === 'POST' && !id) return true;   // explicit time
  return false;
}

/** Parse a JSON request body, with a readable error instead of a stack trace. */
export async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw badRequest('Body must be valid JSON');
  }
}

/** D1 stores JSON as TEXT. These two keep the parsing in one place. */
export function parseJsonColumn(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

export function stringifyJsonColumn(value, fallback = '[]') {
  if (value === undefined || value === null) return fallback;
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/**
 * Escape a string for safe use inside a regular expression, so a keyword
 * containing a character like '+' or '.' still matches literally.
 */
export function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Truncate to the reply length cap without cutting a word in half.
 *
 * This is a safety net, not the primary mechanism: the cap is also stated in
 * the system prompt so replies should arrive short already. When it does fire,
 * ending on a whole word reads like a short answer rather than a glitch.
 *
 * Cuts at the last space inside the limit. A single word longer than the limit
 * has no space to cut at, so it gets a hard cut.
 */
export function truncateWords(text, max) {
  const s = String(text).trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  // If the cut already lands exactly on a word boundary -- the next source
  // character is whitespace -- there is no partial word to trim off. Without
  // this check, a cut that happens to end a whole word still backs up to the
  // space before it, silently dropping a word that fit within the cap.
  if (/\s/.test(s[max])) return cut.trim();
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim();
}

/**
 * Whether an ingest-level request may publish/schedule directly, or must
 * always land as a draft. Pulled out as a pure function, separate from
 * createPostFromBody's database and validation work, so it can be asserted
 * directly in scripts/check.mjs: reachability tests (ingestMayReach) only
 * prove an ingest token can hit a route, not that what it creates there is
 * actually forced to draft.
 */
export function resolvePostStatus({ level, requestedStatus, requireApproval, fromAutomation }) {
  if (level === 'ingest') return 'draft';
  return requestedStatus || (requireApproval && fromAutomation ? 'draft' : 'scheduled');
}
