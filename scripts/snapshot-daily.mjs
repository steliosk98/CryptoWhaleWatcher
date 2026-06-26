#!/usr/bin/env node
// Finalizes a daily end-of-day (EOD) whale snapshot from the freshest intraday
// data (data/latest.json), computing true EOD-to-EOD net flows against the
// previous day's stored balances. Writes:
//   data/daily/<YYYY-MM-DD>.json   immutable per-day archive (cohorts, balances,
//                                  net flow, movers, concentration, entrants/exits)
//   data/series/overview.json      compact long series the dashboard charts
//   data/signals.json              computed flow/accumulation signals
//   data/index.json                catalog of available days + assets
//
// Run from repo root:  node scripts/snapshot-daily.mjs [--date YYYY-MM-DD]

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readJson, writeJson } from './lib/util.mjs';
import { buildSignals } from './lib/signals.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const round = (n, d = 2) => (isFinite(n) ? Math.round(n * 10 ** d) / 10 ** d : 0);

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

async function main() {
  const date = arg('--date') || new Date().toISOString().slice(0, 10);
  const latest = await readJson(join(ROOT, 'data/latest.json'));
  if (!latest?.assets) throw new Error('data/latest.json missing');

  const index = (await readJson(join(ROOT, 'data/index.json'))) || { days: [] };
  const priorDay = (index.days || []).filter((d) => d < date).slice(-1)[0];
  const prior = priorDay ? await readJson(join(ROOT, `data/daily/${priorDay}.json`)) : null;

  const dailyAssets = {};
  const symbols = [];
  for (const a of latest.assets) {
    if (!a || !(a.holders || []).length) continue;
    symbols.push(a.symbol);
    dailyAssets[a.symbol] = buildDailyAsset(a, prior?.assets?.[a.symbol]);
  }

  const daily = { date, generatedAt: new Date().toISOString(), source: 'EOD snapshot from latest.json', assets: dailyAssets };
  await writeJson(join(ROOT, `data/daily/${date}.json`), daily);

  // --- compact series ---
  const seriesDoc = (await readJson(join(ROOT, 'data/series/overview.json'))) || { rows: [] };
  const rows = (seriesDoc.rows || []).filter((r) => r.date !== date);
  const rowAssets = {};
  for (const sym of symbols) {
    const d = dailyAssets[sym];
    rowAssets[sym] = {
      price: d.price,
      whaleUsd: d.cohorts.whale.usd,
      exchangeUsd: d.cohorts.exchange.usd,
      contractUsd: d.cohorts.contract.usd,
      whaleNetFlowUsd: d.netFlow.whaleUsd,
      exchangeNetFlowUsd: d.netFlow.exchangeUsd,
      exchangeReserveAmount: d.cohorts.exchange.amount,
    };
  }
  rows.push({ date, assets: rowAssets });
  rows.sort((a, b) => (a.date < b.date ? -1 : 1));
  const allSymbols = [...new Set(rows.flatMap((r) => Object.keys(r.assets)))];
  await writeJson(join(ROOT, 'data/series/overview.json'), { updatedAt: daily.generatedAt, assets: allSymbols, rows });

  // --- signals ---
  await writeJson(join(ROOT, 'data/signals.json'), buildSignals(rows, allSymbols));

  // --- index ---
  const days = [...new Set([...(index.days || []), date])].sort();
  await writeJson(join(ROOT, 'data/index.json'), {
    updatedAt: daily.generatedAt,
    firstDay: days[0],
    lastDay: days[days.length - 1],
    days,
    assets: allSymbols,
  });

  console.log(`daily snapshot ${date}: ${symbols.length} assets, ${rows.length} series rows.`);
  for (const sym of symbols) {
    const nf = dailyAssets[sym].netFlow;
    console.log(`  ${sym}: whale Δ $${fmt(nf.whaleUsd)} · exch Δ $${fmt(nf.exchangeUsd)}`);
  }
}

function buildDailyAsset(a, prior) {
  const price = a.priceUsd || 0;
  const holders = a.holders || [];
  const balances = {};
  for (const h of holders) balances[h.address] = h.amount;

  const priorBal = prior?.balances || {};
  const flow = { whaleAmount: 0, exchangeAmount: 0, contractAmount: 0 };
  const entrants = [];
  for (const h of holders) {
    if (Object.prototype.hasOwnProperty.call(priorBal, h.address)) {
      flow[(h.cohort || 'whale') + 'Amount'] += h.amount - priorBal[h.address];
    } else if (prior) {
      entrants.push(h.address);
    }
  }
  const exits = Object.keys(priorBal).filter((addr) => !(addr in balances));

  const movers = holders
    .filter((h) => Object.prototype.hasOwnProperty.call(priorBal, h.address))
    .map((h) => ({ address: h.address, label: h.label, cohort: h.cohort, amount: round(h.amount - priorBal[h.address], 4) }))
    .filter((m) => m.amount)
    .sort((x, y) => Math.abs(y.amount) - Math.abs(x.amount))
    .slice(0, 6)
    .map((m) => ({ ...m, usd: round(m.amount * price, 0) }));

  const totalAmt = holders.reduce((s, h) => s + h.amount, 0) || 1;
  const sorted = [...holders].sort((x, y) => y.amount - x.amount);
  const top10Share = round((sorted.slice(0, 10).reduce((s, h) => s + h.amount, 0) / totalAmt) * 100, 2);
  const hhi = Math.round(holders.reduce((s, h) => s + (h.amount / totalAmt) ** 2, 0) * 10000);

  const c = a.cohorts || {};
  const cohort = (k) => ({ usd: c[k]?.usd || 0, amount: c[k]?.amount || 0, count: c[k]?.count || 0 });

  return {
    price,
    cohorts: { whale: cohort('whale'), exchange: cohort('exchange'), contract: cohort('contract') },
    netFlow: {
      whaleAmount: round(flow.whaleAmount, 4), whaleUsd: round(flow.whaleAmount * price, 0),
      exchangeAmount: round(flow.exchangeAmount, 4), exchangeUsd: round(flow.exchangeAmount * price, 0),
    },
    concentration: { top10SharePct: top10Share, hhi },
    movers,
    entrants,
    exits,
    balances,
  };
}

const fmt = (n) => Number(n || 0).toLocaleString('en-US');

main().catch((err) => { console.error('fatal:', err); process.exit(1); });
