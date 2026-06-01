/**
 * Coffee Futures Options Pricer — Black-76 Model + Risk Management
 * Integrates with market-data.json for live prices and realized volatility.
 */

/* ═══════════════════════════════════════════════════════════════════════════
   MATH UTILITIES
   ═══════════════════════════════════════════════════════════════════════════ */

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

function _normPDF(x) {
    return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

function _normInv(p) {
    if (p <= 0) return -8;
    if (p >= 1) return 8;
    if (p === 0.5) return 0;
    const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
               1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
    const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
               6.680131188771972e+01, -1.328068155288572e+01];
    const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
               -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
    const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
    const pLow = 0.02425, pHigh = 1 - pLow;
    let q, r;
    if (p < pLow) {
        q = Math.sqrt(-2 * Math.log(p));
        return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
    } else if (p <= pHigh) {
        q = p - 0.5; r = q * q;
        return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q / (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
    } else {
        q = Math.sqrt(-2 * Math.log(1 - p));
        return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
    }
}

/* ═══════════════════════════════════════════════════════════════════════════
   BLACK-76 MODEL
   ═══════════════════════════════════════════════════════════════════════════ */

function black76Price(type, F, K, T, sigma, r) {
    if (T <= 1e-10) {
        const intrinsic = type === 'call' ? Math.max(F - K, 0) : Math.max(K - F, 0);
        return intrinsic * Math.exp(-r * T);
    }
    const sqrtT = Math.sqrt(T);
    const d1 = (Math.log(F / K) + 0.5 * sigma * sigma * T) / (sigma * sqrtT);
    const d2 = d1 - sigma * sqrtT;
    const df = Math.exp(-r * T);
    if (type === 'call') return df * (F * _normCDF(d1) - K * _normCDF(d2));
    return df * (K * _normCDF(-d2) - F * _normCDF(-d1));
}

function black76Greeks(type, F, K, T, sigma, r) {
    const price = black76Price(type, F, K, T, sigma, r);
    if (T <= 1e-10) {
        const itm = type === 'call' ? (F > K ? 1 : 0) : (F < K ? -1 : 0);
        return { price, delta: itm, gamma: 0, vega: 0, theta: 0, rho: 0, vanna: 0, volga: 0 };
    }
    const sqrtT = Math.sqrt(T);
    const d1 = (Math.log(F / K) + 0.5 * sigma * sigma * T) / (sigma * sqrtT);
    const d2 = d1 - sigma * sqrtT;
    const df = Math.exp(-r * T);
    const nd1 = _normPDF(d1);
    const delta = type === 'call' ? df * _normCDF(d1) : -df * _normCDF(-d1);
    const gamma = df * nd1 / (F * sigma * sqrtT);
    const vega = F * df * nd1 * sqrtT;
    const dT = 1e-5;
    const theta = -(black76Price(type, F, K, T, sigma, r) - black76Price(type, F, K, Math.max(T - dT, 0), sigma, r)) / dT;
    const rho = -T * price;
    const vanna = -df * nd1 * d2 / sigma;
    const volga = vega * d1 * d2 / sigma;
    return { price, delta, gamma, vega, theta, rho, vanna, volga };
}

/* ═══════════════════════════════════════════════════════════════════════════
   REALIZED VOLATILITY
   ═══════════════════════════════════════════════════════════════════════════ */

function computeRealizedVol(history, windowDays) {
    if (!history || history.length < windowDays + 1) return null;
    const recent = history.slice(-windowDays - 1);
    const logReturns = [];
    for (let i = 1; i < recent.length; i++) {
        if (recent[i].value > 0 && recent[i - 1].value > 0) {
            logReturns.push(Math.log(recent[i].value / recent[i - 1].value));
        }
    }
    if (logReturns.length < 10) return null;
    const mean = logReturns.reduce((s, v) => s + v, 0) / logReturns.length;
    const variance = logReturns.reduce((s, v) => s + (v - mean) ** 2, 0) / (logReturns.length - 1);
    return Math.sqrt(variance * 252);
}

/* ═══════════════════════════════════════════════════════════════════════════
   OPTIONS STATE
   ═══════════════════════════════════════════════════════════════════════════ */

const OPT = {
    underlying: 'kc',
    futuresPrice: 265,
    expiry: 0.5,
    vol: 0.35,
    rate: 0.05,
    spotMin: 50,
    spotMax: 450,
    realizedVol: { '20d': null, '60d': null, '120d': null },
    legs: [],
    activeMetric: 'delta',
    surface3dGreek: 'delta',
    surface3dParam: 'vol',
};

const STRATEGIES = {
    'Straddle': (K) => [
        { type: 'call', position: 'long', strike: K, qty: 1 },
        { type: 'put', position: 'long', strike: K, qty: 1 },
    ],
    'Strangle': (K) => [
        { type: 'call', position: 'long', strike: Math.round(K * 1.05), qty: 1 },
        { type: 'put', position: 'long', strike: Math.round(K * 0.95), qty: 1 },
    ],
    'Bull Call Spread': (K) => [
        { type: 'call', position: 'long', strike: Math.round(K * 0.95), qty: 1 },
        { type: 'call', position: 'short', strike: Math.round(K * 1.05), qty: 1 },
    ],
    'Bear Put Spread': (K) => [
        { type: 'put', position: 'long', strike: Math.round(K * 1.05), qty: 1 },
        { type: 'put', position: 'short', strike: Math.round(K * 0.95), qty: 1 },
    ],
    'Butterfly': (K) => [
        { type: 'call', position: 'long', strike: Math.round(K * 0.92), qty: 1 },
        { type: 'call', position: 'short', strike: K, qty: 2 },
        { type: 'call', position: 'long', strike: Math.round(K * 1.08), qty: 1 },
    ],
    'Collar': (K) => [
        { type: 'put', position: 'long', strike: Math.round(K * 0.95), qty: 1 },
        { type: 'call', position: 'short', strike: Math.round(K * 1.05), qty: 1 },
    ],
    'Risk Reversal': (K) => [
        { type: 'call', position: 'long', strike: Math.round(K * 1.05), qty: 1 },
        { type: 'put', position: 'short', strike: Math.round(K * 0.95), qty: 1 },
    ],
    'Iron Condor': (K) => [
        { type: 'put', position: 'long', strike: Math.round(K * 0.90), qty: 1 },
        { type: 'put', position: 'short', strike: Math.round(K * 0.95), qty: 1 },
        { type: 'call', position: 'short', strike: Math.round(K * 1.05), qty: 1 },
        { type: 'call', position: 'long', strike: Math.round(K * 1.10), qty: 1 },
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
            const intrinsic = leg.type === 'call' ? Math.max(s - leg.strike, 0) : Math.max(leg.strike - s, 0);
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

function portfolioTotalGreeks(legs) {
    const greeks = { delta: 0, gamma: 0, vega: 0, theta: 0, rho: 0 };
    for (const leg of legs) {
        const sign = _legSign(leg.position);
        const g = black76Greeks(leg.type, OPT.futuresPrice, leg.strike, OPT.expiry, OPT.vol, OPT.rate);
        greeks.delta += sign * leg.qty * g.delta;
        greeks.gamma += sign * leg.qty * g.gamma;
        greeks.vega += sign * leg.qty * g.vega * 0.01;
        greeks.theta += sign * leg.qty * g.theta / 365;
        greeks.rho += sign * leg.qty * g.rho;
    }
    return greeks;
}

/* ═══════════════════════════════════════════════════════════════════════════
   RISK MANAGEMENT — VaR & STRESS TESTS
   ═══════════════════════════════════════════════════════════════════════════ */

function _getHistoricalReturns() {
    if (!DATA) return [];
    const hist = OPT.underlying === 'kc' ? DATA.futures.kc.history : DATA.futures.rc.history;
    if (!hist || hist.length < 30) return [];
    const returns = [];
    for (let i = 1; i < hist.length; i++) {
        if (hist[i].value > 0 && hist[i - 1].value > 0) {
            returns.push(Math.log(hist[i].value / hist[i - 1].value));
        }
    }
    return returns;
}

function computeHistoricalVaR(confidence, horizon) {
    if (OPT.legs.length === 0) return { var1d: 0, varHorizon: 0 };
    const returns = _getHistoricalReturns();
    if (returns.length < 50) return { var1d: 0, varHorizon: 0 };

    const currentValue = portfolioValue(OPT.legs, OPT.futuresPrice, OPT.expiry);
    const pnls = returns.map(r => {
        const shiftedF = OPT.futuresPrice * Math.exp(r);
        return portfolioValue(OPT.legs, shiftedF, OPT.expiry) - currentValue;
    });
    pnls.sort((a, b) => a - b);
    const idx = Math.floor((1 - confidence) * pnls.length);
    const var1d = -pnls[Math.max(0, idx)];
    return { var1d, varHorizon: var1d * Math.sqrt(horizon) };
}

function computeParametricVaR(confidence, horizon) {
    if (OPT.legs.length === 0) return { var1d: 0, varHorizon: 0 };
    const greeks = portfolioTotalGreeks(OPT.legs);
    const dailyVol = OPT.vol / Math.sqrt(252);
    const z = _normInv(confidence);
    const linearVaR = Math.abs(greeks.delta) * OPT.futuresPrice * dailyVol * z;
    const gammaAdj = 0.5 * Math.abs(greeks.gamma) * (OPT.futuresPrice * dailyVol) ** 2;
    const var1d = linearVaR + gammaAdj;
    return { var1d, varHorizon: var1d * Math.sqrt(horizon) };
}

function computeMonteCarloVaR(confidence, horizon, nSims) {
    if (OPT.legs.length === 0) return { var1d: 0, varHorizon: 0, distribution: [] };
    nSims = nSims || 10000;
    const dailyVol = OPT.vol / Math.sqrt(252);
    const currentValue = portfolioValue(OPT.legs, OPT.futuresPrice, OPT.expiry);
    const pnls = [];
    for (let i = 0; i < nSims; i++) {
        let u1 = Math.random(), u2 = Math.random();
        const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        const shiftedF = OPT.futuresPrice * Math.exp(-0.5 * dailyVol * dailyVol + dailyVol * z);
        const newVal = portfolioValue(OPT.legs, shiftedF, OPT.expiry);
        pnls.push(newVal - currentValue);
    }
    pnls.sort((a, b) => a - b);
    const idx = Math.floor((1 - confidence) * nSims);
    const var1d = -pnls[Math.max(0, idx)];
    return { var1d, varHorizon: var1d * Math.sqrt(horizon), distribution: pnls };
}

function _getHistoricalPnls() {
    const returns = _getHistoricalReturns();
    if (returns.length < 50 || OPT.legs.length === 0) return [];
    const currentValue = portfolioValue(OPT.legs, OPT.futuresPrice, OPT.expiry);
    return returns.map(r => {
        const shiftedF = OPT.futuresPrice * Math.exp(r);
        return portfolioValue(OPT.legs, shiftedF, OPT.expiry) - currentValue;
    });
}

function computeCVaR(pnls, confidence) {
    if (!pnls || pnls.length === 0) return 0;
    const sorted = [...pnls].sort((a, b) => a - b);
    const cutoffIdx = Math.floor((1 - confidence) * sorted.length);
    if (cutoffIdx <= 0) return -sorted[0];
    const tail = sorted.slice(0, cutoffIdx);
    const cvar = -tail.reduce((s, v) => s + v, 0) / tail.length;
    return cvar;
}

function computeMaxDrawdown(nSims, nSteps) {
    if (OPT.legs.length === 0) return { maxDD: 0, avgDD: 0 };
    nSims = nSims || 2000;
    nSteps = nSteps || 20;
    const dailyVol = OPT.vol / Math.sqrt(252);
    const drawdowns = [];
    for (let i = 0; i < nSims; i++) {
        let peak = 0;
        let maxDD = 0;
        let cumPnl = 0;
        const currentValue = portfolioValue(OPT.legs, OPT.futuresPrice, OPT.expiry);
        for (let d = 0; d < nSteps; d++) {
            let u1 = Math.random(), u2 = Math.random();
            const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
            const ret = -0.5 * dailyVol * dailyVol + dailyVol * z;
            const newF = OPT.futuresPrice * Math.exp(ret * (d + 1));
            const newT = Math.max(0.001, OPT.expiry - (d + 1) / 365);
            cumPnl = portfolioValue(OPT.legs, newF, newT) - currentValue;
            if (cumPnl > peak) peak = cumPnl;
            const dd = peak - cumPnl;
            if (dd > maxDD) maxDD = dd;
        }
        drawdowns.push(maxDD);
    }
    drawdowns.sort((a, b) => a - b);
    const avgDD = drawdowns.reduce((s, v) => s + v, 0) / drawdowns.length;
    const pct95 = drawdowns[Math.floor(0.95 * drawdowns.length)];
    return { avgDD, pct95DD: pct95, maxDD: drawdowns[drawdowns.length - 1] };
}

function computeStressTests() {
    if (OPT.legs.length === 0) return [];
    const currentValue = portfolioValue(OPT.legs, OPT.futuresPrice, OPT.expiry);
    const scenarios = [
        { name: 'Crash -20%', priceShock: -0.20, volShock: 0.5, timeShock: 0 },
        { name: 'Sell-off -10%', priceShock: -0.10, volShock: 0.25, timeShock: 0 },
        { name: 'Dip -5%', priceShock: -0.05, volShock: 0.10, timeShock: 0 },
        { name: 'Rally +5%', priceShock: 0.05, volShock: -0.05, timeShock: 0 },
        { name: 'Rally +10%', priceShock: 0.10, volShock: -0.10, timeShock: 0 },
        { name: 'Rally +20%', priceShock: 0.20, volShock: -0.15, timeShock: 0 },
        { name: 'Vol Spike +50%', priceShock: 0, volShock: 0.50, timeShock: 0 },
        { name: 'Vol Crush -50%', priceShock: 0, volShock: -0.50, timeShock: 0 },
        { name: 'Frost Event', priceShock: 0.30, volShock: 0.80, timeShock: 0 },
        { name: '1 Week Decay', priceShock: 0, volShock: 0, timeShock: -7/365 },
        { name: '1 Month Decay', priceShock: 0, volShock: 0, timeShock: -30/365 },
        { name: 'Brazil Crisis', priceShock: 0.15, volShock: 0.40, timeShock: 0 },
    ];

    return scenarios.map(sc => {
        const newF = OPT.futuresPrice * (1 + sc.priceShock);
        const newVol = Math.max(0.05, OPT.vol * (1 + sc.volShock));
        const newT = Math.max(0.001, OPT.expiry + sc.timeShock);
        let stressedVal = 0;
        for (const leg of OPT.legs) {
            const sign = _legSign(leg.position);
            stressedVal += sign * leg.qty * black76Price(leg.type, newF, leg.strike, newT, newVol, OPT.rate);
        }
        return {
            name: sc.name,
            pricePct: (sc.priceShock * 100).toFixed(0),
            volPct: (sc.volShock * 100).toFixed(0),
            newValue: stressedVal,
            pnl: stressedVal - currentValue,
            pnlPct: currentValue !== 0 ? ((stressedVal - currentValue) / Math.abs(currentValue) * 100) : 0,
        };
    });
}

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN RENDER
   ═══════════════════════════════════════════════════════════════════════════ */

function renderOptions() {
    const container = document.getElementById('tab-options');
    if (!container) return;

    _initFromMarketData();

    const unit = OPT.underlying === 'kc' ? '¢/lb' : '$/t';
    const rv20 = OPT.realizedVol['20d'];
    const rv60 = OPT.realizedVol['60d'];
    const rv120 = OPT.realizedVol['120d'];

    container.innerHTML = `
    <div class="opt-layout">
        <!-- LEFT SIDEBAR -->
        <div class="opt-sidebar-left">
            <div class="opt-panel">
                <div class="opt-panel-title">UNDERLYING</div>
                <select id="opt-underlying" class="opt-select" onchange="optChangeUnderlying()">
                    <option value="kc" ${OPT.underlying === 'kc' ? 'selected' : ''}>KC Arabica (¢/lb)</option>
                    <option value="rc" ${OPT.underlying === 'rc' ? 'selected' : ''}>RC Robusta ($/t)</option>
                </select>
                <div class="opt-fwd-display" id="opt-fwd-display">F = ${OPT.futuresPrice.toFixed(2)} ${unit}</div>
                <div class="opt-rv-box">
                    <div class="opt-rv-title">REALIZED VOLATILITY</div>
                    <div class="opt-rv-row">
                        <span>20d:</span><span class="opt-rv-val">${rv20 ? (rv20 * 100).toFixed(1) + '%' : '—'}</span>
                        <span>60d:</span><span class="opt-rv-val">${rv60 ? (rv60 * 100).toFixed(1) + '%' : '—'}</span>
                        <span>120d:</span><span class="opt-rv-val">${rv120 ? (rv120 * 100).toFixed(1) + '%' : '—'}</span>
                    </div>
                    <button class="opt-btn opt-btn-sm" onclick="optUseRealizedVol()">Use 60d RV</button>
                </div>
            </div>

            <div class="opt-panel">
                <div class="opt-panel-title">PARAMETERS</div>
                <label class="opt-label"><span>Futures Price F (${unit})</span><span class="opt-val" id="opt-F-val">${OPT.futuresPrice.toFixed(0)}</span>
                    <input type="range" id="opt-F" min="${OPT.spotMin}" max="${OPT.spotMax}" step="1" value="${OPT.futuresPrice}" class="opt-slider">
                </label>
                <label class="opt-label"><span>Expiry T (years)</span><span class="opt-val" id="opt-T-val">${OPT.expiry}</span>
                    <input type="range" id="opt-T" min="0.01" max="3" step="0.01" value="${OPT.expiry}" class="opt-slider">
                </label>
                <label class="opt-label"><span>Volatility σ (%)</span><span class="opt-val" id="opt-vol-val">${(OPT.vol * 100).toFixed(0)}%</span>
                    <input type="range" id="opt-vol" min="5" max="150" step="1" value="${(OPT.vol * 100).toFixed(0)}" class="opt-slider">
                </label>
                <label class="opt-label"><span>Rate r (%)</span><span class="opt-val" id="opt-r-val">${(OPT.rate * 100).toFixed(1)}%</span>
                    <input type="range" id="opt-r" min="0" max="15" step="0.25" value="${(OPT.rate * 100).toFixed(1)}" class="opt-slider">
                </label>
            </div>

            <div class="opt-panel">
                <div class="opt-panel-title">STRATEGIES</div>
                <select id="opt-strategy" class="opt-select">
                    <option value="">-- Select Strategy --</option>
                    ${Object.keys(STRATEGIES).map(s => `<option value="${s}">${s}</option>`).join('')}
                </select>
                <button class="opt-btn opt-btn-accent" onclick="optApplyStrategy()" style="margin-top:4px;">Apply</button>
            </div>

            <div class="opt-panel">
                <div class="opt-panel-title">NEW POSITION</div>
                <div class="opt-form-row">
                    <label class="opt-label-sm">Type
                        <select id="opt-new-type" class="opt-select-sm"><option value="call">Call</option><option value="put">Put</option></select>
                    </label>
                    <label class="opt-label-sm">Position
                        <select id="opt-new-pos" class="opt-select-sm"><option value="long">Long</option><option value="short">Short</option></select>
                    </label>
                </div>
                <div class="opt-form-row">
                    <label class="opt-label-sm">Strike K
                        <input type="number" id="opt-new-strike" value="${OPT.futuresPrice.toFixed(0)}" step="5" class="opt-input-sm">
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

        </div>

        <!-- MAIN CHARTS -->
        <div class="opt-main">
            <!-- PER-LEG GREEKS DETAIL TABLE -->
            <div class="opt-portfolio-detail" id="opt-portfolio-detail"></div>
            <div class="opt-chart-grid">
                <div class="opt-chart-card">
                    <div class="opt-chart-title">PAYOFF DIAGRAM</div>
                    <div id="opt-chart-payoff" class="opt-chart"></div>
                </div>
                <div class="opt-chart-card">
                    <div class="opt-chart-title">GREEKS ANALYTICS — <span id="opt-greek-label" class="opt-accent">DELTA</span>
                        <div class="opt-metrics-inline">
                            ${['delta','gamma','vega','theta','rho'].map(m =>
                                `<button class="opt-metric-btn ${m === 'delta' ? 'active' : ''}" data-metric="${m}" onclick="optSetMetric('${m}')">${m.charAt(0).toUpperCase() + m.slice(1)}</button>`
                            ).join('')}
                        </div>
                    </div>
                    <div id="opt-chart-greeks" class="opt-chart"></div>
                </div>
                <div class="opt-chart-card">
                    <div class="opt-chart-title">3D GREEK SURFACE — <span id="opt-3d-label" class="opt-accent">DELTA</span>
                        <div class="opt-metrics-inline">
                            <select id="opt-3d-greek" class="opt-select-inline" onchange="optUpdate3DConfig()">
                                ${['delta','gamma','vega','theta'].map(g => `<option value="${g}">${g.charAt(0).toUpperCase() + g.slice(1)}</option>`).join('')}
                            </select>
                            <select id="opt-3d-param" class="opt-select-inline" onchange="optUpdate3DConfig()">
                                <option value="vol">vs Vol</option>
                                <option value="expiry">vs Time</option>
                            </select>
                        </div>
                    </div>
                    <div id="opt-chart-3d" class="opt-chart opt-chart-tall"></div>
                </div>
                <div class="opt-chart-card">
                    <div class="opt-chart-title">THETA DECAY</div>
                    <div id="opt-chart-theta" class="opt-chart"></div>
                </div>
            </div>

            <!-- RISK MANAGEMENT SECTION -->
            <div class="opt-risk-section">
                <h2 class="opt-risk-header">/// RISK MANAGEMENT</h2>
                <div class="opt-risk-controls">
                    <label class="opt-label-sm">Confidence
                        <select id="risk-confidence" class="opt-select-sm" onchange="optUpdateRisk()">
                            <option value="0.95">95%</option>
                            <option value="0.99" selected>99%</option>
                        </select>
                    </label>
                    <label class="opt-label-sm">Horizon (days)
                        <input type="number" id="risk-horizon" value="10" min="1" max="252" step="1" class="opt-input-sm" onchange="optUpdateRisk()">
                    </label>
                    <label class="opt-label-sm">MC Sims
                        <input type="number" id="risk-sims" value="10000" min="1000" max="100000" step="1000" class="opt-input-sm">
                    </label>
                    <div class="opt-risk-run-wrap">
                        <span class="opt-risk-run-spacer" aria-hidden="true">&nbsp;</span>
                        <button type="button" class="opt-btn opt-btn-accent opt-risk-run" onclick="optUpdateRisk()">Run</button>
                    </div>
                </div>

                <div class="opt-risk-grid">
                    <div class="opt-risk-card">
                        <div class="opt-risk-card-title">VALUE-AT-RISK</div>
                        <div id="risk-var-table"></div>
                    </div>
                    <div class="opt-risk-card">
                        <div class="opt-risk-card-title">MC P&L DISTRIBUTION</div>
                        <div id="risk-mc-chart" class="opt-chart"></div>
                    </div>
                </div>

                <div class="opt-risk-card" style="margin-top:10px;">
                    <div class="opt-risk-card-title">STRESS TESTS</div>
                    <div id="risk-stress-table"></div>
                </div>
            </div>
        </div>
    </div>
    `;

    _injectOptionsCSS();
    _bindSliders();
    OPT.legs = STRATEGIES['Straddle'](Math.round(OPT.futuresPrice));
    _renderLegs();
    optUpdateCharts();
    optUpdateRisk();
}

function _initFromMarketData() {
    if (!DATA) return;
    const f = DATA.futures;
    if (OPT.underlying === 'kc') {
        OPT.futuresPrice = f.kc.front || 265;
        OPT.spotMin = Math.round(OPT.futuresPrice * 0.5);
        OPT.spotMax = Math.round(OPT.futuresPrice * 1.5);
        OPT.realizedVol['20d'] = computeRealizedVol(f.kc.history, 20);
        OPT.realizedVol['60d'] = computeRealizedVol(f.kc.history, 60);
        OPT.realizedVol['120d'] = computeRealizedVol(f.kc.history, 120);
    } else {
        OPT.futuresPrice = f.rc.front || 3476;
        OPT.spotMin = Math.round(OPT.futuresPrice * 0.5);
        OPT.spotMax = Math.round(OPT.futuresPrice * 1.5);
        OPT.realizedVol['20d'] = computeRealizedVol(f.rc.history, 20);
        OPT.realizedVol['60d'] = computeRealizedVol(f.rc.history, 60);
        OPT.realizedVol['120d'] = computeRealizedVol(f.rc.history, 120);
    }
    if (OPT.realizedVol['60d']) {
        OPT.vol = OPT.realizedVol['60d'];
    }
}

/* ═══════════════════════════════════════════════════════════════════════════
   CSS INJECTION
   ═══════════════════════════════════════════════════════════════════════════ */

function _injectOptionsCSS() {
    if (document.getElementById('opt-styles')) return;
    const style = document.createElement('style');
    style.id = 'opt-styles';
    style.textContent = `
    .opt-layout {
        display: grid;
        grid-template-columns: 280px 1fr;
        gap: 12px;
        padding: 12px;
        min-height: calc(100vh - 60px);
    }
    .opt-sidebar-left {
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
        font-size: 0.62rem;
        font-weight: 700;
        color: var(--text-secondary);
        letter-spacing: 1.5px;
        margin-bottom: 8px;
        text-transform: uppercase;
    }
    .opt-fwd-display {
        font-family: var(--font-mono);
        font-size: 1.2rem;
        font-weight: 800;
        color: var(--accent);
        text-align: center;
        padding: 8px 0;
        margin: 6px 0;
        border: 1px solid var(--accent);
        border-radius: 4px;
        background: rgba(0,184,148,0.06);
        letter-spacing: 1px;
    }
    .opt-rv-box {
        background: var(--bg-primary);
        border: 1px solid var(--border);
        border-radius: 4px;
        padding: 8px;
        margin-top: 8px;
    }
    .opt-rv-title {
        font-family: var(--font-mono);
        font-size: 0.58rem;
        font-weight: 700;
        color: var(--text-muted);
        letter-spacing: 1px;
        margin-bottom: 6px;
    }
    .opt-rv-row {
        display: grid;
        grid-template-columns: auto 1fr auto 1fr auto 1fr;
        gap: 4px 6px;
        font-size: 0.68rem;
        color: var(--text-secondary);
        align-items: center;
        margin-bottom: 6px;
    }
    .opt-rv-val {
        font-family: var(--font-mono);
        font-weight: 700;
        color: var(--accent);
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
        order: 3;
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
    .opt-label {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        font-size: 0.68rem;
        color: var(--text-secondary);
        margin-bottom: 8px;
        font-weight: 600;
    }
    .opt-label .opt-val {
        font-family: var(--font-mono);
        font-size: 0.68rem;
        color: var(--accent);
        font-weight: 700;
        flex-shrink: 0;
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
    .opt-select-inline {
        background: var(--bg-primary);
        border: 1px solid var(--border);
        color: var(--text-secondary);
        padding: 2px 6px;
        border-radius: 3px;
        font-size: 0.6rem;
        font-family: var(--font-sans);
    }
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
        background: rgba(0,184,148,0.08);
    }
    .opt-btn-accent:hover { background: rgba(0,184,148,0.18); }
    .opt-btn-muted { color: var(--text-muted); }
    .opt-btn-muted:hover { color: var(--red); border-color: var(--red); }
    .opt-btn-sm { padding: 3px 8px; font-size: 0.62rem; flex: none; }
    .opt-badge {
        background: var(--accent);
        color: var(--bg-primary);
        font-size: 0.6rem;
        padding: 1px 6px;
        border-radius: 8px;
        font-weight: 700;
        margin-left: 4px;
    }
    .opt-legs-list { max-height: 180px; overflow-y: auto; }
    .opt-leg-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 4px 8px;
        margin-bottom: 3px;
        background: var(--bg-primary);
        border-radius: 4px;
        border: 1px solid var(--border);
        font-size: 0.66rem;
        font-family: var(--font-mono);
    }
    .opt-leg-long { border-left: 3px solid var(--accent); }
    .opt-leg-short { border-left: 3px solid var(--red); }
    .opt-leg-remove {
        background: none; border: none; color: var(--text-muted);
        cursor: pointer; font-size: 0.8rem; padding: 0 4px;
    }
    .opt-leg-remove:hover { color: var(--red); }
    .opt-empty {
        font-size: 0.66rem; color: var(--text-muted);
        text-align: center; padding: 10px 0; font-style: italic;
    }
    .opt-greeks-summary {
        margin-top: 8px;
        font-size: 0.62rem;
        font-family: var(--font-mono);
        color: var(--text-secondary);
    }
    .opt-greeks-summary table { width: 100%; border-collapse: collapse; }
    .opt-greeks-summary td {
        padding: 2px 4px;
        border-bottom: 1px solid rgba(30,42,58,0.3);
    }
    .opt-greeks-summary .gk-label { color: var(--text-muted); }
    .opt-greeks-summary .gk-val { text-align: right; color: var(--accent); font-weight: 600; }
    .opt-main { min-width: 0; }
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
        font-size: 0.6rem;
        font-weight: 700;
        color: var(--text-secondary);
        letter-spacing: 1.2px;
        margin-bottom: 4px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        flex-wrap: wrap;
        gap: 4px;
    }
    .opt-accent { color: var(--accent); }
    .opt-chart { height: 340px; }
    .opt-chart-tall { height: 380px; }
    .opt-metrics-inline {
        display: flex; gap: 3px; flex-wrap: wrap;
    }
    .opt-metric-btn {
        padding: 2px 6px;
        border: 1px solid var(--border);
        border-radius: 3px;
        background: var(--bg-primary);
        color: var(--text-muted);
        font-size: 0.58rem;
        font-weight: 600;
        font-family: var(--font-mono);
        cursor: pointer;
        transition: all 0.15s;
    }
    .opt-metric-btn:hover { border-color: var(--accent); color: var(--text-secondary); }
    .opt-metric-btn.active {
        border-color: var(--accent);
        color: var(--accent);
        background: rgba(0,184,148,0.1);
    }
    /* Risk Management */
    .opt-risk-section {
        margin-top: 16px;
        padding-top: 12px;
        border-top: 1px solid var(--border);
    }
    .opt-risk-header {
        font-family: var(--font-mono);
        font-size: 0.85rem;
        font-weight: 800;
        color: var(--text-primary);
        letter-spacing: 1px;
        margin-bottom: 10px;
    }
    .opt-risk-controls {
        display: grid;
        grid-template-columns: minmax(120px, 1fr) minmax(120px, 1fr) minmax(100px, 140px) auto;
        gap: 10px;
        align-items: end;
        margin-bottom: 12px;
    }
    .opt-risk-controls .opt-label-sm {
        display: flex;
        flex-direction: column;
        gap: 4px;
        margin-bottom: 0;
    }
    .opt-risk-controls .opt-select-sm,
    .opt-risk-controls .opt-input-sm {
        margin: 0;
        box-sizing: border-box;
        min-height: 28px;
    }
    .opt-risk-run-wrap {
        display: flex;
        flex-direction: column;
        gap: 4px;
        justify-content: flex-end;
    }
    .opt-risk-run-spacer {
        display: block;
        font-size: 0.65rem;
        font-weight: 600;
        line-height: 1.2;
        visibility: hidden;
        user-select: none;
    }
    .opt-risk-run {
        flex: none;
        min-width: 76px;
        height: 28px;
        padding: 0 12px;
        line-height: 1;
    }
    .opt-risk-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
    }
    .opt-risk-card {
        background: var(--bg-card);
        border: 1px solid var(--border);
        border-radius: 6px;
        padding: 10px 12px;
    }
    .opt-risk-card-title {
        font-family: var(--font-mono);
        font-size: 0.6rem;
        font-weight: 700;
        color: var(--text-secondary);
        letter-spacing: 1.2px;
        margin-bottom: 8px;
    }
    .var-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.68rem;
        font-family: var(--font-mono);
    }
    .var-table th {
        text-align: left;
        padding: 4px 8px;
        color: var(--text-muted);
        font-weight: 600;
        border-bottom: 1px solid var(--border);
        font-size: 0.6rem;
        letter-spacing: 0.5px;
    }
    .var-table td {
        padding: 5px 8px;
        border-bottom: 1px solid rgba(30,42,58,0.3);
        color: var(--text-primary);
    }
    .var-table .var-method { color: var(--text-secondary); font-weight: 600; }
    .var-table .var-val { font-weight: 700; }
    .var-table .var-loss { color: var(--red); }
    .var-table .var-gain { color: var(--accent); }
    .opt-portfolio-detail {
        margin-bottom: 12px;
    }
    .opt-portfolio-detail:empty { display: none; }
    .opt-greeks-detail-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.66rem;
        font-family: var(--font-mono);
    }
    .opt-greeks-detail-table th {
        text-align: right;
        padding: 5px 8px;
        color: var(--text-muted);
        font-weight: 600;
        border-bottom: 1px solid var(--border);
        font-size: 0.58rem;
        letter-spacing: 0.5px;
    }
    .opt-greeks-detail-table th:first-child { text-align: left; }
    .opt-greeks-detail-table td {
        padding: 5px 8px;
        border-bottom: 1px solid rgba(30,42,58,0.3);
        color: var(--text-primary);
        text-align: right;
    }
    .opt-greeks-detail-table td:first-child { text-align: left; }
    .opt-greeks-detail-table tr.total-row {
        border-top: 2px solid var(--accent);
        font-weight: 700;
    }
    .opt-greeks-detail-table tr.total-row td { color: var(--accent); }
    .opt-risk-extra-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
        margin-top: 10px;
    }
    .opt-risk-metric-card {
        background: var(--bg-primary);
        border: 1px solid var(--border);
        border-radius: 4px;
        padding: 8px 10px;
    }
    .opt-risk-metric-label {
        font-family: var(--font-mono);
        font-size: 0.58rem;
        font-weight: 700;
        color: var(--text-muted);
        letter-spacing: 1px;
        text-transform: uppercase;
    }
    .stress-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.66rem;
        font-family: var(--font-mono);
    }
    .stress-table th {
        text-align: left;
        padding: 4px 6px;
        color: var(--text-muted);
        font-weight: 600;
        border-bottom: 1px solid var(--border);
        font-size: 0.58rem;
        letter-spacing: 0.5px;
    }
    .stress-table td {
        padding: 4px 6px;
        border-bottom: 1px solid rgba(30,42,58,0.3);
        color: var(--text-primary);
    }
    .stress-table tr:hover { background: rgba(0,184,148,0.04); }
    @media (max-width: 1200px) {
        .opt-layout { grid-template-columns: 260px 1fr; }
    }
    @media (max-width: 900px) {
        .opt-layout { grid-template-columns: 1fr; }
        .opt-chart-grid { grid-template-columns: 1fr; }
        .opt-risk-grid { grid-template-columns: 1fr; }
        .opt-sidebar-left { max-height: none; }
    }
    `;
    document.head.appendChild(style);
}

/* ═══════════════════════════════════════════════════════════════════════════
   EVENT BINDING
   ═══════════════════════════════════════════════════════════════════════════ */

function _bindSliders() {
    _bindSlider('opt-F', 'opt-F-val', v => { OPT.futuresPrice = +v; _updateFwdDisplay(); return (+v).toFixed(0); });
    _bindSlider('opt-T', 'opt-T-val', v => { OPT.expiry = +v; return v; });
    _bindSlider('opt-vol', 'opt-vol-val', v => { OPT.vol = v / 100; return v + '%'; });
    _bindSlider('opt-r', 'opt-r-val', v => { OPT.rate = v / 100; return (+v).toFixed(1) + '%'; });
}

function _bindSlider(sliderId, valId, formatter) {
    const slider = document.getElementById(sliderId);
    const valEl = document.getElementById(valId);
    if (!slider) return;
    slider.addEventListener('input', () => {
        const display = formatter(slider.value);
        if (valEl) valEl.textContent = display;
        _renderLegs();
        optUpdateCharts();
    });
}

function _updateFwdDisplay() {
    const unit = OPT.underlying === 'kc' ? '¢/lb' : '$/t';
    const el = document.getElementById('opt-fwd-display');
    if (el) el.textContent = `F = ${OPT.futuresPrice.toFixed(2)} ${unit}`;
}

/* ═══════════════════════════════════════════════════════════════════════════
   UNDERLYING CHANGE
   ═══════════════════════════════════════════════════════════════════════════ */

function optChangeUnderlying() {
    const sel = document.getElementById('opt-underlying');
    if (!sel) return;
    OPT.underlying = sel.value;
    OPT.legs = [];
    document.getElementById('tab-options').dataset.rendered = '';
    renderOptions();
}

function optUseRealizedVol() {
    const rv = OPT.realizedVol['60d'];
    if (!rv) return;
    OPT.vol = rv;
    const slider = document.getElementById('opt-vol');
    const valEl = document.getElementById('opt-vol-val');
    if (slider) slider.value = (rv * 100).toFixed(0);
    if (valEl) valEl.textContent = (rv * 100).toFixed(0) + '%';
    _renderLegs();
    optUpdateCharts();
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
    optUpdateRisk();
}

function optApplyStrategy() {
    const sel = document.getElementById('opt-strategy');
    if (!sel || !sel.value) return;
    const fn = STRATEGIES[sel.value];
    if (!fn) return;
    OPT.legs = fn(Math.round(OPT.futuresPrice));
    _renderLegs();
    optUpdateCharts();
    optUpdateRisk();
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
        list.innerHTML = '<div class="opt-empty">No positions yet.</div>';
        _renderPortfolioDetail();
        return;
    }
    list.innerHTML = OPT.legs.map((leg, i) => {
        const cls = leg.position === 'long' ? 'opt-leg-long' : 'opt-leg-short';
        const sign = leg.position === 'long' ? '+' : '-';
        const color = leg.position === 'long' ? 'var(--accent)' : 'var(--red)';
        const premium = black76Price(leg.type, OPT.futuresPrice, leg.strike, OPT.expiry, OPT.vol, OPT.rate);
        return `<div class="opt-leg-item ${cls}">
            <span><span style="color:${color};font-weight:700">${sign}${leg.qty}</span> ${leg.type.toUpperCase()} K=${leg.strike}</span>
            <span style="color:var(--text-muted)">${premium.toFixed(2)}</span>
            <button class="opt-leg-remove" onclick="_removeLeg(${i})">×</button>
        </div>`;
    }).join('');
    _renderGreeksSummary();
    _renderPortfolioDetail();
}

function _renderPortfolioDetail() {
    const el = document.getElementById('opt-portfolio-detail');
    if (!el) return;
    if (OPT.legs.length === 0) { el.innerHTML = ''; return; }

    const unit = OPT.underlying === 'kc' ? '¢/lb' : '$/t';
    const totals = { price: 0, delta: 0, gamma: 0, vega: 0, theta: 0, rho: 0 };
    const rows = OPT.legs.map(leg => {
        const sign = _legSign(leg.position);
        const g = black76Greeks(leg.type, OPT.futuresPrice, leg.strike, OPT.expiry, OPT.vol, OPT.rate);
        const s = sign * leg.qty;
        const row = {
            label: `${sign > 0 ? '+' : '-'}${leg.qty} ${leg.type.toUpperCase()} K=${leg.strike}`,
            price: s * g.price,
            delta: s * g.delta,
            gamma: s * g.gamma,
            vega: s * g.vega * 0.01,
            theta: s * g.theta / 365,
            rho: s * g.rho,
            isLong: sign > 0,
        };
        totals.price += row.price;
        totals.delta += row.delta;
        totals.gamma += row.gamma;
        totals.vega += row.vega;
        totals.theta += row.theta;
        totals.rho += row.rho;
        return row;
    });

    let html = `<div class="opt-risk-card">
        <div class="opt-risk-card-title">LEG GREEKS DETAIL</div>
        <table class="opt-greeks-detail-table">
        <thead><tr>
            <th>Leg</th><th>Value</th><th>Delta</th><th>Gamma</th><th>Vega</th><th>Theta/d</th><th>Rho</th>
        </tr></thead><tbody>`;

    for (const r of rows) {
        const clr = r.isLong ? 'var(--accent)' : 'var(--red)';
        html += `<tr>
            <td style="color:${clr};font-weight:600;">${r.label}</td>
            <td>${r.price.toFixed(2)}</td>
            <td>${r.delta.toFixed(4)}</td>
            <td>${r.gamma.toFixed(6)}</td>
            <td>${r.vega.toFixed(4)}</td>
            <td>${r.theta.toFixed(4)}</td>
            <td>${r.rho.toFixed(4)}</td>
        </tr>`;
    }

    html += `<tr class="total-row">
        <td>TOTAL</td>
        <td>${totals.price.toFixed(2)}</td>
        <td>${totals.delta.toFixed(4)}</td>
        <td>${totals.gamma.toFixed(6)}</td>
        <td>${totals.vega.toFixed(4)}</td>
        <td>${totals.theta.toFixed(4)}</td>
        <td>${totals.rho.toFixed(4)}</td>
    </tr></tbody></table></div>`;

    el.innerHTML = html;
}

function _renderGreeksSummary() {
    const el = document.getElementById('opt-greeks-summary');
    if (!el) return;
    if (OPT.legs.length === 0) { el.innerHTML = ''; return; }
    const g = portfolioTotalGreeks(OPT.legs);
    const currentVal = portfolioValue(OPT.legs, OPT.futuresPrice, OPT.expiry);
    el.innerHTML = `<table>
        <tr><td class="gk-label">Value</td><td class="gk-val">${currentVal.toFixed(2)}</td></tr>
        <tr><td class="gk-label">Delta</td><td class="gk-val">${g.delta.toFixed(4)}</td></tr>
        <tr><td class="gk-label">Gamma</td><td class="gk-val">${g.gamma.toFixed(6)}</td></tr>
        <tr><td class="gk-label">Vega</td><td class="gk-val">${g.vega.toFixed(4)}</td></tr>
        <tr><td class="gk-label">Theta/day</td><td class="gk-val">${g.theta.toFixed(4)}</td></tr>
    </table>`;
}

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

function _drawPayoffChart() {
    const el = document.getElementById('opt-chart-payoff');
    if (!el) return;
    const spots = _spotArray(300);
    const unit = OPT.underlying === 'kc' ? '¢/lb' : '$/t';
    const traces = [];

    if (OPT.legs.length > 0) {
        const payoff = portfolioPayoff(OPT.legs, spots);
        traces.push({
            x: spots, y: payoff, name: 'P&L at Expiry',
            line: { color: COLORS.accent, width: 2 },
            fill: 'tozeroy', fillcolor: 'rgba(0,184,148,0.08)',
        });

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
            x: spots, y: currentVal, name: 'MTM P&L (same IV/DTE)',
            line: { color: COLORS.orange, width: 1.5, dash: 'dot' },
            hovertemplate: 'Underlying: %{x:.2f}<br>MTM P&L: %{y:.2f}<extra>Same IV/DTE</extra>',
        });

        const legColors = [COLORS.blue, COLORS.purple, COLORS.yellow, COLORS.red];
        OPT.legs.forEach((leg, i) => {
            const lp = spots.map(s => {
                const sign = _legSign(leg.position);
                const intr = leg.type === 'call' ? Math.max(s - leg.strike, 0) : Math.max(leg.strike - s, 0);
                const prem = black76Price(leg.type, OPT.futuresPrice, leg.strike, OPT.expiry, OPT.vol, OPT.rate);
                return sign * leg.qty * (intr - prem);
            });
            traces.push({
                x: spots, y: lp,
                name: `${leg.position === 'long' ? '+' : '-'}${leg.qty} ${leg.type.toUpperCase()} K=${leg.strike}`,
                line: { color: legColors[i % legColors.length], width: 1, dash: 'dash' }, opacity: 0.6,
            });
        });
    }

    traces.push({ x: [OPT.spotMin, OPT.spotMax], y: [0, 0], showlegend: false, line: { color: COLORS.muted, width: 0.5, dash: 'dash' } });

    const strikes = [...new Set(OPT.legs.map(l => l.strike))];
    const shapes = strikes.map(k => ({
        type: 'line', x0: k, x1: k, y0: 0, y1: 1, yref: 'paper',
        line: { color: 'rgba(233,196,106,0.3)', width: 1, dash: 'dot' },
    }));

    Plotly.react(el, traces, mergeLayout({
        xaxis: { title: `Underlying (${unit})`, range: [OPT.spotMin, OPT.spotMax] },
        yaxis: { title: 'P&L', zeroline: true, zerolinecolor: COLORS.muted },
        showlegend: true, legend: { orientation: 'h', y: 1.12, font: { size: 8 } },
        margin: { l: 50, r: 10, t: 10, b: 35 },
        shapes,
    }), PLOTLY_CONFIG);
}

