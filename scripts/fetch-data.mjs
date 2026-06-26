#!/usr/bin/env node
// Orchestrates the whale-data refresh:
//   1. load config + previous snapshot
//   2. fetch prices (CoinGecko) and per-asset top holders (keyless sources)
//   3. enrich with labels + movement deltas vs the previous snapshot
//   4. write data/latest.json, append data/history.json, write data/meta.json
//
// Designed to degrade gracefully: a failing asset is recorded with status
// "error" and the rest of the run proceeds. Run from repo root:
//   node scripts/fetch-data.mjs

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readJson, writeJson } from './lib/util.mjs';
import { fetchHolders, fetchPrices } from './lib/sources.mjs';
import { buildAssetView, prevAmountMap, buildHistoryPoint } from './lib/build.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HISTORY_CAP = 360; // ~3 months at 6h cadence

async function main() {
  const assetsCfg = await readJson(join(ROOT, 'config/assets.json'));
  const labelsCfg = await readJson(join(ROOT, 'config/labels.json'), { labels: {} });
  const assets = assetsCfg?.assets || [];
  const labels = labelsCfg?.labels || {};
  if (!assets.length) throw new Error('config/assets.json has no assets');

  const prev = await readJson(join(ROOT, 'data/latest.json'), { assets: [] });
  const prevBySymbol = new Map((prev.assets || []).map((a) => [a.symbol, a]));

  // Prices (one call). Non-fatal if it fails — USD columns just show 0.
  let prices = {};
  try {
    prices = await fetchPrices(assets.map((a) => a.coingeckoId));
    console.log(`prices: fetched ${Object.keys(prices).length} ids`);
  } catch (err) {
    console.warn(`prices: FAILED ${err.message}`);
  }

  const sources = new Set();
  const views = [];
  for (const asset of assets) {
    const prevView = prevBySymbol.get(asset.symbol);
    try {
      const { source, holders } = await fetchHolders(asset);
      sources.add(source);
      const view = buildAssetView(
        asset,
        holders,
        prices[asset.coingeckoId],
        prevAmountMap(prevView),
        labels
      );
      view.source = source;
      view.status = 'ok';
      views.push(view);
      console.log(
        `${asset.symbol}: ${holders.length} holders via ${source} ` +
          `(total $${fmt(view.aggregates.totalUsd)}, netflow $${fmt(view.aggregates.netFlowUsd)})`
      );
    } catch (err) {
      console.warn(`${asset.symbol}: FAILED ${err.message}`);
      // Preserve the previous good view (marked stale) so the UI keeps data.
      if (prevView) {
        views.push({ ...prevView, status: 'stale', error: err.message });
      } else {
        views.push({
          symbol: asset.symbol,
          name: asset.name,
          status: 'error',
          error: err.message,
          holders: [],
          aggregates: { holderCount: 0, totalUsd: 0, netFlowUsd: 0 },
        });
      }
    }
  }

  const now = new Date().toISOString();
  const latest = { generatedAt: now, assets: views };
  await writeJson(join(ROOT, 'data/latest.json'), latest);

  // Append to history (only when we have at least one healthy asset).
  const healthy = views.some((v) => v.status === 'ok');
  if (healthy) {
    const history = (await readJson(join(ROOT, 'data/history.json'), [])) || [];
    history.push(buildHistoryPoint(now, views));
    await writeJson(join(ROOT, 'data/history.json'), history.slice(-HISTORY_CAP));
  }

  await writeJson(join(ROOT, 'data/meta.json'), {
    generatedAt: now,
    assetCount: views.length,
    okCount: views.filter((v) => v.status === 'ok').length,
    sources: [...sources, 'coingecko.com (prices)'].sort(),
    cadence: 'every 6 hours via GitHub Actions',
    disclaimer:
      'Tracks publicly-labeled large/whale addresses and exchange-grade rich lists from free, ' +
      'keyless public APIs. Movements are computed from balance changes between snapshots. ' +
      'Entity labels are best-effort and community-sourced. Not financial advice.',
  });

  const failed = views.filter((v) => v.status === 'error');
  console.log(`\nDone. ${views.length - failed.length}/${views.length} assets healthy.`);
  if (failed.length === views.length) {
    console.error('All assets failed — exiting non-zero.');
    process.exit(1);
  }
}

const fmt = (n) => Number(n || 0).toLocaleString('en-US');

main().catch((err) => {
  console.error('fatal:', err);
  process.exit(1);
});
