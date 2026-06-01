/**
 * Coffee Market Monitor — Chart rendering & tab management.
 * Loads docs/data/market-data.json and builds all views with Plotly.
 */

let DATA = null;
let tsCompareDates = [];
let activeSpread = null;
let selectedAssets = ['kc'];
let selectedCotMarket = null;

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
            if (target === 'options' && !document.getElementById('tab-options').dataset.rendered) {
                document.getElementById('tab-options').dataset.rendered = '1';
                if (typeof renderOptions === 'function') renderOptions();
            }
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
    renderSpreadDashboard();
    selectSpread('nz');
    renderKeyDates();
    renderNews();
    setupHorizonButtons();
    setupTermStructureCompare();
    setupSeasonalToggle();
}

function setupSeasonalToggle() {
    const toggle = document.getElementById('seasonal-toggle');
    if (!toggle) return;
    toggle.addEventListener('change', () => {
        const activeHorizon = document.querySelector('.horizon-btn.active')?.dataset.horizon || '1Y';
        renderPriceEvolution(activeHorizon);
    });
}

// ── Clickable Spot Prices with multi-select ─────────────────────────────

function getAssetData(key) {
    const f = DATA.futures;
    if (key === 'kc') return { label: 'KC Arabica', price: f.kc.front, unit: '¢/lb', history: f.kc.history, color: COLORS.accent };
    if (key === 'rc') return { label: 'RC Robusta', price: f.rc.front, unit: '$/t', history: f.rc.history, color: COLORS.blue };
    if (key === 'rc_cl') return { label: 'RC (¢/lb)', price: f.rc.front_cents_lb, unit: '¢/lb', history: f.rc.history_cents_lb, color: '#6BA3BE' };
    if (key === 'arb_rob') return { label: 'Arb-Rob Spread', price: f.arb_rob?.current, unit: '¢/lb', history: f.arb_rob?.history, color: COLORS.orange };
    if (key === 'brl') return { label: 'BRL/USD', price: DATA.brazil?.fx, unit: '', history: DATA.brazil?.fx_history, color: COLORS.yellow };
    return null;
}

function computePerf(history, days) {
    if (!history || history.length < 2) return null;
    const now = history[history.length - 1];
    const cutoff = new Date(new Date(now.date).getTime() - days * 86400000).toISOString().slice(0, 10);
    const ref = history.find(d => d.date >= cutoff) || history[0];
    if (!ref || ref.value === 0) return null;
    return ((now.value - ref.value) / ref.value) * 100;
}

function computeYTDPerf(history) {
    if (!history || history.length < 2) return null;
    const now = history[history.length - 1];
    const yearStart = `${new Date().getFullYear()}-01-01`;
    const ref = history.find(d => d.date >= yearStart) || history[0];
    if (!ref || ref.value === 0) return null;
    return ((now.value - ref.value) / ref.value) * 100;
}

function renderSpotPrices() {
    const el = document.getElementById('spot-prices');
    const assets = [
        { key: 'kc', label: 'KC Arabica' },
        { key: 'rc', label: 'RC Robusta' },
        { key: 'rc_cl', label: 'RC (¢/lb equiv.)' },
        { key: 'arb_rob', label: 'Arb-Rob Spread' },
        { key: 'brl', label: 'BRL/USD (PTAX)' },
    ];

    let html = `<div style="display:flex;justify-content:flex-end;gap:0.5rem;margin-bottom:0.3rem;padding:0 0.2rem;">
        <span class="spot-perf-label">1M</span>
        <span class="spot-perf-label">YTD</span>
    </div>`;

    for (const asset of assets) {
        const data = getAssetData(asset.key);
        if (!data || data.price == null) continue;
        const canSelect = ['kc', 'rc', 'arb_rob', 'brl'].includes(asset.key);
        const sel = selectedAssets.includes(asset.key) ? ' selected' : '';
        const perf1m = computePerf(data.history, 30);
        const perfYtd = computeYTDPerf(data.history);

        html += `
        <div class="spot-row${sel}" ${canSelect ? `onclick="toggleAsset('${asset.key}')" style="cursor:pointer"` : 'style="cursor:default;opacity:0.7"'}>
            <div class="spot-indicator" style="background:${data.color}"></div>
            <span class="spot-name">${asset.label}</span>
            <span class="spot-price">${fmtNum(data.price, data.unit === '$/t' ? 0 : 2)}</span>
            <span class="spot-unit">${data.unit}</span>
            <span class="spot-perf ${pctClass(perf1m)}">${fmtPct(perf1m)}</span>
            <span class="spot-perf ${pctClass(perfYtd)}">${fmtPct(perfYtd)}</span>
        </div>`;
    }
    el.innerHTML = html;
}

