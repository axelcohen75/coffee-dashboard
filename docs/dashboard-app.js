/**
 * Coffee Market Monitor — Chart rendering & tab management.
 * Loads docs/data/market-data.json and builds all views with Plotly.
 */

let DATA = null;
let tsCompareDates = [];
let activeSpread = null;
let selectedAssets = ['kc'];
let selectedCotMarket = null;
let selectedFuturesMarket = 'Arabica';
const FUTURES_CHART_HEIGHT = 280;
const FUTURES_CHART_LAYOUT = { height: FUTURES_CHART_HEIGHT, margin: { t: 8, r: 12, l: 45, b: 32 } };

function getOverviewChartHeight() {
    const el = document.getElementById('chart-price-evolution');
    if (!el) return 180;
    const body = el.parentElement;
    if (!body || body.clientHeight < 40) return 180;

    const horizon = body.querySelector('.horizon-bar');
    const bodyStyle = window.getComputedStyle(body);
    const padY = parseFloat(bodyStyle.paddingTop) + parseFloat(bodyStyle.paddingBottom);
    const horizonStyle = horizon ? window.getComputedStyle(horizon) : null;
    const horizonH = horizon
        ? horizon.offsetHeight + parseFloat(horizonStyle.marginBottom || 0) + parseFloat(horizonStyle.marginTop || 0)
        : 0;
    const available = body.clientHeight - horizonH - padY - 4;
    const minH = window.innerWidth < 1280 ? 130 : 150;

    return Math.max(minH, Math.floor(available));
}

function relayoutPriceChart() {
    const el = document.getElementById('chart-price-evolution');
    if (!el || !el._plotlyInit) return;
    const h = getOverviewChartHeight();
    const w = el.parentElement ? el.parentElement.clientWidth : el.clientWidth;
    if (Math.abs((el._lastH || 0) - h) < 4 && Math.abs((el._lastW || 0) - w) < 4) return;
    el._lastH = h;
    el._lastW = w;
    const updates = { height: h, autosize: true };
    if (w > 0) updates.width = w;
    Plotly.relayout('chart-price-evolution', updates);
}

function setupPriceChartResize() {
    const el = document.getElementById('chart-price-evolution');
    if (!el || el._resizeBound) return;
    el._resizeBound = true;
    const chartPanel = el.closest('.overview-charts-top .panel');
    const body = el.parentElement;
    const tick = () => requestAnimationFrame(relayoutPriceChart);
    if (typeof ResizeObserver !== 'undefined') {
        const obs = new ResizeObserver(tick);
        if (chartPanel) obs.observe(chartPanel);
        else if (body) obs.observe(body);
    }
    window.addEventListener('resize', tick);
}


async function init() {
    try {
        const resp = await fetch('data/market-data.json');
        DATA = await resp.json();
        document.getElementById('last-updated').textContent =
            'Updated ' + new Date(DATA.generated).toUTCString().slice(0, 25) + ' UTC';
    } catch (e) {
        document.getElementById('main-content').innerHTML =
            '<div class="loading">Failed to load data. Run: python scripts/fetch_market_data.py</div>';
        return;
    }
    try {
        await _loadCSVData();
        renderOverview();
        setupTabs();
    } catch (e) {
        console.error('Render error:', e);
    }
}


async function _loadCSVData() {
    // Canonical CSVs are loaded by scripts/fetch_market_data.py into market-data.json.
    return Promise.resolve();
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
    renderOverviewStockBadges();
    renderSpotPrices();
    renderFuturesMarket();
    updateFuturesSectionSubtitles();
    renderPriceEvolution('1Y');
    renderAssetStats();
    activeSpread = getDefaultSpreadKey(selectedFuturesMarket);
    renderSpreadDashboard();
    renderSpreadMonitor(activeSpread);
    renderTermStructure();
    renderKeyDates();
    renderNews();
    setupHorizonButtons();
    setupTermStructureCompare();
    setupSeasonalToggle();
    setupPriceChartResize();
}

function renderOverviewStockBadges() {
    const el = document.getElementById('overview-stock-badges');
    if (!el) return;
    const s = DATA.stocks;
    if (!s) { el.innerHTML = ''; return; }

    const arab = s.arabica || {};
    const rob = s.robusta || {};

    const arabPct = arab.one_month_ago ? ((arab.current - arab.one_month_ago) / arab.one_month_ago * 100).toFixed(1) : '0.0';
    const arabUp = parseFloat(arabPct) >= 0;
    const robPct = rob.one_month_ago ? ((rob.current - rob.one_month_ago) / rob.one_month_ago * 100).toFixed(1) : '0.0';
    const robUp = parseFloat(robPct) >= 0;

    el.innerHTML = `<div class="stock-badge" style="border-left:3px solid ${COLORS.accent};">
            <span class="stock-badge-label">Arabica ICE US</span>
            <span class="stock-badge-value">${fmtInt(arab.current || 0)} <span style="font-size:0.6rem;font-weight:400;color:var(--text-muted);">bags</span></span>
            <span class="stock-badge-sub"><span class="${arabUp ? 'up' : 'down'}">${arabUp ? '+' : ''}${arabPct}%</span> 1M</span>
        </div>
        <div class="stock-badge" style="border-left:3px solid ${COLORS.blue};">
            <span class="stock-badge-label">Robusta ICE EU</span>
            <span class="stock-badge-value">${fmtInt(rob.current || 0)} <span style="font-size:0.6rem;font-weight:400;color:var(--text-muted);">lots</span></span>
            <span class="stock-badge-sub"><span class="${robUp ? 'up' : 'down'}">${robUp ? '+' : ''}${robPct}%</span> 1M</span>
        </div>`;
}

