/* Crypto Whale Watcher — dashboard frontend (zero dependencies).
   Reads the JSON snapshots produced by scripts/fetch-data.mjs and renders a
   quant-style dashboard. All rendering is client-side over static files. */
(() => {
  'use strict';

  const SYM_ICON = { BTC: '₿', ETH: 'Ξ', USDT: '₮', USDC: '$', SOL: '◎' };
  const state = { latest: null, history: [], meta: null, active: null, sort: { key: 'amount', dir: -1 } };

  // ---------- formatting ----------
  const fmtUsd = (n, opts = {}) => {
    n = Number(n) || 0;
    const sign = n < 0 ? '-' : opts.signed && n > 0 ? '+' : '';
    const a = Math.abs(n);
    if (a >= 1e12) return `${sign}$${(a / 1e12).toFixed(2)}T`;
    if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(2)}B`;
    if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(2)}M`;
    if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(1)}K`;
    return `${sign}$${a.toFixed(2)}`;
  };
  const fmtNum = (n, dp = 2) => {
    n = Number(n) || 0;
    const a = Math.abs(n);
    if (a >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (a >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return n.toLocaleString('en-US', { maximumFractionDigits: dp });
  };
  const fmtPrice = (n) => {
    n = Number(n) || 0;
    return n >= 10 ? '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 })
                   : '$' + n.toLocaleString('en-US', { maximumFractionDigits: 4 });
  };
  const signed = (n) => (n > 0 ? '+' : '') + n;
  const pct = (n) => (n > 0 ? '+' : '') + (Number(n) || 0).toFixed(2) + '%';
  const cls = (n) => (n > 0 ? 'pos' : n < 0 ? 'neg' : 'muted');
  const timeAgo = (iso) => {
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 90) return 'just now';
    if (s < 3600) return `${Math.round(s / 60)}m ago`;
    if (s < 86400) return `${Math.round(s / 3600)}h ago`;
    return `${Math.round(s / 86400)}d ago`;
  };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const el = (id) => document.getElementById(id);

  // ---------- data loading ----------
  async function loadJson(path) {
    const res = await fetch(`${path}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`${path} ${res.status}`);
    return res.json();
  }

  async function boot() {
    try {
      const [latest, meta] = await Promise.all([loadJson('data/latest.json'), loadJson('data/meta.json')]);
      state.latest = latest;
      state.meta = meta;
      state.history = await loadJson('data/history.json').catch(() => []);
    } catch (err) {
      el('panel-container').innerHTML =
        `<div class="errbox">Could not load data (${esc(err.message)}). The first data refresh may still be running — check back shortly.</div>`;
      el('status-text').textContent = 'no data yet';
      return;
    }
    const assets = (state.latest.assets || []).filter((a) => a);
    state.active = assets.find((a) => (a.holders || []).length)?.symbol || assets[0]?.symbol;
    renderStatus();
    renderKpis();
    renderTabs();
    renderActive();
    renderMovers();
    renderFooter();
  }

  // ---------- header status ----------
  function renderStatus() {
    const t = state.latest?.generatedAt;
    el('status-text').textContent = t ? `updated ${timeAgo(t)}` : 'live';
  }

  // ---------- KPIs ----------
  function renderKpis() {
    const assets = (state.latest.assets || []).filter((a) => a && a.aggregates);
    let totalUsd = 0, netUsd = 0, addrs = 0;
    for (const a of assets) {
      totalUsd += a.aggregates.totalUsd || 0;
      netUsd += a.aggregates.netFlowUsd || 0;
      addrs += a.aggregates.holderCount || 0;
    }
    el('kpi-value').textContent = fmtUsd(totalUsd);
    el('kpi-flow').innerHTML = `<span class="${cls(netUsd)}">${fmtUsd(netUsd, { signed: true })}</span>`;
    el('kpi-flow-sub').textContent = netUsd >= 0 ? 'net accumulation' : 'net distribution';
    el('kpi-addrs').textContent = fmtNum(addrs, 0);
    el('kpi-assets').textContent = assets.filter((a) => (a.holders || []).length).length;
  }

  // ---------- tabs ----------
  function renderTabs() {
    const tabs = el('tabs');
    tabs.innerHTML = '';
    for (const a of (state.latest.assets || []).filter((x) => x)) {
      const n = (a.holders || []).length;
      const t = document.createElement('div');
      t.className = 'tab' + (a.symbol === state.active ? ' active' : '');
      t.innerHTML = `<span>${SYM_ICON[a.symbol] || ''} ${esc(a.symbol)}</span><span class="chip">${n}</span>`;
      t.onclick = () => { state.active = a.symbol; state.sort = { key: 'amount', dir: -1 }; renderTabs(); renderActive(); };
      tabs.appendChild(t);
    }
  }

  // ---------- active asset panel ----------
  function renderActive() {
    const a = (state.latest.assets || []).find((x) => x && x.symbol === state.active);
    const host = el('panel-container');
    el('loading')?.remove();
    if (!a) { host.innerHTML = '<div class="errbox">No data for this asset.</div>'; return; }

    if (a.status === 'error' || !(a.holders || []).length) {
      host.innerHTML = `<div class="panel"><div class="panel-head"><span class="pname">${SYM_ICON[a.symbol] || ''} ${esc(a.name)}</span></div>`
        + `<div class="errbox">This source is temporarily unavailable${a.error ? ` (${esc(a.error)})` : ''}. It will recover on the next refresh.</div></div>`;
      return;
    }

    const ag = a.aggregates;
    const statusBadge = a.status && a.status !== 'ok'
      ? `<span class="badge" style="color:var(--amber)">${esc(a.status)}</span>` : '';

    host.innerHTML = `
      <div class="panel">
        <div class="panel-head">
          <span class="pname">${SYM_ICON[a.symbol] || ''} ${esc(a.name)} <span class="muted">${esc(a.symbol)}</span></span>
          <span class="pprice">${fmtPrice(a.priceUsd)} <span class="${cls(a.priceChange24h)}">${pct(a.priceChange24h)}</span></span>
          <div class="spacer"></div>
          ${statusBadge}
          <span class="badge">${esc(a.source || 'public API')}</span>
        </div>
        <div class="metricrow">
          <div class="m"><div class="l">Tracked supply</div><div class="v">${fmtNum(ag.totalAmount)} ${esc(a.symbol)}</div></div>
          <div class="m"><div class="l">Tracked value</div><div class="v">${fmtUsd(ag.totalUsd)}</div></div>
          <div class="m"><div class="l">Net flow</div><div class="v ${cls(ag.netFlowUsd)}">${fmtUsd(ag.netFlowUsd, { signed: true })}</div></div>
          <div class="m"><div class="l">Acc / Dist</div><div class="v"><span class="pos">${ag.accumulators}↑</span> <span class="muted">/</span> <span class="neg">${ag.distributors}↓</span></div></div>
        </div>
        <div class="chartbox">
          <div class="ctitle">Tracked value — ${esc(a.symbol)} (history)</div>
          ${sparkline(a.symbol)}
        </div>
        <div class="tablewrap" id="tablewrap"></div>
      </div>`;
    renderTable(a);
  }

  const SORTS = {
    rank: (x) => x.rank, amount: (x) => x.amount, usd: (x) => x.usd,
    delta: (x) => x.delta, deltaUsd: (x) => x.deltaUsd, share: (x) => x.share || 0,
  };

  function renderTable(a) {
    const cols = [
      ['rank', '#', 'l'], ['entity', 'Holder', 'l'], ['amount', 'Amount', ''],
      ['usd', 'Value', ''], ['delta', 'Δ Balance', ''], ['deltaUsd', 'Δ Value', ''], ['share', 'Share', ''],
    ];
    const { key, dir } = state.sort;
    const rows = [...a.holders].sort((x, y) => (SORTS[key](x) - SORTS[key](y)) * dir);
    const maxAbs = Math.max(1, ...rows.map((r) => Math.abs(r.deltaUsd)));

    const head = cols.map(([k, label, c]) => {
      const arrow = k === key ? (dir < 0 ? ' ▾' : ' ▴') : '';
      const sortable = SORTS[k] ? `data-sort="${k}"` : '';
      return `<th class="${c}" ${sortable}>${label}${arrow}</th>`;
    }).join('');

    const body = rows.map((h) => {
      const name = h.label ? esc(h.label) : '<span class="muted">Unlabeled whale</span>';
      const tag = h.label ? `<span class="tag ${esc(h.type)}">${esc(h.type)}</span>` : '';
      const url = a.explorerAddress ? a.explorerAddress + encodeURIComponent(h.address) : null;
      const addr = url ? `<a class="addr" href="${esc(url)}" target="_blank" rel="noopener">${esc(h.short)}</a>` : `<span class="addr">${esc(h.short)}</span>`;
      const w = Math.round((Math.abs(h.deltaUsd) / maxAbs) * 60);
      const bar = h.deltaUsd ? `<span class="flow-bar" style="width:${w}px;background:${h.deltaUsd > 0 ? 'var(--green-dim)' : 'var(--red-dim)'}"></span>` : '';
      const newFlag = h.isNew ? '<span class="flagnew">NEW</span>' : '';
      return `<tr>
        <td class="l rank">${h.rank}</td>
        <td class="l entity"><span class="name">${name}</span>${tag}${newFlag}<br>${addr}</td>
        <td>${fmtNum(h.amount)}</td>
        <td>${fmtUsd(h.usd)}</td>
        <td class="${cls(h.delta)}">${h.isNew ? '<span class="muted">—</span>' : signed(fmtNum(h.delta))}</td>
        <td class="${cls(h.deltaUsd)}">${h.isNew ? '<span class="muted">—</span>' : fmtUsd(h.deltaUsd, { signed: true })}${bar}</td>
        <td>${h.share != null ? h.share.toFixed(2) + '%' : '<span class="muted">—</span>'}</td>
      </tr>`;
    }).join('');

    el('tablewrap').innerHTML = `<table class="holders"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
    el('tablewrap').querySelectorAll('th[data-sort]').forEach((th) => {
      th.onclick = () => {
        const k = th.dataset.sort;
        state.sort = { key: k, dir: state.sort.key === k ? -state.sort.dir : -1 };
        renderTable(a);
      };
    });
  }

  // ---------- sparkline (hand-rolled SVG) ----------
  function sparkline(sym) {
    const pts = state.history.map((p) => p.assets?.[sym]?.totalUsd).map(Number).filter((v) => isFinite(v) && v > 0);
    if (pts.length < 2) return '<svg class="spark" viewBox="0 0 600 120"></svg><div class="muted" style="font-family:var(--mono);font-size:11px;padding:4px 0">Building history… the trend line appears after a few refreshes.</div>';
    const W = 600, H = 120, pad = 6;
    const min = Math.min(...pts), max = Math.max(...pts), range = max - min || 1;
    const x = (i) => pad + (i / (pts.length - 1)) * (W - 2 * pad);
    const y = (v) => H - pad - ((v - min) / range) * (H - 2 * pad);
    const line = pts.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const area = `${line} L${x(pts.length - 1).toFixed(1)},${H} L${x(0).toFixed(1)},${H} Z`;
    const up = pts[pts.length - 1] >= pts[0];
    const c = up ? 'var(--green)' : 'var(--red)';
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <defs><linearGradient id="g-${sym}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${c}" stop-opacity="0.28"/><stop offset="1" stop-color="${c}" stop-opacity="0"/>
      </linearGradient></defs>
      <path d="${area}" fill="url(#g-${sym})"/>
      <path d="${line}" fill="none" stroke="${c}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${x(pts.length - 1).toFixed(1)}" cy="${y(pts[pts.length - 1]).toFixed(1)}" r="3" fill="${c}"/>
    </svg>`;
  }

  // ---------- biggest movers across all assets ----------
  function renderMovers() {
    const all = [];
    for (const a of (state.latest.assets || []).filter((x) => x && x.holders)) {
      for (const h of a.holders) {
        if (!h.isNew && h.deltaUsd) all.push({ sym: a.symbol, who: h.label || h.short, deltaUsd: h.deltaUsd, amount: h.delta });
      }
    }
    if (!all.length) { el('movers-panel').classList.add('hidden'); return; }
    el('movers-panel').classList.remove('hidden');
    const acc = all.filter((x) => x.deltaUsd > 0).sort((a, b) => b.deltaUsd - a.deltaUsd).slice(0, 8);
    const dist = all.filter((x) => x.deltaUsd < 0).sort((a, b) => a.deltaUsd - b.deltaUsd).slice(0, 8);
    const row = (x) => `<li><span class="sym">${SYM_ICON[x.sym] || ''} ${esc(x.sym)}</span><span class="who">${esc(x.who)}</span><span class="amt ${cls(x.deltaUsd)}">${fmtUsd(x.deltaUsd, { signed: true })}</span></li>`;
    el('movers-acc').innerHTML = acc.map(row).join('') || '<li class="muted">No accumulation this snapshot.</li>';
    el('movers-dist').innerHTML = dist.map(row).join('') || '<li class="muted">No distribution this snapshot.</li>';
  }

  // ---------- footer ----------
  function renderFooter() {
    el('disclaimer').innerHTML = `<strong>Methodology.</strong> ${esc(state.meta?.disclaimer || '')}`;
    const srcs = el('sources');
    srcs.innerHTML = (state.meta?.sources || []).map((s) => `<span class="s">${esc(s)}</span>`).join('');
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
