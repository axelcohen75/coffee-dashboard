/**
 * Coffee Futures Options Pricer — Black-76 Model
 * Pure client-side module for pricing commodity options on coffee futures.
 * Uses Plotly.js for charts. Depends on COLORS, PLOTLY_LAYOUT, PLOTLY_CONFIG,
 * mergeLayout() from coffee-data.js.
 */

/* ═══════════════════════════════════════════════════════════════════════════
   MATH UTILITIES
   ═══════════════════════════════════════════════════════════════════════════ */

/** Normal CDF — Abramowitz & Stegun approximation (eqn 26.2.17), |err| < 7.5e-8 */
function _normCDF(x) {
    if (x > 8) return 1;
    if (x < -8) return 0;
    const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
    const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
    const sign = x < 0 ? -1 : 1;
    const z = Math.abs(x);
    const t = 1.0 / (1.0 + p * z);
    const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-z * z / 2);
    return 0.5 * (1.0 + sign * y);
}

/** Normal PDF */
function _normPDF(x) {
    return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

/* ═══════════════════════════════════════════════════════════════════════════
   BLACK-76 MODEL
   ═══════════════════════════════════════════════════════════════════════════ */

function _black76D1D2(F, K, T, sigma) {
    if (T <= 0 || sigma <= 0 || F <= 0 || K <= 0) return { d1: 0, d2: 0 };
    const sqrtT = Math.sqrt(T);
    const d1 = (Math.log(F / K) + 0.5 * sigma * sigma * T) / (sigma * sqrtT);
    const d2 = d1 - sigma * sqrtT;
    return { d1, d2 };
}

function black76Price(type, F, K, T, sigma, r) {
    if (T <= 1e-10) {
        const intrinsic = type === 'call'
            ? Math.max(F - K, 0)
            : Math.max(K - F, 0);
        return intrinsic * Math.exp(-r * T);
    }
    const { d1, d2 } = _black76D1D2(F, K, T, sigma);
    const df = Math.exp(-r * T);
    if (type === 'call') {
        return df * (F * _normCDF(d1) - K * _normCDF(d2));
    } else {
        return df * (K * _normCDF(-d2) - F * _normCDF(-d1));
    }
}

/* ═══════════════════════════════════════════════════════════════════════════
   GREEKS
   ═══════════════════════════════════════════════════════════════════════════ */

function black76Greeks(type, F, K, T, sigma, r) {
    const price = black76Price(type, F, K, T, sigma, r);
    if (T <= 1e-10) {
        const itm = type === 'call' ? (F > K ? 1 : 0) : (F < K ? -1 : 0);
        return { price, delta: itm, gamma: 0, vega: 0, theta: 0, rho: 0, vanna: 0, volga: 0 };
    }
    const { d1, d2 } = _black76D1D2(F, K, T, sigma);
    const df = Math.exp(-r * T);
    const sqrtT = Math.sqrt(T);
    const nd1 = _normPDF(d1);

    // Delta
    let delta = type === 'call'
        ? df * _normCDF(d1)
        : -df * _normCDF(-d1);

    // Gamma
    const gamma = df * nd1 / (F * sigma * sqrtT);

    // Vega (per 1% move = /100 internally, but we return per unit sigma)
    const vega = F * df * nd1 * sqrtT;

    // Theta (per year; divide by 365 for daily)
    let theta;
    if (type === 'call') {
        theta = -(F * df * nd1 * sigma) / (2 * sqrtT)
            + r * df * (F * _normCDF(d1) - K * _normCDF(d2));
        theta = -theta; // convention: passage of time => negative for long
    } else {
        theta = -(F * df * nd1 * sigma) / (2 * sqrtT)
            - r * df * (K * _normCDF(-d2) - F * _normCDF(-d1));
        theta = -theta;
    }
    // Correct sign: theta = dV/dT, but convention is dV/d(passage) = -dV/dT
    // We want theta negative for long options (time decay hurts)
    theta = -(F * df * nd1 * sigma) / (2 * sqrtT);
    if (type === 'call') {
        theta += -r * df * K * _normCDF(d2);
        theta += r * df * F * _normCDF(d1); // net from discounting
        // Simplified: just recalc properly
    }
    // Use clean formula
    const timeDecay = -(F * df * nd1 * sigma) / (2 * sqrtT);
    if (type === 'call') {
        theta = timeDecay - r * K * df * _normCDF(d2) + r * F * df * _normCDF(d1);
    } else {
        theta = timeDecay + r * K * df * _normCDF(-d2) - r * F * df * _normCDF(-d1);
    }
    // Convention: negate so theta is negative for long options
    theta = -Math.abs(theta) * (price > 0 ? 1 : 0);
    // Actually use textbook: theta = dV/dt (per year, t going forward)
    // For call: theta = -F*df*n(d1)*sig/(2*sqrt(T)) + r*call_price  ... but let's just do finite diff
    const dT = 1e-5;
    theta = -(black76Price(type, F, K, T, sigma, r) - black76Price(type, F, K, T - dT > 0 ? T - dT : 0, sigma, r)) / dT;

    // Rho
    const rho = -T * price;

    // Vanna = d(delta)/d(sigma) = d(vega)/d(F)
    const vanna = -df * nd1 * d2 / sigma;

    // Volga (Vomma) = d(vega)/d(sigma)
    const volga = vega * d1 * d2 / sigma;

    return { price, delta, gamma, vega, theta, rho, vanna, volga };
}

/* ═══════════════════════════════════════════════════════════════════════════
   FORWARD CURVE
   ═══════════════════════════════════════════════════════════════════════════ */

function forwardPrice(S, r, y, c, T) {
    return S * Math.exp((r - y + c) * T);
}

/* ═══════════════════════════════════════════════════════════════════════════
   OPTIONS STATE
   ═══════════════════════════════════════════════════════════════════════════ */

const OPT = {
    // Parameters
    futuresPrice: 265,
    spot: 265,
    convYield: 0.03,
    storageCost: 0.02,
    fundingRate: 0.05,
    expiry: 0.5,
    vol: 0.35,
    rate: 0.05,
    spotMin: 50,
    spotMax: 450,

    // Portfolio legs: [{type:'call'|'put', position:'long'|'short', strike:number, qty:number}]
    legs: [],

    // Active metric for greeks chart
    activeMetric: 'delta',

    // 3D surface axes
    surface3dGreek: 'delta',
    surface3dParam: 'vol',

    // Sweep
    sweepParam: 'vol',
    sweepMin: 0.10,
    sweepMax: 0.80,
    sweepSteps: 20,
};

/* ═══════════════════════════════════════════════════════════════════════════
   STRATEGIES
   ═══════════════════════════════════════════════════════════════════════════ */

const STRATEGIES = {
    'Straddle': (K) => [
        { type: 'call', position: 'long', strike: K, qty: 1 },
        { type: 'put', position: 'long', strike: K, qty: 1 },
    ],
    'Strangle': (K) => [
        { type: 'call', position: 'long', strike: K * 1.05, qty: 1 },
        { type: 'put', position: 'long', strike: K * 0.95, qty: 1 },
    ],
    'Bull Spread': (K) => [
        { type: 'call', position: 'long', strike: K * 0.95, qty: 1 },
        { type: 'call', position: 'short', strike: K * 1.05, qty: 1 },
    ],
    'Bear Spread': (K) => [
        { type: 'put', position: 'long', strike: K * 1.05, qty: 1 },
        { type: 'put', position: 'short', strike: K * 0.95, qty: 1 },
    ],
    'Butterfly': (K) => [
        { type: 'call', position: 'long', strike: K * 0.92, qty: 1 },
        { type: 'call', position: 'short', strike: K, qty: 2 },
        { type: 'call', position: 'long', strike: K * 1.08, qty: 1 },
    ],
    'Collar': (K) => [
        { type: 'put', position: 'long', strike: K * 0.95, qty: 1 },
        { type: 'call', position: 'short', strike: K * 1.05, qty: 1 },
    ],
    'Risk Reversal': (K) => [
        { type: 'call', position: 'long', strike: K * 1.05, qty: 1 },
        { type: 'put', position: 'short', strike: K * 0.95, qty: 1 },
    ],
};

/* ═══════════════════════════════════════════════════════════════════════════
   PORTFOLIO CALCULATIONS
   ═══════════════════════════════════════════════════════════════════════════ */

function _legSign(pos) { return pos === 'long' ? 1 : -1; }

function portfolioPayoff(legs, spotArr) {
    return spotArr.map(s => {
        let total = 0;
        for (const leg of legs) {
            const sign = _legSign(leg.position);
            const intrinsic = leg.type === 'call'
                ? Math.max(s - leg.strike, 0)
                : Math.max(leg.strike - s, 0);
            const premium = black76Price(leg.type, OPT.futuresPrice, leg.strike, OPT.expiry, OPT.vol, OPT.rate);
            total += sign * leg.qty * (intrinsic - premium);
        }
        return total;
    });
}

function portfolioGreek(legs, spotArr, metric) {
    return spotArr.map(s => {
        let total = 0;
        for (const leg of legs) {
            const sign = _legSign(leg.position);
            const greeks = black76Greeks(leg.type, s, leg.strike, OPT.expiry, OPT.vol, OPT.rate);
            let val = greeks[metric] || 0;
            // Vega: scale to per 1% move for display
            if (metric === 'vega') val *= 0.01;
            total += sign * leg.qty * val;
        }
        return total;
    });
}

function portfolioValue(legs, F, T) {
    let total = 0;
    for (const leg of legs) {
        const sign = _legSign(leg.position);
        total += sign * leg.qty * black76Price(leg.type, F, leg.strike, T, OPT.vol, OPT.rate);
    }
    return total;
}

/* ═══════════════════════════════════════════════════════════════════════════
   UI RENDERING
   ═══════════════════════════════════════════════════════════════════════════ */

function renderOptions() {
    const container = document.getElementById('tab-options');
    if (!container) return;
    container.dataset.rendered = '1';

    container.innerHTML = `
    <div class="opt-layout">
        <!-- LEFT SIDEBAR -->
        <div class="opt-sidebar-left">
            <!-- Forward Curve -->
            <div class="opt-panel">
                <div class="opt-panel-title">FORWARD CURVE</div>
                <div class="opt-fwd-display" id="opt-fwd-display">F = 265.00 c/lb</div>
                <label class="opt-label">Spot Price S (c/lb)
                    <input type="range" id="opt-spot" min="50" max="500" step="1" value="${OPT.spot}" class="opt-slider">
                    <span class="opt-val" id="opt-spot-val">${OPT.spot}</span>
                </label>
                <label class="opt-label">Convenience Yield y
                    <input type="range" id="opt-cy" min="0" max="0.20" step="0.005" value="${OPT.convYield}" class="opt-slider">
                    <span class="opt-val" id="opt-cy-val">${(OPT.convYield * 100).toFixed(1)}%</span>
                </label>
                <label class="opt-label">Storage Cost c
                    <input type="range" id="opt-sc" min="0" max="0.15" step="0.005" value="${OPT.storageCost}" class="opt-slider">
                    <span class="opt-val" id="opt-sc-val">${(OPT.storageCost * 100).toFixed(1)}%</span>
                </label>
                <label class="opt-label">Funding Rate r
                    <input type="range" id="opt-fr" min="0" max="0.15" step="0.005" value="${OPT.fundingRate}" class="opt-slider">
                    <span class="opt-val" id="opt-fr-val">${(OPT.fundingRate * 100).toFixed(1)}%</span>
                </label>
            </div>

            <!-- Strategy Presets -->
            <div class="opt-panel">
                <div class="opt-panel-title">OPTION STRATEGIES</div>
                <select id="opt-strategy" class="opt-select">
                    <option value="">-- Select Strategy --</option>
                    ${Object.keys(STRATEGIES).map(s => `<option value="${s}">${s}</option>`).join('')}
                </select>
                <button class="opt-btn" onclick="optApplyStrategy()">Apply</button>
            </div>

            <!-- New Position -->
            <div class="opt-panel">
                <div class="opt-panel-title">NEW POSITION</div>
                <div class="opt-form-row">
                    <label class="opt-label-sm">Type
                        <select id="opt-new-type" class="opt-select-sm">
                            <option value="call">Call</option>
                            <option value="put">Put</option>
                        </select>
                    </label>
                    <label class="opt-label-sm">Position
                        <select id="opt-new-pos" class="opt-select-sm">
                            <option value="long">Long</option>
                            <option value="short">Short</option>
                        </select>
                    </label>
                </div>
                <div class="opt-form-row">
                    <label class="opt-label-sm">Strike K
                        <input type="number" id="opt-new-strike" value="${OPT.futuresPrice}" step="5" class="opt-input-sm">
                    </label>
                    <label class="opt-label-sm">Qty
                        <input type="number" id="opt-new-qty" value="1" min="1" step="1" class="opt-input-sm">
                    </label>
                </div>
                <div class="opt-form-row">
                    <button class="opt-btn opt-btn-accent" onclick="optAddLeg()">Add Leg</button>
                    <button class="opt-btn opt-btn-muted" onclick="optClearLegs()">Clear All</button>
                </div>
            </div>

            <!-- Portfolio Legs -->
            <div class="opt-panel">
                <div class="opt-panel-title">PORTFOLIO LEGS <span class="opt-badge" id="opt-leg-count">0</span></div>
                <div id="opt-legs-list" class="opt-legs-list">
                    <div class="opt-empty">No positions. Add a leg or apply a strategy.</div>
                </div>
            </div>
        </div>

        <!-- MAIN CHARTS -->
        <div class="opt-main">
            <div class="opt-chart-grid">
                <div class="opt-chart-card">
                    <div class="opt-chart-title">PAYOFF DIAGRAM</div>
                    <div id="opt-chart-payoff" class="opt-chart"></div>
                </div>
                <div class="opt-chart-card">
                    <div class="opt-chart-title">GREEKS ANALYTICS — <span id="opt-greek-label" class="opt-accent">DELTA</span></div>
                    <div id="opt-chart-greeks" class="opt-chart"></div>
                </div>
                <div class="opt-chart-card">
                    <div class="opt-chart-title">3D GREEK SURFACE — <span id="opt-3d-label" class="opt-accent">DELTA</span></div>
                    <div id="opt-chart-3d" class="opt-chart opt-chart-tall"></div>
                </div>
                <div class="opt-chart-card">
                    <div class="opt-chart-title">THETA DECAY</div>
                    <div id="opt-chart-theta" class="opt-chart"></div>
                </div>
            </div>
        </div>

        <!-- RIGHT SIDEBAR -->
        <div class="opt-sidebar-right">
            <!-- Parameters -->
            <div class="opt-panel">
                <div class="opt-panel-title">PARAMETERS</div>
                <label class="opt-label">Futures Price F (c/lb)
                    <input type="range" id="opt-F" min="50" max="500" step="1" value="${OPT.futuresPrice}" class="opt-slider">
                    <span class="opt-val" id="opt-F-val">${OPT.futuresPrice}</span>
                </label>
                <label class="opt-label">Expiry T (years)
                    <input type="range" id="opt-T" min="0.01" max="3" step="0.01" value="${OPT.expiry}" class="opt-slider">
                    <span class="opt-val" id="opt-T-val">${OPT.expiry}</span>
                </label>
                <label class="opt-label">Volatility σ (%)
                    <input type="range" id="opt-vol" min="5" max="120" step="1" value="${OPT.vol * 100}" class="opt-slider">
                    <span class="opt-val" id="opt-vol-val">${(OPT.vol * 100).toFixed(0)}%</span>
                </label>
                <label class="opt-label">Rate r (%)
                    <input type="range" id="opt-r" min="0" max="15" step="0.25" value="${OPT.rate * 100}" class="opt-slider">
                    <span class="opt-val" id="opt-r-val">${(OPT.rate * 100).toFixed(1)}%</span>
                </label>
                <label class="opt-label">Spot Min
                    <input type="number" id="opt-smin" value="${OPT.spotMin}" step="10" class="opt-input-sm" style="width:100%">
                </label>
                <label class="opt-label">Spot Max
                    <input type="number" id="opt-smax" value="${OPT.spotMax}" step="10" class="opt-input-sm" style="width:100%">
                </label>
            </div>

            <!-- Parameter Sweep -->
            <div class="opt-panel">
                <div class="opt-panel-title">PARAMETER SWEEP</div>
                <label class="opt-label">Sweep Variable
                    <select id="opt-sweep-param" class="opt-select">
                        <option value="vol">Volatility</option>
                        <option value="expiry">Time to Expiry</option>
                        <option value="rate">Interest Rate</option>
                    </select>
                </label>
                <div class="opt-form-row">
                    <label class="opt-label-sm">Min <input type="number" id="opt-sweep-min" value="0.10" step="0.05" class="opt-input-sm"></label>
                    <label class="opt-label-sm">Max <input type="number" id="opt-sweep-max" value="0.80" step="0.05" class="opt-input-sm"></label>
                </div>
                <label class="opt-label">Steps
                    <input type="range" id="opt-sweep-steps" min="5" max="50" step="1" value="20" class="opt-slider">
                    <span class="opt-val" id="opt-sweep-steps-val">20</span>
                </label>
                <button class="opt-btn opt-btn-accent" onclick="optRunSweep()">Run Sweep</button>
            </div>

            <!-- Active Metrics -->
            <div class="opt-panel">
                <div class="opt-panel-title">ACTIVE METRICS</div>
                <div class="opt-metrics-list">
                    ${['payoff','price','delta','gamma','vega','theta','rho','vanna','volga'].map(m =>
                        `<button class="opt-metric-btn ${m === 'delta' ? 'active' : ''}" data-metric="${m}" onclick="optSetMetric('${m}')">${m.charAt(0).toUpperCase() + m.slice(1)}</button>`
                    ).join('')}
                </div>
            </div>

            <!-- 3D Surface Config -->
            <div class="opt-panel">
                <div class="opt-panel-title">3D SURFACE CONFIG</div>
                <label class="opt-label">Greek
                    <select id="opt-3d-greek" class="opt-select" onchange="optUpdate3DConfig()">
                        ${['delta','gamma','vega','theta','rho','vanna','volga'].map(g =>
                            `<option value="${g}" ${g === 'delta' ? 'selected' : ''}>${g.charAt(0).toUpperCase() + g.slice(1)}</option>`
                        ).join('')}
                    </select>
                </label>
                <label class="opt-label">2nd Axis
                    <select id="opt-3d-param" class="opt-select" onchange="optUpdate3DConfig()">
                        <option value="vol" selected>Volatility</option>
                        <option value="expiry">Time to Expiry</option>
                        <option value="rate">Interest Rate</option>
                    </select>
                </label>
            </div>
        </div>
    </div>
    `;

    _injectOptionsCSS();
    _bindSliders();

    // Set default straddle to show something
    OPT.legs = STRATEGIES['Straddle'](OPT.futuresPrice);
    _renderLegs();
    optUpdateCharts();
}

/* ═══════════════════════════════════════════════════════════════════════════
   CSS INJECTION (scoped to .opt-*)
   ═══════════════════════════════════════════════════════════════════════════ */

function _injectOptionsCSS() {
    if (document.getElementById('opt-styles')) return;
    const style = document.createElement('style');
    style.id = 'opt-styles';
    style.textContent = `
    .opt-layout {
        display: grid;
        grid-template-columns: 260px 1fr 240px;
        gap: 12px;
        padding: 12px;
        min-height: calc(100vh - 60px);
    }
    .opt-sidebar-left, .opt-sidebar-right {
        display: flex;
        flex-direction: column;
        gap: 10px;
        overflow-y: auto;
        max-height: calc(100vh - 70px);
    }
    .opt-panel {
        background: var(--bg-card);
        border: 1px solid var(--border);
        border-radius: 6px;
        padding: 12px;
    }
    .opt-panel-title {
        font-family: var(--font-mono);
        font-size: 0.65rem;
        font-weight: 700;
        color: var(--text-secondary);
        letter-spacing: 1.5px;
        margin-bottom: 10px;
        text-transform: uppercase;
    }
    .opt-fwd-display {
        font-family: var(--font-mono);
        font-size: 1.3rem;
        font-weight: 800;
        color: var(--accent);
        text-align: center;
        padding: 10px 0;
        margin-bottom: 10px;
        border: 1px solid var(--accent);
        border-radius: 4px;
        background: rgba(0,212,170,0.06);
        letter-spacing: 1px;
    }
    .opt-label {
        display: block;
        font-size: 0.7rem;
        color: var(--text-secondary);
        margin-bottom: 8px;
        font-weight: 600;
    }
    .opt-label-sm {
        display: block;
        font-size: 0.65rem;
        color: var(--text-secondary);
        font-weight: 600;
        flex: 1;
    }
    .opt-slider {
        width: 100%;
        margin: 4px 0 2px;
        -webkit-appearance: none;
        appearance: none;
        height: 4px;
        background: var(--border);
        border-radius: 2px;
        outline: none;
    }
    .opt-slider::-webkit-slider-thumb {
        -webkit-appearance: none;
        width: 14px; height: 14px;
        border-radius: 50%;
        background: var(--accent);
        cursor: pointer;
        border: 2px solid var(--bg-card);
    }
    .opt-slider::-moz-range-thumb {
        width: 14px; height: 14px;
        border-radius: 50%;
        background: var(--accent);
        cursor: pointer;
        border: 2px solid var(--bg-card);
    }
    .opt-val {
        font-family: var(--font-mono);
        font-size: 0.7rem;
        color: var(--accent);
        float: right;
        margin-top: -16px;
    }
    .opt-select, .opt-select-sm {
        width: 100%;
        background: var(--bg-primary);
        border: 1px solid var(--border);
        color: var(--text-primary);
        padding: 5px 8px;
        border-radius: 4px;
        font-size: 0.72rem;
        font-family: var(--font-sans);
        margin-bottom: 6px;
    }
    .opt-select-sm { font-size: 0.68rem; }
    .opt-input-sm {
        width: 100%;
        background: var(--bg-primary);
        border: 1px solid var(--border);
        color: var(--text-primary);
        padding: 4px 6px;
        border-radius: 4px;
        font-size: 0.72rem;
        font-family: var(--font-mono);
        margin-top: 3px;
    }
    .opt-form-row {
        display: flex;
        gap: 8px;
        margin-bottom: 8px;
    }
    .opt-btn {
        padding: 5px 12px;
        border: 1px solid var(--border);
        border-radius: 4px;
        background: var(--bg-primary);
        color: var(--text-secondary);
        font-size: 0.68rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.15s;
        flex: 1;
    }
    .opt-btn:hover { border-color: var(--accent); color: var(--accent); }
    .opt-btn-accent {
        border-color: var(--accent);
        color: var(--accent);
        background: rgba(0,212,170,0.08);
    }
    .opt-btn-accent:hover { background: rgba(0,212,170,0.18); }
    .opt-btn-muted { color: var(--text-muted); }
    .opt-btn-muted:hover { color: var(--red); border-color: var(--red); }
    .opt-badge {
        background: var(--accent);
        color: var(--bg-primary);
        font-size: 0.6rem;
        padding: 1px 6px;
        border-radius: 8px;
        font-weight: 700;
        margin-left: 4px;
    }
    .opt-legs-list {
        max-height: 200px;
        overflow-y: auto;
    }
    .opt-leg-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 5px 8px;
        margin-bottom: 3px;
        background: var(--bg-primary);
        border-radius: 4px;
        border: 1px solid var(--border);
        font-size: 0.68rem;
        font-family: var(--font-mono);
    }
    .opt-leg-long { border-left: 3px solid var(--accent); }
    .opt-leg-short { border-left: 3px solid var(--red); }
    .opt-leg-remove {
        background: none;
        border: none;
        color: var(--text-muted);
        cursor: pointer;
        font-size: 0.8rem;
        padding: 0 4px;
    }
    .opt-leg-remove:hover { color: var(--red); }
    .opt-empty {
        font-size: 0.68rem;
        color: var(--text-muted);
        text-align: center;
        padding: 12px 0;
        font-style: italic;
    }
    .opt-main {
        min-width: 0;
    }
    .opt-chart-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
    }
    .opt-chart-card {
        background: var(--bg-card);
        border: 1px solid var(--border);
        border-radius: 6px;
        padding: 8px 10px;
    }
    .opt-chart-title {
        font-family: var(--font-mono);
        font-size: 0.62rem;
        font-weight: 700;
        color: var(--text-secondary);
        letter-spacing: 1.2px;
        margin-bottom: 4px;
    }
    .opt-accent { color: var(--accent); }
    .opt-chart { height: 260px; }
    .opt-chart-tall { height: 260px; }
    .opt-metrics-list {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
    }
    .opt-metric-btn {
        padding: 3px 8px;
        border: 1px solid var(--border);
        border-radius: 3px;
        background: var(--bg-primary);
        color: var(--text-muted);
        font-size: 0.63rem;
        font-weight: 600;
        font-family: var(--font-mono);
        cursor: pointer;
        transition: all 0.15s;
    }
    .opt-metric-btn:hover { border-color: var(--accent); color: var(--text-secondary); }
    .opt-metric-btn.active {
        border-color: var(--accent);
        color: var(--accent);
        background: rgba(0,212,170,0.1);
    }
    @media (max-width: 1100px) {
        .opt-layout { grid-template-columns: 220px 1fr 200px; }
    }
    @media (max-width: 860px) {
        .opt-layout { grid-template-columns: 1fr; }
        .opt-chart-grid { grid-template-columns: 1fr; }
        .opt-sidebar-left, .opt-sidebar-right { max-height: none; }
    }
    `;
    document.head.appendChild(style);
}

/* ═══════════════════════════════════════════════════════════════════════════
   EVENT BINDING
   ═══════════════════════════════════════════════════════════════════════════ */

function _bindSliders() {
    // Forward curve sliders
    _bindSlider('opt-spot', 'opt-spot-val', v => {
        OPT.spot = +v;
        return v;
    });
    _bindSlider('opt-cy', 'opt-cy-val', v => {
        OPT.convYield = +v;
        return (v * 100).toFixed(1) + '%';
    });
    _bindSlider('opt-sc', 'opt-sc-val', v => {
        OPT.storageCost = +v;
        return (v * 100).toFixed(1) + '%';
    });
    _bindSlider('opt-fr', 'opt-fr-val', v => {
        OPT.fundingRate = +v;
        return (v * 100).toFixed(1) + '%';
    });

    // Parameter sliders
    _bindSlider('opt-F', 'opt-F-val', v => {
        OPT.futuresPrice = +v;
        return v;
    });
    _bindSlider('opt-T', 'opt-T-val', v => {
        OPT.expiry = +v;
        return v;
    });
    _bindSlider('opt-vol', 'opt-vol-val', v => {
        OPT.vol = v / 100;
        return v + '%';
    });
    _bindSlider('opt-r', 'opt-r-val', v => {
        OPT.rate = v / 100;
        return (+v).toFixed(1) + '%';
    });
    _bindSlider('opt-sweep-steps', 'opt-sweep-steps-val', v => v);

    // Spot range inputs
    const smin = document.getElementById('opt-smin');
    const smax = document.getElementById('opt-smax');
    if (smin) smin.addEventListener('change', () => { OPT.spotMin = +smin.value; optUpdateCharts(); });
    if (smax) smax.addEventListener('change', () => { OPT.spotMax = +smax.value; optUpdateCharts(); });
}

function _bindSlider(sliderId, valId, formatter) {
    const slider = document.getElementById(sliderId);
    const valEl = document.getElementById(valId);
    if (!slider) return;
    slider.addEventListener('input', () => {
        const display = formatter(slider.value);
        if (valEl) valEl.textContent = display;
        _updateForwardDisplay();
        optUpdateCharts();
    });
}

function _updateForwardDisplay() {
    const F = forwardPrice(OPT.spot, OPT.fundingRate, OPT.convYield, OPT.storageCost, OPT.expiry);
    const el = document.getElementById('opt-fwd-display');
    if (el) el.textContent = `F = ${F.toFixed(2)} c/lb`;
    // Optionally sync futures price
    OPT.futuresPrice = Math.round(F);
    const fSlider = document.getElementById('opt-F');
    const fVal = document.getElementById('opt-F-val');
    if (fSlider) fSlider.value = OPT.futuresPrice;
    if (fVal) fVal.textContent = OPT.futuresPrice;
}

/* ═══════════════════════════════════════════════════════════════════════════
   LEG MANAGEMENT
   ═══════════════════════════════════════════════════════════════════════════ */

function optAddLeg() {
    const type = document.getElementById('opt-new-type').value;
    const position = document.getElementById('opt-new-pos').value;
    const strike = +document.getElementById('opt-new-strike').value;
    const qty = +document.getElementById('opt-new-qty').value || 1;
    if (!strike || strike <= 0) return;
    OPT.legs.push({ type, position, strike, qty });
    _renderLegs();
    optUpdateCharts();
}

function optClearLegs() {
    OPT.legs = [];
    _renderLegs();
    optUpdateCharts();
}

function optApplyStrategy() {
    const sel = document.getElementById('opt-strategy');
    if (!sel || !sel.value) return;
    const fn = STRATEGIES[sel.value];
    if (!fn) return;
    OPT.legs = fn(OPT.futuresPrice);
    _renderLegs();
    optUpdateCharts();
}

function _removeLeg(idx) {
    OPT.legs.splice(idx, 1);
    _renderLegs();
    optUpdateCharts();
}

function _renderLegs() {
    const list = document.getElementById('opt-legs-list');
    const badge = document.getElementById('opt-leg-count');
    if (!list) return;
    if (badge) badge.textContent = OPT.legs.length;

    if (OPT.legs.length === 0) {
        list.innerHTML = '<div class="opt-empty">No positions. Add a leg or apply a strategy.</div>';
        return;
    }
    list.innerHTML = OPT.legs.map((leg, i) => {
        const cls = leg.position === 'long' ? 'opt-leg-long' : 'opt-leg-short';
        const sign = leg.position === 'long' ? '+' : '-';
        const color = leg.position === 'long' ? 'var(--accent)' : 'var(--red)';
        const premium = black76Price(leg.type, OPT.futuresPrice, leg.strike, OPT.expiry, OPT.vol, OPT.rate);
        return `<div class="opt-leg-item ${cls}">
            <span><span style="color:${color};font-weight:700">${sign}${leg.qty}</span> ${leg.type.toUpperCase()} K=${leg.strike.toFixed(0)}</span>
            <span style="color:var(--text-muted)">${premium.toFixed(2)}</span>
            <button class="opt-leg-remove" onclick="_removeLeg(${i})">x</button>
        </div>`;
    }).join('');
}
// Expose _removeLeg globally
window._removeLeg = _removeLeg;

/* ═══════════════════════════════════════════════════════════════════════════
   METRIC SELECTION
   ═══════════════════════════════════════════════════════════════════════════ */

function optSetMetric(metric) {
    OPT.activeMetric = metric;
    document.querySelectorAll('.opt-metric-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.metric === metric);
    });
    const label = document.getElementById('opt-greek-label');
    if (label) label.textContent = metric.toUpperCase();
    _drawGreeksChart();
}