function _drawGreeksChart() {
    const el = document.getElementById('opt-chart-greeks');
    if (!el) return;
    const spots = _spotArray(200);
    const unit = OPT.underlying === 'kc' ? '¢/lb' : '$/t';
    const metric = OPT.activeMetric;
    const traces = [];

    if (OPT.legs.length > 0) {
        const vals = portfolioGreek(OPT.legs, spots, metric);
        traces.push({
            x: spots, y: vals,
            name: metric.charAt(0).toUpperCase() + metric.slice(1),
            line: { color: COLORS.accent, width: 2 },
            fill: 'tozeroy', fillcolor: 'rgba(0,184,148,0.06)',
        });

        if (OPT.legs.length > 1) {
            const legColors = [COLORS.blue, COLORS.purple, COLORS.yellow, COLORS.red, COLORS.orange];
            OPT.legs.forEach((leg, i) => {
                const v = spots.map(s => {
                    const g = black76Greeks(leg.type, s, leg.strike, OPT.expiry, OPT.vol, OPT.rate);
                    let val = g[metric] || 0;
                    if (metric === 'vega') val *= 0.01;
                    return _legSign(leg.position) * leg.qty * val;
                });
                traces.push({
                    x: spots, y: v,
                    name: `${leg.position === 'long' ? '+' : '-'}${leg.qty} ${leg.type.toUpperCase()} K=${leg.strike}`,
                    line: { color: legColors[i % legColors.length], width: 1, dash: 'dash' }, opacity: 0.6,
                });
            });
        }
    }

    Plotly.react(el, traces, mergeLayout({
        xaxis: { title: `Underlying (${unit})`, range: [OPT.spotMin, OPT.spotMax] },
        yaxis: { title: metric.charAt(0).toUpperCase() + metric.slice(1), zeroline: true, zerolinecolor: COLORS.muted },
        showlegend: true, legend: { orientation: 'h', y: 1.12, font: { size: 8 } },
        margin: { l: 50, r: 10, t: 10, b: 35 },
    }), PLOTLY_CONFIG);
}

