// Pure transform logic: enrich raw holders with labels, prices, and movement
// deltas vs the previous snapshot, then aggregate. No I/O or network here so it
// can be unit-tested directly (see scripts/selftest.mjs).

import { normAddr, lookupLabel } from './util.mjs';

export function shortenAddr(addr) {
  if (!addr) return '';
  if (addr.length <= 14) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-6)}`;
}

/**
 * Build the per-asset view object.
 * @param {object} asset      asset config entry
 * @param {Array}  holders    [{address, amount, share?}] from a source
 * @param {object} priceInfo  { usd, usd_24h_change } or undefined
 * @param {Map}    prevMap    Map<normAddr, prevAmount> from previous snapshot
 * @param {object} labels     address -> {entity,label,type}
 */
export function buildAssetView(asset, holders, priceInfo, prevMap, labels) {
  const price = Number(priceInfo?.usd) || 0;
  const priceChange = Number(priceInfo?.usd_24h_change) || 0;

  const enriched = holders.map((h, i) => {
    const key = normAddr(h.address);
    const meta = lookupLabel(labels, h.address);
    const prev = prevMap.get(key);
    const hasPrev = typeof prev === 'number';
    const delta = hasPrev ? h.amount - prev : 0;
    return {
      rank: i + 1,
      address: h.address,
      short: shortenAddr(h.address),
      amount: round(h.amount, 4),
      usd: round(h.amount * price, 2),
      label: meta?.label || null,
      entity: meta?.entity || null,
      type: meta?.type || 'unknown',
      share: typeof h.share === 'number' ? round(h.share, 4) : null,
      delta: round(delta, 4),
      deltaUsd: round(delta * price, 2),
      isNew: !hasPrev,
    };
  });

  const totalAmount = sum(enriched.map((h) => h.amount));
  const netFlowAmount = sum(enriched.filter((h) => !h.isNew).map((h) => h.delta));
  const accumulators = enriched.filter((h) => h.delta > 0).length;
  const distributors = enriched.filter((h) => h.delta < 0).length;

  return {
    symbol: asset.symbol,
    name: asset.name,
    chain: asset.chain,
    decimals: asset.decimals,
    explorerAddress: asset.explorerAddress,
    priceUsd: round(price, price < 10 ? 6 : 2),
    priceChange24h: round(priceChange, 2),
    holders: enriched,
    aggregates: {
      holderCount: enriched.length,
      totalAmount: round(totalAmount, 2),
      totalUsd: round(totalAmount * price, 0),
      netFlowAmount: round(netFlowAmount, 2),
      netFlowUsd: round(netFlowAmount * price, 0),
      accumulators,
      distributors,
    },
  };
}

/** Build a Map<normAddr, amount> from a previous asset view (or undefined). */
export function prevAmountMap(prevAssetView) {
  const m = new Map();
  if (!prevAssetView?.holders) return m;
  for (const h of prevAssetView.holders) m.set(normAddr(h.address), h.amount);
  return m;
}

/** Compact per-run point appended to the history time series. */
export function buildHistoryPoint(timestamp, assetViews) {
  const assets = {};
  let totalUsd = 0;
  for (const a of assetViews) {
    if (!a || a.status === 'error') continue;
    assets[a.symbol] = {
      totalAmount: a.aggregates.totalAmount,
      totalUsd: a.aggregates.totalUsd,
      netFlowUsd: a.aggregates.netFlowUsd,
      priceUsd: a.priceUsd,
    };
    totalUsd += a.aggregates.totalUsd || 0;
  }
  return { t: timestamp, totalUsd: Math.round(totalUsd), assets };
}

// --- small numeric helpers ---
export function round(n, dp = 2) {
  if (!isFinite(n)) return 0;
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
function sum(arr) {
  return arr.reduce((a, b) => a + (isFinite(b) ? b : 0), 0);
}
