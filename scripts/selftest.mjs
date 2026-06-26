#!/usr/bin/env node
// Offline unit tests for the pure transform logic. No network. Runs in CI and
// exits non-zero on any failure. Run: node scripts/selftest.mjs

import assert from 'node:assert/strict';
import { toUnits, normAddr, lookupLabel, hexToBig } from './lib/util.mjs';
import {
  buildAssetView,
  prevAmountMap,
  buildHistoryPoint,
  shortenAddr,
  round,
} from './lib/build.mjs';

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

console.log(`\n${passed} tests passed.`);