function _draw3DSurface() {
    const el = document.getElementById('opt-chart-3d');
    if (!el || OPT.legs.length === 0) {
        if (el) Plotly.react(el, [], mergeLayout({ margin: { l: 0, r: 0, t: 0, b: 0 } }), PLOTLY_CONFIG);
        return;
    }

    const greek = OPT.surface3dGreek;
    const param = OPT.surface3dParam;
    const nSpots = 40, nParam = 30;
    const spots = _spotArray(nSpots);

    let paramMin, paramMax, paramLabel;
    if (param === 'vol') { paramMin = 0.05; paramMax = 1.0; paramLabel = 'Volatility'; }
    else if (param === 'expiry') { paramMin = 0.02; paramMax = 2.0; paramLabel = 'Time (yrs)'; }
    else { paramMin = 0.0; paramMax = 0.15; paramLabel = 'Rate'; }

    const paramVals = [];
    for (let i = 0; i < nParam; i++) paramVals.push(paramMin + (paramMax - paramMin) * i / (nParam - 1));

    const z = [];
    for (let pi = 0; pi < nParam; pi++) {
        const row = [];
        for (let si = 0; si < nSpots; si++) {
            let total = 0;
            for (const leg of OPT.legs) {
                const sign = _legSign(leg.position);
                const vol = param === 'vol' ? paramVals[pi] : OPT.vol;
                const T = param === 'expiry' ? paramVals[pi] : OPT.expiry;
                const r = param === 'rate' ? paramVals[pi] : OPT.rate;
                const g = black76Greeks(leg.type, spots[si], leg.strike, T, vol, r);
                let val = g[greek] || 0;
                if (greek === 'vega') val *= 0.01;
                total += sign * leg.qty * val;
            }
            row.push(total);
        }
        z.push(row);
    }

    Plotly.react(el, [{
        x: spots,
        y: paramVals.map(v => param === 'vol' || param === 'rate' ? (v * 100).toFixed(1) : v.toFixed(2)),
        z, type: 'surface',
        colorscale: [[0, COLORS.red], [0.25, COLORS.orange], [0.5, '#1e2a3a'], [0.75, COLORS.blue], [1, COLORS.accent]],
        showscale: false, opacity: 0.92,
    }], mergeLayout({
        scene: {
            xaxis: { title: 'Spot', color: '#8899aa', gridcolor: COLORS.grid, backgroundcolor: 'rgba(0,0,0,0)' },
            yaxis: { title: paramLabel, color: '#8899aa', gridcolor: COLORS.grid, backgroundcolor: 'rgba(0,0,0,0)' },
            zaxis: { title: greek.charAt(0).toUpperCase() + greek.slice(1), color: '#8899aa', gridcolor: COLORS.grid, backgroundcolor: 'rgba(0,0,0,0)' },
            bgcolor: 'rgba(0,0,0,0)',
            camera: { eye: { x: 1.6, y: -1.6, z: 0.9 } },
        },
        margin: { l: 0, r: 0, t: 0, b: 0 },
    }), PLOTLY_CONFIG);
}

