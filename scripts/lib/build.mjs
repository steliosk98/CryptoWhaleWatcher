// Pure transform logic: enrich raw holders with labels, prices, and movement
// deltas vs the previous snapshot, then aggregate — split by cohort so the UI
// can separate directional "smart-money" whales from custodial exchange
// reserves. No I/O or network here so it can be unit-tested directly
// (see scripts/selftest.mjs).

import { normAddr, lookupLabel } from './util.mjs';

export function shortenAddr(addr) {
  if (!addr) return '';
  if (addr.length <= 14) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-6)}`;
}

/**
 * Cohort an address belongs to:
 *  - exchange : custodial exchange wallet (reserves / flow signal)
 *  - contract : staking deposit, bridge, or protocol contract (informational)
 *  - whale    : individual / unknown large holder (directional signal)
 */
export function cohortOf(type) {
  if (type === 'exchange') return 'exchange';
  if (type === 'contract') return 'contract';
  return 'whale';
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
    const type = meta?.type || 'unknown';
    return {
      rank: i + 1,
      address: h.address,
      short: shortenAddr(h.address),
      amount: round(h.amount, 4),
      usd: round(h.amount * price, 2),
      label: meta?.label || null,
      entity: meta?.entity || null,
      type,
      cohort: cohortOf(type),
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
  const cohorts = cohortStats(enriched, price);

  return {
    symbol: asset.symbol,
    name: asset.name,
    chain: asset.chain,
    decimals: asset.decimals,
    explorerAddress: asset.explorerAddress,
    priceUsd: round(price, price < 10 ? 6 : 2),
    priceChange24h: round(priceChange, 2),
    holders: enriched,
    cohorts,
    aggregates: {
      holderCount: enriched.length,
      totalAmount: round(totalAmount, 2),
      totalUsd: round(totalAmount * price, 0),
      netFlowAmount: round(netFlowAmount, 2),
      netFlowUsd: round(netFlowAmount * price, 0),
      accumulators,
      distributors,
      // cohort convenience fields (used by KPIs + history)
      whaleUsd: cohorts.whale.usd,
      exchangeUsd: cohorts.exchange.usd,
      contractUsd: cohorts.contract.usd,
      whaleNetFlowUsd: cohorts.whale.netFlowUsd,
      exchangeNetFlowUsd: cohorts.exchange.netFlowUsd,
      whaleCount: cohorts.whale.count,
      exchangeCount: cohorts.exchange.count,
    },
  };
}

/** Aggregate enriched holders into per-cohort stats. */
export function cohortStats(holders, price) {
  const make = () => ({ count: 0, amount: 0, netFlowAmount: 0, accumulators: 0, distributors: 0 });
  const c = { whale: make(), exchange: make(), contract: make() };
  for (const h of holders) {
    const g = c[h.cohort] || c.whale;
    g.count++;
    g.amount += h.amount;
    if (!h.isNew) {
      g.netFlowAmount += h.delta;
      if (h.delta > 0) g.accumulators++;
      else if (h.delta < 0) g.distributors++;
    }
  }
  for (const k of Object.keys(c)) {
    const g = c[k];
    g.amount = round(g.amount, 2);
    g.usd = round(g.amount * price, 0);
    g.netFlowAmount = round(g.netFlowAmount, 2);
    g.netFlowUsd = round(g.netFlowAmount * price, 0);
  }
  return c;
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
    const ag = a.aggregates || {};
    assets[a.symbol] = {
      totalAmount: ag.totalAmount,
      totalUsd: ag.totalUsd,
      netFlowUsd: ag.netFlowUsd,
      priceUsd: a.priceUsd,
      whaleUsd: ag.whaleUsd,
      exchangeUsd: ag.exchangeUsd,
      whaleNetFlowUsd: ag.whaleNetFlowUsd,
      exchangeNetFlowUsd: ag.exchangeNetFlowUsd,
    };
    totalUsd += ag.totalUsd || 0;
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
