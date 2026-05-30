/**
 * Coffee Market Monitor — Chart rendering & tab management.
 * Loads docs/data/market-data.json and builds all views with Plotly.
 */

let DATA = null;
let tsCompareDates = [];  // term structure comparison dates
let activeSpread = null;  // currently selected spread in dashboard

async function init() {
    try {
        const resp = await fetch('data/market-data.json');
        DATA = await resp.json();
        document.getElementById('last-updated').textContent =
            'Updated ' + new Date(DATA.generated).toUTCString().slice(0, 25) + ' UTC';
        renderOverview();
        setupTabs();
    } catch (e) {
        document.getElementById('main-content').innerHTML =
            '<div class="loading">Failed to load data. Run: python scripts/fetch_market_data.py</div>';
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

function setupTabs() {
    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
            tab.classList.add('active');
            const target = tab.dataset.tab;
            document.getElementById('tab-' + target).classList.add('active');
            if (target === 'inventory' && !document.getElementById('tab-inventory').dataset.rendered) renderInventory();
            if (target === 'brazil' && !document.getElementById('tab-brazil').dataset.rendered) renderBrazil();
            if (target === 'differentials' && !document.getElementById('tab-differentials').dataset.rendered) renderDifferentials();
            if (target === 'weather' && !document.getElementById('tab-weather').dataset.rendered) renderWeather();
            if (target === 'positioning' && !document.getElementById('tab-positioning').dataset.rendered) renderPositioning();
        });
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// OVERVIEW TAB
// ═══════════════════════════════════════════════════════════════════════════

function renderOverview() {
    renderSpotPrices();
    renderPriceEvolution('1Y');
    renderTermStructure();
    renderSpreadMonitor();
    renderCalendarSpread();
    renderNews();
    renderSpreadDashboard();
    renderPolymarket();
    setupHorizonButtons();
    setupTermStructureCompare();
}

function renderSpotPrices() {
    const el = document.getElementById('spot-prices');
    const f = DATA.futures;
    let html = '';

    const items = [
        { name: 'KC Arabica', price: f.kc.front, unit: '¢/lb', d1: f.kc.performance?.['1d'], m1: f.kc.performance?.['1m'] },
        { name: 'Robusta', price: f.rc.front, unit: '$/t', d1: f.rc.performance?.['1d'], m1: f.rc.performance?.['1m'] },
        { name: 'RC (¢/lb equiv.)', price: f.rc.front_cents_lb, unit: '¢/lb', d1: null, m1: null },
        { name: 'Arb-Rob Spread', price: f.arb_rob.current, unit: '¢/lb', d1: null, m1: null },
    ];

    for (const item of items) {
        if (item.price == null) continue;
        const d1Txt = fmtPct(item.d1);
        const d1Cls = pctClass(item.d1);
        const m1Txt = fmtPct(item.m1);
        const m1Cls = pctClass(item.m1);
        html += `
        <div class="spot-row">
            <div class="spot-indicator" style="background:${COLORS.accent}"></div>
            <span class="spot-name">${item.name}</span>
            <span class="spot-price">${fmtNum(item.price, item.unit === '$/t' ? 0 : 2)}</span>
            <span class="spot-unit">${item.unit}</span>
            <span class="spot-change ${d1Cls}">${d1Txt}</span>
            <span class="spot-change ${m1Cls}">${m1Txt}</span>
        </div>`;
    }
    el.innerHTML = html;
}

function renderPriceEvolution(horizon) {
    const hist = DATA.futures.kc.history;
    if (!hist || !hist.length) return;

    const cutoff = getCutoffDate(horizon);
    const filtered = hist.filter(d => d.date >= cutoff);
    const seasonal = DATA.futures.kc.seasonal;

    const traces = [{
        x: filtered.map(d => d.date),
        y: filtered.map(d => d.value),
        name: 'KC Arabica',
        line: { color: COLORS.accent, width: 2 },
        fill: 'tozeroy',
        fillcolor: 'rgba(0,212,170,0.06)',
    }];

    if (seasonal && seasonal.length > 0 && horizon !== '1D' && horizon !== '1W') {
        const seasonalMap = {};
        seasonal.forEach(s => { seasonalMap[s.doy] = s.value; });
        const sVals = filtered.map(d => {
            const doy = getDOY(d.date);
            return seasonalMap[doy] || null;
        });
        traces.push({
            x: filtered.map(d => d.date),
            y: sVals,
            name: '5y Seasonal',
            line: { color: COLORS.green, width: 1.5, dash: 'dash' },
            opacity: 0.6,
        });
    }

    Plotly.react('chart-price-evolution', traces, mergeLayout({
        height: 310,
        yaxis: { title: '¢/lb' },
    }), PLOTLY_CONFIG);
}

// ── Term Structure with date comparison ──────────────────────────────────

function renderTermStructure() {
    const kc = DATA.forward_curve.kc;
    if (!kc || !kc.length) {
        document.getElementById('chart-term-structure').innerHTML =
            '<div class="loading">Forward curve not available</div>';
        return;
    }

    const traces = [{
        x: kc.map(d => d.contract),
        y: kc.map(d => d.price),
        name: 'KC (now)',
        mode: 'lines+markers',
        line: { color: COLORS.accent, width: 2.5 },
        marker: { size: 7 },
    }];

    // Add comparison date traces
    const compareColors = [COLORS.orange, COLORS.purple, COLORS.yellow, COLORS.red];
    tsCompareDates.forEach((dateStr, i) => {
        const curve = getHistoricalCurveAtDate(dateStr);
        if (curve && curve.length) {
            traces.push({
                x: curve.map(d => d.contract),
                y: curve.map(d => d.price),
                name: `KC (${dateStr})`,
                mode: 'lines+markers',
                line: { color: compareColors[i % compareColors.length], width: 2, dash: 'dash' },
                marker: { size: 6, symbol: 'diamond' },
            });
        }
    });

    let titleText = 'Term Structure';
    if (kc.length >= 2) {
        const f = kc[0].price, l = kc[kc.length - 1].price;
        const structure = l > f ? 'Contango' : 'Backwardation';
        const slope = ((l / f - 1) * 100).toFixed(1);
        titleText = `KC — ${structure} (${slope > 0 ? '+' : ''}${slope}%)`;
    }

    Plotly.react('chart-term-structure', traces, mergeLayout({
        height: 310,
        title: { text: titleText, font: { size: 11, color: COLORS.muted } },
        yaxis: { title: '¢/lb' },
    }), PLOTLY_CONFIG);
}

function getHistoricalCurveAtDate(dateStr) {
    // Find the KC price on that date from history, then estimate curve
    // by applying the current curve's shape (spread ratios) to the historical front price
    const hist = DATA.futures.kc.history;
    if (!hist || !hist.length) return null;

    // Find closest date
    let closest = null;
    let minDiff = Infinity;
    for (const pt of hist) {
        const diff = Math.abs(new Date(pt.date) - new Date(dateStr));
        if (diff < minDiff) {
            minDiff = diff;
            closest = pt;
        }
    }
    if (!closest || minDiff > 7 * 86400000) return null;  // within 7 days

    const currentCurve = DATA.forward_curve.kc;
    if (!currentCurve || !currentCurve.length) return null;

    const currentFront = currentCurve[0].price;
    const histFront = closest.value;
    const ratio = histFront / currentFront;

    return currentCurve.map(pt => ({
        contract: pt.contract,
        price: Math.round(pt.price * ratio * 100) / 100,
    }));
}

function setupTermStructureCompare() {
    const addBtn = document.getElementById('ts-add-date');
    const dateInput = document.getElementById('ts-compare-date');

    // Default to 1 month ago
    const defaultDate = new Date();
    defaultDate.setMonth(defaultDate.getMonth() - 1);
    dateInput.value = defaultDate.toISOString().slice(0, 10);

    addBtn.addEventListener('click', () => {
        const val = dateInput.value;
        if (!val || tsCompareDates.includes(val)) return;
        if (tsCompareDates.length >= 4) return;  // max 4 overlays
        tsCompareDates.push(val);
        renderTermStructure();
        renderTsDateTags();
    });
}

function renderTsDateTags() {
    const el = document.getElementById('ts-date-tags');
    if (!tsCompareDates.length) {
        el.innerHTML = '';
        return;
    }
    const compareColors = [COLORS.orange, COLORS.purple, COLORS.yellow, COLORS.red];
    let html = '';
    tsCompareDates.forEach((d, i) => {
        html += `<span class="ts-date-tag" style="border-color:${compareColors[i % compareColors.length]}">
            <span style="color:${compareColors[i % compareColors.length]}">●</span>
            KC ${d}
            <span class="remove" onclick="removeTsDate(${i})">×</span>
        </span> `;
    });
    html += `<span class="remove" onclick="clearTsDates()" style="font-size:0.65rem;color:var(--text-muted);cursor:pointer;text-decoration:underline;">Clear all</span>`;
    el.innerHTML = html;
}

function removeTsDate(idx) {
    tsCompareDates.splice(idx, 1);
    renderTermStructure();
    renderTsDateTags();
}

function clearTsDates() {
    tsCompareDates = [];
    renderTermStructure();
    renderTsDateTags();
}

// ── Spread Monitor (updates when dashboard item clicked) ─────────────────

function renderSpreadMonitor(spreadKey) {
    const chartEl = document.getElementById('chart-spread-monitor');

    // Default: arb-rob, or the selected spread
    if (!spreadKey || spreadKey === 'arb_rob') {
        const arb = DATA.futures.arb_rob;
        if (!arb || !arb.history || !arb.history.length) {
            chartEl.innerHTML = '<div class="loading">Arb-Rob spread requires RC data</div>';
            return;
        }
        renderSpreadChart(arb.history, arb.mean, arb.current, 'KC − RC Spread');

        // Update the panel subtitle
        const subtitle = chartEl.closest('.panel')?.querySelector('.panel-subtitle');
        if (subtitle) subtitle.textContent = ' Arabica premium over Robusta // ¢/lb';
    } else {
        const sp = DATA.spreads?.[spreadKey];
        if (!sp || !sp.history || !sp.history.length) {
            chartEl.innerHTML = '<div class="loading">No data for this spread</div>';
            return;
        }
        renderSpreadChart(sp.history, sp.mean, sp.current, sp.label);

        const subtitle = chartEl.closest('.panel')?.querySelector('.panel-subtitle');
        if (subtitle) subtitle.textContent = ` ${sp.label} // ¢/lb`;
    }
}

function renderSpreadChart(history, mean, current, name) {
    const h = history;
    const traces = [{
        x: h.map(d => d.date), y: h.map(d => d.value),
        name: name, line: { color: COLORS.accent, width: 1.5 },
    }];

    const shapes = [];
    const annotations = [];
    if (mean != null) {
        shapes.push({
            type: 'line', y0: mean, y1: mean, x0: h[0].date, x1: h[h.length - 1].date,
            line: { color: COLORS.red, dash: 'dash', width: 1.5 },
        });
        annotations.push({
            x: h[h.length - 1].date, y: mean,
            text: `Mean (${fmtNum(mean)})`, showarrow: false,
            font: { color: COLORS.red, size: 9 }, xanchor: 'right', yanchor: 'bottom',
        });
    }

    Plotly.react('chart-spread-monitor', traces, mergeLayout({
        height: 310,
        title: { text: `Current: ${fmtNum(current)} ¢/lb`, font: { size: 11, color: COLORS.muted } },
        yaxis: { title: '¢/lb' },
        shapes, annotations,
    }), PLOTLY_CONFIG);
}

function renderCalendarSpread() {
    const nz = DATA.spreads?.nz;
    if (!nz || !nz.history || !nz.history.length) {
        document.getElementById('chart-calendar-spread').innerHTML =
            '<div class="loading">N-Z spread data not available</div>';
        return;
    }

    const h = nz.history;
    const traces = [{
        x: h.map(d => d.date), y: h.map(d => d.value),
        name: 'N-Z', line: { color: COLORS.accent, width: 1.5 },
    }];

    const shapes = [{
        type: 'line', y0: nz.mean, y1: nz.mean, x0: h[0].date, x1: h[h.length - 1].date,
        line: { color: COLORS.red, dash: 'dash', width: 1.5 },
    }];

    Plotly.react('chart-calendar-spread', traces, mergeLayout({
        height: 310,
        title: {
            text: `Current: ${fmtNum(nz.current)} | Min: ${fmtNum(nz.p5)} | Max: ${fmtNum(nz.p95)}`,
            font: { size: 10, color: COLORS.muted },
        },
        yaxis: { title: '¢/lb' },
        shapes: shapes,
    }), PLOTLY_CONFIG);
}

// ── News (sorted by recency) ─────────────────────────────────────────────

function renderNews() {
    const el = document.getElementById('news-list');
    let news = DATA.news || [];
    if (!news.length) { el.innerHTML = '<div class="news-item">No coffee news available.</div>'; return; }

    // Parse and sort by actual date, most recent first
    news = news.map(a => {
        let ts = 0;
        try { ts = new Date(a.published).getTime(); } catch(e) {}
        return { ...a, _ts: ts };
    }).sort((a, b) => b._ts - a._ts);

    // Recompute ages from sorted dates
    const now = Date.now();
    news.forEach(a => {
        if (a._ts > 0) {
            const hrs = (now - a._ts) / 3600000;
            a.age = hrs < 1 ? `${Math.floor(hrs * 60)}m ago` :
                    hrs < 24 ? `${Math.floor(hrs)}h ago` :
                    `${Math.floor(hrs / 24)}d ago`;
        }
    });

    let html = '';
    for (const a of news.slice(0, 12)) {
        const summary = a.summary.replace(/&nbsp;/g, ' ').replace(/<[^>]+>/g, '');
        html += `
        <div class="news-item">
            <div class="news-top">
                <span class="sentiment-tag sentiment-${a.sentiment}">${a.sentiment}</span>
                <span class="news-age">${a.age || ''}</span>
            </div>
            <div class="news-title">${escHtml(a.title.slice(0, 100))}</div>
            <div class="news-summary">${escHtml(summary.slice(0, 180))}…</div>
            <a class="news-link" href="${a.url}" target="_blank" rel="noopener">READ ARTICLE →</a>
        </div>`;
    }
    el.innerHTML = html;
}

// ── Spread Dashboard (clickable → updates spread monitor) ────────────────

function renderSpreadDashboard() {
    const el = document.getElementById('spread-dashboard');
    let html = '';

    const arb = DATA.futures.arb_rob;
    if (arb && arb.current != null) {
        const cls = arb.current >= 0 ? 'up' : 'down';
        html += `<div class="spread-item${activeSpread === 'arb_rob' ? ' active' : ''}" data-spread="arb_rob" onclick="selectSpread('arb_rob')">
            <span class="spread-label">Arb-Rob</span>
            <span class="spread-value ${cls}">${arb.current >= 0 ? '+' : ''}${fmtNum(arb.current)} ¢/lb</span>
        </div>`;
    }

    for (const def of SPREAD_DEFS) {
        const sp = DATA.spreads?.[def.key];
        if (!sp) continue;
        const cls = sp.current >= 0 ? 'up' : 'down';
        html += `<div class="spread-item${activeSpread === def.key ? ' active' : ''}" data-spread="${def.key}" onclick="selectSpread('${def.key}')">
            <span class="spread-label">${def.label}</span>
            <span class="spread-value ${cls}">${sp.current >= 0 ? '+' : ''}${fmtNum(sp.current)} ¢/lb</span>
        </div>`;
    }

    el.innerHTML = html || '<div style="color:var(--text-muted);font-size:0.75rem;">No spread data available.</div>';
}

function selectSpread(key) {
    activeSpread = key;
    renderSpreadDashboard();  // re-render to update .active class
    renderSpreadMonitor(key);  // update the chart
}

function renderPolymarket() {
    const el = document.getElementById('polymarket-list');
    const markets = DATA.polymarket || [];

    if (!markets.length) {
        el.innerHTML = `<div class="poly-card">
            <div class="poly-question">No active coffee prediction markets found on Polymarket.</div>
            <div class="poly-vol">Markets will appear here when available.</div>
        </div>`;
        return;
    }

    let html = '';
    for (const m of markets.slice(0, 5)) {
        html += `<div class="poly-card">
            <div class="poly-question">${escHtml(m.question.slice(0, 120))}</div>
            <div class="poly-stats">
                <span class="poly-yes">YES ${m.yes_pct != null ? m.yes_pct.toFixed(0) + '%' : '—'}</span>
                <span class="poly-vol">Vol: $${fmtInt(m.volume)} · ${m.end_date || '—'}</span>
            </div>
        </div>`;
    }
    el.innerHTML = html;
}

function setupHorizonButtons() {
    document.querySelectorAll('.horizon-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.horizon-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderPriceEvolution(btn.dataset.horizon);
        });
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// INVENTORY TAB
// ═══════════════════════════════════════════════════════════════════════════

function renderInventory() {
    document.getElementById('tab-inventory').dataset.rendered = '1';
    const s = DATA.stocks;
    if (!s) return;

    const arab = s.arabica;
    const rob = s.robusta;
    const arabVar = arab.current - arab.one_month_ago;
    const arabVarPct = ((arabVar / arab.one_month_ago) * 100).toFixed(1);
    const dailyCons = 100000000 / 365;
    const daysCons = Math.round(arab.current / dailyCons);

    document.getElementById('inv-kpis').innerHTML = `
        <div class="kpi-card">
            <div class="kpi-label">Arabica Certified</div>
            <div class="kpi-value">${fmtInt(arab.current)} bags</div>
            <div class="kpi-delta ${arabVar >= 0 ? 'up' : 'down'}">${arabVar >= 0 ? '+' : ''}${fmtInt(arabVar)} (${arabVarPct}%) 1M</div>
        </div>
        <div class="kpi-card">
            <div class="kpi-label">Robusta Certified</div>
            <div class="kpi-value">${fmtInt(rob.current)} tonnes</div>
            <div class="kpi-delta ${(rob.current - rob.one_month_ago) >= 0 ? 'up' : 'down'}">${fmtInt(rob.current - rob.one_month_ago)} 1M</div>
        </div>
        <div class="kpi-card">
            <div class="kpi-label">Days of Consumption</div>
            <div class="kpi-value">${daysCons} days</div>
        </div>`;

    const ah = arab.history;
    Plotly.react('chart-inv-arabica', [{
        x: ah.map(d => d.date), y: ah.map(d => d.value),
        name: 'Arabica Stocks', line: { color: COLORS.accent, width: 2 },
        fill: 'tozeroy', fillcolor: 'rgba(0,212,170,0.06)',
    }], mergeLayout({ height: 350, yaxis: { title: 'bags (60kg)' } }), PLOTLY_CONFIG);

    const ports = s.ports;
    const portNames = Object.keys(ports).sort((a, b) => ports[b] - ports[a]);
    Plotly.react('chart-inv-ports', [{
        y: portNames, x: portNames.map(p => ports[p]),
        type: 'bar', orientation: 'h',
        marker: { color: COLORS.accent },
        text: portNames.map(p => fmtInt(ports[p])),
        textposition: 'auto',
    }], mergeLayout({ height: 350, margin: { l: 100 } }), PLOTLY_CONFIG);

    const rh = rob.history;
    Plotly.react('chart-inv-robusta', [{
        x: rh.map(d => d.date), y: rh.map(d => d.value),
        name: 'Robusta Stocks', line: { color: COLORS.blue, width: 2 },
        fill: 'tozeroy', fillcolor: 'rgba(69,123,157,0.06)',
    }], mergeLayout({ height: 250, yaxis: { title: 'tonnes' } }), PLOTLY_CONFIG);

    if (s.simulated) {
        document.getElementById('inv-note').textContent =
            '⚠ Stock data is simulated. Connect ICE daily reports for live data.';
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// BRAZIL PARITY TAB
// ═══════════════════════════════════════════════════════════════════════════

function renderBrazil() {
    document.getElementById('tab-brazil').dataset.rendered = '1';
    const b = DATA.brazil;
    const kc = DATA.futures.kc.front;
    if (!b || !kc) return;

    const fx = b.fx;
    const diff = b.differential;
    const parity = b.parity;

    document.getElementById('brazil-kpis').innerHTML = `
        <div class="kpi-card">
            <div class="kpi-label">KC Front</div>
            <div class="kpi-value">${fmtNum(kc)} ¢/lb</div>
        </div>
        <div class="kpi-card">
            <div class="kpi-label">BRL/USD (PTAX)</div>
            <div class="kpi-value">${fx ? fmtNum(fx, 4) : '—'}</div>
        </div>
        <div class="kpi-card">
            <div class="kpi-label">Differential</div>
            <div class="kpi-value">${diff != null ? (diff >= 0 ? '+' : '') + fmtNum(diff, 1) + ' ¢/lb' : '—'}</div>
        </div>
        <div class="kpi-card">
            <div class="kpi-label">Export Parity</div>
            <div class="kpi-value">${parity ? 'R$ ' + fmtNum(parity, 0) + '/saca' : '—'}</div>
        </div>`;

    if (b.parity_history && b.parity_history.length) {
        const ph = b.parity_history;
        Plotly.react('chart-brazil-parity', [{
            x: ph.map(d => d.date), y: ph.map(d => d.value),
            name: 'Export Parity', line: { color: COLORS.blue, width: 2 },
            fill: 'tozeroy', fillcolor: 'rgba(69,123,157,0.06)',
        }], mergeLayout({
            height: 380,
            yaxis: { title: 'R$ / saca (60kg)' },
            title: { text: 'FOB Santos Export Parity (R$/saca)', font: { size: 12, color: COLORS.muted } },
        }), PLOTLY_CONFIG);
    }

    if (b.fx_history && b.fx_history.length) {
        const fh = b.fx_history;
        Plotly.react('chart-brazil-fx', [{
            x: fh.map(d => d.date), y: fh.map(d => d.value),
            name: 'BRL/USD', line: { color: COLORS.orange, width: 2 },
        }], mergeLayout({
            height: 300,
            yaxis: { title: 'BRL per USD' },
            title: { text: 'BRL/USD PTAX', font: { size: 12, color: COLORS.muted } },
        }), PLOTLY_CONFIG);
    }

    if (b.sensitivity && b.sensitivity.length) {
        const sens = b.sensitivity;
        const el = document.getElementById('brazil-sensitivity');
        const fxHeaders = sens[0].values.map(v => `FX ${fmtNum(v.fx, 2)}`);

        let html = '<table class="sens-table"><thead><tr><th>KC \\ FX</th>';
        for (const h of fxHeaders) html += `<th>${h}</th>`;
        html += '</tr></thead><tbody>';

        for (const row of sens) {
            html += `<tr><td><b>KC ${fmtNum(row.kc, 1)}</b></td>`;
            for (const v of row.values) {
                const cls = parity && v.parity < parity * 1.02 ? 'sens-positive' : 'sens-negative';
                html += `<td class="${cls}">${fmtInt(v.parity)}</td>`;
            }
            html += '</tr>';
        }
        html += '</tbody></table>';
        el.innerHTML = html;
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// DIFFERENTIALS TAB
// ═══════════════════════════════════════════════════════════════════════════

function renderDifferentials() {
    document.getElementById('tab-differentials').dataset.rendered = '1';
    const d = DATA.differentials;
    if (!d || !d.origins) return;

    let kpiHtml = '';
    for (const [name, info] of Object.entries(d.origins)) {
        const zCls = Math.abs(info.zscore_2y) > 2 ? 'down' : Math.abs(info.zscore_2y) > 1 ? 'neutral' : 'up';
        kpiHtml += `<div class="kpi-card">
            <div class="kpi-label">${name}</div>
            <div class="kpi-value">${info.current >= 0 ? '+' : ''}${fmtNum(info.current, 1)} ¢/lb</div>
            <div class="kpi-delta ${zCls}">Z: ${info.zscore_2y >= 0 ? '+' : ''}${fmtNum(info.zscore_2y, 2)}σ</div>
            <div style="font-size:0.6rem;color:var(--text-muted);margin-top:0.2rem;">${info.region}</div>
        </div>`;
    }
    document.getElementById('diff-kpis').innerHTML = kpiHtml;

    const traces = [];
    for (const [name, info] of Object.entries(d.origins)) {
        if (!info.history || !info.history.length) continue;
        traces.push({
            x: info.history.map(d => d.date),
            y: info.history.map(d => d.value),
            name: name,
            line: { color: DIFF_COLORS[name] || COLORS.accent, width: 1.5 },
        });
    }

    Plotly.react('chart-diff-history', traces, mergeLayout({
        height: 400,
        yaxis: { title: 'differential (¢/lb vs futures)' },
        shapes: [{ type: 'line', y0: 0, y1: 0, x0: 0, x1: 1, xref: 'paper',
            line: { color: 'rgba(200,200,200,0.2)', width: 1 } }],
    }), PLOTLY_CONFIG);

    renderDiffHeatmap(Object.keys(d.origins)[0]);
    const sel = document.getElementById('diff-origin-select');
    sel.innerHTML = Object.keys(d.origins).map(n => `<option value="${n}">${n}</option>`).join('');
    sel.addEventListener('change', () => renderDiffHeatmap(sel.value));
}

function renderDiffHeatmap(originName) {
    const info = DATA.differentials.origins[originName];
    if (!info || !info.heatmap || !info.heatmap.length) return;

    const years = [...new Set(info.heatmap.map(h => h.year))].sort();
    const zData = years.map(yr =>
        MONTHS.map((_, mi) => {
            const entry = info.heatmap.find(h => h.year === yr && h.month === mi + 1);
            return entry ? entry.value : null;
        })
    );

    Plotly.react('chart-diff-heatmap', [{
        z: zData, x: MONTHS, y: years.map(String),
        type: 'heatmap',
        colorscale: [[0, '#264653'], [0.5, '#2A9D8F'], [1, '#E76F51']],
        text: zData.map(row => row.map(v => v != null ? v.toFixed(1) : '')),
        texttemplate: '%{text}',
        hoverongaps: false,
        colorbar: { title: '¢/lb', tickfont: { size: 9 } },
    }], mergeLayout({
        height: 300,
        title: { text: `${originName} — Monthly Differential`, font: { size: 11, color: COLORS.muted } },
    }), PLOTLY_CONFIG);
}

// ═══════════════════════════════════════════════════════════════════════════
// WEATHER TAB
// ═══════════════════════════════════════════════════════════════════════════

function renderWeather() {
    document.getElementById('tab-weather').dataset.rendered = '1';
    const w = DATA.weather;
    if (!w) return;

    let alerts = [];
    for (const [zone, info] of Object.entries(w)) {
        if (info.frost_alert) alerts.push({ type: 'danger', text: `🥶 FROST ALERT: ${zone} — Min ${info.min_temp_7d}°C (7d)` });
        if (info.drought_alert) alerts.push({ type: 'warning', text: `🏜 DROUGHT: ${zone} — Index ${info.drought_index} (90d)` });
    }
    const alertEl = document.getElementById('weather-alerts');
    if (alerts.length) {
        alertEl.innerHTML = alerts.map(a => `<div class="alert alert-${a.type}">${a.text}</div>`).join('');
    } else {
        alertEl.innerHTML = '<div class="alert alert-ok">✓ No active weather alerts across monitored zones</div>';
    }

    let kpiHtml = '';
    for (const [zone, info] of Object.entries(w)) {
        if (info.error) continue;
        const anomColor = info.precip_anomaly_pct < -30 ? COLORS.red :
            info.precip_anomaly_pct < -10 ? COLORS.orange :
            info.precip_anomaly_pct < 20 ? COLORS.green : COLORS.blue;
        kpiHtml += `<div class="kpi-card" style="border-left:3px solid ${anomColor}">
            <div class="kpi-label">${zone}</div>
            <div style="font-size:0.75rem;margin-top:0.2rem;">
                Precip: <b>${info.precip_30d}mm</b> (${info.precip_anomaly_pct >= 0 ? '+' : ''}${info.precip_anomaly_pct}%)
                · Min: <b>${info.min_temp_7d}°C</b>
                · Drought: <b>${info.drought_index}</b>
            </div>
        </div>`;
    }
    document.getElementById('weather-kpis').innerHTML = kpiHtml;

    const sel = document.getElementById('weather-zone-select');
    sel.innerHTML = Object.keys(w).map(z => `<option value="${z}">${z}</option>`).join('');
    renderWeatherZone(Object.keys(w)[0]);
    sel.addEventListener('change', () => renderWeatherZone(sel.value));

    renderPhenology();
    renderWeatherMap();
}

function renderWeatherZone(zone) {
    const info = DATA.weather[zone];
    if (!info || !info.recent_data) return;

    const rd = info.recent_data;

    Plotly.react('chart-weather-temp', [
        { x: rd.map(d => d.date), y: rd.map(d => d.tmax), name: 'T max', line: { color: COLORS.red, width: 1.5 } },
        { x: rd.map(d => d.date), y: rd.map(d => d.tmin), name: 'T min', line: { color: COLORS.blue, width: 1.5 },
          fill: 'tonexty', fillcolor: 'rgba(69,123,157,0.08)' },
    ], mergeLayout({
        height: 300,
        title: { text: `Temperature — ${zone} (90d)`, font: { size: 11, color: COLORS.muted } },
        yaxis: { title: '°C' },
        shapes: [{ type: 'line', y0: 4, y1: 4, x0: 0, x1: 1, xref: 'paper',
            line: { color: COLORS.red, dash: 'dash', width: 1 } }],
    }), PLOTLY_CONFIG);

    const cumPrecip = [];
    let cumSum = 0;
    for (const d of rd) { cumSum += (d.precip || 0); cumPrecip.push(cumSum); }

    Plotly.react('chart-weather-precip', [
        { x: rd.map(d => d.date), y: rd.map(d => d.precip), name: 'Daily', type: 'bar',
          marker: { color: COLORS.accent, opacity: 0.5 } },
        { x: rd.map(d => d.date), y: cumPrecip, name: 'Cumulative', yaxis: 'y2',
          line: { color: COLORS.accent, width: 2 } },
    ], mergeLayout({
        height: 300,
        title: { text: `Precipitation — ${zone} (90d)`, font: { size: 11, color: COLORS.muted } },
        yaxis: { title: 'mm/day' },
        yaxis2: { title: 'cumulative mm', overlaying: 'y', side: 'right', gridcolor: 'rgba(30,42,58,0.3)' },
    }), PLOTLY_CONFIG);
}

function renderWeatherMap() {
    const w = DATA.weather;
    const traces = [];

    for (const [zone, info] of Object.entries(w)) {
        if (info.error) continue;
        const color = info.precip_anomaly_pct < -30 ? COLORS.red :
            info.precip_anomaly_pct < -10 ? COLORS.orange :
            info.precip_anomaly_pct < 20 ? COLORS.green : COLORS.blue;

        traces.push({
            type: 'scattergeo',
            lat: [info.lat], lon: [info.lon],
            text: [`<b>${zone}</b><br>Precip: ${info.precip_anomaly_pct}%<br>Min: ${info.min_temp_7d}°C`],
            hoverinfo: 'text',
            marker: { size: 16, color: color, opacity: 0.8, line: { width: 2, color: '#fff' } },
            name: zone, showlegend: false,
        });
    }

    Plotly.react('chart-weather-map', traces, {
        geo: {
            center: { lat: -20, lon: -44 },
            projection: { scale: 10 },
            showland: true, landcolor: '#111827',
            showocean: true, oceancolor: '#0a0e1a',
            showcountries: true, countrycolor: '#1e2a3a',
            showcoastlines: true, coastlinecolor: '#1e2a3a',
            bgcolor: 'rgba(0,0,0,0)',
        },
        paper_bgcolor: 'rgba(0,0,0,0)',
        margin: { l: 0, r: 0, t: 10, b: 10 },
        height: 320,
        font: { color: '#e8ecf1' },
    }, PLOTLY_CONFIG);
}

function renderPhenology() {
    const el = document.getElementById('phenology-bar');
    const now = new Date().getMonth() + 1;
    let html = '<div class="pheno-bar">';
    for (const p of PHENOLOGY) {
        let span = p.endMonth >= p.startMonth ? p.endMonth - p.startMonth + 1 : (12 - p.startMonth + 1) + p.endMonth;
        const widthPct = (span / 12 * 100).toFixed(1);
        html += `<div class="pheno-segment" style="width:${widthPct}%;background:${p.color};" title="${p.phase}">${p.phase}</div>`;
    }
    html += '</div>';
    html += `<div style="font-size:0.65rem;color:var(--text-muted);margin-top:0.3rem;">Current month: ${MONTHS[now - 1]} — `;
    const active = PHENOLOGY.find(p => {
        if (p.endMonth >= p.startMonth) return now >= p.startMonth && now <= p.endMonth;
        return now >= p.startMonth || now <= p.endMonth;
    });
    html += active ? `Active phase: <b style="color:${active.color}">${active.phase}</b>` : 'Between phases';
    html += '</div>';
    el.innerHTML = html;
}

// ═══════════════════════════════════════════════════════════════════════════
// POSITIONING TAB
// ═══════════════════════════════════════════════════════════════════════════

function renderPositioning() {
    document.getElementById('tab-positioning').dataset.rendered = '1';
    const c = DATA.cot;
    if (!c || !c.available) {
        document.getElementById('tab-positioning').innerHTML =
            '<div class="loading">CFTC COT data not available. Check network access to cftc.gov.</div>';
        return;
    }

    const z = c.current_zscore;
    const zCls = Math.abs(z) > 2 ? 'down' : Math.abs(z) > 1 ? 'neutral' : 'up';

    document.getElementById('pos-kpis').innerHTML = `
        <div class="kpi-card">
            <div class="kpi-label">MM Net Position</div>
            <div class="kpi-value">${fmtInt(c.current_mm_net)} lots</div>
        </div>
        <div class="kpi-card">
            <div class="kpi-label">Z-Score (2Y)</div>
            <div class="kpi-value ${zCls}">${z >= 0 ? '+' : ''}${fmtNum(z)}σ</div>
        </div>
        <div class="kpi-card">
            <div class="kpi-label">Commercials Net</div>
            <div class="kpi-value">${fmtInt(c.current_prod_net)} lots</div>
        </div>
        <div class="kpi-card">
            <div class="kpi-label">Open Interest</div>
            <div class="kpi-value">${fmtInt(c.current_oi)} lots</div>
        </div>`;

    const sigEl = document.getElementById('pos-signal');
    if (z > 2) {
        sigEl.innerHTML = '<div class="alert alert-warning">⚠ Specs très longs (Z > +2σ) — Signal contrarian de correction potentielle</div>';
    } else if (z < -2) {
        sigEl.innerHTML = '<div class="alert alert-ok">ℹ Specs très shorts (Z < −2σ) — Signal contrarian de rebond potentiel</div>';
    } else {
        sigEl.innerHTML = '';
    }

    const h = c.history;
    Plotly.react('chart-pos-mm', [
        { x: h.map(d => d.date), y: h.map(d => d.mm_long), name: 'MM Longs', type: 'bar',
          marker: { color: COLORS.green, opacity: 0.3 } },
        { x: h.map(d => d.date), y: h.map(d => -d.mm_short), name: 'MM Shorts', type: 'bar',
          marker: { color: COLORS.red, opacity: 0.3 } },
        { x: h.map(d => d.date), y: h.map(d => d.mm_net), name: 'MM Net',
          line: { color: COLORS.orange, width: 2 } },
    ], mergeLayout({
        height: 350, barmode: 'overlay',
        title: { text: 'Managed Money — Net Position (lots)', font: { size: 12, color: COLORS.muted } },
    }), PLOTLY_CONFIG);

    Plotly.react('chart-pos-comm', [{
        x: h.map(d => d.date), y: h.map(d => d.prod_net),
        name: 'Commercials Net', line: { color: COLORS.blue, width: 2 },
    }], mergeLayout({
        height: 250,
        title: { text: 'Commercials — Net Position (lots)', font: { size: 12, color: COLORS.muted } },
        shapes: [{ type: 'line', y0: 0, y1: 0, x0: 0, x1: 1, xref: 'paper',
            line: { color: 'rgba(200,200,200,0.2)', width: 1 } }],
    }), PLOTLY_CONFIG);

    if (c.zscore_history && c.zscore_history.length) {
        const zh = c.zscore_history;
        Plotly.react('chart-pos-zscore', [{
            x: zh.map(d => d.date), y: zh.map(d => d.value),
            name: 'MM Z-Score', line: { color: COLORS.orange, width: 1.5 },
            fill: 'tozeroy', fillcolor: 'rgba(244,162,97,0.08)',
        }], mergeLayout({
            height: 250,
            title: { text: 'Z-Score History (2Y rolling)', font: { size: 12, color: COLORS.muted } },
            yaxis: { title: 'σ' },
            shapes: [
                { type: 'line', y0: 2, y1: 2, x0: 0, x1: 1, xref: 'paper',
                  line: { color: 'rgba(200,200,200,0.2)', dash: 'dot', width: 1 } },
                { type: 'line', y0: -2, y1: -2, x0: 0, x1: 1, xref: 'paper',
                  line: { color: 'rgba(200,200,200,0.2)', dash: 'dot', width: 1 } },
                { type: 'rect', y0: -2, y1: 2, x0: 0, x1: 1, xref: 'paper',
                  fillcolor: 'rgba(69,123,157,0.03)', line: { width: 0 } },
            ],
        }), PLOTLY_CONFIG);
    }

    renderZscoreGauge(z);
}

function renderZscoreGauge(z) {
    const el = document.getElementById('pos-gauge');
    const pct = ((z + 3) / 6 * 100).toFixed(0);
    const color = z > 1.5 ? COLORS.red : z < -1.5 ? COLORS.green : COLORS.orange;
    el.innerHTML = `
        <div class="zscore-gauge">
            <div class="zscore-value" style="color:${color}">${z >= 0 ? '+' : ''}${fmtNum(z)}σ</div>
            <div class="zscore-label">Managed Money 2Y Z-Score</div>
            <div class="zscore-bar">
                <div class="zscore-marker" style="left:${Math.max(0, Math.min(100, pct))}%"></div>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:0.6rem;color:var(--text-muted);">
                <span>−3σ</span><span>0</span><span>+3σ</span>
            </div>
            <div style="margin-top:0.8rem;font-size:0.7rem;color:var(--text-muted);text-align:left;">
                <div><span style="color:${COLORS.green}">■</span> Z &lt; −2σ: Contrarian bullish</div>
                <div><span style="color:${COLORS.blue}">■</span> −1σ to +1σ: Normal</div>
                <div><span style="color:${COLORS.red}">■</span> Z &gt; +2σ: Contrarian bearish</div>
            </div>
        </div>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

function getCutoffDate(horizon) {
    const now = new Date();
    const map = {
        '1D': 5, '1W': 7, '1M': 30, '3M': 90, '6M': 180,
        'YTD': null, '1Y': 365, '5Y': 1825, '10Y': 3650,
    };
    if (horizon === 'YTD') {
        return `${now.getFullYear()}-01-01`;
    }
    const days = map[horizon] || 365;
    const d = new Date(now.getTime() - days * 86400000);
    return d.toISOString().slice(0, 10);
}

function getDOY(dateStr) {
    const d = new Date(dateStr);
    const start = new Date(d.getFullYear(), 0, 0);
    const diff = d - start;
    return Math.floor(diff / 86400000);
}

function escHtml(s) {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
}

document.addEventListener('DOMContentLoaded', init);