function _drawThetaDecay() {
    const el = document.getElementById('opt-chart-theta');
    if (!el) return;
    const traces = [];

    if (OPT.legs.length > 0) {
        const nPoints = 200;
        const maxT = OPT.expiry;
        const times = [];
        for (let i = 0; i < nPoints; i++) times.push(maxT * (1 - i / (nPoints - 1)) + 0.001);
        times.reverse();
        const dte = times.map(t => t * 365);
        const vals = times.map(t => portfolioValue(OPT.legs, OPT.futuresPrice, t));
        traces.push({ x: dte, y: vals, name: `At F=${OPT.futuresPrice.toFixed(0)}`, line: { color: COLORS.accent, width: 2 } });

        [{ pct: 0.90, color: COLORS.blue, label: '-10%' }, { pct: 1.10, color: COLORS.orange, label: '+10%' }].forEach(({ pct, color, label }) => {
            const sF = Math.round(OPT.futuresPrice * pct);
            traces.push({ x: dte, y: times.map(t => portfolioValue(OPT.legs, sF, t)), name: `At F=${sF} (${label})`, line: { color, width: 1.5, dash: 'dash' } });
        });
    }

    Plotly.react(el, traces, mergeLayout({
        xaxis: { title: 'Days to Expiry', autorange: 'reversed' },
        yaxis: { title: 'Portfolio Value', zeroline: true, zerolinecolor: COLORS.muted },
        showlegend: true, legend: { orientation: 'h', y: 1.12, font: { size: 8 } },
        margin: { l: 50, r: 10, t: 10, b: 35 },
    }), PLOTLY_CONFIG);
}

