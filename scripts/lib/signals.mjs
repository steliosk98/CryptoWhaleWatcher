// Pure signal math derived from the daily series. No I/O — unit-tested in
// scripts/selftest.mjs. Every signal is regime-relative (scored against its own
// recent history via z-scores) so it adapts per asset instead of using magic
// absolute thresholds. Signals are informational, not advice.

export const ASSETS_STABLE = ['USDT', 'USDC'];

export function mean(a) {
  const v = a.filter(isFiniteNum);
  return v.length ? v.reduce((x, y) => x + y, 0) / v.length : 0;
}
export function std(a) {
  const v = a.filter(isFiniteNum);
  if (v.length < 2) return 0;
  const m = mean(v);
  return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1));
}
export function zscore(value, history) {
  const s = std(history);
  if (!s) return 0;
  return (value - mean(history)) / s;
}
/** Map a z-score to a bounded 0..100 score (50 = neutral). */
export function zToScore(z) {
  return Math.round((50 + 50 * Math.tanh(z / 2)) * 10) / 10;
}
export function pctChange(now, then) {
  if (!isFiniteNum(now) || !isFiniteNum(then) || then === 0) return null;
  return ((now - then) / Math.abs(then)) * 100;
}
const isFiniteNum = (v) => typeof v === 'number' && isFinite(v);
const last = (a, n) => a.slice(Math.max(0, a.length - n));

/**
 * Compute the current signal set for one asset from its ordered daily rows.
 * @param {Array} rows  series rows asc by date; each row.assets[sym] may hold
 *   { price, whaleUsd, exchangeUsd, whaleNetFlowUsd, exchangeNetFlowUsd, exchangeReserveAmount }
 */
export function assetSignals(rows, sym) {
  const series = rows.map((r) => r.assets?.[sym]).map((a) => a || {});
  const exNet = series.map((a) => a.exchangeNetFlowUsd);
  const whNet = series.map((a) => a.whaleNetFlowUsd);
  const price = series.map((a) => a.price);
  const reserve = series.map((a) => a.exchangeReserveAmount);

  const exNetVals = exNet.filter(isFiniteNum);
  const whNetVals = whNet.filter(isFiniteNum);

  // Exchange net-flow: out (negative) = bullish, in (positive) = sell pressure.
  const exNet1d = lastFinite(exNet);
  const exNet7d = sumFinite(last(exNet, 7));
  const exNetZ = exNetVals.length >= 4 ? zscore(exNet1d ?? 0, last(exNetVals, 30)) : 0;

  // Whale accumulation: positive net flow = accumulation. Scored vs own history.
  const whNet7d = sumFinite(last(whNet, 7));
  const whNetZ = whNetVals.length >= 4 ? zscore(lastFinite(whNet) ?? 0, last(whNetVals, 30)) : 0;
  const accScore = whNetVals.length >= 4 ? zToScore(whNetZ) : null;

  // Exchange reserve trend: falling reserves = structurally bullish.
  const reserveNow = lastFinite(reserve);
  const reserve30 = nthFromEndFinite(reserve, 30);
  const reserveChange30dPct = pctChange(reserveNow, reserve30);

  // Divergence: price vs whale positioning over ~7d.
  const price7 = nthFromEndFinite(price, 7);
  const priceChange7dPct = pctChange(lastFinite(price), price7);
  let divergence = 'none';
  if (priceChange7dPct != null && isFiniteNum(whNet7d)) {
    if (priceChange7dPct < -2 && whNet7d > 0) divergence = 'bullish';
    else if (priceChange7dPct > 2 && whNet7d < 0) divergence = 'bearish';
  }

  return {
    exchangeNetFlow1dUsd: round0(exNet1d),
    exchangeNetFlow7dUsd: round0(exNet7d),
    exchangeNetFlowZ: round2(exNetZ),
    exchangeLean: leanFromExchangeFlow(exNetZ, exNet7d),
    whaleNetFlow7dUsd: round0(whNet7d),
    whaleAccumulationScore: accScore,
    whaleLean: accScore == null ? 'neutral' : accScore >= 60 ? 'bullish' : accScore <= 40 ? 'bearish' : 'neutral',
    exchangeReserveAmount: round2(reserveNow),
    reserveChange30dPct: reserveChange30dPct == null ? null : round2(reserveChange30dPct),
    reserveLean: reserveChange30dPct == null ? 'neutral'
      : reserveChange30dPct < -1 ? 'bullish' : reserveChange30dPct > 1 ? 'bearish' : 'neutral',
    priceChange7dPct: priceChange7dPct == null ? null : round2(priceChange7dPct),
    divergence,
    samples: exNetVals.length,
  };
}

/** Cross-asset stablecoin "dry powder": tracked USDT+USDC value + 7d change. */
export function dryPowder(rows) {
  const total = (row) => ASSETS_STABLE.reduce((s, k) => {
    const a = row.assets?.[k];
    const v = (a?.whaleUsd || 0) + (a?.exchangeUsd || 0);
    return s + (isFiniteNum(v) ? v : 0);
  }, 0);
  if (!rows.length) return { usd: 0, change7dPct: null };
  const nowRow = rows[rows.length - 1];
  const thenRow = rows[Math.max(0, rows.length - 8)];
  const now = total(nowRow), then = total(thenRow);
  return { usd: round0(now), change7dPct: pctChange(now, then) == null ? null : round2(pctChange(now, then)) };
}

/** Build the full signals.json payload from the series rows. */
export function buildSignals(rows, symbols) {
  const assets = {};
  for (const sym of symbols) assets[sym] = assetSignals(rows, sym);
  return { updatedAt: new Date().toISOString(), assets, dryPowder: dryPowder(rows) };
}

// exchange flow lean: outflow (negative) bullish, inflow bearish; magnitude via z
function leanFromExchangeFlow(z, sum7d) {
  if (!isFiniteNum(sum7d) || sum7d === 0) return 'neutral';
  if (sum7d < 0 && z <= -0.5) return 'bullish';
  if (sum7d > 0 && z >= 0.5) return 'bearish';
  return 'neutral';
}

// helpers
function lastFinite(a) { for (let i = a.length - 1; i >= 0; i--) if (isFiniteNum(a[i])) return a[i]; return null; }
function nthFromEndFinite(a, n) { const i = a.length - 1 - n; return i >= 0 && isFiniteNum(a[i]) ? a[i] : (i < 0 ? firstFinite(a) : lastFinite(a.slice(0, i + 1))); }
function firstFinite(a) { for (let i = 0; i < a.length; i++) if (isFiniteNum(a[i])) return a[i]; return null; }
function sumFinite(a) { const v = a.filter(isFiniteNum); return v.length ? v.reduce((x, y) => x + y, 0) : null; }
const round0 = (n) => (isFiniteNum(n) ? Math.round(n) : null);
const round2 = (n) => (isFiniteNum(n) ? Math.round(n * 100) / 100 : null);
