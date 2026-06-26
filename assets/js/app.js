/* Crypto Whale Watcher — dashboard frontend (zero dependencies).
   Reads the JSON snapshots produced by scripts/fetch-data.mjs and renders a
   quant-style dashboard that separates directional "smart-money" whales from
   custodial exchange reserves. All rendering is client-side over static files. */
(() => {
  'use strict';

  const SYM_ICON = { BTC: '₿', ETH: 'Ξ', USDT: '₮', USDC: '$', SOL: '◎' };
  const ASSET_COLOR = { BTC: '#f7931a', ETH: '#7b86c2', USDT: '#26a17b', USDC: '#2775ca', SOL: '#14f195' };
  const COHORT = {
    whale: { label: 'Whales', icon: '🐋', color: '#fbbf24', desc: 'individual / unknown large holders — directional signal' },
    exchange: { label: 'Exchanges', icon: '🏦', color: '#60a5fa', desc: 'custodial reserves — inflow = sell pressure, outflow = accumulation' },
    contract: { label: 'Contracts', icon: '📜', color: '#c4b5fd', desc: 'staking / bridge / protocol contracts — informational' },
  };
  const state = { latest: null, history: [], meta: null, active: null, sort: {} };

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
  const assets = () => (state.latest?.assets || []).filter((a) => a);
  const live = () => assets().filter((a) => (a.holders || []).length);
  const num = (v) => (isFinite(Number(v)) ? Number(v) : null);

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
    state.active = live()[0]?.symbol || assets()[0]?.symbol;
    renderStatus();
    renderKpis();
    renderOverview();
    renderTabs();
    renderActive();
    renderMovers();
    renderFooter();
  }

  function renderStatus() {
    const t = state.latest?.generatedAt;
    el('status-text').textContent = t ? `updated ${timeAgo(t)}` : 'live';
  }

  // ---------- KPIs ----------
  function renderKpis() {
    let totalUsd = 0, whaleFlow = 0, exFlow = 0, whales = 0, exch = 0;
    for (const a of assets()) {
      const ag = a.aggregates || {};
      totalUsd += ag.totalUsd || 0;
      whaleFlow += ag.whaleNetFlowUsd || 0;
      exFlow += ag.exchangeNetFlowUsd || 0;
      whales += ag.whaleCount || 0;
      exch += ag.exchangeCount || 0;
    }
    el('kpi-value').textContent = fmtUsd(totalUsd);
    el('kpi-whaleflow').innerHTML = `<span class="${cls(whaleFlow)}">${fmtUsd(whaleFlow, { signed: true })}</span>`;
    el('kpi-whaleflow-sub').textContent = whaleFlow >= 0 ? 'net accumulation' : 'net distribution';
    el('kpi-exflow').innerHTML = `<span class="${cls(-exFlow)}">${fmtUsd(exFlow, { signed: true })}</span>`;
    el('kpi-exflow-sub').textContent = exFlow > 0 ? 'reserves rising · sell pressure' : exFlow < 0 ? 'reserves falling · accumulation' : 'flat';
    el('kpi-cohorts').innerHTML = `${whales} <span class="muted" style="font-size:15px">🐋</span> / ${exch} <span class="muted" style="font-size:15px">🏦</span>`;
  }

  // ---------- overview (cross-asset) ----------
  function renderOverview() {
    const tot = { whale: 0, exchange: 0, contract: 0 };
    for (const a of assets()) {
      tot.whale += a.cohorts?.whale?.usd || 0;
      tot.exchange += a.cohorts?.exchange?.usd || 0;
      tot.contract += a.cohorts?.contract?.usd || 0;
    }
    const segs = Object.keys(tot).filter((k) => tot[k] > 0)
      .map((k) => ({ label: COHORT[k].label, icon: COHORT[k].icon, value: tot[k], color: COHORT[k].color }));
    el('ov-composition').innerHTML = donut(segs);

    const rows = live().map((a) => ({
      label: `${SYM_ICON[a.symbol] || ''} ${a.symbol}`,
      value: a.aggregates?.totalUsd || 0,
      color: ASSET_COLOR[a.symbol] || 'var(--accent)',
    })).sort((x, y) => y.value - x.value);
    el('ov-byasset').innerHTML = hbars(rows);

    const vals = state.history.map((p) => Number(p.totalUsd)).filter((v) => isFinite(v) && v > 0);
    el('ov-history').innerHTML = lineChart([{ color: 'var(--accent)', values: vals }], { area: true, h: 150 });
    el('ov-hist-badge').textContent = vals.length >= 2 ? `${vals.length} snapshots` : 'building…';
  }

  // ---------- tabs ----------
  function renderTabs() {
    const tabs = el('tabs');
    tabs.innerHTML = '';
    for (const a of assets()) {
      const t = document.createElement('div');
      t.className = 'tab' + (a.symbol === state.active ? ' active' : '');
      t.innerHTML = `<span>${SYM_ICON[a.symbol] || ''} ${esc(a.symbol)}</span><span class="chip">${(a.holders || []).length}</span>`;
      t.onclick = () => { state.active = a.symbol; state.sort = {}; renderTabs(); renderActive(); };
      tabs.appendChild(t);
    }
  }

  // ---------- active asset panel ----------
  function renderActive() {
    const a = assets().find((x) => x.symbol === state.active);
    const host = el('panel-container');
    el('loading')?.remove();
    if (!a) { host.innerHTML = '<div class="errbox">No data for this asset.</div>'; return; }
    if (a.status === 'error' || !(a.holders || []).length) {
      host.innerHTML = `<div class="panel"><div class="panel-head"><span class="pname">${SYM_ICON[a.symbol] || ''} ${esc(a.name)}</span></div>`
        + `<div class="errbox">This source is temporarily unavailable${a.error ? ` (${esc(a.error)})` : ''}. It will recover on the next refresh.</div></div>`;
      return;
    }

    const c = a.cohorts || { whale: {}, exchange: {}, contract: {} };
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
        <div class="metricrow six">
          <div class="m"><div class="l">🐋 Whale holdings</div><div class="v">${fmtUsd(c.whale?.usd)}</div><div class="s muted">${c.whale?.count || 0} addrs</div></div>
          <div class="m"><div class="l">🐋 Whale net flow</div><div class="v ${cls(c.whale?.netFlowUsd)}">${fmtUsd(c.whale?.netFlowUsd, { signed: true })}</div><div class="s">${flowWord(c.whale?.netFlowUsd, 'accumulating', 'distributing')}</div></div>
          <div class="m"><div class="l">🏦 Exch. reserves</div><div class="v">${fmtUsd(c.exchange?.usd)}</div><div class="s muted">${c.exchange?.count || 0} addrs</div></div>
          <div class="m"><div class="l">🏦 Exch. net flow</div><div class="v ${cls(-(c.exchange?.netFlowUsd || 0))}">${fmtUsd(c.exchange?.netFlowUsd, { signed: true })}</div><div class="s">${flowWord(c.exchange?.netFlowUsd, 'inflow', 'outflow')}</div></div>
          <div class="m"><div class="l">Tracked value</div><div class="v">${fmtUsd(a.aggregates.totalUsd)}</div><div class="s muted">${fmtNum(a.aggregates.totalAmount)} ${esc(a.symbol)}</div></div>
          <div class="m"><div class="l">Acc / Dist</div><div class="v"><span class="pos">${a.aggregates.accumulators}↑</span> <span class="muted">/</span> <span class="neg">${a.aggregates.distributors}↓</span></div><div class="s muted">this snapshot</div></div>
        </div>
        <div class="chartbox">
          <div class="ctitle">🐋 Whale holdings vs 🏦 exchange reserves — ${esc(a.symbol)} (history)</div>
          ${cohortHistoryChart(a.symbol)}
          <div class="legend">
            <span><i style="background:${COHORT.whale.color}"></i>Whale holdings</span>
            <span><i style="background:${COHORT.exchange.color}"></i>Exchange reserves</span>
          </div>
        </div>
        <div id="cohort-tables"></div>
      </div>`;

    const tbl = el('cohort-tables');
    tbl.appendChild(cohortSection(a, 'whale'));
    if ((c.exchange?.count || 0) > 0) tbl.appendChild(cohortSection(a, 'exchange'));
    if ((c.contract?.count || 0) > 0) tbl.appendChild(cohortSection(a, 'contract'));
  }

  const flowWord = (n, up, down) => {
    n = Number(n) || 0;
    if (!n) return '<span class="muted">flat</span>';
    return n > 0 ? `<span class="pos">${up}</span>` : `<span class="neg">${down}</span>`;
  };

  // ---------- cohort table section ----------
  const SORTS = {
    rank: (x) => x.rank, amount: (x) => x.amount, usd: (x) => x.usd,
    delta: (x) => x.delta, deltaUsd: (x) => x.deltaUsd, share: (x) => x.share || 0,
  };

  function cohortSection(a, cohort) {
    const meta = COHORT[cohort];
    const wrap = document.createElement('div');
    wrap.className = 'cohort';
    wrap.innerHTML = `<div class="sub-head" style="border-left:3px solid ${meta.color}">
        <span class="pname">${meta.icon} ${meta.label}</span>
        <span class="muted small">${esc(meta.desc)}</span>
      </div><div class="tablewrap"></div>`;
    renderCohortTable(wrap.querySelector('.tablewrap'), a, cohort);
    return wrap;
  }

  function renderCohortTable(host, a, cohort) {
    const holders = (a.holders || []).filter((h) => (h.cohort || 'whale') === cohort);
    if (!holders.length) {
      const why = cohort === 'whale'
        ? `No individual whales in the tracked ${esc(a.symbol)} set yet — its tracked addresses are exchanges/contracts. Add whale addresses via <code>config/assets.json</code>.`
        : `None tracked for ${esc(a.symbol)}.`;
      host.innerHTML = `<div class="building" style="text-align:left;padding:14px 16px">${why}</div>`;
      return;
    }
    const sort = state.sort[cohort] || (state.sort[cohort] = { key: 'amount', dir: -1 });
    const cols = [
      ['rank', '#', 'l'], ['entity', 'Holder', 'l'], ['amount', 'Amount', ''],
      ['usd', 'Value', ''], ['delta', 'Δ Balance', ''], ['deltaUsd', 'Δ Value', ''], ['share', 'Share', ''],
    ];
    const rows = [...holders].sort((x, y) => (SORTS[sort.key](x) - SORTS[sort.key](y)) * sort.dir);
    const maxAbs = Math.max(1, ...rows.map((r) => Math.abs(r.deltaUsd)));

    const head = cols.map(([k, label, cl]) => {
      const arrow = k === sort.key ? (sort.dir < 0 ? ' ▾' : ' ▴') : '';
      return `<th class="${cl}" ${SORTS[k] ? `data-sort="${k}"` : ''}>${label}${arrow}</th>`;
    }).join('');

    const body = rows.map((h, idx) => {
      const name = h.label ? esc(h.label) : `<span class="muted">Unlabeled ${cohort === 'whale' ? 'whale' : 'address'}</span>`;
      const url = a.explorerAddress ? a.explorerAddress + encodeURIComponent(h.address) : null;
      const addr = url ? `<a class="addr" href="${esc(url)}" target="_blank" rel="noopener">${esc(h.short)}</a>` : `<span class="addr">${esc(h.short)}</span>`;
      const w = Math.round((Math.abs(h.deltaUsd) / maxAbs) * 56);
      const bar = h.deltaUsd ? `<span class="flow-bar" style="width:${w}px;background:${h.deltaUsd > 0 ? 'var(--green-dim)' : 'var(--red-dim)'}"></span>` : '';
      const newFlag = h.isNew ? '<span class="flagnew">NEW</span>' : '';
      return `<tr>
        <td class="l rank">${idx + 1}</td>
        <td class="l entity"><span class="name">${name}</span>${newFlag}<br>${addr}</td>
        <td>${fmtNum(h.amount)}</td>
        <td>${fmtUsd(h.usd)}</td>
        <td class="${cls(h.delta)}">${h.isNew ? '<span class="muted">—</span>' : (h.delta > 0 ? '+' : '') + fmtNum(h.delta)}</td>
        <td class="${cls(h.deltaUsd)}">${h.isNew ? '<span class="muted">—</span>' : fmtUsd(h.deltaUsd, { signed: true })}${bar}</td>
        <td>${h.share != null ? h.share.toFixed(2) + '%' : '<span class="muted">—</span>'}</td>
      </tr>`;
    }).join('');

    host.innerHTML = `<table class="holders"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
    host.querySelectorAll('th[data-sort]').forEach((th) => {
      th.onclick = () => {
        const k = th.dataset.sort;
        state.sort[cohort] = { key: k, dir: sort.key === k ? -sort.dir : -1 };
        renderCohortTable(host, a, cohort);
      };
    });
  }

  // ---------- biggest movers (split by cohort) ----------
  function renderMovers() {
    const whales = [], exch = [];
    for (const a of live()) {
      for (const h of a.holders) {
        if (h.isNew || !h.deltaUsd) continue;
        const row = { sym: a.symbol, who: h.label || h.short, deltaUsd: h.deltaUsd };
        if (h.cohort === 'exchange') exch.push(row);
        else if (h.cohort !== 'contract') whales.push(row);
      }
    }
    if (!whales.length && !exch.length) { el('movers-panel').classList.add('hidden'); return; }
    el('movers-panel').classList.remove('hidden');
    const row = (x, invert) => `<li><span class="sym">${SYM_ICON[x.sym] || ''} ${esc(x.sym)}</span><span class="who">${esc(x.who)}</span><span class="amt ${cls(invert ? -x.deltaUsd : x.deltaUsd)}">${fmtUsd(x.deltaUsd, { signed: true })}</span></li>`;
    const byAbs = (a, b) => Math.abs(b.deltaUsd) - Math.abs(a.deltaUsd);
    el('movers-whales').innerHTML = whales.sort(byAbs).slice(0, 8).map((x) => row(x, false)).join('') || '<li class="muted">No whale movement this snapshot.</li>';
    el('movers-exchanges').innerHTML = exch.sort(byAbs).slice(0, 8).map((x) => row(x, true)).join('') || '<li class="muted">No exchange flow this snapshot.</li>';
  }

  // ---------- footer ----------
  function renderFooter() {
    el('disclaimer').innerHTML = `<strong>Methodology.</strong> ${esc(state.meta?.disclaimer || '')}`;
    el('sources').innerHTML = (state.meta?.sources || []).map((s) => `<span class="s">${esc(s)}</span>`).join('');
  }

  // ================= charts (hand-rolled SVG) =================
  function buildingMsg() {
    return '<div class="muted building">Building history… charts fill in after a few refreshes.</div>';
  }

  // multi-series line / area chart. series: [{color, values:[num|null]}]
  function lineChart(series, { h = 140, area = false, W = 600 } = {}) {
    if (Math.max(0, ...series.map((s) => s.values.filter((v) => isFinite(v)).length)) < 2) return buildingMsg();
    const N = Math.max(...series.map((s) => s.values.length));
    const all = series.flatMap((s) => s.values).filter((v) => isFinite(v));
    let min = Math.min(...all), max = Math.max(...all);
    if (min === max) { min *= 0.999; max *= 1.001; }
    const pad = 6, range = max - min || 1;
    const x = (i) => pad + (N <= 1 ? 0 : (i / (N - 1)) * (W - 2 * pad));
    const y = (v) => h - pad - ((v - min) / range) * (h - 2 * pad);

    let svg = `<svg class="spark" viewBox="0 0 ${W} ${h}" preserveAspectRatio="none">`;
    series.forEach((s, si) => {
      let d = '', open = false, lastI = -1, lastV = null;
      s.values.forEach((v, i) => {
        if (!isFinite(v)) { open = false; return; }
        d += `${open ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
        open = true; lastI = i; lastV = v;
      });
      if (area && series.length === 1 && lastI >= 0) {
        const first = s.values.findIndex((v) => isFinite(v));
        svg += `<defs><linearGradient id="ga${si}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="${s.color}" stop-opacity="0.28"/><stop offset="1" stop-color="${s.color}" stop-opacity="0"/></linearGradient></defs>`;
        svg += `<path d="${d}L${x(lastI).toFixed(1)},${h} L${x(first).toFixed(1)},${h} Z" fill="url(#ga${si})"/>`;
      }
      svg += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
      if (lastI >= 0) svg += `<circle cx="${x(lastI).toFixed(1)}" cy="${y(lastV).toFixed(1)}" r="3" fill="${s.color}"/>`;
    });
    svg += '</svg>';
    return `<div class="chart-ywrap"><span class="ymax">${fmtUsd(max)}</span><span class="ymin">${fmtUsd(min)}</span>${svg}</div>`;
  }

  function cohortHistoryChart(sym) {
    const whale = state.history.map((p) => num(p.assets?.[sym]?.whaleUsd));
    const exch = state.history.map((p) => num(p.assets?.[sym]?.exchangeUsd));
    if (whale.filter(isFinite).length < 2 && exch.filter(isFinite).length < 2) {
      const tot = state.history.map((p) => num(p.assets?.[sym]?.totalUsd));
      return lineChart([{ color: 'var(--accent)', values: tot }], { area: true, h: 130 });
    }
    return lineChart([
      { color: COHORT.whale.color, values: whale },
      { color: COHORT.exchange.color, values: exch },
    ], { h: 130 });
  }

  // donut chart from segments [{label, icon, value, color}]
  function donut(segs) {
    const total = segs.reduce((a, s) => a + s.value, 0);
    if (!total) return buildingMsg();
    let off = 0;
    const circles = segs.map((s) => {
      const p = (s.value / total) * 100;
      const c = `<circle class="seg" r="15.915" cx="21" cy="21" fill="transparent" stroke="${s.color}" stroke-width="5"
        stroke-dasharray="${p.toFixed(2)} ${(100 - p).toFixed(2)}" stroke-dashoffset="${((100 - off) + 25).toFixed(2)}"></circle>`;
      off += p;
      return c;
    }).join('');
    const legend = segs.map((s) => `<li><i style="background:${s.color}"></i>
      <span class="lname">${s.icon} ${esc(s.label)}</span>
      <span class="lval">${((s.value / total) * 100).toFixed(1)}% · ${fmtUsd(s.value)}</span></li>`).join('');
    return `<div class="donutwrap">
      <svg viewBox="0 0 42 42" class="donut"><circle r="15.915" cx="21" cy="21" fill="transparent" stroke="var(--border)" stroke-width="5"></circle>${circles}
        <text x="21" y="20.5" class="dcenter">${fmtUsd(total)}</text><text x="21" y="25" class="dcsub">tracked</text></svg>
      <ul class="dlegend">${legend}</ul></div>`;
  }

  // horizontal bars from rows [{label, value, color}]
  function hbars(rows) {
    if (!rows.length) return buildingMsg();
    const max = Math.max(...rows.map((r) => r.value), 1);
    return `<div class="hbars">${rows.map((r) => `
      <div class="hb"><span class="hbl">${esc(r.label)}</span>
        <span class="hbtrack"><span class="hbfill" style="width:${((r.value / max) * 100).toFixed(1)}%;background:${r.color}"></span></span>
        <span class="hbv">${fmtUsd(r.value)}</span></div>`).join('')}</div>`;
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
