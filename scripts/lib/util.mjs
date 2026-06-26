// Shared utilities for the data fetcher. Zero external dependencies — relies on
// Node 18+ global fetch / AbortController.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export const USER_AGENT =
  'CryptoWhaleWatcher/1.0 (+https://github.com/steliosk98/CryptoWhaleWatcher)';

/** Sleep for ms milliseconds. */
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * fetch with timeout + retries. Returns parsed JSON.
 * Throws on non-2xx or network failure after exhausting retries.
 */
export async function fetchJson(url, opts = {}) {
  const {
    method = 'GET',
    body = null,
    headers = {},
    timeoutMs = 20000,
    retries = 2,
    retryDelayMs = 1500,
  } = opts;

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method,
        headers: {
          'accept': 'application/json',
          'user-agent': USER_AGENT,
          ...(body ? { 'content-type': 'application/json' } : {}),
          ...headers,
        },
        body: body ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
      }
      return await res.json();
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (attempt < retries) {
        await sleep(retryDelayMs * (attempt + 1));
      }
    }
  }
  throw lastErr;
}

/** fetch returning the raw text body (for endpoints that return plain numbers). */
export async function fetchText(url, opts = {}) {
  const { timeoutMs = 15000, retries = 1, retryDelayMs = 1000 } = opts;
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { headers: { 'user-agent': USER_AGENT }, signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.text();
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (attempt < retries) await sleep(retryDelayMs * (attempt + 1));
    }
  }
  throw lastErr;
}

/** Split an array into chunks of size n. */
export function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/** Read JSON file, returning fallback if missing/unparseable. */
export async function readJson(path, fallback = null) {
  try {
    const txt = await readFile(path, 'utf8');
    return JSON.parse(txt);
  } catch {
    return fallback;
  }
}

/** Write pretty JSON, creating parent dirs as needed. */
export async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

/**
 * Convert a raw integer balance (string|number|bigint) in base units to a
 * floating-point amount in whole token units. Precision to the whole unit is
 * preserved even for values beyond Number.MAX_SAFE_INTEGER.
 */
export function toUnits(raw, decimals) {
  let big;
  try {
    if (typeof raw === 'bigint') big = raw;
    else if (typeof raw === 'string')
      big = BigInt(raw.startsWith('0x') ? raw : raw.split('.')[0] || '0');
    else big = BigInt(Math.trunc(Number(raw)));
  } catch {
    return Number(raw) / 10 ** decimals || 0;
  }
  const divisor = 10n ** BigInt(decimals);
  const whole = big / divisor;
  const frac = big % divisor;
  return Number(whole) + Number(frac) / Number(divisor);
}

/** Lowercase EVM addresses for label lookup; pass others through unchanged. */
export function normAddr(addr) {
  if (typeof addr !== 'string') return '';
  return addr.startsWith('0x') ? addr.toLowerCase() : addr;
}

/** Look up a known label for an address (tries exact, then lowercased). */
export function lookupLabel(labels, addr) {
  if (!addr) return null;
  return labels[addr] || labels[addr.toLowerCase()] || null;
}

/** Hex string -> BigInt (handles undefined/null gracefully). */
export function hexToBig(hex) {
  if (!hex || hex === '0x') return 0n;
  try {
    return BigInt(hex);
  } catch {
    return 0n;
  }
}