function optUpdate3DConfig() {
    const gSel = document.getElementById('opt-3d-greek');
    const pSel = document.getElementById('opt-3d-param');
    if (gSel) OPT.surface3dGreek = gSel.value;
    if (pSel) OPT.surface3dParam = pSel.value;
    const label = document.getElementById('opt-3d-label');
    if (label) label.textContent = OPT.surface3dGreek.toUpperCase();
    _draw3DSurface();
}

/* ═══════════════════════════════════════════════════════════════════════════
   CHART RENDERING
   ═══════════════════════════════════════════════════════════════════════════ */

function optUpdateCharts() {
    _drawPayoffChart();
    _drawGreeksChart();
    _draw3DSurface();
    _drawThetaDecay();
}

function _spotArray(n) {
    n = n || 200;
    const arr = [];
    const step = (OPT.spotMax - OPT.spotMin) / (n - 1);
    for (let i = 0; i < n; i++) arr.push(OPT.spotMin + i * step);
    return arr;
}

/* ── Payoff Diagram ─────────────────────────────────────────────────────── */

function _drawPayoffChart() {
    const el = document.getElementById('opt-chart-payoff');
    if (!el) return;
    const spots = _spotArray(300);
    const traces = [];

    if (OPT.legs.length > 0) {
        // Portfolio payoff at expiry
        const payoff = portfolioPayoff(OPT.legs, spots);
        traces.push({
            x: spots, y: payoff,
            type: 'scatter', mode: 'lines',
            name: 'P&L at Expiry',
            line: { color: COLORS.accent, width: 2 },
            fill: 'tozeroy',
            fillcolor: 'rgba(0,212,170,0.08)',
        });

        // Current value (before expiry)
        const currentVal = spots.map(s => {
            let total = 0;
            for (const leg of OPT.legs) {
                const sign = _legSign(leg.position);
                const price = black76Price(leg.type, s, leg.strike, OPT.expiry, OPT.vol, OPT.rate);
                const entryPrice = black76Price(leg.type, OPT.futuresPrice, leg.strike, OPT.expiry, OPT.vol, OPT.rate);
                total += sign * leg.qty * (price - entryPrice);
            }
            return total;
        });
        traces.push({
            x: spots, y: currentVal,
            type: 'scatter', mode: 'lines',
            name: 'Current P&L',
            line: { color: COLORS.orange, width: 1.5, dash: 'dot' },
        });

        // Individual legs (thin lines)
        OPT.legs.forEach((leg, i) => {
            const legPayoff = spots.map(s => {
                const sign = _legSign(leg.position);
                const intrinsic = leg.type === 'call' ? Math.max(s - leg.strike, 0) : Math.max(leg.strike - s, 0);
                const premium = black76Price(leg.type, OPT.futuresPrice, leg.strike, OPT.expiry, OPT.vol, OPT.rate);
                return sign * leg.qty * (intrinsic - premium);
            });
            const colors = [COLORS.blue, COLORS.purple, COLORS.yellow, COLORS.red];
            traces.push({
                x: spots, y: legPayoff,
                type: 'scatter', mode: 'lines',
                name: `${leg.position === 'long' ? '+' : '-'}${leg.qty} ${leg.type.toUpperCase()} K=${leg.strike.toFixed(0)}`,
                line: { color: colors[i % colors.length], width: 1, dash: 'dash' },
                opacity: 0.6,
            });
        });
    }

    // Zero line
    traces.push({
        x: [OPT.spotMin, OPT.spotMax], y: [0, 0],
        type: 'scatter', mode: 'lines',
        name: '', showlegend: false,
        line: { color: COLORS.muted, width: 0.5, dash: 'dash' },
    });

    // Strike markers
    const strikes = [...new Set(OPT.legs.map(l => l.strike))];
    strikes.forEach(k => {
        traces.push({
            x: [k, k], y: [-1e6, 1e6],
            type: 'scatter', mode: 'lines',
            name: '', showlegend: false,
            line: { color: 'rgba(233,196,106,0.3)', width: 1, dash: 'dot' },
        });
    });

    const layout = mergeLayout({
        title: false,
        xaxis: { title: 'Underlying (c/lb)', range: [OPT.spotMin, OPT.spotMax] },
        yaxis: { title: 'P&L', zeroline: true, zerolinecolor: COLORS.muted },
        showlegend: true,
        legend: { orientation: 'h', y: 1.12, font: { size: 9 } },
        margin: { l: 50, r: 10, t: 10, b: 35 },
    });

    Plotly.react(el, traces, layout, PLOTLY_CONFIG);
}

