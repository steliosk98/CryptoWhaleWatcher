/* Crypto Whale Watcher — Mission Control frontend (zero dependencies).
   Financial / quant command-center UI. Reads the JSON snapshots from
   scripts/*.mjs: smart-money whales separated from exchange reserves, flow
   signals, live ticker, pulse gauge, net-flow heatmap, activity log. All
   rendering is client-side over static files. */
(() => {
  'use strict';

  const ASSET = {
    BTC: { glyph: '₿', color: '#F7931A', text: '#1a1206' },
    ETH: { glyph: 'Ξ', color: '#627EEA', text: '#ffffff' },
    USDT: { glyph: '₮', color: '#26A17B', text: '#ffffff' },
    USDC: { glyph: '$', color: '#2775CA', text: '#ffffff' },
    SOL: { glyph: '◎', color: '#14F195', text: '#06281a' },
  };
  const WHALE = '<span class="we" aria-hidden="true">🐋</span>';
  const COHORT = {
    whale: { label: 'Whales', icon: 'i-whale', color: 'var(--c-whale)', desc: 'individual / unknown large holders — directional signal' },
    exchange: { label: 'Exchanges', icon: 'i-bank', color: 'var(--c-exch)', desc: 'custodial reserves — inflow = sell pressure, outflow = accumulation' },
    contract: { label: 'Contracts', icon: 'i-file', color: 'var(--c-contract)', desc: 'staking / bridge / protocol contracts — informational' },
  };
  const LEAN_CLS = { bullish: 'pos', bearish: 'neg', neutral: 'muted' };
  const state = { latest: null, history: [], meta: null, active: null, sort: {}, signals: null, series: [] };

  // ---------- icons ----------
  const icon = (id, cls = 'ic') => `<svg class="${cls}" aria-hidden="true"><use href="#${id}"/></svg>`;
  const trendIc = (n) => (n > 0 ? icon('i-trend-up') : n < 0 ? icon('i-trend-down') : '');
  const cohortMark = (key) => (key === 'whale' ? WHALE : icon(COHORT[key].icon));
  const assetChip = (sym) => {
    const a = ASSET[sym] || { glyph: '', color: 'var(--panel-2)', text: 'var(--text)' };
    return `<span class="achip" style="background:${a.color};color:${a.text}" aria-hidden="true">${a.glyph}</span>`;
  };

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
  const fmtNum = (n) => {
    n = Number(n) || 0;
    const a = Math.abs(n);
    if (a >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (a >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
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
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const shortDate = (s) => { const d = new Date(s); return isNaN(d) ? '' : `${MON[d.getUTCMonth()]} ${d.getUTCDate()}`; };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const el = (id) => document.getElementById(id);
  const assets = () => (state.latest?.assets || []).filter((a) => a);
  const live = () => assets().filter((a) => (a.holders || []).length);
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

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
      state.signals = await loadJson('data/signals.json').catch(() => null);
      const series = await loadJson('data/series/overview.json').catch(() => null);
      state.series = series?.rows || [];
    } catch (err) {
      el('panel-container').innerHTML =
        `<div class="errbox">Could not load data (${esc(err.message)}). The first data refresh may still be running — check back shortly.</div>`;
      el('status-text').textContent = 'NO DATA';
      return;
    }
    state.active = live()[0]?.symbol || assets()[0]?.symbol;
    renderTicker();
    renderCommandBar();
    renderKpis();
    renderPulseGauge();
    renderOverview();
    renderHeatmap();
    renderTabs();
    renderActive();
    renderActivityLog();
    renderMovers();
    renderFooter();
    setupKeys();
  }

  // ---------- ticker ----------
  function renderTicker() {
    const items = live().map((a) => ({ sym: a.symbol, price: a.priceUsd, ch: a.priceChange24h }));
    if (!items.length) return;
    const cell = (it) => `<span class="tk"><span class="tk-sym">${assetChip(it.sym)}${it.sym}</span><span class="tk-px">${fmtPrice(it.price)}</span><span class="tk-ch ${cls(it.ch)}">${trendIc(it.ch)}${pct(it.ch)}</span></span>`;
    const seq = items.map(cell).join('');
    el('ticker-track').innerHTML = seq + seq;
  }

  // ---------- command bar ----------
  let clockTimer = null;
  function renderCommandBar() {
    const latest = state.latest;
    const okAssets = assets().filter((a) => (a.holders || []).length && a.status !== 'error');
    el('sources-online').textContent = `${okAssets.length}/${assets().length}`;
    el('source-leds').innerHTML = assets().map((a) => {
      const ok = (a.holders || []).length && a.status !== 'error';
      const stale = a.status === 'stale';
      const c = ok ? (stale ? 'led-warn' : 'led-on') : 'led-off';
      return `<span class="led ${c}" title="${esc(a.symbol)}: ${esc(a.status || '?')}"></span>`;
    }).join('');
    el('updated').textContent = latest?.generatedAt ? timeAgo(latest.generatedAt) : '—';
    el('status-text').textContent = 'LIVE';
    if (clockTimer) clearInterval(clockTimer);
    const tick = () => { el('clock').textContent = new Date().toISOString().slice(11, 19); };
    tick(); clockTimer = setInterval(tick, 1000);
  }

  // ---------- KPIs ----------
  function renderKpis() {
    let totalUsd = 0, whaleFlow = 0, exFlow = 0, whales = 0, exch = 0;
    for (const a of assets()) {
      const ag = a.aggregates || {};
      totalUsd += ag.totalUsd || 0; whaleFlow += ag.whaleNetFlowUsd || 0; exFlow += ag.exchangeNetFlowUsd || 0;
      whales += ag.whaleCount || 0; exch += ag.exchangeCount || 0;
    }
    const spark = state.history.map((p) => Number(p.totalUsd)).filter(Number.isFinite);
    const cards = [
      { label: 'Tracked value', ic: icon('i-layers', 'ic kpi-ic'), value: fmtUsd(totalUsd), sub: 'across all assets', spark },
      { label: 'Whale net flow', ic: `<span class="kpi-ic-e">${WHALE}</span>`, value: `<span class="${cls(whaleFlow)} kpi-arrow">${trendIc(whaleFlow)} ${fmtUsd(whaleFlow, { signed: true })}</span>`, sub: whaleFlow >= 0 ? 'net accumulation' : 'net distribution' },
      { label: 'Exchange net flow', ic: icon('i-bank', 'ic kpi-ic'), value: `<span class="${cls(-exFlow)} kpi-arrow">${trendIc(exFlow)} ${fmtUsd(exFlow, { signed: true })}</span>`, sub: exFlow > 0 ? 'reserves rising · sell pressure' : exFlow < 0 ? 'reserves falling · accumulation' : 'flat' },
      { label: 'Tracked addresses', ic: icon('i-activity', 'ic kpi-ic'), value: `${whales} ${WHALE} <span class="faint">/</span> ${exch} ${icon('i-bank')}`, sub: 'whales / exchanges' },
    ];
    el('kpis').innerHTML = cards.map((c) => `<div class="kpi" data-stagger>
      <div class="kpi-top"><span class="kpi-label">${esc(c.label)}</span>${c.ic}</div>
      <div class="value tnum">${c.value}</div>
      <div class="meta muted">${esc(c.sub)}</div>
      ${c.spark && c.spark.length > 2 ? `<div class="kpi-spark">${miniSpark(c.spark)}</div>` : ''}
    </div>`).join('');
  }

  function miniSpark(vals) {
    const v = vals.slice(-48); const W = 120, H = 30, pad = 2;
    let min = Math.min(...v), max = Math.max(...v); if (min === max) { min *= 0.999; max *= 1.001; }
    const r = max - min || 1;
    const x = (i) => pad + (i / (v.length - 1)) * (W - 2 * pad);
    const y = (val) => H - pad - ((val - min) / r) * (H - 2 * pad);
    const d = v.map((val, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(val).toFixed(1)}`).join(' ');
    const up = v[v.length - 1] >= v[0]; const col = up ? 'var(--up)' : 'var(--down)';
    const gid = 'ks' + (++chartSeq);
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity="0.3"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient></defs><path d="${d} L${x(v.length - 1).toFixed(1)},${H} L${x(0).toFixed(1)},${H} Z" fill="url(#${gid})"/><path d="${d}" fill="none" stroke="${col}" stroke-width="1.5"/></svg>`;
  }

  // ---------- market pulse gauge ----------
  function renderPulseGauge() {
    let whaleFlow = 0, exFlow = 0, totVal = 0;
    for (const a of assets()) { const ag = a.aggregates || {}; whaleFlow += ag.whaleNetFlowUsd || 0; exFlow += ag.exchangeNetFlowUsd || 0; totVal += ag.totalUsd || 0; }
    const netBull = whaleFlow - exFlow; // whale accumulation + exchange outflow = bullish
    const ratio = totVal ? netBull / totVal : 0;
    const score = Math.round(50 + 48 * Math.tanh(ratio * 1500));
    const zone = score >= 66 ? { l: 'Accumulation', c: 'var(--up)' } : score <= 34 ? { l: 'Distribution', c: 'var(--down)' } : { l: 'Neutral', c: 'var(--amber-400)' };

    const cx = 100, cy = 100, r = 80;
    const pol = (deg, rr = r) => [cx + rr * Math.cos(deg * Math.PI / 180), cy - rr * Math.sin(deg * Math.PI / 180)];
    const arc = (d1, d2, color, w) => {
      const [x1, y1] = pol(d1), [x2, y2] = pol(d2);
      return `<path d="M${x1.toFixed(1)},${y1.toFixed(1)} A${r},${r} 0 0 1 ${x2.toFixed(1)},${y2.toFixed(1)}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round"/>`;
    };
    const needleDeg = 180 - (score / 100) * 180;
    const [nx, ny] = pol(needleDeg, r - 12);
    const ticks = [0, 25, 50, 75, 100].map((p) => { const dg = 180 - (p / 100) * 180; const [a1, b1] = pol(dg, r + 3); const [a2, b2] = pol(dg, r + 9); return `<line x1="${a1.toFixed(1)}" y1="${b1.toFixed(1)}" x2="${a2.toFixed(1)}" y2="${b2.toFixed(1)}" stroke="var(--faint)" stroke-width="1"/>`; }).join('');

    const svg = `<svg class="gauge-svg" viewBox="0 0 200 116" role="img" aria-label="Whale sentiment ${score} of 100, ${zone.l}">
      ${arc(180, 120, 'var(--down)', 9)}${arc(120, 60, 'var(--amber-400)', 9)}${arc(60, 0, 'var(--up)', 9)}
      ${ticks}
      <line class="gauge-needle" x1="${cx}" y1="${cy}" x2="${nx.toFixed(1)}" y2="${ny.toFixed(1)}" stroke="${zone.c}" stroke-width="3" stroke-linecap="round"/>
      <circle cx="${cx}" cy="${cy}" r="6" fill="var(--panel)" stroke="${zone.c}" stroke-width="2.5"/>
    </svg>`;

    el('mc-pulse').innerHTML = `<div class="gauge-wrap">${svg}
      <div class="gauge-read"><div class="gv" style="color:${zone.c}">${score}</div><div class="gl" style="color:${zone.c}">${zone.l}</div></div>
      <div class="gauge-sub"><span>${WHALE} <b class="${cls(whaleFlow)}">${fmtUsd(whaleFlow, { signed: true })}</b></span><span>${icon('i-bank')} <b class="${cls(-exFlow)}">${fmtUsd(exFlow, { signed: true })}</b></span></div>
      <div class="muted small" style="font-family:var(--mono);text-align:center">whale accumulation + exchange outflow → bullish bias</div></div>`;
  }

  // ---------- net-flow heatmap ----------
  function renderHeatmap() {
    const rows = live();
    if (!rows.length) { el('mc-heatmap').innerHTML = buildingMsg(); return; }
    const wMax = Math.max(1, ...rows.map((a) => Math.abs(a.aggregates?.whaleNetFlowUsd || 0)));
    const eMax = Math.max(1, ...rows.map((a) => Math.abs(a.aggregates?.exchangeNetFlowUsd || 0)));
    const cell = (val, max, invert) => {
      const v = val || 0;
      if (!v) return `<div class="hm-cell flat"><span class="hm-v">·</span></div>`;
      const intensity = Math.min(1, Math.abs(v) / max);
      const bull = invert ? v < 0 : v > 0;
      const base = bull ? '34,197,94' : '239,68,68';
      return `<div class="hm-cell ${bull ? 'pos' : 'neg'}" style="background:rgba(${base},${(0.12 + intensity * 0.5).toFixed(2)})"><span class="hm-v">${fmtUsd(v, { signed: true })}</span></div>`;
    };
    let html = `<div class="hm-h"></div><div class="hm-h">${WHALE} Whale</div><div class="hm-h">${icon('i-bank')} Exch.</div>`;
    for (const a of rows) {
      html += `<div class="hm-rl">${assetChip(a.symbol)}${a.symbol}</div>${cell(a.aggregates?.whaleNetFlowUsd, wMax, false)}${cell(a.aggregates?.exchangeNetFlowUsd, eMax, true)}`;
    }
    el('mc-heatmap').innerHTML = `<div class="heatmap">${html}</div>`;
  }

  // ---------- overview (donut / bars / history) ----------
  function renderOverview() {
    const tot = { whale: 0, exchange: 0, contract: 0 };
    for (const a of assets()) { tot.whale += a.cohorts?.whale?.usd || 0; tot.exchange += a.cohorts?.exchange?.usd || 0; tot.contract += a.cohorts?.contract?.usd || 0; }
    const segs = Object.keys(tot).filter((k) => tot[k] > 0).map((k) => ({ key: k, label: COHORT[k].label, value: tot[k], color: COHORT[k].color }));
    el('ov-composition').innerHTML = donut(segs);

    const rows = live().map((a) => ({ sym: a.symbol, value: a.aggregates?.totalUsd || 0, color: ASSET[a.symbol]?.color || 'var(--primary)' })).sort((x, y) => y.value - x.value);
    el('ov-byasset').innerHTML = hbars(rows);

    const vals = state.history.map((p) => Number(p.totalUsd));
    const dates = state.history.map((p) => p.t);
    el('ov-history').innerHTML = renderTimeChart({ dates, series: [{ label: 'Total tracked', color: 'var(--primary)', values: vals }], area: true, h: 150 });
    const valid = vals.filter((v) => Number.isFinite(v) && v > 0).length;
    el('ov-hist-badge').textContent = valid >= 2 ? `${valid} snapshots` : 'building…';
    wireCharts(el('mc-grid'));
  }

  // ---------- tabs ----------
  function renderTabs() {
    const tabs = el('tabs');
    tabs.innerHTML = '';
    assets().forEach((a, idx) => {
      const t = document.createElement('button');
      t.className = 'tab' + (a.symbol === state.active ? ' active' : '');
      t.setAttribute('role', 'tab');
      t.setAttribute('aria-selected', a.symbol === state.active ? 'true' : 'false');
      t.innerHTML = `${assetChip(a.symbol)}<span>${esc(a.symbol)}</span><span class="chip">${(a.holders || []).length}</span><span class="kbd">${idx + 1}</span>`;
      t.onclick = () => { state.active = a.symbol; state.sort = {}; renderTabs(); renderActive(); };
      tabs.appendChild(t);
    });
  }

  function setupKeys() {
    if (window.__wwKeys) return; window.__wwKeys = true;
    document.addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= 9) { const a = assets()[n - 1]; if (a) { state.active = a.symbol; state.sort = {}; renderTabs(); renderActive(); } }
    });
  }

  // ---------- active asset panel ----------
  function renderActive() {
    const a = assets().find((x) => x.symbol === state.active);
    const host = el('panel-container');
    el('loading')?.remove();
    if (!a) { host.innerHTML = '<div class="errbox">No data for this asset.</div>'; return; }
    if (a.status === 'error' || !(a.holders || []).length) {
      host.innerHTML = `<div class="panel term"><div class="term-head"><span class="dots"><i></i><i></i><i></i></span>${assetChip(a.symbol)}<span class="pname">${esc(a.name)}</span></div>`
        + `<div class="errbox">This source is temporarily unavailable${a.error ? ` (${esc(a.error)})` : ''}. It will recover on the next refresh.</div></div>`;
      return;
    }

    const c = a.cohorts || { whale: {}, exchange: {}, contract: {} };
    const statusBadge = a.status && a.status !== 'ok' ? `<span class="badge" style="color:var(--amber-400)">${esc(a.status)}</span>` : '';

    host.innerHTML = `
      <div class="panel term" data-stagger>
        <div class="term-head">
                    ${assetChip(a.symbol)}
          <span class="pname">${esc(a.name)} · ${esc(a.symbol)}</span>
          <span class="pprice">${fmtPrice(a.priceUsd)} <span class="${cls(a.priceChange24h)}">${trendIc(a.priceChange24h)} ${pct(a.priceChange24h)}</span></span>
          <span class="term-tag" style="margin-left:auto">${esc(a.source || 'public API')}</span>
          ${statusBadge}
        </div>
        <div class="metricrow six">
          <div class="m"><div class="l">${WHALE} Whale holdings</div><div class="v">${fmtUsd(c.whale?.usd)}</div><div class="s muted">${c.whale?.count || 0} addrs</div></div>
          <div class="m"><div class="l">${WHALE} Whale net flow</div><div class="v ${cls(c.whale?.netFlowUsd)}">${fmtUsd(c.whale?.netFlowUsd, { signed: true })}</div><div class="s">${flowWord(c.whale?.netFlowUsd, 'accumulating', 'distributing')}</div></div>
          <div class="m"><div class="l">${icon('i-bank')} Exch. reserves</div><div class="v">${fmtUsd(c.exchange?.usd)}</div><div class="s muted">${c.exchange?.count || 0} addrs</div></div>
          <div class="m"><div class="l">${icon('i-bank')} Exch. net flow</div><div class="v ${cls(-(c.exchange?.netFlowUsd || 0))}">${fmtUsd(c.exchange?.netFlowUsd, { signed: true })}</div><div class="s">${flowWord(c.exchange?.netFlowUsd, 'inflow', 'outflow')}</div></div>
          <div class="m"><div class="l">${icon('i-layers')} Tracked value</div><div class="v">${fmtUsd(a.aggregates.totalUsd)}</div><div class="s muted">${fmtNum(a.aggregates.totalAmount)} ${esc(a.symbol)}</div></div>
          <div class="m"><div class="l">${icon('i-activity')} Acc / Dist</div><div class="v"><span class="pos">${a.aggregates.accumulators}↑</span> <span class="faint">/</span> <span class="neg">${a.aggregates.distributors}↓</span></div><div class="s muted">this snapshot</div></div>
        </div>
        ${signalsPanel(a.symbol)}
        <div class="chartbox">
          <div class="ctitle">${icon('i-line')} Price vs whale positioning — ${esc(a.symbol)} <span class="muted">(line coloured by daily whale flow)</span></div>
          ${priceWhaleChart(a.symbol)}
          <div class="legend"><span><i style="background:var(--up)"></i>accumulating</span><span><i style="background:var(--down)"></i>distributing</span><span><i style="background:var(--faint)"></i>no whale data</span></div>
        </div>
        <div class="chartbox">
          <div class="ctitle">${icon('i-line')} Whale holdings vs exchange reserves — ${esc(a.symbol)}</div>
          ${cohortHistoryChart(a.symbol)}
          <div class="legend"><span><i style="background:var(--c-whale)"></i>Whale holdings</span><span><i style="background:var(--c-exch)"></i>Exchange reserves</span></div>
        </div>
        <div id="cohort-tables"></div>
      </div>`;

    const tbl = el('cohort-tables');
    tbl.appendChild(cohortSection(a, 'whale'));
    if ((c.exchange?.count || 0) > 0) tbl.appendChild(cohortSection(a, 'exchange'));
    if ((c.contract?.count || 0) > 0) tbl.appendChild(cohortSection(a, 'contract'));
    wireCharts(host);
  }

  const flowWord = (n, up, down) => {
    n = Number(n) || 0;
    if (!n) return '<span class="muted">flat</span>';
    return n > 0 ? `<span class="pos">${up}</span>` : `<span class="neg">${down}</span>`;
  };

  // ---------- cohort table ----------
  const SORTS = { rank: (x) => x.rank, amount: (x) => x.amount, usd: (x) => x.usd, delta: (x) => x.delta, deltaUsd: (x) => x.deltaUsd, share: (x) => x.share || 0 };

  function cohortSection(a, cohort) {
    const meta = COHORT[cohort];
    const wrap = document.createElement('div');
    wrap.className = 'cohort';
    wrap.innerHTML = `<div class="sub-head" style="border-left-color:${meta.color}">
        ${cohortMark(cohort)}<span class="pname">${meta.label}</span><span class="muted small">${esc(meta.desc)}</span>
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
      host.innerHTML = `<div class="building" style="text-align:left;padding:14px 20px">${why}</div>`;
      return;
    }
    const sort = state.sort[cohort] || (state.sort[cohort] = { key: 'amount', dir: -1 });
    const cols = [['rank', '#', 'l'], ['entity', 'Holder', 'l'], ['amount', 'Amount', ''], ['usd', 'Value', ''], ['delta', 'Δ Balance', ''], ['deltaUsd', 'Δ Value', ''], ['share', 'Share', '']];
    const rows = [...holders].sort((x, y) => (SORTS[sort.key](x) - SORTS[sort.key](y)) * sort.dir);
    const maxAbs = Math.max(1, ...rows.map((r) => Math.abs(r.deltaUsd)));

    const head = cols.map(([k, label, cl]) => {
      const aria = k === sort.key ? ` aria-sort="${sort.dir < 0 ? 'descending' : 'ascending'}"` : '';
      const arrow = k === sort.key ? (sort.dir < 0 ? ' ▾' : ' ▴') : '';
      return `<th class="${cl}"${SORTS[k] ? ` data-sort="${k}" tabindex="0"` : ''}${aria}>${label}${arrow}</th>`;
    }).join('');

    const body = rows.map((h, idx) => {
      const name = h.label ? esc(h.label) : `<span class="muted">Unlabeled ${cohort === 'whale' ? 'whale' : 'address'}</span>`;
      const url = a.explorerAddress ? a.explorerAddress + encodeURIComponent(h.address) : null;
      const addr = url ? `<a class="addr" href="${esc(url)}" target="_blank" rel="noopener">${esc(h.short)} ${icon('i-ext')}</a>` : `<span class="addr">${esc(h.short)}</span>`;
      const w = Math.round((Math.abs(h.deltaUsd) / maxAbs) * 52);
      const bar = h.deltaUsd ? `<span class="flow-bar" style="width:${w}px;background:${h.deltaUsd > 0 ? 'var(--up-soft)' : 'var(--down-soft)'};box-shadow:inset 0 0 0 1px ${h.deltaUsd > 0 ? 'var(--up)' : 'var(--down)'}"></span>` : '';
      const dBal = h.isNew ? '<span class="muted">—</span>' : `<span class="delta-cell ${cls(h.delta)}">${trendIc(h.delta)}${(h.delta > 0 ? '+' : '') + fmtNum(h.delta)}</span>`;
      const dUsd = h.isNew ? '<span class="muted">—</span>' : `<span class="delta-cell ${cls(h.deltaUsd)}">${fmtUsd(h.deltaUsd, { signed: true })}</span>${bar}`;
      return `<tr>
        <td class="l rank">${idx + 1}</td>
        <td class="l entity"><span class="name">${name}</span>${h.isNew ? '<span class="flagnew">NEW</span>' : ''}<br>${addr}</td>
        <td>${fmtNum(h.amount)}</td><td>${fmtUsd(h.usd)}</td>
        <td>${dBal}</td><td>${dUsd}</td>
        <td>${h.share != null ? h.share.toFixed(2) + '%' : '<span class="muted">—</span>'}</td>
      </tr>`;
    }).join('');

    host.innerHTML = `<table class="holders"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
    host.querySelectorAll('th[data-sort]').forEach((th) => {
      const act = () => { const k = th.dataset.sort; state.sort[cohort] = { key: k, dir: sort.key === k ? -sort.dir : -1 }; renderCohortTable(host, a, cohort); };
      th.onclick = act;
      th.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(); } };
    });
  }

  // ---------- signals panel ----------
  const leanWord = (l) => (l === 'bullish' ? 'Bullish' : l === 'bearish' ? 'Bearish' : 'Neutral');
  const leanIc = (l) => (l === 'bullish' ? icon('i-trend-up') : l === 'bearish' ? icon('i-trend-down') : '');

  function signalsPanel(sym) {
    const s = state.signals?.assets?.[sym];
    if (!s) {
      return `<div class="signals"><div class="sig-head">${icon('i-activity')}<span class="pname">Whale signals</span></div>
        <div class="building" style="text-align:left;padding:14px 20px">Signals populate after the first daily snapshot (runs 00:10 UTC). They derive trend &amp; flow indicators from day-over-day whale data.</div></div>`;
    }
    const dp = state.signals?.dryPowder;
    const dryChip = dp ? `<span class="drychip">${icon('i-fuel')} Stablecoin dry powder: <b>${fmtUsd(dp.usd)}</b> ${dp.change7dPct != null ? `<span class="${cls(dp.change7dPct)}">${pct(dp.change7dPct)}</span> <span class="muted small">7d</span>` : ''}</span>` : '';

    const tile = (mark, label, valueHtml, lean, sub) => {
      const lc = LEAN_CLS[lean] || 'muted';
      return `<div class="sig"><div class="sl">${mark} ${label}</div><div class="sv ${lc}">${valueHtml}</div>
        <div class="sb"><span class="leanbadge ${lc}">${leanIc(lean)}${leanWord(lean)}</span> <span class="muted small">${sub}</span></div></div>`;
    };

    const exFlow = tile(icon('i-bank'), 'Exchange flow (7d)', fmtUsd(s.exchangeNetFlow7dUsd, { signed: true }), s.exchangeLean,
      (s.exchangeNetFlow7dUsd < 0 ? 'net outflow' : s.exchangeNetFlow7dUsd > 0 ? 'net inflow' : 'flat') + ' · out=accumulation');
    const accScore = s.whaleAccumulationScore;
    const acc = tile(WHALE, 'Whale accumulation', accScore == null ? '—' : `${accScore.toFixed(0)}<span class="muted" style="font-size:13px">/100</span>`, s.whaleLean, 'size-weighted, vs recent norm');
    const reserve = tile(icon('i-bank'), 'Exch. reserve trend', s.reserveChange30dPct == null ? '—' : pct(s.reserveChange30dPct), s.reserveLean, '30d reserves · falling=bullish');
    const divLean = s.divergence === 'none' ? 'neutral' : s.divergence;
    const div = tile(icon('i-scale'), 'Price vs whales', s.divergence === 'none' ? 'Aligned' : leanWord(divLean) + ' div.', divLean,
      s.priceChange7dPct != null ? `price ${pct(s.priceChange7dPct)} 7d` : 'divergence check');

    return `<div class="signals"><div class="sig-head">${icon('i-activity')}<span class="pname">Whale signals</span><span class="muted small">informational, not financial advice</span><div class="spacer"></div>${dryChip}</div>
      <div class="sigrid">${exFlow}${acc}${reserve}${div}</div></div>`;
  }

  // ---------- activity log ----------
  function renderActivityLog() {
    const t = state.latest?.generatedAt;
    const ts = t ? new Date(t).toISOString().slice(11, 16) : '--:--';
    const lines = [];
    const okC = assets().filter((a) => (a.holders || []).length && a.status !== 'error').length;
    lines.push({ lvl: 'ok', tag: 'SYS', msg: `Snapshot ingested — <b>${okC}/${assets().length}</b> sources online` });
    for (const a of assets()) {
      if (a.status === 'stale') lines.push({ lvl: 'warn', tag: 'SRC', msg: `<b>${esc(a.symbol)}</b> source stale — showing last good data` });
      if (a.status === 'error') lines.push({ lvl: 'warn', tag: 'SRC', msg: `<b>${esc(a.symbol)}</b> source offline (${esc(a.error || 'error')})` });
    }
    const moves = [];
    for (const a of live()) for (const h of a.holders) { if (h.isNew || !h.deltaUsd) continue; moves.push({ sym: a.symbol, who: h.label || h.short, d: h.deltaUsd, cohort: h.cohort }); }
    moves.sort((x, y) => Math.abs(y.d) - Math.abs(x.d));
    for (const m of moves.slice(0, 8)) {
      const lvl = m.cohort === 'exchange' ? (m.d < 0 ? 'acc' : 'dist') : (m.d > 0 ? 'acc' : 'dist');
      const word = m.cohort === 'exchange' ? (m.d < 0 ? 'exchange outflow' : 'exchange inflow') : (m.d > 0 ? 'accumulation' : 'distribution');
      lines.push({ lvl, tag: m.sym, msg: `<b>${esc(m.who)}</b> ${fmtUsd(m.d, { signed: true })} · ${word}` });
    }
    for (const a of live()) { const n = (a.holders || []).filter((h) => h.isNew).length; if (n) lines.push({ lvl: 'info', tag: a.symbol, msg: `<b>${n}</b> new top-holder${n > 1 ? 's' : ''} entered tracking` }); }
    if (lines.length === 1) lines.push({ lvl: 'info', tag: 'SYS', msg: 'No notable movements this snapshot — whales holding steady' });

    el('activity-log').innerHTML = lines.slice(0, 16).map((l) => `<li><span class="ts">${ts}</span><span class="lvl ${l.lvl}">${esc(l.tag)}</span><span class="msg">${l.msg}</span></li>`).join('');
  }

  // ---------- movers ----------
  function renderMovers() {
    const whales = [], exch = [];
    for (const a of live()) {
      for (const h of a.holders) {
        if (h.isNew || !h.deltaUsd) continue;
        const r = { sym: a.symbol, who: h.label || h.short, deltaUsd: h.deltaUsd };
        if (h.cohort === 'exchange') exch.push(r); else if (h.cohort !== 'contract') whales.push(r);
      }
    }
    if (!whales.length && !exch.length) { el('movers-panel').classList.add('hidden'); return; }
    el('movers-panel').classList.remove('hidden');
    const row = (x, invert) => `<li>${assetChip(x.sym)}<span class="who">${esc(x.who)}</span><span class="amt ${cls(invert ? -x.deltaUsd : x.deltaUsd)}">${trendIc(x.deltaUsd)}${fmtUsd(x.deltaUsd, { signed: true })}</span></li>`;
    const byAbs = (a, b) => Math.abs(b.deltaUsd) - Math.abs(a.deltaUsd);
    el('movers-whales').innerHTML = whales.sort(byAbs).slice(0, 8).map((x) => row(x, false)).join('') || '<li class="muted">No whale movement this snapshot.</li>';
    el('movers-exchanges').innerHTML = exch.sort(byAbs).slice(0, 8).map((x) => row(x, true)).join('') || '<li class="muted">No exchange flow this snapshot.</li>';
  }

  // ---------- footer ----------
  function renderFooter() {
    el('disclaimer').innerHTML = `<strong>Methodology.</strong> ${esc(state.meta?.disclaimer || '')}`;
    el('sources').innerHTML = (state.meta?.sources || []).map((s) => `<span class="s">${esc(s)}</span>`).join('');
  }

  // ===================== charts =====================
  function buildingMsg() { return '<div class="building">Building history… charts fill in after a few refreshes.</div>'; }
  const lastFiniteIdx = (a) => { for (let i = a.length - 1; i >= 0; i--) if (Number.isFinite(a[i])) return i; return -1; };
  const firstFiniteIdx = (a) => { for (let i = 0; i < a.length; i++) if (Number.isFinite(a[i])) return i; return -1; };

  let chartSeq = 0;
  const charts = new Map();

  function renderTimeChart({ dates = [], series, area = false, h = 150, segColor = null }) {
    const drawn = series.filter((s) => s.draw !== false);
    const all = drawn.flatMap((s) => s.values).filter((v) => Number.isFinite(v));
    if (all.length < 2) return buildingMsg();
    let min = Math.min(...all), max = Math.max(...all);
    if (min === max) { min *= 0.999; max *= 1.001; }
    const W = 600, H = h, pad = 8, GL = 4;
    const N = Math.max(...series.map((s) => s.values.length));
    const range = max - min || 1;
    const xOf = (i) => (N <= 1 ? pad : pad + (i / (N - 1)) * (W - 2 * pad));
    const yOf = (v) => H - pad - ((v - min) / range) * (H - 2 * pad);
    const id = 'c' + (++chartSeq);

    let grid = '';
    for (let g = 0; g <= GL; g++) { const yy = (pad + (g / GL) * (H - 2 * pad)).toFixed(1); grid += `<line x1="${pad}" y1="${yy}" x2="${W - pad}" y2="${yy}" stroke="var(--grid)" stroke-width="1"/>`; }

    let paths = '';
    drawn.forEach((s) => {
      if (segColor && drawn.length === 1) {
        for (let i = 1; i < s.values.length; i++) {
          const a = s.values[i - 1], b = s.values[i];
          if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
          paths += `<path d="M${xOf(i - 1).toFixed(1)},${yOf(a).toFixed(1)} L${xOf(i).toFixed(1)},${yOf(b).toFixed(1)}" stroke="${segColor(i)}" stroke-width="2" fill="none" stroke-linecap="round"/>`;
        }
      } else {
        let d = '', open = false; const fi = firstFiniteIdx(s.values), li = lastFiniteIdx(s.values);
        s.values.forEach((v, i) => { if (!Number.isFinite(v)) { open = false; return; } d += `${open ? 'L' : 'M'}${xOf(i).toFixed(1)},${yOf(v).toFixed(1)} `; open = true; });
        if (area && drawn.length === 1 && li >= 0) {
          paths += `<defs><linearGradient id="g${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${s.color}" stop-opacity="0.26"/><stop offset="1" stop-color="${s.color}" stop-opacity="0"/></linearGradient></defs>`;
          paths += `<path d="${d}L${xOf(li).toFixed(1)},${H - pad} L${xOf(fi).toFixed(1)},${H - pad} Z" fill="url(#g${id})"/>`;
        }
        paths += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
      }
      const li = lastFiniteIdx(s.values);
      if (li >= 0) paths += `<circle cx="${xOf(li).toFixed(1)}" cy="${yOf(s.values[li]).toFixed(1)}" r="3" fill="${s.color}"/>`;
    });

    const cursor = `<g class="cursor-layer" opacity="0"><line class="cross" y1="${pad}" y2="${H - pad}" stroke="var(--slate-500)" stroke-width="1" stroke-dasharray="3 3"/>${drawn.map((s, si) => `<circle class="cur cur${si}" r="3.6" fill="${s.color}" stroke="var(--bg)" stroke-width="1.5" opacity="0"/>`).join('')}</g>`;
    const hit = `<rect class="chart-hit" x="0" y="0" width="${W}" height="${H}" data-chart="${id}"/>`;
    charts.set(id, { W, H, pad, N, min, max, range, series, drawn, dates });

    const fi = firstFiniteIdx(series[0] ? series[0].values : []);
    const xaxis = dates.length ? `<div class="xaxis"><span>${shortDate(dates[Math.max(0, fi)] || dates[0])}</span><span>${shortDate(dates[dates.length - 1])}</span></div>` : '';
    return `<div class="chart-ywrap"><span class="ymax">${fmtUsd(max)}</span><span class="ymin">${fmtUsd(min)}</span>
      <svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${grid}${paths}${cursor}${hit}</svg></div>${xaxis}`;
  }

  function wireCharts(root) {
    if (!root) return;
    const tip = el('chart-tip');
    root.querySelectorAll('rect.chart-hit[data-chart]').forEach((rect) => {
      const c = charts.get(rect.dataset.chart);
      if (!c) return;
      const svg = rect.ownerSVGElement;
      const layer = svg.querySelector('.cursor-layer');
      const cross = layer.querySelector('.cross');
      const curs = [...layer.querySelectorAll('.cur')];
      const xOf = (i) => (c.N <= 1 ? c.pad : c.pad + (i / (c.N - 1)) * (c.W - 2 * c.pad));
      const yOf = (v) => c.H - c.pad - ((v - c.min) / c.range) * (c.H - 2 * c.pad);
      const move = (e) => {
        const r = svg.getBoundingClientRect();
        const frac = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
        const i = Math.round(frac * (c.N - 1));
        const xv = xOf(i);
        cross.setAttribute('x1', xv); cross.setAttribute('x2', xv);
        c.drawn.forEach((s, si) => { const v = s.values[i]; if (Number.isFinite(v)) { curs[si].setAttribute('cx', xv); curs[si].setAttribute('cy', yOf(v)); curs[si].setAttribute('opacity', '1'); } else curs[si].setAttribute('opacity', '0'); });
        let rows = '';
        c.series.forEach((s) => { const v = s.values[i]; const f = s.fmt || fmtUsd; rows += `<div class="tt-row"><i style="background:${s.color}"></i>${esc(s.label)}: ${Number.isFinite(v) ? f(v) : '—'}</div>`; });
        layer.setAttribute('opacity', '1');
        const d = c.dates && c.dates[i];
        tip.innerHTML = `${d ? `<div class="tt-date">${shortDate(d)}</div>` : ''}${rows}`;
        tip.style.left = Math.min(window.innerWidth - 200, e.clientX + 14) + 'px';
        tip.style.top = (e.clientY + 16) + 'px';
        tip.classList.add('show'); tip.setAttribute('aria-hidden', 'false');
      };
      rect.addEventListener('pointermove', move);
      rect.addEventListener('pointerleave', () => { layer.setAttribute('opacity', '0'); tip.classList.remove('show'); tip.setAttribute('aria-hidden', 'true'); });
    });
  }

  function cohortHistoryChart(sym) {
    const dates = state.series.map((p) => p.date);
    const whale = state.series.map((p) => num(p.assets?.[sym]?.whaleUsd));
    const exch = state.series.map((p) => num(p.assets?.[sym]?.exchangeUsd));
    if (whale.filter(Number.isFinite).length < 2 && exch.filter(Number.isFinite).length < 2) {
      const tot = state.series.map((p) => num(p.assets?.[sym]?.totalUsd));
      return renderTimeChart({ dates, series: [{ label: 'Tracked value', color: 'var(--data)', values: tot }], area: true, h: 140 });
    }
    return renderTimeChart({ dates, series: [
      { label: 'Whale holdings', color: 'var(--c-whale)', values: whale },
      { label: 'Exchange reserves', color: 'var(--c-exch)', values: exch },
    ], h: 140 });
  }

  function priceWhaleChart(sym) {
    const dates = state.series.map((p) => p.date);
    const price = state.series.map((p) => num(p.assets?.[sym]?.price));
    const flow = state.series.map((p) => num(p.assets?.[sym]?.whaleNetFlowUsd));
    if (price.filter(Number.isFinite).length < 2) return buildingMsg();
    const seg = (i) => { const f = flow[i]; return !Number.isFinite(f) || f === 0 ? 'var(--faint)' : f > 0 ? 'var(--up)' : 'var(--down)'; };
    return renderTimeChart({ dates, h: 156, segColor: seg, series: [
      { label: 'Price', color: 'var(--data)', values: price, fmt: fmtPrice },
      { label: 'Whale flow', color: 'var(--c-whale)', values: flow, fmt: (v) => fmtUsd(v, { signed: true }), draw: false },
    ] });
  }

  // donut
  function donut(segs) {
    const total = segs.reduce((a, s) => a + s.value, 0);
    if (!total) return buildingMsg();
    let off = 0;
    const circles = segs.map((s) => {
      const p = (s.value / total) * 100;
      const c = `<circle class="seg" r="15.915" cx="21" cy="21" fill="transparent" stroke="${s.color}" stroke-width="5" stroke-dasharray="${p.toFixed(2)} ${(100 - p).toFixed(2)}" stroke-dashoffset="${((100 - off) + 25).toFixed(2)}"></circle>`;
      off += p; return c;
    }).join('');
    const legend = segs.map((s) => `<li>${s.key === 'whale' ? `<span class="lic we">🐋</span>` : `<svg class="lic ic" style="color:${s.color}" aria-hidden="true"><use href="#${COHORT[s.key].icon}"/></svg>`}<span class="lname">${esc(s.label)}</span><span class="lval">${((s.value / total) * 100).toFixed(1)}% · ${fmtUsd(s.value)}</span></li>`).join('');
    return `<div class="donutwrap"><svg viewBox="0 0 42 42" class="donut" role="img" aria-label="Holder composition by USD">
      <circle r="15.915" cx="21" cy="21" fill="transparent" stroke="var(--border)" stroke-width="5"></circle>${circles}
      <text x="21" y="20.5" class="dcenter">${fmtUsd(total)}</text><text x="21" y="25" class="dcsub">tracked</text></svg>
      <ul class="dlegend">${legend}</ul></div>`;
  }

  // horizontal bars
  function hbars(rows) {
    if (!rows.length) return buildingMsg();
    const max = Math.max(...rows.map((r) => r.value), 1);
    return `<div class="hbars">${rows.map((r) => `<div class="hb">
      <span class="hbl">${assetChip(r.sym)}${esc(r.sym)}</span>
      <span class="hbtrack"><span class="hbfill" style="width:${((r.value / max) * 100).toFixed(1)}%;background:${r.color}"></span></span>
      <span class="hbv">${fmtUsd(r.value)}</span></div>`).join('')}</div>`;
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
