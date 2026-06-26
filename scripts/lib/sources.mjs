// Per-strategy whale-holder fetchers. Every function returns a normalized list:
//   { source, holders: [{ address, amount }] }   amount = whole token units.
// All sources are free and keyless. Each is invoked inside try/catch by the
// orchestrator, so a single failing source never aborts the whole run.

import { fetchJson, toUnits, hexToBig } from './util.mjs';

const EVM_RPCS = [
  'https://ethereum-rpc.publicnode.com',
  'https://eth.llamarpc.com',
  'https://rpc.ankr.com/eth',
  'https://cloudflare-eth.com',
];

/** Bitcoin: real top-N addresses by balance via Blockchair (keyless). */
export async function blockchairBtc(asset) {
  const limit = Math.min(asset.limit || 100, 100);
  const url = `https://api.blockchair.com/bitcoin/addresses?limit=${limit}`;
  const json = await fetchJson(url, { timeoutMs: 25000 });
  // Blockchair's /addresses returns data either as an array of
  // {address, balance} or as an object keyed by address -> balance.
  const data = json?.data;
  const rows = Array.isArray(data)
    ? data
    : data && typeof data === 'object'
      ? Object.entries(data).map(([address, v]) => ({ address, balance: v?.balance ?? v }))
      : [];
  const holders = rows
    .map((r) => ({ address: r.address, amount: toUnits(r.balance, asset.decimals) }))
    .filter((h) => h.address && h.amount > 0)
    .sort((a, b) => b.amount - a.amount);
  if (!holders.length) throw new Error('blockchair returned no BTC addresses');
  return { source: 'blockchair.com (BTC rich list)', holders };
}

/** ERC-20 token: real top-N holders via Ethplorer public "freekey". */
export async function ethplorerTokenHolders(asset) {
  const limit = Math.min(asset.limit || 100, 100);
  const url = `https://api.ethplorer.io/getTopTokenHolders/${asset.tokenContract}?apiKey=freekey&limit=${limit}`;
  const json = await fetchJson(url, { timeoutMs: 25000 });
  const rows = Array.isArray(json?.holders) ? json.holders : [];
  const holders = rows
    .map((r) => ({
      address: r.address,
      // Ethplorer returns raw token balance (integer in base units).
      amount: toUnits(r.balance, asset.decimals),
      share: typeof r.share === 'number' ? r.share : undefined,
    }))
    .filter((h) => h.address && h.amount > 0);
  if (!holders.length) throw new Error(`ethplorer returned no holders for ${asset.symbol}`);
  return { source: 'ethplorer.io (top token holders)', holders };
}

/** Ethereum native: balances of curated large addresses via public JSON-RPC. */
export async function evmCuratedBalances(asset) {
  const addrs = asset.curated || [];
  if (!addrs.length) throw new Error(`no curated addresses for ${asset.symbol}`);
  const batch = addrs.map((addr, i) => ({
    jsonrpc: '2.0',
    id: i,
    method: 'eth_getBalance',
    params: [addr, 'latest'],
  }));

  let lastErr;
  for (const rpc of EVM_RPCS) {
    try {
      const json = await fetchJson(rpc, { method: 'POST', body: batch, timeoutMs: 20000, retries: 1 });
      const arr = Array.isArray(json) ? json : [json];
      const byId = new Map(arr.map((r) => [r.id, r]));
      const holders = addrs
        .map((addr, i) => {
          const wei = hexToBig(byId.get(i)?.result);
          return { address: addr, amount: toUnits(wei, asset.decimals) };
        })
        .filter((h) => h.amount > 0)
        .sort((a, b) => b.amount - a.amount);
      if (!holders.length) throw new Error('all curated balances zero');
      return { source: `public JSON-RPC (${new URL(rpc).host})`, holders };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('all EVM RPC endpoints failed');
}

/** Solana: top accounts via getLargestAccounts RPC (returns up to 20). */
export async function solanaLargestAccounts(asset) {
  const rpc = 'https://api.mainnet-beta.solana.com';
  const json = await fetchJson(rpc, {
    method: 'POST',
    body: { jsonrpc: '2.0', id: 1, method: 'getLargestAccounts', params: [{ filter: 'circulating' }] },
    timeoutMs: 25000,
  });
  const rows = json?.result?.value || [];
  const holders = rows
    .map((r) => ({ address: r.address, amount: toUnits(r.lamports, asset.decimals) }))
    .filter((h) => h.address && h.amount > 0)
    .slice(0, asset.limit || 20);
  if (!holders.length) throw new Error('solana getLargestAccounts returned nothing');
  return { source: 'Solana RPC (getLargestAccounts)', holders };
}

const STRATEGIES = {
  'blockchair-btc': blockchairBtc,
  'ethplorer-token-holders': ethplorerTokenHolders,
  'evm-curated-balances': evmCuratedBalances,
  'solana-largest-accounts': solanaLargestAccounts,
};

export async function fetchHolders(asset) {
  const fn = STRATEGIES[asset.topSource];
  if (!fn) throw new Error(`unknown topSource: ${asset.topSource}`);
  return fn(asset);
}

/** CoinGecko spot prices + 24h change for all assets in one keyless call. */
export async function fetchPrices(coingeckoIds) {
  const ids = [...new Set(coingeckoIds)].join(',');
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`;
  const json = await fetchJson(url, { timeoutMs: 20000 });
  return json || {};
}