/* ── Greeks Analytics ───────────────────────────────────────────────────── */

function _drawGreeksChart() {
    const el = document.getElementById('opt-chart-greeks');
    if (!el) return;
    const spots = _spotArray(200);
    const traces = [];
    const metric = OPT.activeMetric;

    if (metric === 'payoff') {
        // Show payoff instead of a greek
        if (OPT.legs.length > 0) {
            const payoff = portfolioPayoff(OPT.legs, spots);
            traces.push({
                x: spots, y: payoff,
                type: 'scatter', mode: 'lines',
                name: 'Payoff',
                line: { color: COLORS.accent, width: 2 },
            });
        }
    } else if (metric === 'price') {
        if (OPT.legs.length > 0) {
            const vals = spots.map(s => portfolioValue(OPT.legs, s, OPT.expiry));
            traces.push({
                x: spots, y: vals,
                type: 'scatter', mode: 'lines',
                name: 'Portfolio Value',
                line: { color: COLORS.accent, width: 2 },
            });
        }
    } else {
        if (OPT.legs.length > 0) {
            const vals = portfolioGreek(OPT.legs, spots, metric);
            traces.push({
                x: spots, y: vals,
                type: 'scatter', mode: 'lines',
                name: metric.charAt(0).toUpperCase() + metric.slice(1),
                line: { color: COLORS.accent, width: 2 },
                fill: 'tozeroy',
                fillcolor: 'rgba(0,212,170,0.06)',
            });
        }

        // Individual leg contributions
        if (OPT.legs.length > 1) {
            const colors = [COLORS.blue, COLORS.purple, COLORS.yellow, COLORS.red, COLORS.orange];
            OPT.legs.forEach((leg, i) => {
                const vals = spots.map(s => {
                    const g = black76Greeks(leg.type, s, leg.strike, OPT.expiry, OPT.vol, OPT.rate);
                    let v = g[metric] || 0;
                    if (metric === 'vega') v *= 0.01;
                    return _legSign(leg.position) * leg.qty * v;
                });
                traces.push({
                    x: spots, y: vals,
                    type: 'scatter', mode: 'lines',
                    name: `${leg.position === 'long' ? '+' : '-'}${leg.qty} ${leg.type.toUpperCase()} K=${leg.strike.toFixed(0)}`,
                    line: { color: colors[i % colors.length], width: 1, dash: 'dash' },
                    opacity: 0.6,
                });
            });
        }
    }

    const layout = mergeLayout({
        title: false,
        xaxis: { title: 'Underlying (c/lb)', range: [OPT.spotMin, OPT.spotMax] },
        yaxis: { title: metric.charAt(0).toUpperCase() + metric.slice(1), zeroline: true, zerolinecolor: COLORS.muted },
        showlegend: true,
        legend: { orientation: 'h', y: 1.12, font: { size: 9 } },
        margin: { l: 50, r: 10, t: 10, b: 35 },
    });

    Plotly.react(el, traces, layout, PLOTLY_CONFIG);
}

