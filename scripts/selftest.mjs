#!/usr/bin/env node
// Offline unit tests for the pure transform logic. No network. Runs in CI and
// exits non-zero on any failure. Run: node scripts/selftest.mjs

import assert from 'node:assert/strict';
import { toUnits, normAddr, lookupLabel, hexToBig, chunk } from './lib/util.mjs';
import {
  buildAssetView,
  prevAmountMap,
  buildHistoryPoint,
  shortenAddr,
  cohortOf,
  round,
} from './lib/build.mjs';
import { zscore, zToScore, pctChange, assetSignals, dryPowder } from './lib/signals.mjs';

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

test('toUnits handles huge wei beyond MAX_SAFE_INTEGER', () => {
  // 12,345,678 ETH in wei
  const wei = 12_345_678n * 10n ** 18n;
  assert.equal(Math.round(toUnits(wei, 18)), 12_345_678);
});

test('toUnits handles satoshis and token base units', () => {
  assert.equal(toUnits('248597000000000', 8), 2485970);
  assert.equal(toUnits('1000000000000', 6), 1_000_000); // 1M USDT (6 dp)
  assert.equal(toUnits('0x', 18), 0);
});

test('hexToBig parses hex and tolerates junk', () => {
  assert.equal(hexToBig('0x0de0b6b3a7640000'), 10n ** 18n);
  assert.equal(hexToBig(undefined), 0n);
  assert.equal(hexToBig('0x'), 0n);
});

test('normAddr lowercases EVM, preserves BTC/SOL', () => {
  assert.equal(normAddr('0xAbC'), '0xabc');
  assert.equal(normAddr('34xp4vRoCGJym3xR7yCVPFHoCNxv4Twseo'), '34xp4vRoCGJym3xR7yCVPFHoCNxv4Twseo');
});

test('lookupLabel matches exact and lowercased', () => {
  const labels = { '0xabc': { label: 'X' }, 'BtCaddr': { label: 'Y' } };
  assert.equal(lookupLabel(labels, '0xABC').label, 'X');
  assert.equal(lookupLabel(labels, 'BtCaddr').label, 'Y');
  assert.equal(lookupLabel(labels, 'nope'), null);
});

test('shortenAddr truncates long, keeps short', () => {
  assert.equal(shortenAddr('0x1234567890abcdef1234'), '0x1234…ef1234');
  assert.equal(shortenAddr('short'), 'short');
});

test('chunk splits arrays correctly', () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunk([], 3), []);
});

test('round respects decimal places', () => {
  assert.equal(round(1.23456, 2), 1.23);
  assert.equal(round(1 / 3, 4), 0.3333);
  assert.equal(round(Infinity, 2), 0);
});

test('buildAssetView computes deltas, USD, aggregates', () => {
  const asset = { symbol: 'BTC', name: 'Bitcoin', chain: 'bitcoin', decimals: 8, explorerAddress: 'x/' };
  const holders = [
    { address: 'A', amount: 100 },
    { address: 'B', amount: 50 },
    { address: 'C', amount: 10 }, // new entrant (no prev)
  ];
  const prev = prevAmountMap({ holders: [
    { address: 'A', amount: 90 },  // +10 accumulate
    { address: 'B', amount: 70 },  // -20 distribute
  ] });
  const labels = { A: { entity: 'Binance', label: 'Binance', type: 'exchange' } };
  const v = buildAssetView(asset, holders, { usd: 2, usd_24h_change: 1.5 }, prev, labels);

  assert.equal(v.holders[0].label, 'Binance');
  assert.equal(v.holders[0].delta, 10);
  assert.equal(v.holders[0].usd, 200);
  assert.equal(v.holders[1].delta, -20);
  assert.equal(v.holders[2].isNew, true);
  assert.equal(v.holders[2].delta, 0); // new entrants contribute 0 net flow
  assert.equal(v.aggregates.holderCount, 3);
  assert.equal(v.aggregates.totalAmount, 160);
  assert.equal(v.aggregates.totalUsd, 320);
  assert.equal(v.aggregates.netFlowAmount, -10); // +10 -20
  assert.equal(v.aggregates.accumulators, 1);
  assert.equal(v.aggregates.distributors, 1);
  assert.equal(v.priceChange24h, 1.5);

  // cohort split: A is an exchange, B & C are whales (unlabeled)
  assert.equal(v.holders[0].cohort, 'exchange');
  assert.equal(v.holders[1].cohort, 'whale');
  assert.equal(v.cohorts.exchange.amount, 100);
  assert.equal(v.cohorts.exchange.usd, 200);
  assert.equal(v.cohorts.whale.amount, 60); // 50 + 10
  assert.equal(v.cohorts.whale.netFlowUsd, -40); // only B has prev: -20 * 2
  assert.equal(v.aggregates.exchangeNetFlowUsd, 20); // A: +10 * 2
  assert.equal(v.aggregates.whaleCount, 2);
});