/* ═══════════════════════════════════════════════════════════════════════════
   RISK MANAGEMENT RENDER
   ═══════════════════════════════════════════════════════════════════════════ */

function optUpdateRisk() {
    if (OPT.legs.length === 0) {
        const varEl = document.getElementById('risk-var-table');
        const stressEl = document.getElementById('risk-stress-table');
        const mcEl = document.getElementById('risk-mc-chart');
        if (varEl) varEl.innerHTML = '<div class="opt-empty">Add positions to compute VaR.</div>';
        if (stressEl) stressEl.innerHTML = '<div class="opt-empty">Add positions to run stress tests.</div>';
        if (mcEl) Plotly.react(mcEl, [], mergeLayout({ margin: { l: 40, r: 10, t: 10, b: 30 } }), PLOTLY_CONFIG);
        return;
    }

    const confidence = +(document.getElementById('risk-confidence')?.value || 0.99);
    const horizon = +(document.getElementById('risk-horizon')?.value || 10);
    const nSims = +(document.getElementById('risk-sims')?.value || 10000);

    const histVaR = computeHistoricalVaR(confidence, horizon);
    const paramVaR = computeParametricVaR(confidence, horizon);
    const mcVaR = computeMonteCarloVaR(confidence, horizon, nSims);

    const histPnls = _getHistoricalPnls();
    const histCVaR = computeCVaR(histPnls, confidence);
    const mcCVaR = computeCVaR(mcVaR.distribution, confidence);
    const maxDD = computeMaxDrawdown(2000, horizon);

    _renderVaRTable(histVaR, paramVaR, mcVaR, confidence, horizon, histCVaR, mcCVaR, maxDD);
    _renderMCDistribution(mcVaR, confidence);
    _renderStressTable();
}

