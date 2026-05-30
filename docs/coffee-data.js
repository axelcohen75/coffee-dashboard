/**
 * Coffee Market Monitor — Data definitions & presets.
 */

const COLORS = {
    accent: '#00D4AA',
    green: '#00D4AA',
    red: '#E76F51',
    orange: '#F4A261',
    blue: '#457B9D',
    yellow: '#E9C46A',
    purple: '#9B5DE5',
    muted: '#6b7b8d',
    grid: 'rgba(30,42,58,0.5)',
    bg: '#0a0e1a',
    card: '#111827',
};

const PLOTLY_LAYOUT = {
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: { family: 'Inter, sans-serif', color: '#e8ecf1', size: 11 },
    margin: { l: 45, r: 15, t: 30, b: 30 },
    xaxis: { gridcolor: COLORS.grid, zerolinecolor: COLORS.grid },
    yaxis: { gridcolor: COLORS.grid, zerolinecolor: COLORS.grid },
    legend: { orientation: 'h', y: 1.08, font: { size: 10 } },
    modebar: { bgcolor: 'rgba(0,0,0,0)', color: '#6b7b8d', activecolor: '#00D4AA' },
};

const PLOTLY_CONFIG = {
    displayModeBar: true,
    modeBarButtonsToRemove: ['select2d', 'lasso2d', 'autoScale2d'],
    displaylogo: false,
    responsive: true,
};

const SPOT_ITEMS = [
    { key: 'kc', label: 'KC Arabica', unit: '¢/lb', color: COLORS.accent },
    { key: 'rc', label: 'Robusta', unit: '$/t', color: COLORS.blue },
    { key: 'rc_cl', label: 'RC (¢/lb)', unit: '¢/lb', color: COLORS.blue },
    { key: 'arb_rob', label: 'Arb-Rob Spread', unit: '¢/lb', color: COLORS.orange },
];

const SPREAD_DEFS = [
    { key: 'kn', label: 'KC K-N', desc: 'May-Jul' },
    { key: 'nz', label: 'KC N-Z', desc: 'Jul-Dec' },
    { key: 'zh', label: 'KC Z-H', desc: 'Dec-Mar' },
    { key: 'hk', label: 'KC H-K', desc: 'Mar-May' },
];

const WEATHER_ZONES = [
    { key: 'Sul de Minas', short: 'Sul Minas' },
    { key: 'Cerrado Mineiro', short: 'Cerrado' },
    { key: 'Mogiana (SP)', short: 'Mogiana' },
    { key: 'Matas de Minas', short: 'Matas' },
    { key: 'Espirito Santo (Conilon)', short: 'ES Conilon' },
];

const PHENOLOGY = [
    { phase: 'Floraison', startMonth: 9, endMonth: 10, color: COLORS.red },
    { phase: 'Formation grains', startMonth: 11, endMonth: 1, color: COLORS.orange },
    { phase: 'Maturation', startMonth: 2, endMonth: 4, color: COLORS.accent },
    { phase: 'Récolte', startMonth: 5, endMonth: 8, color: COLORS.blue },
];

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const DIFF_COLORS = {
    'Colombian Milds': COLORS.accent,
    'Other Milds': COLORS.orange,
    'Brazilian Naturals': COLORS.blue,
    'Robustas': COLORS.red,
};

/* Helpers */

function fmtPct(v) {
    if (v == null || isNaN(v)) return '—';
    return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
}

function pctClass(v) {
    if (v == null || isNaN(v)) return 'neutral';
    return v >= 0 ? 'up' : 'down';
}

function fmtNum(v, dec = 2) {
    if (v == null || isNaN(v)) return '—';
    return v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function fmtInt(v) {
    if (v == null) return '—';
    return Math.round(v).toLocaleString('en-US');
}

function mergeLayout(overrides) {
    const base = JSON.parse(JSON.stringify(PLOTLY_LAYOUT));
    return deepMerge(base, overrides);
}

function deepMerge(target, source) {
    for (const key of Object.keys(source)) {
        if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
            target[key] = target[key] || {};
            deepMerge(target[key], source[key]);
        } else {
            target[key] = source[key];
        }
    }
    return target;
}