test('cohortOf maps types to cohorts', () => {
  assert.equal(cohortOf('exchange'), 'exchange');
  assert.equal(cohortOf('contract'), 'contract');
  assert.equal(cohortOf('whale'), 'whale');
  assert.equal(cohortOf('unknown'), 'whale');
  assert.equal(cohortOf(undefined), 'whale');
});

test('buildHistoryPoint sums healthy assets only', () => {
  const views = [
    { symbol: 'BTC', status: 'ok', priceUsd: 2, aggregates: { totalAmount: 10, totalUsd: 20, netFlowUsd: 5 } },
    { symbol: 'ETH', status: 'error', aggregates: { totalUsd: 999 } },
  ];
  const p = buildHistoryPoint('2026-01-01T00:00:00Z', views);
  assert.equal(p.totalUsd, 20);
  assert.equal(p.assets.BTC.totalUsd, 20);
  assert.equal(p.assets.ETH, undefined);
});

test('zscore + zToScore behave', () => {
  assert.equal(zscore(5, [1, 2, 3, 4, 5]), zscore(5, [1, 2, 3, 4, 5])); // deterministic
  assert.equal(zToScore(0), 50);
  assert.ok(zToScore(3) > 90 && zToScore(3) <= 100);
  assert.ok(zToScore(-3) < 10 && zToScore(-3) >= 0);
});

test('pctChange handles zero / invalid', () => {
  assert.equal(pctChange(110, 100), 10);
  assert.equal(pctChange(90, 100), -10);
  assert.equal(pctChange(1, 0), null);
  assert.equal(pctChange(1, NaN), null);
});

test('assetSignals computes leans + divergence', () => {
  // 8 days: exchange consistently OUTflowing (negative) -> bullish lean;
  // whales accumulating (positive); price falling -> bullish divergence.
  const rows = [];
  for (let i = 0; i < 8; i++) {
    rows.push({ date: `2026-01-0${i + 1}`, assets: { BTC: {
      price: 100 - i * 2,                 // price falling
      whaleUsd: 1000 + i * 10,
      exchangeUsd: 2000 - i * 10,
      exchangeNetFlowUsd: -50 - i,        // outflow
      whaleNetFlowUsd: 40 + i,            // accumulation
      exchangeReserveAmount: 500 - i,     // reserves falling
    } } });
  }
  const s = assetSignals(rows, 'BTC');
  assert.equal(s.exchangeLean, 'bullish');     // sustained outflow
  assert.equal(s.whaleLean, 'bullish');        // accumulation
  assert.equal(s.reserveLean, 'bullish');      // reserves falling
  assert.equal(s.divergence, 'bullish');       // price down + whales accumulating
  assert.ok(s.priceChange7dPct < 0);
});

test('dryPowder sums stablecoin reserves + 7d change', () => {
  const mk = (u) => ({ assets: { USDT: { whaleUsd: u, exchangeUsd: u }, USDC: { whaleUsd: u, exchangeUsd: 0 } } });
  const rows = [mk(100), mk(100), mk(100), mk(100), mk(100), mk(100), mk(100), mk(150)];
  const dp = dryPowder(rows);
  assert.equal(dp.usd, 450); // 150*2 (USDT w+e) + 150 (USDC w)
  assert.ok(dp.change7dPct > 0);
});

console.log(`\n${passed} tests passed.`);
