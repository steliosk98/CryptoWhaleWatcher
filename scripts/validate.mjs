#!/usr/bin/env node
// CI guard: parses every config/data JSON file and checks basic shape so a
// malformed commit can't silently break the static site. Exits non-zero on
// any problem. Run: node scripts/validate.mjs

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];

async function parse(rel) {
  try {
    return JSON.parse(await readFile(join(ROOT, rel), 'utf8'));
  } catch (e) {
    errors.push(`${rel}: ${e.message}`);
    return null;
  }
}

const assets = await parse('config/assets.json');
if (assets) {
  if (!Array.isArray(assets.assets) || !assets.assets.length)
    errors.push('config/assets.json: assets[] empty');
  for (const a of assets.assets || []) {
    for (const k of ['symbol', 'name', 'chain', 'coingeckoId', 'decimals', 'topSource'])
      if (a[k] === undefined) errors.push(`asset ${a.symbol || '?'} missing "${k}"`);
  }
}

const labels = await parse('config/labels.json');
if (labels && typeof labels.labels !== 'object') errors.push('config/labels.json: labels must be object');

const latest = await parse('data/latest.json');
if (latest && !Array.isArray(latest.assets)) errors.push('data/latest.json: assets must be array');

const history = await parse('data/history.json');
if (history && !Array.isArray(history)) errors.push('data/history.json: must be an array');

await parse('data/meta.json');

if (errors.length) {
  console.error('VALIDATION FAILED:');
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log('All config/data JSON valid.');