function renderAssetStats() {
    const el = document.getElementById('asset-stats-body');
    const titleEl = document.getElementById('asset-stats-title');
    if (!el) return;

    if (selectedAssets.length === 1) {
        const asset = getAssetData(selectedAssets[0]);
        if (!asset || !asset.history || asset.history.length < 10) {
            el.innerHTML = '<div style="color:var(--text-muted);font-size:0.7rem;">Not enough data</div>';
            return;
        }
        titleEl.textContent = asset.label;
        const h = asset.history;
        const current = h[h.length - 1].value;
        const returns = [];
        for (let i = 1; i < h.length; i++) {
            if (h[i - 1].value > 0) returns.push(Math.log(h[i].value / h[i - 1].value));
        }
        const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
        const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (returns.length - 1);
        const dailyVol = Math.sqrt(variance);
        const annualVol = dailyVol * Math.sqrt(252) * 100;

        const perf1w = computePerf(h, 7);
        const perf1m = computePerf(h, 30);
        const perf3m = computePerf(h, 90);
        const perfYtd = computeYTDPerf(h);
        const perf1y = computePerf(h, 365);

        const vals = h.map(d => d.value);
        const high52 = Math.max(...vals.slice(-260));
        const low52 = Math.min(...vals.slice(-260));

        el.innerHTML = `
            <div class="stat-row"><span class="stat-label">Price</span><span class="stat-value">${fmtNum(current)}</span></div>
            <div class="stat-row"><span class="stat-label">1W</span><span class="stat-value ${pctClass(perf1w)}">${fmtPct(perf1w)}</span></div>
            <div class="stat-row"><span class="stat-label">1M</span><span class="stat-value ${pctClass(perf1m)}">${fmtPct(perf1m)}</span></div>
            <div class="stat-row"><span class="stat-label">3M</span><span class="stat-value ${pctClass(perf3m)}">${fmtPct(perf3m)}</span></div>
            <div class="stat-row"><span class="stat-label">YTD</span><span class="stat-value ${pctClass(perfYtd)}">${fmtPct(perfYtd)}</span></div>
            <div class="stat-row"><span class="stat-label">1Y</span><span class="stat-value ${pctClass(perf1y)}">${fmtPct(perf1y)}</span></div>
            <div class="stat-row"><span class="stat-label">Vol (ann.)</span><span class="stat-value">${fmtNum(annualVol, 1)}%</span></div>
            <div class="stat-row"><span class="stat-label">52w High</span><span class="stat-value">${fmtNum(high52)}</span></div>
            <div class="stat-row"><span class="stat-label">52w Low</span><span class="stat-value">${fmtNum(low52)}</span></div>
        `;
    } else {
        titleEl.textContent = 'CORRELATION';
        const horizons = [{ label: '1M', days: 30 }, { label: '3M', days: 90 }, { label: '6M', days: 180 }, { label: '1Y', days: 365 }];
        let html = '';
        for (const hz of horizons) {
            html += `<div style="font-size:0.6rem;color:var(--text-muted);margin-top:0.4rem;letter-spacing:1px;">${hz.label}</div>`;
            html += _buildCorrTable(hz.days);
        }
        el.innerHTML = html;
    }
}

function _buildCorrTable(days) {
    const assets = selectedAssets.map(k => ({ key: k, data: getAssetData(k) })).filter(a => a.data?.history?.length > 10);
    if (assets.length < 2) return '<div style="color:var(--text-muted);font-size:0.65rem;">Select 2+ assets</div>';

    const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

    const dateMap = {};
    for (const a of assets) {
        const filtered = a.data.history.filter(d => d.date >= cutoff);
        for (const pt of filtered) {
            if (!dateMap[pt.date]) dateMap[pt.date] = {};
            dateMap[pt.date][a.key] = pt.value;
        }
    }

    const dates = Object.keys(dateMap).sort();
    const returnSeries = {};
    for (const a of assets) returnSeries[a.key] = [];

    for (let i = 1; i < dates.length; i++) {
        const prev = dateMap[dates[i - 1]];
        const curr = dateMap[dates[i]];
        let allPresent = true;
        for (const a of assets) {
            if (prev[a.key] == null || curr[a.key] == null || prev[a.key] <= 0) { allPresent = false; break; }
        }
        if (!allPresent) continue;
        for (const a of assets) {
            returnSeries[a.key].push(Math.log(curr[a.key] / prev[a.key]));
        }
    }

    let html = '<table class="corr-table"><tr><th></th>';
    for (const a of assets) html += `<th>${a.key.toUpperCase()}</th>`;
    html += '</tr>';
    for (const a of assets) {
        html += `<tr><th>${a.key.toUpperCase()}</th>`;
        for (const b of assets) {
            if (a.key === b.key) {
                html += '<td style="color:var(--text-muted);">1.00</td>';
            } else {
                const corr = _pearson(returnSeries[a.key], returnSeries[b.key]);
                const color = corr > 0.5 ? COLORS.green : corr < -0.5 ? COLORS.red : COLORS.orange;
                html += `<td style="color:${color}">${corr != null ? corr.toFixed(2) : '—'}</td>`;
            }
        }
        html += '</tr>';
    }
    html += '</table>';
    return html;
}