function _renderVaRTable(hist, param, mc, confidence, horizon, histCVaR, mcCVaR, maxDD) {
    const el = document.getElementById('risk-var-table');
    if (!el) return;
    const confPct = (confidence * 100).toFixed(0);

    function fmt(v) {
        if (v == null || isNaN(v)) return '—';
        return v.toFixed(2);
    }

    el.innerHTML = `
    <table class="var-table">
        <thead><tr>
            <th>Method</th>
            <th>VaR 1d (${confPct}%)</th>
            <th>VaR ${horizon}d (${confPct}%)</th>
        </tr></thead>
        <tbody>
            <tr>
                <td class="var-method">Historical</td>
                <td class="var-val ${hist.var1d > 0 ? 'var-loss' : 'var-gain'}">${fmt(hist.var1d)}</td>
                <td class="var-val ${hist.varHorizon > 0 ? 'var-loss' : 'var-gain'}">${fmt(hist.varHorizon)}</td>
            </tr>
            <tr>
                <td class="var-method">Parametric (Δ-Γ)</td>
                <td class="var-val ${param.var1d > 0 ? 'var-loss' : 'var-gain'}">${fmt(param.var1d)}</td>
                <td class="var-val ${param.varHorizon > 0 ? 'var-loss' : 'var-gain'}">${fmt(param.varHorizon)}</td>
            </tr>
            <tr>
                <td class="var-method">Monte Carlo</td>
                <td class="var-val ${mc.var1d > 0 ? 'var-loss' : 'var-gain'}">${fmt(mc.var1d)}</td>
                <td class="var-val ${mc.varHorizon > 0 ? 'var-loss' : 'var-gain'}">${fmt(mc.varHorizon)}</td>
            </tr>
        </tbody>
    </table>
    <div class="opt-risk-extra-grid">
        <div class="opt-risk-metric-card">
            <div class="opt-risk-metric-label">CVaR / Expected Shortfall (${confPct}%)</div>
            <table class="var-table" style="margin-top:6px;">
                <tr><td class="var-method">Historical ES</td><td class="var-val var-loss">${fmt(histCVaR)}</td></tr>
                <tr><td class="var-method">Monte Carlo ES</td><td class="var-val var-loss">${fmt(mcCVaR)}</td></tr>
            </table>
        </div>
        <div class="opt-risk-metric-card">
            <div class="opt-risk-metric-label">Maximum Drawdown (${horizon}d, MC)</div>
            <table class="var-table" style="margin-top:6px;">
                <tr><td class="var-method">Avg Drawdown</td><td class="var-val var-loss">${fmt(maxDD.avgDD)}</td></tr>
                <tr><td class="var-method">95th pctl DD</td><td class="var-val var-loss">${fmt(maxDD.pct95DD)}</td></tr>
                <tr><td class="var-method">Worst-case DD</td><td class="var-val var-loss">${fmt(maxDD.maxDD)}</td></tr>
            </table>
        </div>
    </div>`;
}

