#!/usr/bin/env node
// One-time (idempotent) seed of ~1 year of daily USD prices from CoinGecko into
// data/series/overview.json, so price charts and price-vs-whale divergence have
// historical context from day one. Whale-balance history is forward-only and is
// filled in by scripts/snapshot-daily.mjs going forward.
//
// Only adds a price for an (date, asset) that has no entry yet — it never
// overwrites real whale-snapshot rows. Run: node scripts/backfill-prices.mjs

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readJson, writeJson, fetchJson, sleep } from './lib/util.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DAYS = 365;

async function main() {
  const assetsCfg = await readJson(join(ROOT, 'config/assets.json'));
  const assets = assetsCfg?.assets || [];
  const seriesPath = join(ROOT, 'data/series/overview.json');
  const doc = (await readJson(seriesPath)) || { rows: [] };

  // index rows by date for merge
  const byDate = new Map((doc.rows || []).map((r) => [r.date, r]));

  for (const a of assets) {
    try {
      // No `interval` param: the free tier auto-returns daily granularity for days>90
      // (and rejects interval=daily as paid-only).
      const url = `https://api.coingecko.com/api/v3/coins/${a.coingeckoId}/market_chart?vs_currency=usd&days=${DAYS}`;
      const json = await fetchJson(url, { timeoutMs: 30000, retries: 2 });
      const prices = json?.prices || [];
      let added = 0;
      for (const [ms, price] of prices) {
        const date = new Date(ms).toISOString().slice(0, 10);
        let row = byDate.get(date);
        if (!row) { row = { date, assets: {} }; byDate.set(date, row); }
        if (!row.assets[a.symbol]) {
          row.assets[a.symbol] = { price: round(price, price < 10 ? 6 : 2) };
          added++;
        }
      }
      console.log(`${a.symbol}: ${prices.length} daily prices, ${added} new rows seeded`);
    } catch (err) {
      console.warn(`${a.symbol}: price backfill FAILED ${err.message}`);
    }
    await sleep(2500); // be gentle with the free CoinGecko endpoint
  }

  const rows = [...byDate.values()].sort((x, y) => (x.date < y.date ? -1 : 1));
  const symbols = [...new Set(rows.flatMap((r) => Object.keys(r.assets)))];
  await writeJson(seriesPath, { updatedAt: new Date().toISOString(), assets: symbols, rows });
  console.log(`series now has ${rows.length} rows spanning ${rows[0]?.date} → ${rows[rows.length - 1]?.date}`);
}

const round = (n, d = 2) => (isFinite(n) ? Math.round(n * 10 ** d) / 10 ** d : 0);
main().catch((err) => { console.error('fatal:', err); process.exit(1); });
