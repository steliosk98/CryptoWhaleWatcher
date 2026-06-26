# 🐋 Crypto Whale Watcher

A **free, open-source, quant-style dashboard** that tracks the movements of the
largest whale & exchange addresses across major crypto assets — **BTC, ETH,
USDT, USDC and SOL** — and surfaces accumulation / distribution trends.

Everything runs on **GitHub Pages + GitHub Actions**, using only **free, keyless
public APIs**. No backend, no database, no API keys, no paywall. Anyone can fork
it and host their own copy in minutes.

> **Live site:** https://steliosk98.github.io/CryptoWhaleWatcher/

![dashboard](docs/preview.png)

---

## What it shows

- **Top holders per asset** — exchange-grade rich lists and the largest known
  wallets, with best-effort entity labels (Binance, Bitfinex, Kraken, …).
- **Movement tracking** — per-address balance change since the previous
  snapshot (Δ balance / Δ USD), flagged as accumulation (▲) or distribution (▼).
- **Net flow & KPIs** — aggregate tracked value, net whale flow, addresses
  monitored, and a per-asset acc/dist breakdown.
- **Biggest movers** — the largest accumulators and distributors across all
  assets each refresh.
- **History trend** — a tracked-value sparkline that builds up over time from
  committed snapshots.

## How it works

```
GitHub Actions (cron, every 6h)
  └─ scripts/fetch-data.mjs
       ├─ fetches top holders / rich lists from free public APIs
       ├─ fetches spot prices from CoinGecko
       ├─ diffs balances against the previous snapshot → movements
       └─ writes data/latest.json, data/history.json, data/meta.json
            └─ commits them back to the repo
                 └─ GitHub Pages serves index.html which fetches that JSON
```

Because the data is **pre-computed in CI and committed as static JSON**, the
browser only ever reads same-origin files — there are **no CORS issues and no
exposed credentials**. The frontend is plain HTML/CSS/vanilla JS with **no build
step**.

### Data sources (all free & keyless)

| Asset        | Source                                            |
|--------------|---------------------------------------------------|
| BTC          | [blockchain.info](https://blockchain.info) balances of curated whale wallets |
| ETH          | Public Ethereum JSON-RPC (`eth_getBalance`)       |
| USDT / USDC  | [Ethplorer](https://ethplorer.io) top token holders (`freekey`) |
| SOL          | Solana RPC `getMultipleAccounts` (curated whale wallets) |
| Prices       | [CoinGecko](https://coingecko.com) simple price   |

## Project layout

```
index.html                 # dashboard shell
assets/css/style.css        # quant dark theme
assets/js/app.js            # rendering + charts (no dependencies)
config/assets.json          # which assets to track + how to source them
config/labels.json          # address → entity label map
scripts/fetch-data.mjs      # CI data fetcher (orchestrator)
scripts/lib/*.mjs           # sources, transforms, utilities
scripts/selftest.mjs        # offline unit tests for the pure logic
scripts/validate.mjs        # JSON/shape validation (CI guard)
data/*.json                 # generated snapshots (committed by CI)
.github/workflows/          # CI (tests) + scheduled data refresh
```

## Run / develop locally

The site is static, but the page uses `fetch()` for the JSON, so it must be
served over HTTP (not opened as a `file://`). With any static server:

```bash
# Node
npx serve .
# or Python
python -m http.server 8000
```

Then open `http://localhost:8000`.

To exercise the data pipeline (Node 18+ required, no dependencies to install):

```bash
node scripts/selftest.mjs     # offline unit tests
node scripts/fetch-data.mjs   # hit the live APIs and regenerate data/
node scripts/validate.mjs     # validate config + data JSON
```

## Contributing whale addresses & labels

The tracked sets are data-driven and easy to extend:

- **Add / correct an entity label:** edit [`config/labels.json`](config/labels.json).
  EVM keys are lowercased; Bitcoin/Solana keys are exact.
- **Track more Ethereum addresses:** add them to the `ETH` asset's `curated`
  list in [`config/assets.json`](config/assets.json).
- **Add an asset:** add an entry to `config/assets.json` and (if it needs a new
  fetch strategy) implement it in [`scripts/lib/sources.mjs`](scripts/lib/sources.mjs).

PRs welcome.

## ⚠️ Disclaimer

Entity labels are **best-effort and community-sourced** and may be inaccurate or
out of date. "Top holders" reflect the rich lists / large-holder endpoints of
the free APIs above, not a guaranteed global ranking. This project is for
**informational and educational purposes only** and is **not financial advice**.

## License

[MIT](LICENSE)