/* ── 3D Greek Surface ───────────────────────────────────────────────────── */

function _draw3DSurface() {
    const el = document.getElementById('opt-chart-3d');
    if (!el || OPT.legs.length === 0) {
        if (el) Plotly.react(el, [], mergeLayout({ margin: { l: 0, r: 0, t: 0, b: 0 } }), PLOTLY_CONFIG);
        return;
    }

    const greek = OPT.surface3dGreek;
    const param = OPT.surface3dParam;
    const nSpots = 40;
    const nParam = 30;
    const spots = _spotArray(nSpots);

    // Determine param range
    let paramMin, paramMax, paramLabel;
    if (param === 'vol') {
        paramMin = 0.05; paramMax = 1.0; paramLabel = 'Volatility';
    } else if (param === 'expiry') {
        paramMin = 0.02; paramMax = 2.0; paramLabel = 'Time (yrs)';
    } else {
        paramMin = 0.0; paramMax = 0.15; paramLabel = 'Rate';
    }

    const paramVals = [];
    for (let i = 0; i < nParam; i++) paramVals.push(paramMin + (paramMax - paramMin) * i / (nParam - 1));

    const z = [];
    for (let pi = 0; pi < nParam; pi++) {
        const row = [];
        for (let si = 0; si < nSpots; si++) {
            const s = spots[si];
            let total = 0;
            for (const leg of OPT.legs) {
                const sign = _legSign(leg.position);
                const vol = param === 'vol' ? paramVals[pi] : OPT.vol;
                const T = param === 'expiry' ? paramVals[pi] : OPT.expiry;
                const r = param === 'rate' ? paramVals[pi] : OPT.rate;
                const g = black76Greeks(leg.type, s, leg.strike, T, vol, r);
                let val = g[greek] || 0;
                if (greek === 'vega') val *= 0.01;
                total += sign * leg.qty * val;
            }
            row.push(total);
        }
        z.push(row);
    }

    const trace = {
        x: spots,
        y: paramVals.map(v => param === 'vol' || param === 'rate' ? (v * 100).toFixed(1) : v.toFixed(2)),
        z: z,
        type: 'surface',
        colorscale: [
            [0, COLORS.red],
            [0.25, COLORS.orange],
            [0.5, '#1e2a3a'],
            [0.75, COLORS.blue],
            [1, COLORS.accent],
        ],
        showscale: false,
        opacity: 0.92,
        contours: {
            z: { show: true, usecolormap: true, highlightcolor: '#fff', project: { z: false } },
        },
    };

    const layout = mergeLayout({
        title: false,
        scene: {
            xaxis: { title: 'Spot (c/lb)', color: '#8899aa', gridcolor: COLORS.grid, backgroundcolor: 'rgba(0,0,0,0)' },
            yaxis: { title: paramLabel, color: '#8899aa', gridcolor: COLORS.grid, backgroundcolor: 'rgba(0,0,0,0)' },
            zaxis: { title: greek.charAt(0).toUpperCase() + greek.slice(1), color: '#8899aa', gridcolor: COLORS.grid, backgroundcolor: 'rgba(0,0,0,0)' },
            bgcolor: 'rgba(0,0,0,0)',
            camera: { eye: { x: 1.6, y: -1.6, z: 0.9 } },
        },
        margin: { l: 0, r: 0, t: 0, b: 0 },
    });

    Plotly.react(el, [trace], layout, PLOTLY_CONFIG);
}