function _pearson(a, b) {
    const n = Math.min(a.length, b.length);
    if (n < 5) return null;
    const xa = a.slice(-n), xb = b.slice(-n);
    const ma = xa.reduce((s, v) => s + v, 0) / n;
    const mb = xb.reduce((s, v) => s + v, 0) / n;
    let num = 0, da = 0, db = 0;
    for (let i = 0; i < n; i++) {
        const ai = xa[i] - ma, bi = xb[i] - mb;
        num += ai * bi; da += ai * ai; db += bi * bi;
    }
    const denom = Math.sqrt(da * db);
    return denom > 0 ? num / denom : 0;
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
    if (key === 'arb_rob') return { label: 'KC-RC', price: f.arb_rob?.current, unit: '¢/lb', history: f.arb_rob?.history, color: COLORS.orange };
    if (key === 'brl') return { label: 'BRL/USD', price: DATA.brazil?.fx, unit: '', history: DATA.brazil?.fx_history, color: COLORS.yellow };
    if (key === 'cepea') return { label: 'CEPEA/ESALQ', price: DATA.cepea?.current, unit: 'US$/bag', history: DATA.cepea?.history, color: COLORS.purple };
    if (key === 'dxy') return { label: 'DXY', price: DATA.dxy?.current, unit: '', history: DATA.dxy?.history, color: '#aab4c2' };
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
    const coffeeAssets = [
        { key: 'kc', label: 'KC Arabica' },
        { key: 'rc', label: 'RC Robusta' },
        { key: 'rc_cl', label: 'RC (¢/lb equiv.)' },
        { key: 'cepea', label: 'CEPEA/ESALQ' },
    ];
    const spreadAssets = [
        { key: 'arb_rob', label: 'KC-RC' },
    ];
    const fxAssets = [
        { key: 'brl', label: 'BRL/USD (PTAX)' },
        { key: 'dxy', label: 'DXY (Dollar Index)' },
    ];

    let html = `<div class="spot-perf-header">
        <span aria-hidden="true"></span><span aria-hidden="true"></span><span aria-hidden="true"></span><span aria-hidden="true"></span>
        <span class="spot-perf-label">1M</span>
        <span class="spot-perf-label">YTD</span>
    </div>`;

    html += `<div class="spot-prices-content">`;
    html += `<div class="spot-category">COFFEE</div>`;
    html += _renderSpotRows(coffeeAssets);
    html += `<div class="spot-category spot-category-spreads">SPREADS</div>`;
    html += _renderSpotRows(spreadAssets, 'spread');
    html += `<div class="spot-category spot-category-fx">FX</div>`;
    html += _renderSpotRows(fxAssets);
    html += `</div>`;

    el.innerHTML = html;
}

function renderFuturesMarket() {
    renderFuturesMarketToggle();
    const market = getFuturesMarketPayload(selectedFuturesMarket);
    const el = document.getElementById('futures-market-body');
    if (!market || !market.front) {
        el.innerHTML = '<div class="loading">Futures market data unavailable.</div>';
        return;
    }

    const perf = market.performance || {};
    const curve = market.curve || [];
    const front = curve[0] || {};
    const second = curve[1] || {};
    const roll = estimateContractRoll(front, market.key);
    const nextSpread = second.price && front.price ? second.price - front.price : null;

    el.innerHTML = `
        <div class="futures-market-card">
            <div class="futures-market-top">
                <div>
                    <div class="futures-label">${market.exchange}</div>
                    <div class="futures-title">${market.name}</div>
                </div>
                <div style="text-align:right;">
                    <div class="futures-price">${fmtNum(market.front, market.unit === '$/t' ? 0 : 2)}</div>
                    <div class="futures-unit">${market.unit}</div>
                </div>
            </div>
            <div class="futures-mini-grid">
                <div><span>1M</span><b class="${pctClass(perf['1m'])}">${fmtPct(perf['1m'])}</b></div>
                <div><span>YTD</span><b class="${pctClass(perf.ytd)}">${fmtPct(perf.ytd)}</b></div>
                <div><span>Front</span><b>${front.contract || market.symbol}</b></div>
                <div><span>Next</span><b>${second.contract || '—'} ${nextSpread == null ? '' : `<em class="${pctClass(nextSpread)}">${nextSpread >= 0 ? '+' : ''}${fmtNum(nextSpread, 1)}</em>`}</b></div>
            </div>
        </div>
        <div class="contract-spec-card">
            <div class="contract-spec-title">CONTRACT SPECS</div>
            <div class="contract-spec-grid">
                <span>Symbol</span><b>${market.symbol}</b>
                <span>Contract size</span><b>${market.contractSize}</b>
                <span>Tick</span><b>${market.tick}</b>
                <span>Months</span><b>${market.months}</b>
                <span>Curve source</span><b>${market.curveSource}</b>
                <span>Roll watch</span><b>${roll}</b>
            </div>
        </div>`;
}

function renderFuturesMarketToggle() {
    const el = document.getElementById('futures-market-toggle');
    if (!el) return;
    el.innerHTML = ['Arabica', 'Robusta'].map(m => `
        <button class="horizon-btn ${m === selectedFuturesMarket ? 'active' : ''}" onclick="selectFuturesMarket('${m}')">${m.toUpperCase()}</button>
    `).join('');
}

function selectFuturesMarket(market) {
    selectedFuturesMarket = market;
    activeSpread = getDefaultSpreadKey(market);
    renderFuturesMarket();
    updateFuturesSectionSubtitles();
    renderSpreadDashboard();
    renderSpreadMonitor(activeSpread);
    renderTermStructure();
    renderTsDateTags();
}

