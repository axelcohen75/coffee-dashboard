"""
Brique 3: Brazil Internal Price Equivalent — FOB Santos parity vs CEPEA.
"""

import numpy as np
import pandas as pd
import plotly.graph_objects as go
import streamlit as st
from plotly.subplots import make_subplots

from utils.brazil import (
    compute_parity,
    compute_parity_series,
    fetch_brl_usd,
    fetch_brl_usd_recent,
    sensitivity_matrix,
)
from utils.conversions import LBS_PER_SACA
from utils.futures import fetch_kc_front, fetch_kc_history

st.set_page_config(page_title="Brazil Parity | Coffee Monitor", page_icon="🇧🇷", layout="wide")

T = "plotly_dark"
C_KC = "#00D4AA"
C_CEPEA = "#F4A261"
C_PARITY = "#457B9D"
C_GAP_POS = "#E76F51"
C_GAP_NEG = "#52B788"

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
    <span style="font-size:1.2rem;font-weight:800;color:#fafafa;letter-spacing:2px;">/// BRAZIL PARITY</span>
    <span style="font-size:0.75rem;color:#6b7b8d;">FOB SANTOS EXPORT PARITY vs CEPEA INTERNAL PRICE</span>
</div>
""", unsafe_allow_html=True)

st.markdown("")

# ── Inputs ──
differential = st.sidebar.number_input("Santos Differential (¢/lb)", value=-5.0, step=0.5,
                                        help="FOB Santos = KC + differential. Typical range: -10 to +5 ¢/lb")
diff_source = st.sidebar.selectbox("Differential source", ["Manual (hard-coded)", "ICO Brazilian Naturals (V2)"])

# ── Load data ──
with st.spinner("Loading Brazil parity data…"):
    kc_price = fetch_kc_front()
    fx = fetch_brl_usd_recent()
    fx_series = fetch_brl_usd()
    kc_hist = fetch_kc_history()

if kc_price and fx:
    parity = compute_parity(kc_price, fx, differential)

    # Simulated CEPEA since we can't scrape it directly without authentication
    np.random.seed(99)
    cepea_simulated = parity * (1 + np.random.uniform(-0.08, 0.12))
    cepea_value = round(cepea_simulated, 2)
    gap = round(cepea_value - parity, 2)
    gap_pct = round(gap / parity * 100, 1) if parity != 0 else 0

    # ── KPI Row ──
    c1, c2, c3, c4, c5 = st.columns(5)
    c1.metric("KC Front", f"{kc_price:.2f} ¢/lb")
    c2.metric("BRL/USD (PTAX)", f"{fx:.4f}")
    c3.metric("Differential", f"{differential:+.1f} ¢/lb",
              help=f"Source: {diff_source}")
    c4.metric("CEPEA Arabica", f"R$ {cepea_value:,.2f}/saca",
              help="Simulated — connect CEPEA feed for live data")
    gap_color = "inverse" if gap > 0 else "normal"
    c5.metric("GAP (CEPEA − Parity)", f"R$ {gap:,.2f}/saca",
              delta=f"{gap_pct:+.1f}%", delta_color=gap_color)

    st.markdown("")

    # ── Explanation ──
    if gap > 0:
        st.error(
            f"**GAP POSITIF (+{gap:.2f} R$/saca)** — Le marché interne brésilien est au-dessus de la "
            "parité export. Les producteurs hoardent, les exports ralentissent → signal physique haussier.",
            icon="🔴"
        )
    else:
        st.success(
            f"**GAP NÉGATIF ({gap:.2f} R$/saca)** — Le marché interne est sous la parité export. "
            "Les exportateurs ont la marge, exports robustes attendus → signal physique de détente.",
            icon="🟢"
        )

    st.markdown("")

    # ── Main charts ──
    chart_col, gauge_col = st.columns([3, 1])

    with chart_col:
        st.markdown('<div class="section-header">CEPEA vs EXPORT PARITY — HISTORICAL (R$/SACA)</div>',
                    unsafe_allow_html=True)

        if not kc_hist.empty and not fx_series.empty:
            kc_s = kc_hist["Close"].copy()
            if kc_s.index.tz is not None:
                kc_s.index = kc_s.index.tz_localize(None)

            parity_hist = compute_parity_series(kc_s, fx_series["BRL_USD"], differential)

            if not parity_hist.empty:
                np.random.seed(77)
                noise = pd.Series(
                    np.cumsum(np.random.randn(len(parity_hist)) * 3),
                    index=parity_hist.index,
                )
                cepea_hist = parity_hist * 1.02 + noise

                fig = go.Figure()

                gap_hist = cepea_hist - parity_hist
                pos_mask = gap_hist >= 0
                neg_mask = gap_hist < 0

                fig.add_trace(go.Scatter(
                    x=parity_hist.index, y=parity_hist.values,
                    name="Export Parity (théorique)",
                    line=dict(color=C_PARITY, width=2),
                ))
                fig.add_trace(go.Scatter(
                    x=cepea_hist.index, y=cepea_hist.values,
                    name="CEPEA (simulé)",
                    line=dict(color=C_CEPEA, width=2),
                    fill="tonexty",
                    fillcolor="rgba(231,111,81,0.15)",
                ))

                fig.update_layout(
                    yaxis_title="R$ / saca (60kg)",
                    legend=dict(orientation="h", y=1.05),
                    height=400,
                    template=T,
                    margin=dict(l=40, r=10, t=20, b=30),
                    paper_bgcolor="rgba(0,0,0,0)",
                    plot_bgcolor="rgba(0,0,0,0)",
                    xaxis=dict(gridcolor="rgba(30,42,58,0.5)"),
                    yaxis=dict(gridcolor="rgba(30,42,58,0.5)"),
                )
                st.plotly_chart(fig, use_container_width=True)

    with gauge_col:
        st.markdown('<div class="section-header">GAP PERCENTILE (5Y)</div>', unsafe_allow_html=True)

        if not parity_hist.empty:
            gap_hist_vals = (cepea_hist - parity_hist).dropna()
            percentile = round(float((gap_hist_vals < gap).mean() * 100), 0)

            fig_gauge = go.Figure(go.Indicator(
                mode="gauge+number",
                value=percentile,
                number=dict(suffix="%ile", font=dict(size=28, color="#fafafa")),
                gauge=dict(
                    axis=dict(range=[0, 100], tickcolor="#6b7b8d"),
                    bar=dict(color=C_GAP_POS if gap > 0 else C_GAP_NEG),
                    bgcolor="#141824",
                    bordercolor="#1e2a3a",
                    steps=[
                        dict(range=[0, 25], color="rgba(82,183,136,0.2)"),
                        dict(range=[25, 75], color="rgba(69,123,157,0.2)"),
                        dict(range=[75, 100], color="rgba(231,111,81,0.2)"),
                    ],
                ),
                title=dict(text="Current Gap vs 5Y Distribution", font=dict(size=11, color="#6b7b8d")),
            ))
            fig_gauge.update_layout(
                height=300, template=T,
                margin=dict(l=20, r=20, t=40, b=10),
                paper_bgcolor="rgba(0,0,0,0)",
            )
            st.plotly_chart(fig_gauge, use_container_width=True)

    # ── Sensitivity Matrix ──
    st.markdown('<div class="section-header">SENSITIVITY MATRIX — PARITY (R$/SACA)</div>',
                unsafe_allow_html=True)
    st.caption("What-if: Parity for different KC and FX scenarios")

    matrix = sensitivity_matrix(kc_price, fx, differential)

    def _style_matrix(val):
        try:
            v = float(val)
            return f"background-color: rgba(0,212,170,0.15)" if v < cepea_value \
                else f"background-color: rgba(231,111,81,0.15)"
        except (ValueError, TypeError):
            return ""

    st.dataframe(
        matrix.style.applymap(_style_matrix),
        use_container_width=True,
        height=250,
    )
    st.caption("🟢 Green = parity below CEPEA (exporter has margin) · 🔴 Red = parity above CEPEA")

    # ── Formula explanation ──
    with st.expander("📐 Parity Calculation Formula"):
        st.markdown(f"""
        **Step 1 — FOB Santos (¢/lb):**
        ```
        FOB = KC front ({kc_price:.2f}) + differential ({differential:+.1f}) = {kc_price + differential:.2f} ¢/lb
        ```

        **Step 2 — Convert to R$/saca:**
        ```
        Parity = {kc_price + differential:.2f} × {LBS_PER_SACA:.3f} / 100 × {fx:.4f} = R$ {parity:,.2f}/saca
        ```

        **Step 3 — Gap:**
        ```
        Gap = CEPEA ({cepea_value:,.2f}) − Parity ({parity:,.2f}) = R$ {gap:+,.2f}/saca
        ```

        Gap négatif → interne < parité → exporters ont la marge, exports robustes attendus.
        Gap positif → l'interne hoarde, exports ralentissent, signal physique haussier.
        """)

else:
    st.error("Could not load KC price or BRL/USD exchange rate. Check your connection.")

st.markdown("---")
st.caption(
    "Sources: KC via Yahoo Finance · BRL/USD PTAX via Banco Central do Brasil · "
    "CEPEA simulated (connect cepea.esalq.usp.br for live) · "
    f"Differential: {diff_source}"
)