function _renderMCDistribution(mc, confidence) {
    const el = document.getElementById('risk-mc-chart');
    if (!el || !mc.distribution || !mc.distribution.length) return;

    const pnls = mc.distribution;
    const varCutoff = -mc.var1d;
    const nBins = 80;
    const min = pnls[0], max = pnls[pnls.length - 1];
    const binWidth = (max - min) / nBins;
    const bins = [], counts = [];
    for (let i = 0; i < nBins; i++) {
        const lo = min + i * binWidth;
        bins.push(lo + binWidth / 2);
        counts.push(pnls.filter(v => v >= lo && v < lo + binWidth).length);
    }

    const barColors = bins.map(b => b < varCutoff ? COLORS.red : COLORS.accent);

    Plotly.react(el, [
        { x: bins, y: counts, type: 'bar', marker: { color: barColors, opacity: 0.7 }, showlegend: false },
        { x: [varCutoff, varCutoff], y: [0, Math.max(...counts)], mode: 'lines', name: `VaR`, line: { color: COLORS.red, width: 2, dash: 'dash' }, showlegend: false },
    ], mergeLayout({
        xaxis: { title: 'P&L' },
        yaxis: { title: 'Frequency' },
        margin: { l: 40, r: 10, t: 10, b: 30 },
        bargap: 0.02,
        annotations: [{ x: varCutoff, y: Math.max(...counts) * 0.9, text: `VaR ${(confidence * 100).toFixed(0)}%`, showarrow: true, arrowcolor: COLORS.red, font: { color: COLORS.red, size: 9 } }],
    }), PLOTLY_CONFIG);
}