function getFuturesMarketPayload(market) {
    if (market === 'Robusta') {
        const rc = DATA.futures?.rc || {};
        const curve = DATA.forward_curve?.rc || [];
        return {
            key: 'rc', name: 'RC Robusta Coffee Futures', symbol: 'ICEEUR:RC1!', exchange: 'ICE Futures Europe',
            unit: '$/t', front: rc.front, history: rc.history, performance: rc.performance || {}, curve,
            contractSize: '10 metric tonnes', tick: '$1/t = $10', months: 'Jan, Mar, May, Jul, Sep, Nov',
            curveSource: curve[0]?.source === 'tradingview_delayed' ? 'TradingView delayed' : (curve[0]?.source || rc.source || 'fallback'),
        };
    }
    const kc = DATA.futures?.kc || {};
    const curve = DATA.forward_curve?.kc || [];
    return {
        key: 'kc', name: 'KC Arabica Coffee Futures', symbol: 'KC=F / ICE KC', exchange: 'ICE Futures U.S.',
        unit: '¢/lb', front: kc.front, history: kc.history, performance: kc.performance || {}, curve,
        contractSize: '37,500 lbs', tick: '0.05¢/lb = $18.75', months: 'Mar, May, Jul, Sep, Dec',
        curveSource: curve[0]?.source || 'Yahoo Finance',
    };
}

function updateFuturesSectionSubtitles() {
    const sectionSub = document.getElementById('futures-section-subtitle');
    const tsSub = document.getElementById('term-structure-subtitle');
    const compareControls = document.getElementById('ts-compare-controls');
    if (selectedFuturesMarket === 'Robusta') {
        if (sectionSub) sectionSub.textContent = ' ROBUSTA // RC ICE EUROPE';
        if (tsSub) tsSub.textContent = ' RC ROBUSTA // DELIVERY MONTH';
        if (compareControls) compareControls.style.display = 'none';
    } else {
        if (sectionSub) sectionSub.textContent = ' ARABICA // KC ICE';
        if (tsSub) tsSub.textContent = ' KC ARABICA // DELIVERY MONTH';
        if (compareControls) compareControls.style.display = '';
    }
}

function getDefaultSpreadKey(market) {
    if (market === 'Robusta') {
        const defs = getRobustaSpreadDefs();
        return defs.length ? defs[0].key : null;
    }
    return 'nz';
}

function getRobustaSpreadDefs() {
    const rc = DATA.forward_curve?.rc || [];
    const defs = [];
    for (let i = 0; i < Math.min(rc.length - 1, 4); i++) {
        const a = rc[i];
        const b = rc[i + 1];
        const aMon = (a.delivery_month || a.contract || '').split(' ')[0];
        const bMon = (b.delivery_month || b.contract || '').split(' ')[0];
        defs.push({
            key: `rc_${i}`,
            label: `RC ${a.contract}-${b.contract}`,
            desc: `${aMon} → ${bMon}`,
            months: `${a.delivery_month || a.contract} vs ${b.delivery_month || b.contract}`,
            current: b.price - a.price,
            unit: '$/t',
        });
    }
    return defs;
}

function getSpreadPayload(spreadKey) {
    if (selectedFuturesMarket === 'Robusta') {
        const def = getRobustaSpreadDefs().find(d => d.key === spreadKey);
        if (!def) return null;
        return {
            label: def.label,
            current: def.current,
            mean: null,
            history: null,
            unit: def.unit,
            detail: def,
        };
    }
    const sp = DATA.spreads?.[spreadKey];
    if (!sp) return null;
    return { ...sp, unit: '¢/lb', detail: SPREAD_DETAILS[spreadKey] || {} };
}

function estimateContractRoll(frontContract, marketKey) {
    if (!frontContract?.month || !frontContract?.year) return 'Check exchange calendar';
    const daysBefore = marketKey === 'rc' ? 5 : 10;
    const d = businessDaysBefore(new Date(frontContract.year, frontContract.month - 1, 1), daysBefore);
    return `${d.toISOString().slice(0, 10)} est. (${daysBefore} bd before delivery month)`;
}

function businessDaysBefore(date, n) {
    const d = new Date(date);
    while (n > 0) {
        d.setDate(d.getDate() - 1);
        if (d.getDay() !== 0 && d.getDay() !== 6) n -= 1;
    }
    return d;
}

