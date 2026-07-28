#!/usr/bin/env node
/**
 * Pre-deploy sanity check.  Run with:  npm run check
 *
 * Two jobs:
 *   1. Catch the configuration mistakes that produce confusing runtime errors
 *      later (a placeholder database_id, a placeholder PUBLIC_ORIGIN, a token
 *      accidentally pasted into schema.sql).
 *   2. Assert the pure logic that decides whether a comment fires a code, so a
 *      change to the matcher cannot silently start replying to the wrong things.
 *
 * This runs on your machine with plain Node. It does not touch Cloudflare and
 * does not need credentials.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { webcrypto } from 'node:crypto';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

// globalThis.crypto is only global-by-default from Node 19 on; the README's
// documented minimum is Node 18. Without this, every assertion below that
// round-trips token encryption or verifies a Meta signature silently never
// runs on the officially supported minimum version, and `npm run check` still
// prints PASSED and exits 0.
if (!globalThis.crypto?.subtle) globalThis.crypto = webcrypto;

let failures = 0;
let warnings = 0;

const fail = (msg) => { console.error(`  FAIL  ${msg}`); failures++; };
const warn = (msg) => { console.warn(`  WARN  ${msg}`); warnings++; };
const pass = (msg) => console.log(`  ok    ${msg}`);

function assert(cond, msg) { cond ? pass(msg) : fail(msg); }

// ===========================================================================
console.log('\nConfiguration');
// ===========================================================================

const toml = read('wrangler.toml');

// A warning rather than a failure: this is the expected state before setup, and
// a check that always fails on a fresh copy is a check you learn to ignore.
// The text is blunt about the consequence.
if (toml.includes('REPLACE_WITH_DATABASE_ID')) {
  warn('wrangler.toml still has the placeholder database_id. `wrangler deploy` WILL FAIL until you run: wrangler d1 create social-suite, and paste the id it prints into wrangler.toml. See README step 3.');
} else {
  pass('database_id has been filled in');
}

if (toml.includes('YOUR-SUBDOMAIN')) {
  warn('PUBLIC_ORIGIN is still the placeholder. This is expected before your first deploy. Deploy once, copy the real URL wrangler prints, paste it in, deploy again. Publishing cannot work until then.');
} else {
  pass('PUBLIC_ORIGIN has been set to a real URL');
}

// ===========================================================================
console.log('\nSecret hygiene');
// ===========================================================================

// The exact bug this project was built to fix: a live Instagram token pasted
// into a tracked file. IGAA is the prefix Instagram long-lived tokens carry.
const TOKEN_SHAPE = /IGAA[A-Za-z0-9_-]{20,}/;

// A real directory walk, not a fixed list of paths: a hardcoded list is
// silently blind to any file added later and never added to it, and to
// anything outside src/public in the first place. node_modules, .wrangler and
// .git are excluded because they are dependencies or local state, never
// something you'd hand-edit a token into.
const SKIP_DIRS = new Set(['node_modules', '.wrangler', '.git']);
function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(join(dir, entry.name), out);
    } else {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

let leaked = false;
for (const full of walk(root)) {
  let content;
  try { content = readFileSync(full, 'utf8'); } catch { continue; }
  if (TOKEN_SHAPE.test(content)) {
    fail(`${full} contains something shaped like a live Instagram access token. Remove it. Tokens belong in the dashboard, encrypted into D1, never in a file.`);
    leaked = true;
  }
}
if (!leaked) pass('no access token found in any file in this project (node_modules, .wrangler and .git excluded)');

const gitignore = (() => { try { return read('.gitignore'); } catch { return ''; } })();
assert(gitignore.includes('.dev.vars'), '.gitignore covers .dev.vars');

// ===========================================================================
console.log('\nSchema');
// ===========================================================================

const schema = read('schema.sql');
for (const table of [
  'accounts', 'posts', 'triggers', 'contacts', 'conversations', 'messages',
  'resources', 'guardrails', 'events_log', 'processed_events', 'sends',
  'post_insights', 'slots', 'short_links', 'link_clicks', 'scheduled_sends',
  'system_state', 'deletion_requests',
]) {
  assert(new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`).test(schema), `table ${table} is defined`);
}
assert(
  /token_ciphertext/.test(schema) && !/token_secret_name/.test(schema),
  'accounts stores an encrypted token, not a secret name (the old broken design)'
);

// ===========================================================================
console.log('\nComment matching logic');
// ===========================================================================

const { triggerMatches } = await import('../src/webhook.js');
const { matchResources } = await import('../src/webhook.js');
const { truncateWords } = await import('../src/util.js');

const MAP = { keyword: 'MAP', match_mode: 'word' };

const cases = [
  [MAP, 'MAP', true, 'bare keyword'],
  [MAP, 'map', true, 'lowercase'],
  [MAP, 'MAP please', true, 'keyword then text'],
  [MAP, 'send me the MAP', true, 'keyword at the end'],
  [MAP, 'MAP!', true, 'trailing punctuation'],
  [MAP, 'I need a "MAP" for this', true, 'quoted'],
  [MAP, 'mapping my area', false, 'must not fire inside a longer word'],
  [MAP, 'roadmap', false, 'must not fire as a word ending'],
  [MAP, 'MAP_2', true, 'underscore counts as a separator, the code was still typed'],
  [MAP, '#MAP', true, 'hashtagged code'],
  [MAP, 'MAPS', false, 'plural of the code is a different word'],
  [MAP, 'nothing relevant', false, 'unrelated comment'],
  [{ keyword: 'MAP', match_mode: 'contains' }, 'mapping my area', true, 'contains mode is looser by design'],
  [{ keyword: 'C+C', match_mode: 'word' }, 'send C+C', true, 'regex characters in a keyword are literal'],
];

for (const [trigger, text, expected, label] of cases) {
  const got = triggerMatches(trigger, text);
  assert(got === expected, `${label}: ${JSON.stringify(text)} -> ${expected}`);
}

// ===========================================================================
console.log('\nResource matching and length cap');
// ===========================================================================

const resources = [
  { id: 'r1', topic: 'coverage area', content: 'We cover the Upstate and Charlotte metro.', keywords: '["charlotte","coverage","service area"]', active: 1 },
  { id: 'r2', topic: 'pricing', content: 'Teardowns start at 500 dollars.', keywords: '["price","pricing","cost"]', active: 1 },
  { id: 'r3', topic: 'turnaround', content: 'Five business days.', keywords: '["how long","turnaround"]', active: 0 },
];

const hit = matchResources(resources, 'does this cover charlotte');
assert(hit[0]?.id === 'r1', 'a coverage question ranks the coverage entry first');

const priced = matchResources(resources, 'what is the cost');
assert(priced[0]?.id === 'r2', 'a cost question ranks the pricing entry first');

const inactive = matchResources(resources, 'how long does it take');
assert(!inactive.some((r) => r.id === 'r3'), 'inactive entries are never used');

assert(truncateWords('a'.repeat(50), 20).length <= 20, 'length cap is respected');
assert(truncateWords('one two three four five', 12) === 'one two', 'cap does not cut a word in half');
assert(truncateWords('short', 300) === 'short', 'short text is untouched');

// ===========================================================================
console.log('\nToken encryption round trip');
// ===========================================================================

{
  const { encryptToken, decryptToken, verifyMetaSignature } = await import('../src/crypto.js');
  const env = { TOKEN_ENC_KEY: 'a'.repeat(64) };
  const secret = 'pretend-token-value-for-testing-only-not-a-real-credential';
  const ct = await encryptToken(secret, env);
  assert(!ct.includes('pretend-token'), 'ciphertext does not contain the plaintext');
  assert((await decryptToken(ct, env)) === secret, 'decrypt returns the original token');

  const ct2 = await encryptToken(secret, env);
  assert(ct !== ct2, 'encrypting twice gives different ciphertext (random nonce)');

  let wrongKeyRejected = false;
  try { await decryptToken(ct, { TOKEN_ENC_KEY: 'b'.repeat(64) }); } catch { wrongKeyRejected = true; }
  assert(wrongKeyRejected, 'a wrong key is rejected rather than returning garbage');

  // Signature verification, checked against a known-good HMAC.
  const body = '{"object":"instagram","entry":[]}';
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('appsecret'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');

  assert((await verifyMetaSignature(body, `sha256=${hex}`, 'appsecret')).ok, 'a correct signature is accepted');
  assert(!(await verifyMetaSignature(body, `sha256=${hex}`, 'wrongsecret')).ok, 'a wrong app secret is rejected');
  assert(!(await verifyMetaSignature(body + ' ', `sha256=${hex}`, 'appsecret')).ok, 'a tampered body is rejected');
  assert(!(await verifyMetaSignature(body, null, 'appsecret')).ok, 'a missing signature header is rejected');
}

// ===========================================================================
console.log('\nPosting schedule and timezones');
// ===========================================================================

const { zonedWallTimeToUtc, upcomingSlotTimes, nextFreeSlot } = await import('../src/schedule.js');

// 9am Eastern is 13:00 UTC in winter and 14:00 UTC in summer. Getting this
// wrong means every queued post drifts by an hour twice a year.
const janUtc = new Date(zonedWallTimeToUtc(2027, 1, 12, 9, 0, 'America/New_York')).toISOString();
const julUtc = new Date(zonedWallTimeToUtc(2027, 7, 13, 9, 0, 'America/New_York')).toISOString();
assert(janUtc === '2027-01-12T14:00:00.000Z', `9am ET in January is 14:00 UTC (got ${janUtc})`);
assert(julUtc === '2027-07-13T13:00:00.000Z', `9am ET in July is 13:00 UTC (got ${julUtc})`);

// The one Sunday a year US clocks spring forward, 2:00-2:59 AM never happens
// locally at all. Every assertion above sits well inside standard or daylight
// time, nowhere near the actual transition, so a regression in the gap-hour
// handling would pass all of them cleanly. 2027-03-14 is that Sunday.
const beforeGapUtc = new Date(zonedWallTimeToUtc(2027, 3, 14, 1, 30, 'America/New_York')).toISOString();
assert(beforeGapUtc === '2027-03-14T06:30:00.000Z', `1:30 AM before the spring-forward gap is 06:30 UTC (got ${beforeGapUtc})`);
const insideGap = zonedWallTimeToUtc(2027, 3, 14, 2, 30, 'America/New_York');
const afterGap = zonedWallTimeToUtc(2027, 3, 14, 3, 30, 'America/New_York');
assert(
  insideGap === afterGap,
  `2:30 AM, which does not exist locally on spring-forward day, resolves to the same instant as 3:30 AM (got ${new Date(insideGap).toISOString()} vs ${new Date(afterGap).toISOString()})`
);

// A slot must land on the right weekday in the account's zone, not in UTC.
// 9pm Eastern on a Tuesday is Wednesday in UTC, and the slot still belongs to
// Tuesday.
const lateSlot = [{ weekday: 2, hour: 21, minute: 0, active: 1 }];
const lateTimes = upcomingSlotTimes(lateSlot, 'America/New_York', Date.UTC(2027, 0, 10), 14);
const firstLate = new Date(lateTimes[0].iso);
assert(firstLate.getUTCDay() === 3, 'a Tuesday 9pm ET slot lands on Wednesday UTC, as it should');
assert(
  new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' }).format(firstLate) === 'Tue',
  'and is still Tuesday in the account timezone'
);

const slots = [
  { id: 'a', weekday: 2, hour: 9, minute: 0, active: 1 },
  { id: 'b', weekday: 4, hour: 9, minute: 0, active: 1 },
  { id: 'c', weekday: 6, hour: 11, minute: 0, active: 0 },
];
const from = Date.UTC(2027, 0, 11, 12, 0); // Monday
const times = upcomingSlotTimes(slots, 'America/New_York', from, 21);
assert(times.length > 0, 'slots produce upcoming times');
assert(times.every((t, i) => i === 0 || times[i - 1].iso <= t.iso), 'times come back in order');
assert(!times.some((t) => t.slot.id === 'c'), 'an inactive slot is never scheduled');

const firstFree = nextFreeSlot(slots, 'America/New_York', new Set(), from);
const secondFree = nextFreeSlot(slots, 'America/New_York', new Set([firstFree.iso]), from);
assert(!!firstFree, 'a free slot is found');
assert(secondFree.iso > firstFree.iso, 'an occupied slot is skipped for the next one');
assert(!nextFreeSlot([], 'America/New_York', new Set(), from), 'no slots means no placement');

// ===========================================================================
console.log('\nUTM tagging and short codes');
// ===========================================================================

const { withUtm, shortCode } = await import('../src/util.js');

const tagged = withUtm('https://example.com/map', {
  utm_source: 'instagram', utm_medium: 'comment_code', utm_campaign: 'map',
});
assert(tagged.includes('utm_source=instagram'), 'UTM source is applied');
assert(tagged.includes('utm_campaign=map'), 'UTM campaign is applied');

const preserved = withUtm('https://x.com/p?utm_campaign=mine', { utm_campaign: 'generated' });
assert(preserved.includes('utm_campaign=mine'), 'a UTM you set yourself is never overwritten');
assert(withUtm('not a url', { utm_source: 'x' }) === 'not a url', 'an unparseable URL is handed back untouched');

const codes = new Set(Array.from({ length: 500 }, () => shortCode()));
assert(codes.size === 500, 'short codes do not collide over 500 draws');
assert([...codes].every((c) => /^[23456789abcdefghjkmnpqrstuvwxyz]{7}$/.test(c)),
  'short codes avoid characters that get misread (0/O, 1/l/I)');

// ===========================================================================
console.log('\nsigned_request parsing (Meta data deletion callback)');
// ===========================================================================

{
  const { parseSignedRequest } = await import('../src/crypto.js');
  const secret = 'appsecret';
  const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const payloadJson = JSON.stringify({ user_id: '1234567890', algorithm: 'HMAC-SHA256' });
  const payloadPart = b64url(new TextEncoder().encode(payloadJson));
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = b64url(new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(payloadPart))));

  const parsed = await parseSignedRequest(`${sig}.${payloadPart}`, secret);
  assert(parsed.user_id === '1234567890', 'a valid signed_request yields the user id');

  let rejected = false;
  try { await parseSignedRequest(`${sig}.${payloadPart}`, 'wrongsecret'); } catch { rejected = true; }
  assert(rejected, 'a signed_request signed with the wrong secret is rejected');

  let malformedRejected = false;
  try { await parseSignedRequest('garbage', secret); } catch { malformedRejected = true; }
  assert(malformedRejected, 'a malformed signed_request is rejected');
}

// ===========================================================================
console.log('\nIngest token scope');
// ===========================================================================

const { ingestMayReach, authenticate } = await import('../src/util.js');

// The allow-list is what makes it safe to put an ingest token in a skill or a
// scheduled routine. Anything not on it must stay out of reach.
const allowed = [
  ['media', 'POST', null, 'upload media'],
  ['queue', 'POST', null, 'queue into the next free slot'],
  ['posts', 'POST', null, 'create a post'],
];
for (const [r, m, id, label] of allowed) {
  assert(ingestMayReach(r, m, id) === true, `ingest may ${label}`);
}

const denied = [
  ['conversations', 'GET', null, 'read the inbox'],
  ['conversations', 'POST', 'x', 'send a DM'],
  ['accounts', 'PATCH', 'account_one', 'pause the account'],
  ['accounts', 'POST', 'account_one', 'replace an access token'],
  ['export', 'GET', null, 'export the database'],
  ['run-now', 'POST', null, 'force a publish pass'],
  ['triggers', 'POST', null, 'create a comment code'],
  ['guardrails', 'PUT', 'account_one', 'rewrite the guardrails'],
  ['log', 'GET', null, 'read the event log'],
  ['media', 'DELETE', 'x.png', 'delete media'],
  ['posts', 'PATCH', 'x', 'edit an existing post'],
  ['posts', 'DELETE', 'x', 'delete a post'],
  ['contacts', 'GET', null, 'read contacts'],
];
for (const [r, m, id, label] of denied) {
  assert(ingestMayReach(r, m, id) === false, `ingest may NOT ${label}`);
}

// Token resolution order. Admin is checked first so setting both secrets to the
// same value degrades to admin rather than granting admin via the ingest path.
const req = (token) => ({ headers: { get: (h) => (h === 'authorization' ? `Bearer ${token}` : null) } });
const env2 = { API_TOKEN: 'admintok', INGEST_TOKEN: 'ingesttok' };
assert(authenticate(req('admintok'), env2) === 'admin', 'the admin token resolves to admin');
assert(authenticate(req('ingesttok'), env2) === 'ingest', 'the ingest token resolves to ingest');
assert(authenticate(req('admintok'), { API_TOKEN: 'admintok', INGEST_TOKEN: 'admintok' }) === 'admin',
  'identical tokens resolve to admin, not ingest');

let rejectedBad = false;
try { authenticate(req('wrong'), env2); } catch { rejectedBad = true; }
assert(rejectedBad, 'an unknown token is rejected');

let rejectedNoIngest = false;
try { authenticate(req('ingesttok'), { API_TOKEN: 'admintok' }); } catch { rejectedNoIngest = true; }
assert(rejectedNoIngest, 'with INGEST_TOKEN unset, the ingest token is just an unknown token');

// ingestMayReach above only proves an ingest token can hit POST /api/posts.
// It says nothing about what status the post it creates ends up with, which
// is the actual safety property README section 9 promises: "it cannot be
// overridden by passing status in the body." resolvePostStatus is the pure
// decision createPostFromBody defers to, asserted here directly.
const { resolvePostStatus } = await import('../src/util.js');
assert(
  resolvePostStatus({ level: 'ingest', requestedStatus: 'scheduled', requireApproval: false, fromAutomation: true }) === 'draft',
  'an ingest-level request cannot publish directly even if it passes status itself'
);
assert(
  resolvePostStatus({ level: 'ingest', requestedStatus: 'published', requireApproval: false, fromAutomation: false }) === 'draft',
  'an ingest-level request is forced to draft regardless of source'
);
assert(
  resolvePostStatus({ level: 'admin', requestedStatus: 'scheduled', requireApproval: false, fromAutomation: true }) === 'scheduled',
  'an admin request with an explicit status is honored'
);
assert(
  resolvePostStatus({ level: 'admin', requestedStatus: undefined, requireApproval: true, fromAutomation: true }) === 'draft',
  'require_approval forces an automation-sourced post to draft for the admin token too'
);
assert(
  resolvePostStatus({ level: 'admin', requestedStatus: undefined, requireApproval: true, fromAutomation: false }) === 'scheduled',
  'require_approval does not hold back something scheduled by hand'
);

// ===========================================================================
console.log(`\n${failures ? 'FAILED' : 'PASSED'}  ${failures} failure(s), ${warnings} warning(s)\n`);
process.exit(failures ? 1 : 0);