/* ── Theta Decay ────────────────────────────────────────────────────────── */

function _drawThetaDecay() {
    const el = document.getElementById('opt-chart-theta');
    if (!el) return;
    const traces = [];

    if (OPT.legs.length > 0) {
        const nPoints = 200;
        const maxT = OPT.expiry;
        const times = [];
        for (let i = 0; i < nPoints; i++) times.push(maxT * (1 - i / (nPoints - 1)) + 0.001);
        times.reverse(); // ascending order: near expiry first

        // Portfolio value over time at current futures price
        const vals = times.map(t => portfolioValue(OPT.legs, OPT.futuresPrice, t));

        // Days to expiry for x-axis
        const dte = times.map(t => t * 365);

        traces.push({
            x: dte, y: vals,
            type: 'scatter', mode: 'lines',
            name: `At F=${OPT.futuresPrice}`,
            line: { color: COLORS.accent, width: 2 },
        });

        // Also show at +/- 10% spot
        const offsets = [
            { pct: 0.90, color: COLORS.blue, label: '-10%' },
            { pct: 1.10, color: COLORS.orange, label: '+10%' },
        ];
        offsets.forEach(({ pct, color, label }) => {
            const shiftedF = Math.round(OPT.futuresPrice * pct);
            const v = times.map(t => portfolioValue(OPT.legs, shiftedF, t));
            traces.push({
                x: dte, y: v,
                type: 'scatter', mode: 'lines',
                name: `At F=${shiftedF} (${label})`,
                line: { color, width: 1.5, dash: 'dash' },
            });
        });
    }

    const layout = mergeLayout({
        title: false,
        xaxis: { title: 'Days to Expiry', autorange: 'reversed' },
        yaxis: { title: 'Portfolio Value', zeroline: true, zerolinecolor: COLORS.muted },
        showlegend: true,
        legend: { orientation: 'h', y: 1.12, font: { size: 9 } },
        margin: { l: 50, r: 10, t: 10, b: 35 },
    });

    Plotly.react(el, traces, layout, PLOTLY_CONFIG);
}