function _renderSpotRows(assets, rowClass = '') {
    let html = '';
    for (const asset of assets) {
        const data = getAssetData(asset.key);
        if (!data || data.price == null) continue;
        const canSelect = !['rc_cl'].includes(asset.key);
        const sel = selectedAssets.includes(asset.key) ? ' selected' : '';
        const perf1m = computePerf(data.history, 30);
        const perfYtd = computeYTDPerf(data.history);
        html += `
        <div class="spot-row${rowClass ? ` ${rowClass}` : ``}${sel}" ${canSelect ? `onclick="toggleAsset('${asset.key}')" style="cursor:pointer"` : 'style="cursor:default;opacity:0.7"'}>
            <div class="spot-indicator" style="background:${data.color}"></div>
            <span class="spot-name">${asset.label}</span>
            <span class="spot-price">${fmtNum(data.price, data.unit === '$/t' ? 0 : 2)}</span>
            <span class="spot-unit">${data.unit}</span>
            <span class="spot-perf ${pctClass(perf1m)}">${fmtPct(perf1m)}</span>
            <span class="spot-perf ${pctClass(perfYtd)}">${fmtPct(perfYtd)}</span>
        </div>`;
    }
    return html;
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
    renderAssetStats();
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
        subtitleEl.textContent = selectedAssets.map(k => getAssetData(k)?.label).filter(Boolean).join(' vs ') + ' // %';
    } else {
        const asset = getAssetData(selectedAssets[0]);
        titleEl.textContent = 'PRICE EVOLUTION';
        subtitleEl.textContent = `${asset?.label || 'KC Arabica'} // ${asset?.unit || '¢/lb'}`;
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
                const seasonalByDOY = {};
                for (const s of seasonal) seasonalByDOY[s.doy] = s.value;

                const xDates = [];
                const yVals = [];
                for (const pt of filtered) {
                    const doy = getDOY(pt.date);
                    if (seasonalByDOY[doy] != null) {
                        xDates.push(pt.date);
                        yVals.push(seasonalByDOY[doy]);
                    }
                }

                if (xDates.length) {
                    traces.push({
                        x: xDates,
                        y: yVals,
                        name: '5Y Seasonal',
                        yaxis: 'y2',
                        line: { color: COLORS.purple, width: 1.5, dash: 'dot' },
                        opacity: 0.7,
                    });
                }
            }
        }
    }

    const chartHeight = getOverviewChartHeight();
    const yUnit = multiMode ? '%' : (getAssetData(selectedAssets[0])?.unit || '¢/lb');
    const layoutOverrides = {
        height: chartHeight,
        margin: { l: 52, r: 18, t: 10, b: 34 },
        yaxis: { title: { text: yUnit, standoff: 6 }, automargin: true },
        legend: { orientation: 'h', y: 1.02, x: 0, xanchor: 'left', font: { size: 10 } },
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

    const chartEl = document.getElementById('chart-price-evolution');
    chartEl._plotlyInit = true;
    chartEl._lastH = chartHeight;
    requestAnimationFrame(() => requestAnimationFrame(relayoutPriceChart));
    if (!chartEl._clickBound) {
        chartEl._clickBound = true;
        chartEl.on('plotly_click', function(data) {
            if (!data.points || !data.points.length) return;
            const pt = data.points[0];
            const date = pt.x;
            const value = pt.y;
            const existing = chartEl._annotations || [];
            const idx = existing.findIndex(a => a.x === date);
            if (idx >= 0) {
                existing.splice(idx, 1);
            } else {
                existing.push({
                    x: date, y: value,
                    text: `${date}<br>${fmtNum(value, 2)}`,
                    showarrow: true, arrowhead: 2, arrowsize: 0.8,
                    arrowcolor: COLORS.orange,
                    font: { color: COLORS.orange, size: 9 },
                    bgcolor: 'rgba(17,24,39,0.9)',
                    bordercolor: COLORS.orange,
                    borderpad: 3,
                });
            }
            chartEl._annotations = existing;
            Plotly.relayout('chart-price-evolution', { annotations: existing });
        });
    } else if (chartEl._annotations && chartEl._annotations.length) {
        Plotly.relayout('chart-price-evolution', { annotations: chartEl._annotations });
    }
}

// ── Term Structure with date comparison ──────────────────────────────────

function renderTermStructure() {
    const isRobusta = selectedFuturesMarket === 'Robusta';
    const curve = isRobusta ? (DATA.forward_curve.rc || []) : (DATA.forward_curve.kc || []);
    const chartEl = document.getElementById('chart-term-structure');
    if (!curve.length) {
        chartEl.innerHTML = '<div class="loading">Forward curve not available</div>';
        return;
    }

    const traces = [];
    if (isRobusta) {
        traces.push({
            x: curve.map(d => d.delivery_month || d.contract),
            y: curve.map(d => d.price),
            name: 'RC Robusta ($/t)',
            mode: 'lines+markers',
            line: { color: COLORS.blue, width: 2.5 },
            marker: { size: 7 },
            customdata: curve.map(d => [d.symbol || '', d.source || '', d.volume || 0]),
            hovertemplate: '%{x}<br>%{y:.0f} $/t<br>%{customdata[0]}<br>Source: %{customdata[1]}<br>Volume: %{customdata[2]:,.0f}<extra>RC Robusta</extra>',
        });
    } else {
        traces.push({
            x: curve.map(d => d.contract),
            y: curve.map(d => d.price),
            name: 'KC Arabica (¢/lb)',
            mode: 'lines+markers',
            line: { color: COLORS.accent, width: 2.5 },
            marker: { size: 7 },
        });
        const compareColors = [COLORS.orange, COLORS.purple, COLORS.yellow, COLORS.red];
        tsCompareDates.forEach((dateStr, i) => {
            const histCurve = getHistoricalCurveAtDate(dateStr);
            if (histCurve && histCurve.length) {
                traces.push({
                    x: histCurve.map(d => d.contract),
                    y: histCurve.map(d => d.price),
                    name: `KC (${dateStr})`,
                    mode: 'lines+markers',
                    line: { color: compareColors[i % compareColors.length], width: 2, dash: 'dash' },
                    marker: { size: 6, symbol: 'diamond' },
                });
            }
        });
    }

    let titleText = 'Term Structure';
    if (curve.length >= 2) {
        const f = curve[0].price, l = curve[curve.length - 1].price;
        const structure = l > f ? 'Contango' : 'Backwardation';
        const slope = ((l / f - 1) * 100).toFixed(1);
        const prefix = isRobusta ? 'RC' : 'KC';
        titleText = `${prefix} — ${structure} (${slope > 0 ? '+' : ''}${slope}%)`;
    }
    const metaEl = document.getElementById('term-structure-meta');
    if (metaEl) metaEl.textContent = titleText;

    const layout = {
        ...FUTURES_CHART_LAYOUT,
        yaxis: { title: isRobusta ? '$/t' : '¢/lb' },
    };
    Plotly.react('chart-term-structure', traces, mergeLayout(layout), PLOTLY_CONFIG);
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
    const payload = getSpreadPayload(spreadKey);

    if (!payload) {
        chartEl.innerHTML = '<div class="loading">No data for this timespread</div>';
        if (subtitleEl) subtitleEl.textContent = '';
        return;
    }

    const detail = payload.detail || {};
    if (selectedFuturesMarket === 'Robusta') {
        renderRobustaSpreadChart(payload);
        if (subtitleEl) subtitleEl.textContent = ` ${payload.label} — ${detail.months || detail.desc || ''} // ${payload.unit}`;
        return;
    }

    if (!payload.history || !payload.history.length) {
        chartEl.innerHTML = '<div class="loading">No data for this timespread</div>';
        return;
    }
    renderSpreadChart(payload.history, payload.mean, payload.current, payload.label, payload.unit);
    if (subtitleEl) subtitleEl.textContent = ` ${payload.label} — ${detail.months || ''} // ${payload.unit}`;
}

