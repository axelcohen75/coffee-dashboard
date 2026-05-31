"""Differentials page: FOB coffee premiums by origin group."""

import numpy as np
import pandas as pd
import plotly.graph_objects as go
import streamlit as st

st.set_page_config(page_title="Differentials | Coffee Monitor", page_icon="🌍", layout="wide")

T = "plotly_dark"
C_COLS = {"Colombian Milds": "#00D4AA", "Other Milds": "#F4A261",
          "Brazilian Naturals": "#457B9D", "Robustas": "#E76F51"}

st.markdown("""
<style>
    .stApp { background-color: #0a0e1a; }
    .block-container { padding-top: 1rem; }
    .section-header {
        font-size: 0.75rem; color: #6b7b8d; letter-spacing: 1.5px;
        text-transform: uppercase; padding: 0.5rem 0; border-bottom: 1px solid #1e2a3a;
        margin: 0.5rem 0;
    }
    div[data-testid="stMetric"] {
        background: #141824; border: 1px solid #1e2a3a; border-radius: 4px;
        padding: 0.6rem; text-align: center;
    }
    #MainMenu {visibility: hidden;} footer {visibility: hidden;} header {visibility: hidden;}
</style>
""", unsafe_allow_html=True)

st.markdown("""
<div style="display:flex;align-items:center;gap:1rem;padding-bottom:0.5rem;border-bottom:1px solid #1e2a3a;">
    <span style="font-size:1.2rem;font-weight:800;color:#fafafa;letter-spacing:2px;">/// DIFFERENTIALS</span>
    <span style="font-size:0.75rem;color:#6b7b8d;">ICO INDICATOR PRICES — FOB BY ORIGIN GROUP</span>
</div>
""", unsafe_allow_html=True)

st.markdown("")

ORIGINS = {
    "Colombian Milds": {"region": "Colombia, Kenya, Tanzania", "base": "KC", "typical_diff": 15.0},
    "Other Milds": {"region": "Guatemala, Honduras, Ethiopia", "base": "KC", "typical_diff": 5.0},
    "Brazilian Naturals": {"region": "Brazil, Ethiopia (natural)", "base": "KC", "typical_diff": -8.0},
    "Robustas": {"region": "Vietnam, Indonesia, Uganda", "base": "RC", "typical_diff": -3.0},
}


@st.cache_data(ttl=86400)
def generate_differential_data() -> dict[str, pd.DataFrame]:
    """
    Simulated ICO differential data.
    In production, download from ico.org/prices (daily CSV).
    """
    np.random.seed(123)
    dates = pd.date_range("2019-01-01", pd.Timestamp.now().normalize(), freq="B")
    result = {}

    for name, info in ORIGINS.items():
        base = info["typical_diff"]
        seasonal_amp = 5.0
        month_phase = {"Colombian Milds": 0, "Other Milds": 1, "Brazilian Naturals": 3, "Robustas": 5}
        phase = month_phase.get(name, 0)

        seasonal = seasonal_amp * np.sin(np.arange(len(dates)) * 2 * np.pi / 252 + phase)
        trend = np.linspace(0, np.random.uniform(-5, 10), len(dates))
        noise = np.cumsum(np.random.randn(len(dates)) * 0.3)

        diff = base + seasonal + trend + noise
        df = pd.DataFrame({"differential": diff}, index=dates)
        result[name] = df

    return result


data = generate_differential_data()


def compute_zscore_2y(series: pd.Series) -> float:
    cutoff = pd.Timestamp.now().normalize() - pd.DateOffset(years=2)
    sub = series[series.index >= cutoff]
    if len(sub) < 20:
        return 0.0
    return float((sub.iloc[-1] - sub.mean()) / sub.std()) if sub.std() > 0 else 0.0