/* ═══════════════════════════════════════════════════════════════════════════
   PARAMETER SWEEP
   ═══════════════════════════════════════════════════════════════════════════ */

function optRunSweep() {
    if (OPT.legs.length === 0) return;

    const param = document.getElementById('opt-sweep-param').value;
    const sMin = +document.getElementById('opt-sweep-min').value;
    const sMax = +document.getElementById('opt-sweep-max').value;
    const steps = +document.getElementById('opt-sweep-steps').value || 20;

    const paramVals = [];
    for (let i = 0; i <= steps; i++) paramVals.push(sMin + (sMax - sMin) * i / steps);

    const spots = _spotArray(150);
    const el = document.getElementById('opt-chart-payoff');
    if (!el) return;

    const traces = [];
    const colorScale = paramVals.map((_, i) => {
        const t = i / (paramVals.length - 1);
        // Interpolate from blue to accent
        return `hsl(${160 + t * 20}, ${60 + t * 30}%, ${30 + t * 30}%)`;
    });

    paramVals.forEach((pv, i) => {
        const savedVol = OPT.vol;
        const savedT = OPT.expiry;
        const savedR = OPT.rate;
        if (param === 'vol') OPT.vol = pv;
        if (param === 'expiry') OPT.expiry = pv;
        if (param === 'rate') OPT.rate = pv;

        const payoff = portfolioPayoff(OPT.legs, spots);

        let label;
        if (param === 'vol') label = `σ=${(pv * 100).toFixed(0)}%`;
        else if (param === 'expiry') label = `T=${pv.toFixed(2)}y`;
        else label = `r=${(pv * 100).toFixed(1)}%`;

        traces.push({
            x: spots, y: payoff,
            type: 'scatter', mode: 'lines',
            name: label,
            line: { color: colorScale[i], width: 1.2 },
            opacity: 0.7,
        });

        OPT.vol = savedVol;
        OPT.expiry = savedT;
        OPT.rate = savedR;
    });

    // Zero line
    traces.push({
        x: [OPT.spotMin, OPT.spotMax], y: [0, 0],
        type: 'scatter', mode: 'lines',
        showlegend: false,
        line: { color: COLORS.muted, width: 0.5, dash: 'dash' },
    });

    const paramNames = { vol: 'Volatility', expiry: 'Time', rate: 'Rate' };
    const layout = mergeLayout({
        title: { text: `Parameter Sweep: ${paramNames[param]}`, font: { size: 11, color: COLORS.accent } },
        xaxis: { title: 'Underlying (c/lb)', range: [OPT.spotMin, OPT.spotMax] },
        yaxis: { title: 'P&L', zeroline: true, zerolinecolor: COLORS.muted },
        showlegend: true,
        legend: { orientation: 'v', x: 1.02, y: 1, font: { size: 8 } },
        margin: { l: 50, r: 80, t: 30, b: 35 },
    });

    Plotly.react(el, traces, layout, PLOTLY_CONFIG);
}

/* ═══════════════════════════════════════════════════════════════════════════
   EXPOSE GLOBALS
   ═══════════════════════════════════════════════════════════════════════════ */

window.renderOptions = renderOptions;
window.optAddLeg = optAddLeg;
window.optClearLegs = optClearLegs;
window.optApplyStrategy = optApplyStrategy;
window.optUpdateCharts = optUpdateCharts;
window.optSetMetric = optSetMetric;
window.optRunSweep = optRunSweep;
window.optUpdate3DConfig = optUpdate3DConfig;