function _smoothSeries(values, window) {
    const out = [];
    for (let i = 0; i < values.length; i++) {
        const start = Math.max(0, i - Math.floor(window / 2));
        const end = Math.min(values.length, i + Math.floor(window / 2) + 1);
        let sum = 0, count = 0;
        for (let j = start; j < end; j++) { sum += values[j]; count++; }
        out.push(sum / count);
    }
    return out;
}

function renderSpreadChart(history, mean, current, name, unit = '¢/lb') {
    const h = history;
    const smoothed = _smoothSeries(h.map(d => d.value), 5);
    const traces = [{
        x: h.map(d => d.date), y: smoothed,
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

    const metaEl = document.getElementById('spread-chart-meta');
    if (metaEl) metaEl.textContent = `Current: ${fmtNum(current)} ${unit}`;

    Plotly.react('chart-spread-monitor', traces, mergeLayout({
        ...FUTURES_CHART_LAYOUT,
        yaxis: { title: unit },
        shapes, annotations,
    }), PLOTLY_CONFIG);
}

function renderRobustaSpreadChart(payload) {
    const defs = getRobustaSpreadDefs();
    const labels = defs.map(d => d.label.replace('RC ', ''));
    const values = defs.map(d => d.current);
    const selectedIdx = defs.findIndex(d => d.key === activeSpread);
    const barColors = defs.map((d, i) => i === selectedIdx ? COLORS.accent : 'rgba(69,123,157,0.55)');

    const metaEl = document.getElementById('spread-chart-meta');
    if (metaEl) metaEl.textContent = `Selected: ${fmtNum(payload.current, 0)} $/t (curve snapshot)`;

    Plotly.react('chart-spread-monitor', [{
        x: labels,
        y: values,
        type: 'bar',
        marker: { color: barColors },
        hovertemplate: '%{x}<br>%{y:.0f} $/t<extra></extra>',
    }], mergeLayout({
        ...FUTURES_CHART_LAYOUT,
        yaxis: { title: '$/t' },
    }), PLOTLY_CONFIG);
}

// ── Spread Dashboard (clickable → updates dropdown + chart) ─────────────

function renderSpreadDashboard() {
    const el = document.getElementById('spread-dashboard');
    let html = '';
    const isRobusta = selectedFuturesMarket === 'Robusta';
    const defs = isRobusta ? getRobustaSpreadDefs() : SPREAD_DEFS;

    for (const def of defs) {
        const sp = isRobusta ? def : DATA.spreads?.[def.key];
        if (!sp) continue;
        const current = isRobusta ? def.current : sp.current;
        const cls = current >= 0 ? 'up' : 'down';
        const detail = isRobusta ? def : (SPREAD_DETAILS[def.key] || {});
        const meanDiff = !isRobusta && sp.mean != null ? (sp.current - sp.mean) : null;
        const meanTag = meanDiff != null ? `<span style="font-size:0.55rem;color:${meanDiff >= 0 ? 'var(--green)' : 'var(--red)'}">${meanDiff >= 0 ? '+' : ''}${fmtNum(meanDiff)} vs avg</span>` : '';
        const unit = isRobusta ? '$/t' : '¢/lb';
        html += `<div class="spread-item${activeSpread === def.key ? ' active' : ''}" onclick="selectSpread('${def.key}')">
            <div>
                <span class="spread-label" style="font-weight:600;">${def.label}</span>
                <span style="font-size:0.6rem;color:var(--text-muted);margin-left:0.3rem;">${detail.desc || def.desc || ''}</span>
                <div style="font-size:0.55rem;color:var(--text-muted);">${detail.months || ''} ${meanTag}</div>
            </div>
            <span class="spread-value ${cls}">${current >= 0 ? '+' : ''}${fmtNum(current, isRobusta ? 0 : 2)} <span style="font-size:0.55rem;color:var(--text-muted);">${unit}</span></span>
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
    for (const a of news.slice(0, 8)) {
        const summary = a.summary.replace(/&nbsp;/g, ' ').replace(/<[^>]+>/g, '');
        html += `
        <div class="news-item">
            <div class="news-top">
                <span class="sentiment-tag sentiment-${a.sentiment}">${a.sentiment}</span>
                <span class="news-age">${a.age || ''}</span>
            </div>
            <div class="news-title">${escHtml(a.title.slice(0, 100))}</div>
            <div class="news-summary">${escHtml(summary.slice(0, 220))}${summary.length > 220 ? "…" : ""}</div>
            <a class="news-link" href="${a.url}" target="_blank" rel="noopener">READ ARTICLE →</a>
        </div>`;
    }
    el.innerHTML = html;
}

function renderPolymarket() {
    const el = document.getElementById('polymarket-list');
    const markets = DATA.polymarket || [];

    if (!markets.length) {
        el.innerHTML = `<div class="poly-card">
            <div class="poly-question">No active coffee or climate prediction markets found on Polymarket.</div>
            <div class="poly-vol">Coffee & climate markets will appear here when available.</div>
        </div>`;
        return;
    }

    let html = '';
    for (const m of markets.slice(0, 8)) {
        const catBadge = m.category === 'climate'
            ? '<span style="font-size:0.55rem;padding:1px 4px;border-radius:2px;background:rgba(231,111,81,0.15);color:var(--red);font-weight:700;margin-right:0.3rem;">CLIMATE</span>'
            : '<span style="font-size:0.55rem;padding:1px 4px;border-radius:2px;background:rgba(0,212,170,0.15);color:var(--green);font-weight:700;margin-right:0.3rem;">COFFEE</span>';
        html += `<div class="poly-card">
            <div class="poly-question">${catBadge}${escHtml(m.question.slice(0, 120))}</div>
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

const TONNES_TO_BAGS = 1000 / 60;
let selectedPhysicalMarket = 'Arabica';
let _physicalListenersSetup = false;

function renderInventory() {
    document.getElementById('tab-inventory').dataset.rendered = '1';
    const s = DATA.stocks;
    if (!s) return;

    renderPhysicalMarketToggle();
    renderPhysicalMarket(selectedPhysicalMarket);

    if (!_physicalListenersSetup) {
        _physicalListenersSetup = true;
        document.getElementById('physical-unit-toggle')?.addEventListener('change', () => renderPhysicalMarket(selectedPhysicalMarket));
        document.getElementById('physical-price-overlay')?.addEventListener('change', () => renderPhysicalMarket(selectedPhysicalMarket));
        document.querySelectorAll('#physical-horizon .horizon-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('#physical-horizon .horizon-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                renderPhysicalMarket(selectedPhysicalMarket);
            });
        });
    }
}

function renderPhysicalMarketToggle() {
    const el = document.getElementById('physical-market-toggle');
    el.innerHTML = ['Arabica', 'Robusta'].map(m => `
        <button class="horizon-btn ${m === selectedPhysicalMarket ? 'active' : ''}" onclick="selectPhysicalMarket('${m}')">${m.toUpperCase()}</button>
    `).join('');
}

function selectPhysicalMarket(market) {
    selectedPhysicalMarket = market;
    renderPhysicalMarketToggle();
    renderPhysicalMarket(market);
}

function renderPhysicalMarket(market) {
    const s = DATA.stocks || {};
    const isRobusta = market === 'Robusta';
    const data = isRobusta ? (s.robusta || { current: 0, one_month_ago: 0, history: [] }) : (s.arabica || { current: 0, one_month_ago: 0, history: [] });
    const ports = isRobusta ? (s.robusta_ports || {}) : (s.ports || {});
    const convert = isRobusta && Boolean(document.getElementById('physical-unit-toggle')?.checked);
    const showPrice = Boolean(document.getElementById('physical-price-overlay')?.checked);
    const horizon = document.querySelector('#physical-horizon .horizon-btn.active')?.dataset.horizon || '1Y';
    const factor = convert ? TONNES_TO_BAGS : 1;
    const unit = isRobusta ? (convert ? 'bags (60kg equivalent)' : 'tonnes') : 'bags (60kg)';
    const current = Math.round((data.current || 0) * factor);
    const prev = Math.round((data.one_month_ago || 0) * factor);
    const change = current - prev;
    const changePct = prev ? (change / prev * 100) : 0;

    document.getElementById('physical-source').textContent = isRobusta
        ? 'ICE Europe Robusta certified stocks by port. Toggle converts tonnes to 60kg bag equivalent.'
        : 'ICE Futures U.S. Coffee C certified stocks by licensed warehouse port.';
    document.getElementById('physical-history-title').textContent = `${market.toUpperCase()} STOCKS — HISTORICAL`;
    document.getElementById('physical-ports-title').textContent = `${market.toUpperCase()} — CURRENT LEVELS BY PORT`;
    document.getElementById('physical-unit-toggle-wrap').style.display = isRobusta ? 'flex' : 'none';
    document.getElementById('physical-price-overlay-wrap').style.display = 'flex';

    const daysConsumption = !isRobusta && current ? Math.round(current / (100000000 / 365)) : null;
    document.getElementById('physical-kpis').innerHTML = `
        <div class="kpi-card"><div class="kpi-label">${market} Certified</div><div class="kpi-value">${fmtInt(current)} ${unit}</div><div class="kpi-delta ${change >= 0 ? 'up' : 'down'}">${change >= 0 ? '+' : ''}${fmtInt(change)} (${changePct.toFixed(1)}%) 1M</div></div>
        <div class="kpi-card"><div class="kpi-label">Latest Report</div><div class="kpi-value">${data.history?.length ? data.history[data.history.length - 1].date : '—'}</div><div class="kpi-delta">${data.history?.length || 0} observations</div></div>
        <div class="kpi-card"><div class="kpi-label">Largest Port</div><div class="kpi-value">${topPortName(ports)}</div><div class="kpi-delta">${fmtInt(topPortValue(ports))} ${unit}</div></div>
        ${daysConsumption != null ? `<div class="kpi-card"><div class="kpi-label">Days of Consumption</div><div class="kpi-value">${daysConsumption} days</div><div class="kpi-delta">Arabica only proxy</div></div>` : `<div class="kpi-card"><div class="kpi-label">Unit View</div><div class="kpi-value">${convert ? 'Bags eq.' : 'Tonnes'}</div><div class="kpi-delta">Robusta stocks</div></div>`}
    `;

    renderPhysicalDeskRead(market, change, changePct, current, unit);
    drawPhysicalHistory(market, data.history || [], showPrice, horizon, factor, unit);
    drawPhysicalPorts(ports, factor, unit);
    renderPhysicalWatchlist(market);
}

function topPortName(ports) {
    const entries = Object.entries(ports || {}).sort((a, b) => b[1] - a[1]);
    return entries.length ? entries[0][0] : '—';
}

function topPortValue(ports) {
    const entries = Object.entries(ports || {}).sort((a, b) => b[1] - a[1]);
    return entries.length ? entries[0][1] : 0;
}

function renderPhysicalDeskRead(market, change, changePct, current, unit) {
    const cls = change < 0 ? 'alert-warning' : 'alert-ok';
    const direction = change < 0 ? 'drawn down' : 'built';
    const implication = change < 0
        ? 'tightens visible exchange availability and can support nearby spreads if demand is confirmed.'
        : 'adds visible buffer and can soften nearby tightness unless certified quality/location is constrained.';
    document.getElementById('physical-read').innerHTML = `<div class="alert ${cls}"><b>Key insight:</b> ${market} certified stocks ${direction} by ${fmtInt(Math.abs(change))} ${unit} (${changePct.toFixed(1)}%) over the last month. This ${implication}</div>`;
}

function drawPhysicalHistory(market, history, showPrice, horizon, factor, unit) {
    if (!history.length) return;
    let filtered = history;
    if (horizon && horizon !== 'MAX') {
        const cutoff = getCutoffDate(horizon);
        filtered = history.filter(d => d.date >= cutoff);
        if (!filtered.length) filtered = history;
    }
    const color = market === 'Robusta' ? COLORS.blue : COLORS.accent;
    const traces = [{
        x: filtered.map(d => d.date), y: filtered.map(d => d.value * factor),
        name: `${market} Stocks`, line: { color, width: 2 },
        fill: 'tozeroy', fillcolor: market === 'Robusta' ? 'rgba(69,123,157,0.06)' : 'rgba(0,212,170,0.06)',
    }];
    const layout = { height: 390, yaxis: { title: unit } };
    const priceSeries = market === 'Robusta' ? DATA.futures?.rc?.history : DATA.futures?.kc?.history;
    if (showPrice && priceSeries?.length) {
        const cutoff = filtered[0].date;
        const px = priceSeries.filter(d => d.date >= cutoff);
        traces.push({
            x: px.map(d => d.date), y: px.map(d => d.value), yaxis: 'y2',
            name: market === 'Robusta' ? 'RC Futures ($/t)' : 'KC Futures (¢/lb)',
            line: { color: COLORS.orange, width: 1.5, dash: 'dot' },
        });
        layout.yaxis2 = { title: market === 'Robusta' ? '$/t' : '¢/lb', overlaying: 'y', side: 'right', showgrid: false, color: COLORS.orange };
    }
    Plotly.react('chart-physical-history', traces, mergeLayout(layout), PLOTLY_CONFIG);
}

function drawPhysicalPorts(ports, factor, unit) {
    const portData = ports || {};
    const portNames = Object.keys(portData).sort((a, b) => portData[b] - portData[a]);
    if (!portNames.length) {
        document.getElementById('chart-physical-ports').innerHTML = '<div style="padding:2rem;color:var(--text-muted);text-align:center;">No port breakdown available.</div>';
        return;
    }
    Plotly.react('chart-physical-ports', [{
        y: portNames, x: portNames.map(p => portData[p] * factor),
        type: 'bar', orientation: 'h', marker: { color: COLORS.accent },
        text: portNames.map(p => fmtInt(portData[p] * factor)), textposition: 'auto', textfont: { size: 10 },
    }], mergeLayout({ height: 360, margin: { l: 145 }, xaxis: { title: unit } }), PLOTLY_CONFIG);
}

function renderPhysicalWatchlist(market) {
    const isRobusta = market === 'Robusta';
    const rows = isRobusta ? [
        ['Vietnam flow', 'Watch certified drawdowns against Vietnam export pace and RC structure.'],
        ['Port concentration', 'Large London/Antwerp concentration can make headline stocks less fungible.'],
        ['Unit conversion', 'Use bags equivalent only for intuition; ICE Robusta stocks are reported in tonnes.'],
    ] : [
        ['Tenderable quality', 'Certified bags are exchange-grade; location and age matter for deliverability.'],
        ['Spread confirmation', 'Drawdowns matter more when KC calendar spreads tighten at the same time.'],
        ['Brazil flow', 'Compare certified changes with BRL/USD and CEPEA for replacement incentives.'],
    ];
    document.getElementById('physical-watchlist').innerHTML = rows.map(([k, v]) => `<div style="margin-bottom:0.55rem;"><b style="color:var(--text-primary);">${k}</b><br><span style="color:var(--text-muted);font-size:0.75rem;">${v}</span></div>`).join('');
}


// ═══════════════════════════════════════════════════════════════════════════
// WEATHER TAB// WEATHER TAB
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
    document.getElementById('pos-signal').innerHTML = `<div class="alert ${cls}"><b>Key insight:</b> ${msg}</div>`;
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
        <table class="data-table"><thead><tr><th>Date</th><th>MM Net</th><th>MM WoW</th><th>Commercial WoW</th><th>Open Interest</th></tr></thead><tbody>
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
