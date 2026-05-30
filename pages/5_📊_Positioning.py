"""
Brique 6: CFTC Positioning — Managed Money & Commercials.
"""

import numpy as np
import pandas as pd
import plotly.graph_objects as go
import streamlit as st
from plotly.subplots import make_subplots

from utils.cftc import compute_zscore, fetch_cot_data

st.set_page_config(page_title="Positioning | Coffee Monitor", page_icon="📊", layout="wide")

T = "plotly_dark"
C_LONG = "#00D4AA"
C_SHORT = "#E76F51"
C_NET = "#F4A261"
C_COMM = "#457B9D"

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
    <span style="font-size:1.2rem;font-weight:800;color:#fafafa;letter-spacing:2px;">/// POSITIONING</span>
    <span style="font-size:0.75rem;color:#6b7b8d;">CFTC COT — MANAGED MONEY & COMMERCIALS</span>
</div>
""", unsafe_allow_html=True)

st.markdown("")

# ── Load COT data ──
with st.spinner("Loading CFTC Commitments of Traders data…"):
    cot = fetch_cot_data()

if cot.empty:
    st.warning(
        "CFTC COT data could not be loaded. This may be due to network restrictions or "
        "the CFTC website being temporarily unavailable. Showing simulated data for demonstration."
    )

    np.random.seed(55)
    dates = pd.date_range("2019-01-01", pd.Timestamp.now().normalize(), freq="W-TUE")
    mm_net = np.cumsum(np.random.randn(len(dates)) * 1500) + 30000
    prod_net = -mm_net * 0.7 + np.cumsum(np.random.randn(len(dates)) * 800)
    oi = 250000 + np.cumsum(np.random.randn(len(dates)) * 500)
    cot = pd.DataFrame({
        "mm_long": np.maximum(mm_net, 0) + 20000,
        "mm_short": np.maximum(-mm_net, 0) + 15000,
        "mm_net": mm_net,
        "prod_long": np.maximum(-prod_net, 0) + 30000,
        "prod_short": np.maximum(prod_net, 0) + 25000,
        "prod_net": prod_net,
        "oi": oi,
    }, index=dates)

# ── Compute Z-score ──
mm_zscore = compute_zscore(cot["mm_net"])
current_zscore = float(mm_zscore.iloc[-1]) if not mm_zscore.empty else 0
current_mm_net = float(cot["mm_net"].iloc[-1])
current_prod_net = float(cot["prod_net"].iloc[-1]) if "prod_net" in cot else 0
current_oi = float(cot["oi"].iloc[-1]) if "oi" in cot else 0

# ── KPIs ──
c1, c2, c3, c4 = st.columns(4)
c1.metric("MM Net Position", f"{current_mm_net:+,.0f} lots")

z_text = f"{current_zscore:+.2f}σ"
if abs(current_zscore) > 2:
    c2.metric("Z-Score (2Y)", z_text, help="⚠️ Extreme positioning — contrarian signal")
elif abs(current_zscore) > 1:
    c2.metric("Z-Score (2Y)", z_text, help="Elevated positioning")
else:
    c2.metric("Z-Score (2Y)", z_text, help="Normal range")

c3.metric("Commercials Net", f"{current_prod_net:+,.0f} lots")
c4.metric("Open Interest", f"{current_oi:,.0f} lots")

# ── Signal interpretation ──
if current_zscore > 2:
    st.warning("⚠️ **Specs très longs (Z > +2σ)** — Positionnement extrême haussier. "
               "Historiquement, c'est un signal contrarian de correction potentielle.", icon="⚠️")
elif current_zscore < -2:
    st.info("ℹ️ **Specs très shorts (Z < −2σ)** — Positionnement extrême baissier. "
            "Historiquement, c'est un signal contrarian de rebond potentiel.", icon="ℹ️")

st.markdown("")

# ── Main charts ──
chart_col, gauge_col = st.columns([3, 1])

with chart_col:
    st.markdown('<div class="section-header">MANAGED MONEY & COMMERCIALS — NET POSITIONS</div>',
                unsafe_allow_html=True)

    fig = make_subplots(rows=2, cols=1, shared_xaxes=True, vertical_spacing=0.08,
                        row_heights=[0.6, 0.4],
                        subplot_titles=["Managed Money Net (lots)", "Commercials Net (lots)"])

    fig.add_trace(go.Bar(
        x=cot.index, y=cot["mm_long"],
        name="MM Longs", marker=dict(color=C_LONG, opacity=0.3),
    ), row=1, col=1)
    fig.add_trace(go.Bar(
        x=cot.index, y=-cot["mm_short"],
        name="MM Shorts", marker=dict(color=C_SHORT, opacity=0.3),
    ), row=1, col=1)
    fig.add_trace(go.Scatter(
        x=cot.index, y=cot["mm_net"],
        name="MM Net", line=dict(color=C_NET, width=2),
    ), row=1, col=1)

    fig.add_trace(go.Scatter(
        x=cot.index, y=cot["prod_net"],
        name="Commercials Net", line=dict(color=C_COMM, width=2),
    ), row=2, col=1)

    fig.add_hline(y=0, line=dict(color="rgba(200,200,200,0.2)", width=1), row=1, col=1)
    fig.add_hline(y=0, line=dict(color="rgba(200,200,200,0.2)", width=1), row=2, col=1)

    fig.update_layout(
        legend=dict(orientation="h", y=1.08),
        height=500,
        template=T,
        margin=dict(l=40, r=10, t=40, b=30),
        paper_bgcolor="rgba(0,0,0,0)",
        plot_bgcolor="rgba(0,0,0,0)",
        barmode="overlay",
    )
    for i in range(1, 3):
        fig.update_xaxes(gridcolor="rgba(30,42,58,0.5)", row=i, col=1)
        fig.update_yaxes(gridcolor="rgba(30,42,58,0.5)", row=i, col=1)

    st.plotly_chart(fig, use_container_width=True)

with gauge_col:
    st.markdown('<div class="section-header">MM Z-SCORE GAUGE</div>', unsafe_allow_html=True)

    gauge_color = C_SHORT if current_zscore > 1.5 else C_LONG if current_zscore < -1.5 else C_NET

    fig_gauge = go.Figure(go.Indicator(
        mode="gauge+number",
        value=current_zscore,
        number=dict(suffix="σ", font=dict(size=32, color="#fafafa")),
        gauge=dict(
            axis=dict(range=[-3, 3], tickcolor="#6b7b8d",
                      tickvals=[-3, -2, -1, 0, 1, 2, 3]),
            bar=dict(color=gauge_color),
            bgcolor="#141824",
            bordercolor="#1e2a3a",
            steps=[
                dict(range=[-3, -2], color="rgba(0,212,170,0.2)"),
                dict(range=[-2, -1], color="rgba(0,212,170,0.1)"),
                dict(range=[-1, 1], color="rgba(69,123,157,0.1)"),
                dict(range=[1, 2], color="rgba(231,111,81,0.1)"),
                dict(range=[2, 3], color="rgba(231,111,81,0.2)"),
            ],
            threshold=dict(line=dict(color="#fafafa", width=2), thickness=0.8, value=current_zscore),
        ),
        title=dict(text="Managed Money<br>2Y Z-Score", font=dict(size=11, color="#6b7b8d")),
    ))
    fig_gauge.update_layout(
        height=300, template=T,
        margin=dict(l=20, r=20, t=40, b=10),
        paper_bgcolor="rgba(0,0,0,0)",
    )
    st.plotly_chart(fig_gauge, use_container_width=True)

    st.markdown("""
    <div style="font-size:0.75rem;color:#6b7b8d;padding:0.5rem;">
        <div style="margin-bottom:0.3rem;"><span style="color:#00D4AA;">■</span> Z < −2σ: Specs very short → contrarian bullish</div>
        <div style="margin-bottom:0.3rem;"><span style="color:#457B9D;">■</span> −1σ to +1σ: Normal range</div>
        <div><span style="color:#E76F51;">■</span> Z > +2σ: Specs very long → contrarian bearish</div>
    </div>
    """, unsafe_allow_html=True)

# ── Z-score history ──
st.markdown('<div class="section-header">Z-SCORE HISTORY (2Y ROLLING)</div>', unsafe_allow_html=True)

fig_z = go.Figure()
fig_z.add_hrect(y0=-2, y1=2, fillcolor="rgba(69,123,157,0.05)", layer="below", line_width=0)
fig_z.add_hrect(y0=2, y1=4, fillcolor="rgba(231,111,81,0.1)", layer="below", line_width=0)
fig_z.add_hrect(y0=-4, y1=-2, fillcolor="rgba(0,212,170,0.1)", layer="below", line_width=0)

fig_z.add_trace(go.Scatter(
    x=mm_zscore.index, y=mm_zscore.values,
    name="MM Net Z-Score",
    line=dict(color=C_NET, width=1.5),
    fill="tozeroy",
    fillcolor="rgba(244,162,97,0.1)",
))

for level, label in [(2, "+2σ"), (-2, "−2σ")]:
    fig_z.add_hline(y=level, line=dict(color="rgba(200,200,200,0.2)", dash="dot", width=1),
                    annotation_text=label, annotation_position="bottom right",
                    annotation_font=dict(color="#6b7b8d", size=9))

fig_z.add_hline(y=0, line=dict(color="rgba(200,200,200,0.15)", width=1))

fig_z.update_layout(
    yaxis_title="Z-score (σ)",
    height=280, template=T,
    margin=dict(l=40, r=10, t=10, b=30),
    paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)",
    xaxis=dict(gridcolor="rgba(30,42,58,0.5)"),
    yaxis=dict(gridcolor="rgba(30,42,58,0.5)"),
)
st.plotly_chart(fig_z, use_container_width=True)

# ── Latest weekly note link ──
st.markdown('<div class="section-header">WEEKLY MARKET NOTE</div>', unsafe_allow_html=True)

import os
from pathlib import Path

notes_dir = Path(__file__).parent.parent / "notes"
notes = sorted(notes_dir.glob("*.md"), reverse=True) if notes_dir.exists() else []

if notes:
    latest = notes[0]
    st.markdown(f"📝 Latest note: **{latest.stem}**")
    with st.expander("View note"):
        st.markdown(latest.read_text())
else:
    st.info(
        "No weekly notes yet. Run `python etl/weekly_note.py` each Friday to generate one. "
        "The 'My read' section is for your manual market commentary."
    )

st.markdown("---")
st.caption(
    "Sources: CFTC Commitments of Traders (Disaggregated Futures Only) · "
    "Coffee commodity code: 083731 · "
    "Z-score: 2-year (104 weeks) rolling window · "
    "Published each Friday for Tuesday data"
)
