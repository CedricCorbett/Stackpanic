// Token encryption and webhook signature verification.
//
// WHY TOKENS ARE ENCRYPTED IN THE DATABASE RATHER THAN HELD AS SECRETS
//
// A Cloudflare secret is the right home for a value that never changes, like
// your API_TOKEN. An Instagram access token is not that: it expires every 60
// days and has to be replaced by a fresh one that the Worker itself fetches.
// A Worker cannot rewrite its own secrets, so tokens-in-secrets means the
// refresh job can only warn you, never fix itself, and the whole system dies
// silently on day 61.
//
// So the token lives in D1, encrypted with AES-GCM. The key lives in the
// TOKEN_ENC_KEY secret. Someone who gets a copy of your database still has
// nothing usable. The refresh job can write a new value in place. Nothing
// sensitive ever appears in a file in this repo.

import { HttpError } from './util.js';

const IV_BYTES = 12; // 96 bits, the standard nonce size for AES-GCM

async function importKey(env) {
  const hex = env.TOKEN_ENC_KEY;
  if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new HttpError(
      500,
      'TOKEN_ENC_KEY must be set to 64 hex characters (32 bytes). Generate one with: openssl rand -hex 32'
    );
  }
  const raw = new Uint8Array(hex.match(/../g).map((b) => parseInt(b, 16)));
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

function toBase64(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromBase64(b64) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

/** Returns base64( iv || ciphertext ). Safe to store as TEXT in D1. */
export async function encryptToken(plaintext, env) {
  const key = await importKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext)
  );
  const packed = new Uint8Array(IV_BYTES + ct.byteLength);
  packed.set(iv, 0);
  packed.set(new Uint8Array(ct), IV_BYTES);
  return toBase64(packed);
}

export async function decryptToken(ciphertextB64, env) {
  if (!ciphertextB64) {
    throw new HttpError(409, 'No access token stored for this account. Paste one in the dashboard first.');
  }
  const key = await importKey(env);
  const packed = fromBase64(ciphertextB64);
  const iv = packed.slice(0, IV_BYTES);
  const ct = packed.slice(IV_BYTES);
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    return new TextDecoder().decode(plain);
  } catch {
    // AES-GCM fails authentication rather than returning garbage, which is the
    // point. The realistic cause is a changed TOKEN_ENC_KEY.
    throw new HttpError(
      500,
      'Could not decrypt the stored access token. TOKEN_ENC_KEY has probably changed since it was stored. Re-paste the token in the dashboard.'
    );
  }
}

function base64UrlToBytes(input) {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const full = padded + '='.repeat((4 - (padded.length % 4)) % 4);
  return Uint8Array.from(atob(full), (c) => c.charCodeAt(0));
}

/**
 * Parse and verify Meta's `signed_request`, used by the data deletion callback.
 *
 * Format is `<base64url signature>.<base64url json payload>`, where the
 * signature is HMAC-SHA256 of the *encoded payload string* keyed with your app
 * secret. Verifying matters: without it, anyone could POST a deletion request
 * for any user id and wipe rows out of your database.
 */
export async function parseSignedRequest(signedRequest, appSecret) {
  if (!appSecret) throw new HttpError(500, 'META_APP_SECRET is not set');
  const [sigPart, payloadPart] = String(signedRequest || '').split('.');
  if (!sigPart || !payloadPart) throw new HttpError(400, 'Malformed signed_request');

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(appSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const expected = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadPart))
  );
  const provided = base64UrlToBytes(sigPart);

  if (expected.length !== provided.length) throw new HttpError(403, 'signed_request signature mismatch');
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected[i] ^ provided[i];
  if (diff !== 0) throw new HttpError(403, 'signed_request signature mismatch');

  try {
    return JSON.parse(new TextDecoder().decode(base64UrlToBytes(payloadPart)));
  } catch {
    throw new HttpError(400, 'signed_request payload was not JSON');
  }
}

/**
 * Verify Meta's X-Hub-Signature-256 header over the exact raw request body.
 *
 * This is the difference between "only Meta can make this account send a
 * message" and "anyone who discovers the webhook URL can". It must run before
 * any event is processed, and it must use the raw body text, not a re-serialised
 * object, because re-serialising changes the bytes and the signature will not
 * match.
 */
export async function verifyMetaSignature(rawBody, signatureHeader, appSecret) {
  if (!appSecret) return { ok: false, reason: 'META_APP_SECRET is not set' };
  if (!signatureHeader) return { ok: false, reason: 'missing X-Hub-Signature-256 header' };
  if (!signatureHeader.startsWith('sha256=')) {
    return { ok: false, reason: 'signature header is not sha256=' };
  }

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(appSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const expected = [...new Uint8Array(mac)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const provided = signatureHeader.slice(7).toLowerCase();
  if (provided.length !== expected.length) return { ok: false, reason: 'signature length mismatch' };
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
  return diff === 0 ? { ok: true } : { ok: false, reason: 'signature mismatch' };
}