function toggleAsset(key) {
    const idx = selectedAssets.indexOf(key);
    if (idx >= 0) {
        if (selectedAssets.length <= 1) return;
        selectedAssets.splice(idx, 1);
    } else {
        selectedAssets.push(key);
    }
    renderSpotPrices();
    const activeHorizon = document.querySelector('.horizon-btn.active')?.dataset.horizon || '1Y';
    renderPriceEvolution(activeHorizon);
}

// ── Price Evolution (multi-asset, % mode when multiple) ─────────────────

function renderPriceEvolution(horizon) {
    const multiMode = selectedAssets.length > 1;
    const cutoff = getCutoffDate(horizon);
    const traces = [];

    for (const key of selectedAssets) {
        const asset = getAssetData(key);
        if (!asset || !asset.history || !asset.history.length) continue;

        const filtered = asset.history.filter(d => d.date >= cutoff);
        if (!filtered.length) continue;

        let yVals, yTitle;
        if (multiMode) {
            const base = filtered[0].value;
            if (base === 0) continue;
            yVals = filtered.map(d => ((d.value / base) - 1) * 100);
            yTitle = 'Performance (%)';
        } else {
            yVals = filtered.map(d => d.value);
            yTitle = asset.unit;
        }

        traces.push({
            x: filtered.map(d => d.date),
            y: yVals,
            name: asset.label,
            line: { color: asset.color, width: 2 },
        });
    }

    const titleEl = document.getElementById('price-evo-title');
    const subtitleEl = document.getElementById('price-evo-subtitle');
    if (multiMode) {
        titleEl.textContent = 'RELATIVE PERFORMANCE';
        subtitleEl.textContent = ' ' + selectedAssets.map(k => getAssetData(k)?.label).filter(Boolean).join(' vs ') + ' // %';
    } else {
        const asset = getAssetData(selectedAssets[0]);
        titleEl.textContent = 'PRICE EVOLUTION';
        subtitleEl.textContent = ` ${asset?.label || 'KC ARABICA'} // ${asset?.unit || '¢/lb'}`;
    }

    if (multiMode) {
        traces.push({
            x: [cutoff, new Date().toISOString().slice(0, 10)],
            y: [0, 0],
            mode: 'lines',
            line: { color: 'rgba(200,200,200,0.2)', width: 1, dash: 'dot' },
            showlegend: false,
            hoverinfo: 'skip',
        });
    }

    const seasonalToggle = document.getElementById('seasonal-toggle');
    if (seasonalToggle && seasonalToggle.checked && !multiMode) {
        const seasonal = DATA.futures?.kc?.seasonal;
        if (seasonal && seasonal.length) {
            const mainAsset = getAssetData(selectedAssets[0]);
            const filtered = mainAsset?.history?.filter(d => d.date >= cutoff) || [];
            if (filtered.length) {
                const startDOY = getDOY(filtered[0].date);
                const endDOY = getDOY(filtered[filtered.length - 1].date);

                let seasonalFiltered;
                if (startDOY <= endDOY) {
                    seasonalFiltered = seasonal.filter(s => s.doy >= startDOY && s.doy <= endDOY);
                } else {
                    seasonalFiltered = seasonal.filter(s => s.doy >= startDOY || s.doy <= endDOY);
                }

                if (seasonalFiltered.length) {
                    const xDates = seasonalFiltered.map(s => {
                        const yr = new Date().getFullYear();
                        const d = new Date(yr, 0);
                        d.setDate(s.doy);
                        return d.toISOString().slice(0, 10);
                    });

                    traces.push({
                        x: xDates,
                        y: seasonalFiltered.map(s => s.value),
                        name: '5Y Seasonal',
                        yaxis: 'y2',
                        line: { color: COLORS.purple, width: 1.5, dash: 'dot' },
                        opacity: 0.7,
                    });
                }
            }
        }
    }

    const layoutOverrides = {
        height: 310,
        yaxis: { title: multiMode ? '%' : (getAssetData(selectedAssets[0])?.unit || '¢/lb') },
    };

    if (seasonalToggle && seasonalToggle.checked && !multiMode) {
        layoutOverrides.yaxis2 = {
            title: 'Seasonal (¢/lb)',
            overlaying: 'y',
            side: 'right',
            showgrid: false,
            titlefont: { color: COLORS.purple, size: 10 },
            tickfont: { color: COLORS.purple, size: 9 },
        };
    }

    Plotly.react('chart-price-evolution', traces, mergeLayout(layoutOverrides), PLOTLY_CONFIG);
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
    const hist = DATA.futures.kc.history;
    if (!hist || !hist.length) return null;

    let closest = null;
    let minDiff = Infinity;
    for (const pt of hist) {
        const diff = Math.abs(new Date(pt.date) - new Date(dateStr));
        if (diff < minDiff) { minDiff = diff; closest = pt; }
    }
    if (!closest || minDiff > 7 * 86400000) return null;

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

    const defaultDate = new Date();
    defaultDate.setMonth(defaultDate.getMonth() - 1);
    dateInput.value = defaultDate.toISOString().slice(0, 10);

    addBtn.addEventListener('click', () => {
        const val = dateInput.value;
        if (!val || tsCompareDates.includes(val)) return;
        if (tsCompareDates.length >= 4) return;
        tsCompareDates.push(val);
        renderTermStructure();
        renderTsDateTags();
    });
}