function _renderStressTable() {
    const el = document.getElementById('risk-stress-table');
    if (!el) return;
    const results = computeStressTests();

    let html = `<table class="stress-table">
        <thead><tr>
            <th>Scenario</th>
            <th>Price Δ</th>
            <th>Vol Δ</th>
            <th>New Value</th>
            <th>P&L</th>
            <th>P&L %</th>
        </tr></thead><tbody>`;

    for (const r of results) {
        const pnlCls = r.pnl >= 0 ? 'var-gain' : 'var-loss';
        html += `<tr>
            <td style="color:var(--text-secondary);font-weight:600;">${r.name}</td>
            <td>${r.pricePct !== '0' ? r.pricePct + '%' : '—'}</td>
            <td>${r.volPct !== '0' ? r.volPct + '%' : '—'}</td>
            <td>${r.newValue.toFixed(2)}</td>
            <td class="${pnlCls}">${r.pnl >= 0 ? '+' : ''}${r.pnl.toFixed(2)}</td>
            <td class="${pnlCls}">${r.pnlPct >= 0 ? '+' : ''}${r.pnlPct.toFixed(1)}%</td>
        </tr>`;
    }
    html += '</tbody></table>';
    el.innerHTML = html;
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
window.optUpdate3DConfig = optUpdate3DConfig;
window.optChangeUnderlying = optChangeUnderlying;
window.optUseRealizedVol = optUseRealizedVol;
window.optUpdateRisk = optUpdateRisk;