# ── KPI Cards ──
cols = st.columns(4)
for i, (name, df) in enumerate(data.items()):
    current = float(df["differential"].iloc[-1])
    zscore = compute_zscore_2y(df["differential"])
    info = ORIGINS[name]

    z_color = "#E76F51" if abs(zscore) > 2 else "#F4A261" if abs(zscore) > 1 else "#00D4AA"
    with cols[i]:
        st.metric(name, f"{current:+.1f} ¢/lb")
        st.markdown(
            f'<div style="text-align:center;font-size:0.8rem;">'
            f'Z-score: <span style="color:{z_color};font-weight:700;">{zscore:+.2f}σ</span>'
            f'<br><span style="color:#6b7b8d;font-size:0.7rem;">{info["region"]}</span></div>',
            unsafe_allow_html=True,
        )

st.markdown("")

# ── Main time-series chart ──
st.markdown('<div class="section-header">DIFFERENTIALS vs FUTURES — 5 YEAR HISTORY (¢/LB)</div>',
            unsafe_allow_html=True)

fig = go.Figure()
for name, df in data.items():
    fig.add_trace(go.Scatter(
        x=df.index, y=df["differential"].values,
        name=name,
        line=dict(color=C_COLS[name], width=1.5),
    ))

    ma = df["differential"].rolling(63).mean()
    fig.add_trace(go.Scatter(
        x=df.index, y=ma.values,
        name=f"{name} (63d MA)",
        line=dict(color=C_COLS[name], width=1, dash="dot"),
        showlegend=False,
        opacity=0.5,
    ))

fig.add_hline(y=0, line=dict(color="rgba(200,200,200,0.2)", width=1))
fig.update_layout(
    yaxis_title="differential (¢/lb vs futures)",
    legend=dict(orientation="h", y=1.08),
    height=400,
    template=T,
    margin=dict(l=40, r=10, t=20, b=30),
    paper_bgcolor="rgba(0,0,0,0)",
    plot_bgcolor="rgba(0,0,0,0)",
    xaxis=dict(gridcolor="rgba(30,42,58,0.5)"),
    yaxis=dict(gridcolor="rgba(30,42,58,0.5)"),
)
st.plotly_chart(fig, use_container_width=True)

# ── Seasonal Heatmap ──
st.markdown('<div class="section-header">SEASONAL HEATMAP — MONTHLY AVERAGE DIFFERENTIAL</div>',
            unsafe_allow_html=True)

sel_origin = st.selectbox("Origin group", list(data.keys()), label_visibility="collapsed")
df_sel = data[sel_origin]
df_sel = df_sel.copy()
df_sel["month"] = df_sel.index.month
df_sel["year"] = df_sel.index.year

pivot = df_sel.pivot_table(values="differential", index="year", columns="month", aggfunc="mean")
month_labels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
pivot.columns = month_labels[:len(pivot.columns)]

fig_hm = go.Figure(data=go.Heatmap(
    z=pivot.values,
    x=pivot.columns,
    y=[str(y) for y in pivot.index],
    colorscale=[[0, "#264653"], [0.5, "#2A9D8F"], [1, "#E76F51"]],
    text=np.round(pivot.values, 1),
    texttemplate="%{text}",
    textfont=dict(size=10),
    colorbar=dict(title="¢/lb"),
))

fig_hm.update_layout(
    title=dict(text=f"{sel_origin} — Monthly Differential", font=dict(size=12, color="#8899aa")),
    height=300,
    template=T,
    margin=dict(l=40, r=10, t=40, b=30),
    paper_bgcolor="rgba(0,0,0,0)",
    plot_bgcolor="rgba(0,0,0,0)",
)
st.plotly_chart(fig_hm, use_container_width=True)

st.markdown("---")
st.caption(
    "⚠️ Differential data is simulated. In production, download ICO daily indicator prices "
    "from ico.org/prices. Groups: Colombian Milds, Other Milds, Brazilian Naturals, Robustas. "
    "Z-score computed on 2-year rolling window."
)