function renderTsDateTags() {
    const el = document.getElementById('ts-date-tags');
    if (!tsCompareDates.length) { el.innerHTML = ''; return; }
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

// ── Spread Monitor with dropdown ────────────────────────────────────────

const SPREAD_DETAILS = {
    kn: { label: 'KC K-N', desc: 'May → Jul', months: 'Old crop vs new crop transition' },
    nz: { label: 'KC N-Z', desc: 'Jul → Dec', months: 'Harvest pressure gauge' },
    zh: { label: 'KC Z-H', desc: 'Dec → Mar', months: 'Inter-crop carry' },
    hk: { label: 'KC H-K', desc: 'Mar → May', months: 'Pre-harvest tightness' },
};

function setupSpreadDropdown() {
    const sel = document.getElementById('spread-select');
    let html = '';
    for (const def of SPREAD_DEFS) {
        const detail = SPREAD_DETAILS[def.key] || {};
        html += `<option value="${def.key}">${def.label} (${def.desc})</option>`;
    }
    sel.innerHTML = html;
    sel.addEventListener('change', () => {
        renderSpreadMonitorFromDropdown();
    });
}

function renderSpreadMonitorFromDropdown() {
    const sel = document.getElementById('spread-select');
    const key = sel.value || 'nz';
    renderSpreadMonitor(key);
}

function renderSpreadMonitor(spreadKey) {
    const chartEl = document.getElementById('chart-spread-monitor');
    const subtitleEl = document.getElementById('spread-chart-subtitle');

    const sp = DATA.spreads?.[spreadKey];
    if (!sp || !sp.history || !sp.history.length) {
        chartEl.innerHTML = '<div class="loading">No data for this timespread</div>';
        return;
    }
    const detail = SPREAD_DETAILS[spreadKey] || {};
    renderSpreadChart(sp.history, sp.mean, sp.current, sp.label);
    if (subtitleEl) subtitleEl.textContent = ` ${sp.label} — ${detail.months || ''} // ¢/lb`;
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

// ── Spread Dashboard (clickable → updates dropdown + chart) ─────────────

function renderSpreadDashboard() {
    const el = document.getElementById('spread-dashboard');
    let html = '';

    for (const def of SPREAD_DEFS) {
        const sp = DATA.spreads?.[def.key];
        if (!sp) continue;
        const cls = sp.current >= 0 ? 'up' : 'down';
        const detail = SPREAD_DETAILS[def.key] || {};
        const meanDiff = sp.mean != null ? (sp.current - sp.mean) : null;
        const meanTag = meanDiff != null ? `<span style="font-size:0.55rem;color:${meanDiff >= 0 ? 'var(--green)' : 'var(--red)'}">${meanDiff >= 0 ? '+' : ''}${fmtNum(meanDiff)} vs avg</span>` : '';
        html += `<div class="spread-item${activeSpread === def.key ? ' active' : ''}" onclick="selectSpread('${def.key}')">
            <div>
                <span class="spread-label" style="font-weight:600;">${def.label}</span>
                <span style="font-size:0.6rem;color:var(--text-muted);margin-left:0.3rem;">${detail.desc || def.desc}</span>
                <div style="font-size:0.55rem;color:var(--text-muted);">${detail.months || ''} ${meanTag}</div>
            </div>
            <span class="spread-value ${cls}">${sp.current >= 0 ? '+' : ''}${fmtNum(sp.current)}</span>
        </div>`;
    }

    el.innerHTML = html || '<div style="color:var(--text-muted);font-size:0.75rem;">No spread data available.</div>';
}

function selectSpread(key) {
    activeSpread = key;
    renderSpreadDashboard();
    renderSpreadMonitor(key);
}

// ── Key Dates Calendar (concise, economic calendar style) ────────────────

function renderKeyDates() {
    const el = document.getElementById('key-dates');
    const now = new Date();
    const year = now.getFullYear();

    const keyDates = [
        ...getNextCOTDates(now, 3).map(d => ({ date: d, title: 'CFTC COT Report', tag: 'CFTC', tagClass: 'tag-cftc', freq: 'Weekly Fri' })),
        ...getNextWASDEDates(now, 2).map(d => ({ date: d, title: 'USDA WASDE', tag: 'USDA', tagClass: 'tag-usda', freq: '' })),
        ...getNextICODates(now, 2).map(d => ({ date: d, title: 'ICO Monthly Report', tag: 'ICO', tagClass: 'tag-ico', freq: '' })),
        { date: new Date(year, 5, 1), title: 'Frost Season Begins', tag: 'WEATHER', tagClass: 'tag-weather', freq: '' },
        { date: new Date(year, 7, 31), title: 'Frost Season Ends', tag: 'WEATHER', tagClass: 'tag-weather', freq: '' },
        { date: new Date(year, 4, 1), title: 'Arabica Harvest Start', tag: 'BRAZIL', tagClass: 'tag-brazil', freq: '' },
        { date: new Date(year, 8, 30), title: 'Arabica Harvest End', tag: 'BRAZIL', tagClass: 'tag-brazil', freq: '' },
        { date: new Date(year, 6, 21), title: 'KC N Expiry', tag: 'ICE', tagClass: 'tag-ice', freq: '' },
        { date: new Date(year, 8, 18), title: 'KC U Expiry', tag: 'ICE', tagClass: 'tag-ice', freq: '' },
        { date: new Date(year, 11, 18), title: 'KC Z Expiry', tag: 'ICE', tagClass: 'tag-ice', freq: '' },
        { date: new Date(year + 1, 2, 20), title: 'KC H Expiry', tag: 'ICE', tagClass: 'tag-ice', freq: '' },
        { date: new Date(year, 8, 15), title: 'Flowering Season', tag: 'WEATHER', tagClass: 'tag-weather', freq: '' },
    ];

    const upcoming = keyDates
        .filter(d => d.date >= new Date(now.getFullYear(), now.getMonth(), now.getDate()))
        .sort((a, b) => a.date - b.date)
        .slice(0, 8);

    if (!upcoming.length) {
        el.innerHTML = '<div style="color:var(--text-muted);font-size:0.75rem;">No upcoming dates.</div>';
        return;
    }

    let html = '<table style="width:100%;border-collapse:collapse;">';
    for (const item of upcoming) {
        const d = item.date;
        const month = MONTHS[d.getMonth()];
        const day = d.getDate();
        html += `<tr style="border-bottom:1px solid rgba(30,42,58,0.4);">
            <td style="padding:0.3rem 0.4rem;white-space:nowrap;font-size:0.72rem;color:var(--text-secondary);">${month} ${day}</td>
            <td style="padding:0.3rem 0.2rem;"><span class="key-date-tag ${item.tagClass}">${item.tag}</span></td>
            <td style="padding:0.3rem 0.2rem;font-size:0.72rem;color:var(--text-primary);">${item.title}</td>
            <td style="padding:0.3rem 0.2rem;font-size:0.6rem;color:var(--text-muted);text-align:right;">${item.freq}</td>
        </tr>`;
    }
    html += '</table>';
    el.innerHTML = html;
}

function getNextCOTDates(from, count) {
    const dates = [];
    let d = new Date(from);
    while (dates.length < count) {
        d = new Date(d.getTime() + 86400000);
        if (d.getDay() === 5) dates.push(new Date(d));
    }
    return dates;
}

function getNextWASDEDates(from, count) {
    const dates = [];
    let month = from.getMonth();
    let year = from.getFullYear();
    for (let i = 0; i < count + 2; i++) {
        const candidate = new Date(year, month + i, 12);
        if (candidate.getDay() === 0) candidate.setDate(13);
        if (candidate.getDay() === 6) candidate.setDate(14);
        if (candidate >= from) dates.push(candidate);
        if (dates.length >= count) break;
    }
    return dates;
}

function getNextICODates(from, count) {
    const dates = [];
    let month = from.getMonth();
    let year = from.getFullYear();
    for (let i = 0; i < count + 2; i++) {
        const candidate = new Date(year, month + i, 15);
        if (candidate.getDay() === 0) candidate.setDate(16);
        if (candidate.getDay() === 6) candidate.setDate(17);
        if (candidate >= from) dates.push(candidate);
        if (dates.length >= count) break;
    }
    return dates;
}

// ── News (sorted by recency) ─────────────────────────────────────────────

function renderNews() {
    const el = document.getElementById('news-list');
    let news = DATA.news || [];
    if (!news.length) { el.innerHTML = '<div class="news-item">No coffee news available.</div>'; return; }

    news = news.map(a => {
        let ts = 0;
        try { ts = new Date(a.published).getTime(); } catch(e) {}
        return { ...a, _ts: ts };
    }).sort((a, b) => b._ts - a._ts);

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

    if (!arab.current && !rob.current) {
        document.getElementById('inv-kpis').innerHTML = `
            <div class="alert alert-warning" style="width:100%;">
                No stock data available. Place CSV files in <code>data/ice_arabica_stocks.csv</code> and <code>data/ice_robusta_stocks.csv</code> with columns: Date, Total, [port columns].
                Then re-run <code>python scripts/fetch_market_data.py</code>.
            </div>`;
        return;
    }

    const arabVar = arab.one_month_ago ? arab.current - arab.one_month_ago : 0;
    const arabVarPct = arab.one_month_ago ? ((arabVar / arab.one_month_ago) * 100).toFixed(1) : '0.0';
    const dailyCons = 100000000 / 365;
    const daysCons = arab.current ? Math.round(arab.current / dailyCons) : 0;

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

    const ports = s.ports || {};
    const portNames = Object.keys(ports).sort((a, b) => ports[b] - ports[a]);
    if (portNames.length) {
        Plotly.react('chart-inv-ports', [{
            y: portNames, x: portNames.map(p => ports[p]),
            type: 'bar', orientation: 'h',
            marker: { color: COLORS.accent },
            text: portNames.map(p => fmtInt(ports[p])),
            textposition: 'auto',
        }], mergeLayout({ height: 350, margin: { l: 100 } }), PLOTLY_CONFIG);
    } else {
        document.getElementById('chart-inv-ports').innerHTML =
            '<div style="padding:2rem;color:var(--text-muted);text-align:center;">No port breakdown available. Add port columns to your CSV.</div>';
    }

    const rh = rob.history;
    Plotly.react('chart-inv-robusta', [{
        x: rh.map(d => d.date), y: rh.map(d => d.value),
        name: 'Robusta Stocks', line: { color: COLORS.blue, width: 2 },
        fill: 'tozeroy', fillcolor: 'rgba(69,123,157,0.06)',
    }], mergeLayout({ height: 250, yaxis: { title: 'tonnes' } }), PLOTLY_CONFIG);

    if (s.simulated) {
        document.getElementById('inv-note').textContent =
            'Stock data is simulated. Place real CSV files in data/ and re-run the fetcher.';
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
        if (info.frost_alert) alerts.push({ type: 'danger', text: `FROST ALERT: ${zone} — Min ${info.min_temp_7d}°C (7d)` });
        if (info.drought_alert) alerts.push({ type: 'warning', text: `DROUGHT: ${zone} — Index ${info.drought_index} (90d)` });
    }
    const alertEl = document.getElementById('weather-alerts');
    if (alerts.length) {
        alertEl.innerHTML = alerts.map(a => `<div class="alert alert-${a.type}">${a.text}</div>`).join('');
    } else {
        alertEl.innerHTML = '<div class="alert alert-ok">No active weather alerts across monitored zones</div>';
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
    const cot = DATA.cot;
    if (!cot || !cot.available || !cot.markets || !Object.keys(cot.markets).length) {
        document.getElementById('tab-positioning').innerHTML =
            '<div class="loading">CFTC COT data not available. Add cot_arabica_disaggregated.csv and/or cot_robusta_disaggregated.csv, then run the fetcher.</div>';
        return;
    }

    const markets = Object.keys(cot.markets);
    if (!selectedCotMarket || !cot.markets[selectedCotMarket]) {
        selectedCotMarket = cot.default_market || markets[0];
    }

    renderCotMarketToggle(markets);
    renderCotMarket(cot.markets[selectedCotMarket]);
}

function renderCotMarketToggle(markets) {
    const el = document.getElementById('pos-market-toggle');
    el.innerHTML = markets.map(m => `
        <button class="horizon-btn ${m === selectedCotMarket ? 'active' : ''}" onclick="selectCotMarket('${m}')">${m.toUpperCase()}</button>
    `).join('');
}

function selectCotMarket(market) {
    selectedCotMarket = market;
    renderPositioning();
}

function renderCotMarket(c) {
    const h = c.history || [];
    if (!h.length) return;
    const last = h[h.length - 1];
    const z = c.current_zscore || 0;
    const pct = c.current_percentile ?? 50;
    const zCls = Math.abs(z) >= 2 ? 'down' : Math.abs(z) >= 1 ? 'neutral' : 'up';

    document.getElementById('pos-source').textContent =
        `Source: ${c.source} · Last report: ${c.last_report} · ${c.rows} weekly observations`;

    document.getElementById('pos-kpis').innerHTML = `
        <div class="kpi-card"><div class="kpi-label">MM Net</div><div class="kpi-value">${fmtSignedInt(c.current_mm_net)}</div><div class="kpi-delta ${pctClass(c.current_mm_wow)}">WoW ${fmtSignedInt(c.current_mm_wow)}</div></div>
        <div class="kpi-card"><div class="kpi-label">MM Z-Score</div><div class="kpi-value ${zCls}">${z >= 0 ? '+' : ''}${fmtNum(z)}σ</div><div class="kpi-delta">2Y rolling</div></div>
        <div class="kpi-card"><div class="kpi-label">Crowding Percentile</div><div class="kpi-value ${pct >= 90 ? 'down' : pct <= 10 ? 'up' : ''}">${fmtNum(pct, 0)}%</div><div class="kpi-delta">MM net rank</div></div>
        <div class="kpi-card"><div class="kpi-label">Commercial Net</div><div class="kpi-value">${fmtSignedInt(c.current_prod_net)}</div><div class="kpi-delta ${pctClass(-c.current_prod_wow)}">WoW ${fmtSignedInt(c.current_prod_wow)}</div></div>
        <div class="kpi-card"><div class="kpi-label">Open Interest</div><div class="kpi-value">${fmtInt(c.current_oi)}</div><div class="kpi-delta ${pctClass(c.current_oi_wow)}">WoW ${fmtSignedInt(c.current_oi_wow)}</div></div>
        <div class="kpi-card"><div class="kpi-label">MM / OI</div><div class="kpi-value">${fmtSignedNum(c.current_mm_pct_oi, 1)}%</div><div class="kpi-delta">Net length intensity</div></div>
    `;

    renderCotDeskRead(c);
    renderCotNetChart(h, c.market);
    renderCotManagedMoneyChart(h);
    renderCotGauge(z, pct);
    renderCotZscoreChart(c.zscore_history || [], c.percentile_history || []);
    renderCotPctOiChart(h);
    renderCotTables(c, last);
}

function renderCotDeskRead(c) {
    const z = c.current_zscore || 0;
    const pct = c.current_percentile ?? 50;
    let cls = 'alert-ok';
    let msg;
    if (z >= 2 || pct >= 90) {
        cls = 'alert-warning';
        msg = `${c.market}: managed money is crowded long (${fmtNum(z)}σ, ${fmtNum(pct, 0)}th pctile). Treat rallies as more vulnerable to liquidation if price momentum or Brazil/weather confirmation fades.`;
    } else if (z <= -2 || pct <= 10) {
        cls = 'alert-ok';
        msg = `${c.market}: managed money is crowded short (${fmtNum(z)}σ, ${fmtNum(pct, 0)}th pctile). This is a cleaner contrarian bullish setup if fundamentals tighten.`;
    } else if ((c.current_mm_wow || 0) > 0 && (c.current_prod_wow || 0) < 0) {
        cls = 'alert-warning';
        msg = `${c.market}: funds added length while commercials sold into the move. Trend-following flow is supportive, but producer selling can cap upside if it accelerates.`;
    } else {
        msg = `${c.market}: positioning is not at an extreme. Use COT as a context layer with spreads, Brazil parity, weather and certified stocks before arguing direction.`;
    }
    document.getElementById('pos-signal').innerHTML = `<div class="alert ${cls}"><b>Desk read:</b> ${msg}</div>`;
}

function renderCotNetChart(h, market) {
    const traces = [
        { key: 'mm_net', name: 'Managed Money', color: COLORS.orange, width: 2.4 },
        { key: 'prod_net', name: 'Commercials', color: COLORS.blue, width: 2.1 },
        { key: 'swap_net', name: 'Swap Dealers', color: COLORS.purple, width: 1.7 },
        { key: 'other_net', name: 'Other Reportables', color: COLORS.yellow, width: 1.7 },
    ].map(def => ({
        x: h.map(d => d.date), y: h.map(d => d[def.key]), name: def.name,
        line: { color: def.color, width: def.width },
    }));
    Plotly.react('chart-pos-net', traces, mergeLayout({
        height: 430,
        title: { text: `${market} COT — Net positioning by trader group`, font: { size: 12, color: COLORS.muted } },
        yaxis: { title: 'Net lots', gridcolor: COLORS.grid, zerolinecolor: 'rgba(200,200,200,0.25)' },
    }), PLOTLY_CONFIG);
}

function renderCotManagedMoneyChart(h) {
    Plotly.react('chart-pos-mm', [
        { x: h.map(d => d.date), y: h.map(d => d.mm_long), name: 'MM Longs', type: 'bar', marker: { color: COLORS.green, opacity: 0.42 } },
        { x: h.map(d => d.date), y: h.map(d => -d.mm_short), name: 'MM Shorts', type: 'bar', marker: { color: COLORS.red, opacity: 0.42 } },
        { x: h.map(d => d.date), y: h.map(d => d.mm_net), name: 'MM Net', line: { color: COLORS.orange, width: 2.2 } },
    ], mergeLayout({
        height: 360, barmode: 'relative',
        yaxis: { title: 'Lots', gridcolor: COLORS.grid, zerolinecolor: 'rgba(200,200,200,0.25)' },
    }), PLOTLY_CONFIG);
}

function renderCotGauge(z, pct) {
    const el = document.getElementById('pos-gauge');
    const markerPct = ((z + 3) / 6 * 100).toFixed(0);
    const color = z > 1.5 ? COLORS.red : z < -1.5 ? COLORS.green : COLORS.orange;
    el.innerHTML = `
        <div class="zscore-gauge">
            <div class="zscore-value" style="color:${color}">${z >= 0 ? '+' : ''}${fmtNum(z)}σ</div>
            <div class="zscore-label">Managed Money 2Y Z-Score</div>
            <div class="zscore-bar"><div class="zscore-marker" style="left:${Math.max(0, Math.min(100, markerPct))}%"></div></div>
            <div style="display:flex;justify-content:space-between;font-size:0.6rem;color:var(--text-muted);"><span>-3σ</span><span>0</span><span>+3σ</span></div>
            <div style="margin-top:0.8rem;font-size:0.72rem;color:var(--text-muted);text-align:left;line-height:1.55;">
                <div><span style="color:${COLORS.green}">■</span> Short extreme: contrarian bullish</div>
                <div><span style="color:${COLORS.orange}">■</span> Current percentile: <b>${fmtNum(pct, 0)}%</b></div>
                <div><span style="color:${COLORS.red}">■</span> Long extreme: liquidation risk</div>
            </div>
        </div>`;
}

function renderCotZscoreChart(zHist, pctHist) {
    Plotly.react('chart-pos-zscore', [
        { x: zHist.map(d => d.date), y: zHist.map(d => d.value), name: 'MM Z-Score', line: { color: COLORS.orange, width: 1.8 }, fill: 'tozeroy', fillcolor: 'rgba(244,162,97,0.08)' },
        { x: pctHist.map(d => d.date), y: pctHist.map(d => d.value), name: 'Percentile', yaxis: 'y2', line: { color: COLORS.green, width: 1.5, dash: 'dot' } },
    ], mergeLayout({
        height: 330,
        yaxis: { title: 'Z-score', gridcolor: COLORS.grid, zerolinecolor: 'rgba(200,200,200,0.25)' },
        yaxis2: { title: 'Percentile', overlaying: 'y', side: 'right', range: [0, 100], gridcolor: 'rgba(0,0,0,0)' },
        shapes: [
            { type: 'line', y0: 2, y1: 2, x0: 0, x1: 1, xref: 'paper', line: { color: 'rgba(231,111,81,0.35)', dash: 'dot', width: 1 } },
            { type: 'line', y0: -2, y1: -2, x0: 0, x1: 1, xref: 'paper', line: { color: 'rgba(0,184,148,0.35)', dash: 'dot', width: 1 } },
        ],
    }), PLOTLY_CONFIG);
}

function renderCotPctOiChart(h) {
    const defs = [
        ['mm_pct_oi', 'Managed Money', COLORS.orange],
        ['prod_pct_oi', 'Commercials', COLORS.blue],
        ['swap_pct_oi', 'Swap Dealers', COLORS.purple],
        ['other_pct_oi', 'Other Reportables', COLORS.yellow],
    ];
    Plotly.react('chart-pos-pctoi', defs.map(([key, name, color]) => ({
        x: h.map(d => d.date), y: h.map(d => d[key]), name, line: { color, width: 1.8 },
    })), mergeLayout({
        height: 330,
        yaxis: { title: '% OI', gridcolor: COLORS.grid, zerolinecolor: 'rgba(200,200,200,0.25)' },
    }), PLOTLY_CONFIG);
}

function renderCotTables(c, last) {
    const groups = [
        ['Managed Money', 'mm'], ['Commercials', 'prod'], ['Swap Dealers', 'swap'], ['Other Reportables', 'other'],
    ];
    document.getElementById('pos-snapshot').innerHTML = `
        <table class="data-table"><thead><tr><th>Group</th><th>Long</th><th>Short</th><th>Net</th><th>Net/OI</th></tr></thead><tbody>
        ${groups.map(([label, key]) => `<tr><td>${label}</td><td>${fmtInt(last[key + '_long'])}</td><td>${fmtInt(last[key + '_short'])}</td><td class="${pctClass(last[key + '_net'])}">${fmtSignedInt(last[key + '_net'])}</td><td>${fmtSignedNum(last[key + '_pct_oi'], 1)}%</td></tr>`).join('')}
        </tbody></table>`;

    document.getElementById('pos-flow').innerHTML = `
        <table class="data-table"><thead><tr><th>Date</th><th>MM net</th><th>MM WoW</th><th>Comm. WoW</th><th>OI</th></tr></thead><tbody>
        ${(c.recent_flow || []).slice().reverse().map(r => `<tr><td>${r.date}</td><td>${fmtSignedInt(r.mm_net)}</td><td class="${pctClass(r.mm_wow)}">${fmtSignedInt(r.mm_wow)}</td><td class="${pctClass(-r.prod_wow)}">${fmtSignedInt(r.prod_wow)}</td><td>${fmtInt(r.oi)}</td></tr>`).join('')}
        </tbody></table>`;
}

function fmtSignedInt(v) {
    if (v == null || isNaN(v)) return '—';
    return (v >= 0 ? '+' : '') + Math.round(v).toLocaleString('en-US');
}

function fmtSignedNum(v, dec = 1) {
    if (v == null || isNaN(v)) return '—';
    return (v >= 0 ? '+' : '') + Number(v).toFixed(dec);
}

// ═══════════════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

function getCutoffDate(horizon) {
    const now = new Date();
    const map = {
        '1D': 5, '1W': 7, '1M': 30, '3M': 90, '6M': 180,
        'YTD': null, '1Y': 365, '5Y': 1825,
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
