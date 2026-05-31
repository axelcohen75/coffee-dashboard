"""Inventory page: ICE certified arabica and robusta stocks."""

import numpy as np
import pandas as pd
import plotly.graph_objects as go
import streamlit as st
from plotly.subplots import make_subplots

st.set_page_config(page_title="Inventory | Coffee Monitor", page_icon="📦", layout="wide")

T = "plotly_dark"
C_KC = "#00D4AA"
C_RC = "#457B9D"
C_SP = "#E76F51"

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
    <span style="font-size:1.2rem;font-weight:800;color:#fafafa;letter-spacing:2px;">/// INVENTORY</span>
    <span style="font-size:0.75rem;color:#6b7b8d;">ICE CERTIFIED STOCKS — ARABICA & ROBUSTA</span>
</div>
""", unsafe_allow_html=True)

st.markdown("")

WORLD_ARABICA_CONSUMPTION_BAGS_PER_YEAR = 100_000_000
DAILY_CONSUMPTION = WORLD_ARABICA_CONSUMPTION_BAGS_PER_YEAR / 365


@st.cache_data(ttl=86400)
def load_stocks_data() -> dict:
    """
    Generate synthetic ICE certified stocks data for demonstration.
    In production, this would parse ICE daily stock reports.
    """
    np.random.seed(42)
    dates = pd.date_range("2019-01-01", pd.Timestamp.now().normalize(), freq="B")

    arabica_base = 2_200_000
    trend = np.linspace(0, -1_400_000, len(dates))
    seasonal = 200_000 * np.sin(np.arange(len(dates)) * 2 * np.pi / 252)
    noise = np.cumsum(np.random.randn(len(dates)) * 5000)
    arabica = np.maximum(arabica_base + trend + seasonal + noise, 300_000)

    robusta_base = 4_500
    r_trend = np.linspace(0, -2_000, len(dates))
    r_seasonal = 500 * np.sin(np.arange(len(dates)) * 2 * np.pi / 252 + np.pi / 4)
    r_noise = np.cumsum(np.random.randn(len(dates)) * 30)
    robusta = np.maximum(robusta_base + r_trend + r_seasonal + r_noise, 1_000)

    ports = {
        "Antwerp": 0.25, "Bremen": 0.15, "Hamburg": 0.12,
        "Houston": 0.18, "New Orleans": 0.10, "Miami": 0.08,
        "Barcelona": 0.07, "Other": 0.05,
    }

    return {
        "dates": dates,
        "arabica": arabica,
        "robusta": robusta,
        "arabica_current": int(arabica[-1]),
        "robusta_current": int(robusta[-1]),
        "arabica_1m_ago": int(arabica[-22]) if len(arabica) > 22 else int(arabica[0]),
        "robusta_1m_ago": int(robusta[-22]) if len(robusta) > 22 else int(robusta[0]),
        "ports": ports,
        "port_values": {p: int(arabica[-1] * share) for p, share in ports.items()},
    }


data = load_stocks_data()

arab_var = data["arabica_current"] - data["arabica_1m_ago"]
arab_var_pct = (arab_var / data["arabica_1m_ago"]) * 100
rob_var = data["robusta_current"] - data["robusta_1m_ago"]
rob_var_pct = (rob_var / data["robusta_1m_ago"]) * 100
days_consumption = data["arabica_current"] / DAILY_CONSUMPTION

c1, c2, c3, c4 = st.columns(4)
c1.metric("Arabica Certified", f"{data['arabica_current']:,} bags",
          delta=f"{arab_var:+,} ({arab_var_pct:+.1f}%) 1M")
c2.metric("Robusta Certified", f"{data['robusta_current']:,} tonnes",
          delta=f"{rob_var:+,} ({rob_var_pct:+.1f}%) 1M")
c3.metric("Days of Consumption", f"{days_consumption:.0f} days",
          help="Arabica certified stocks ÷ world daily consumption (~274k bags/day)")
c4.metric("YoY Change", f"{((data['arabica'][-1] / data['arabica'][-252]) - 1) * 100:+.1f}%"
          if len(data['arabica']) > 252 else "—")

st.markdown("")

# ── Main chart: Stocks vs N-Z Spread (dual axis) ──
left, right = st.columns([2, 1])

with left:
    st.markdown('<div class="section-header">ARABICA STOCKS vs KC N-Z SPREAD — 5 YEARS</div>',
                unsafe_allow_html=True)

    from utils.futures import fetch_intramarket_spread
    nz = fetch_intramarket_spread("N", "Z", cross_year=False)

    fig = make_subplots(specs=[[{"secondary_y": True}]])

    dates = data["dates"]
    fig.add_trace(go.Scatter(
        x=dates, y=data["arabica"],
        name="Arabica Certified Stocks (bags)",
        line=dict(color=C_KC, width=2),
        fill="tozeroy", fillcolor="rgba(0,212,170,0.08)",
    ), secondary_y=False)

    if not nz.empty:
        fig.add_trace(go.Scatter(
            x=nz.index, y=nz.values,
            name="KC N-Z Spread (¢/lb)",
            line=dict(color=C_SP, width=1.5, dash="dot"),
        ), secondary_y=True)

    events = [
        ("2021-07-20", "Gel Brésil\njuil. 2021", data["arabica"].max() * 0.9),
        ("2024-03-01", "Sécheresse\n2024", data["arabica"].max() * 0.7),
    ]
    for date_str, text, y_pos in events:
        dt = pd.Timestamp(date_str)
        if dt >= dates[0]:
            fig.add_annotation(x=dt, y=y_pos, text=text,
                               showarrow=True, arrowhead=2,
                               font=dict(color="#F4A261", size=10),
                               arrowcolor="#F4A261", secondary_y=False)

    fig.update_layout(
        legend=dict(orientation="h", y=1.05),
        height=420,
        template=T,
        margin=dict(l=40, r=40, t=20, b=30),
        paper_bgcolor="rgba(0,0,0,0)",
        plot_bgcolor="rgba(0,0,0,0)",
    )
    fig.update_yaxes(title_text="bags (60kg)", secondary_y=False, gridcolor="rgba(30,42,58,0.5)")
    fig.update_yaxes(title_text="¢/lb", secondary_y=True, gridcolor="rgba(30,42,58,0.3)")
    fig.update_xaxes(gridcolor="rgba(30,42,58,0.5)")
    st.plotly_chart(fig, use_container_width=True)

# ── Port breakdown ──
with right:
    st.markdown('<div class="section-header">BREAKDOWN BY PORT</div>', unsafe_allow_html=True)

    port_df = pd.DataFrame({
        "Port": list(data["port_values"].keys()),
        "Bags": list(data["port_values"].values()),
    }).sort_values("Bags", ascending=True)

    fig_port = go.Figure()
    fig_port.add_trace(go.Bar(
        y=port_df["Port"], x=port_df["Bags"],
        orientation="h",
        marker=dict(color=C_KC),
        text=[f"{v:,}" for v in port_df["Bags"]],
        textposition="auto",
    ))
    fig_port.update_layout(
        height=420,
        template=T,
        margin=dict(l=0, r=10, t=10, b=30),
        paper_bgcolor="rgba(0,0,0,0)",
        plot_bgcolor="rgba(0,0,0,0)",
        xaxis=dict(gridcolor="rgba(30,42,58,0.5)"),
        yaxis=dict(gridcolor="rgba(30,42,58,0.5)"),
    )
    st.plotly_chart(fig_port, use_container_width=True)

# ── Robusta stocks ──
st.markdown('<div class="section-header">ROBUSTA CERTIFIED STOCKS (ICE EUROPE) — TONNES</div>',
            unsafe_allow_html=True)

fig_rob = go.Figure()
fig_rob.add_trace(go.Scatter(
    x=data["dates"], y=data["robusta"],
    name="Robusta Stocks",
    line=dict(color=C_RC, width=2),
    fill="tozeroy", fillcolor="rgba(69,123,157,0.08)",
))
fig_rob.update_layout(
    yaxis_title="tonnes",
    height=280,
    template=T,
    margin=dict(l=40, r=10, t=10, b=30),
    paper_bgcolor="rgba(0,0,0,0)",
    plot_bgcolor="rgba(0,0,0,0)",
    xaxis=dict(gridcolor="rgba(30,42,58,0.5)"),
    yaxis=dict(gridcolor="rgba(30,42,58,0.5)"),
)
st.plotly_chart(fig_rob, use_container_width=True)

st.markdown("---")
st.caption(
    "⚠️ Stock data is simulated for demonstration. In production, parse ICE daily "
    "Certified Stock Reports (theice.com → Market Data → Reports). "
    "Robusta stocks from ICE Futures Europe."
)
