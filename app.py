"""
Coffee Market Monitor — Professional Trading Dashboard
Overview page: Spot prices, price evolution, term structure, spreads, news, Polymarket.
"""

from datetime import datetime

import numpy as np
import pandas as pd
import plotly.graph_objects as go
import streamlit as st

from utils.futures import (
    apply_seasonal_to_series,
    compute_performance,
    compute_seasonal,
    fetch_forward_curve,
    fetch_intramarket_spread,
    fetch_kc_front,
    fetch_kc_history,
    fetch_rc_front,
    fetch_rc_history,
)
from utils.conversions import USD_T_TO_CENTS_LB
from utils.news import SENTIMENT_COLORS, fetch_coffee_news
from utils.polymarket import fetch_coffee_markets

st.set_page_config(
    page_title="Coffee Market Monitor",
    page_icon="☕",
    layout="wide",
    initial_sidebar_state="collapsed",
)

# ── Theme constants ──────────────────────────────────────────────────────────
T = "plotly_dark"
C_KC = "#00D4AA"
C_RC = "#457B9D"
C_SP = "#E76F51"
C_SEA = "#52B788"
C_ACCENT = "#F4A261"
BG = "#0e1117"
CARD_BG = "#141824"

HORIZON_OFFSETS = {
    "1D": pd.DateOffset(days=5),
    "1W": pd.DateOffset(weeks=1),
    "1M": pd.DateOffset(months=1),
    "3M": pd.DateOffset(months=3),
    "YTD": None,
    "1Y": pd.DateOffset(years=1),
    "5Y": pd.DateOffset(years=5),
    "10Y": pd.DateOffset(years=10),
}

SPREAD_OPTS = {
    "KC−RC (Arb/Rob)": ("arb_rob", "K", "N", False),
    "KC K−N (May−Jul)": ("intra", "K", "N", False),
    "KC N−Z (Jul−Dec)": ("intra", "N", "Z", False),
    "KC Z−H (Dec−Mar)": ("intra", "Z", "H", True),
}

# ── Custom CSS for dark trading terminal look ────────────────────────────────
st.markdown("""
<style>
    .stApp { background-color: #0a0e1a; }
    section[data-testid="stSidebar"] { background-color: #0d1117; }
    .block-container { padding-top: 1rem; padding-bottom: 0; }

    /* Header bar */
    .header-bar {
        display: flex; align-items: center; gap: 1.5rem;
        padding: 0.5rem 0; border-bottom: 1px solid #1e2a3a;
        margin-bottom: 1rem;
    }
    .header-logo { font-size: 1.4rem; font-weight: 800; color: #fafafa; letter-spacing: 2px; }
    .header-section { font-size: 0.85rem; color: #8899aa; letter-spacing: 1px; }

    /* Navigation tabs */
    .nav-tab {
        display: inline-block; padding: 0.3rem 1rem;
        font-size: 0.75rem; letter-spacing: 1px; color: #8899aa;
        text-transform: uppercase; cursor: pointer;
    }
    .nav-tab-active {
        display: inline-block; padding: 0.3rem 1rem;
        font-size: 0.75rem; letter-spacing: 1px;
        background: #00D4AA; color: #0a0e1a; font-weight: 700;
        text-transform: uppercase;
    }

    /* Cards */
    .metric-card {
        background: #141824; border: 1px solid #1e2a3a; border-radius: 4px;
        padding: 0.6rem 0.8rem; margin-bottom: 0.5rem;
    }
    .metric-label { font-size: 0.7rem; color: #6b7b8d; text-transform: uppercase; letter-spacing: 1px; }
    .metric-value { font-size: 1.1rem; font-weight: 700; }
    .metric-sub { font-size: 0.75rem; color: #6b7b8d; }
    .metric-green { color: #00D4AA; }
    .metric-red { color: #E76F51; }

    /* Section headers */
    .section-header {
        font-size: 0.75rem; color: #6b7b8d; letter-spacing: 1.5px;
        text-transform: uppercase; padding: 0.5rem 0; border-bottom: 1px solid #1e2a3a;
        margin: 0.5rem 0;
    }

    /* News items */
    .news-item {
        padding: 0.6rem 0; border-bottom: 1px solid #1a1f2e;
    }
    .news-sentiment {
        display: inline-block; padding: 1px 6px; border-radius: 2px;
        font-size: 0.65rem; font-weight: 700; letter-spacing: 0.5px;
    }
    .news-title { font-size: 0.8rem; color: #d0d8e0; margin: 0.2rem 0; }
    .news-summary { font-size: 0.7rem; color: #6b7b8d; line-height: 1.4; }
    .news-meta { font-size: 0.65rem; color: #4a5568; }
    .news-link { font-size: 0.7rem; color: #00D4AA; text-decoration: none; }

    /* Polymarket */
    .poly-card {
        background: #141824; border: 1px solid #1e2a3a; border-radius: 4px;
        padding: 0.8rem; margin-bottom: 0.5rem;
    }
    .poly-question { font-size: 0.8rem; color: #d0d8e0; margin-bottom: 0.4rem; }
    .poly-yes { color: #00D4AA; font-weight: 700; font-size: 1.1rem; }
    .poly-no { color: #E76F51; font-weight: 700; font-size: 1.1rem; }

    /* Spread dashboard items */
    .spread-item {
        display: flex; justify-content: space-between; align-items: center;
        padding: 0.3rem 0; border-bottom: 1px solid #1a1f2e;
    }
    .spread-label { font-size: 0.75rem; color: #8899aa; }
    .spread-value { font-size: 0.85rem; font-weight: 600; }

    div[data-testid="stMetric"] {
        background: #141824; border: 1px solid #1e2a3a; border-radius: 4px;
        padding: 0.6rem; text-align: center;
    }

    /* Hide streamlit branding */
    #MainMenu {visibility: hidden;}
    footer {visibility: hidden;}
    header {visibility: hidden;}
</style>
""", unsafe_allow_html=True)


def _cutoff(horizon: str) -> pd.Timestamp:
    now = pd.Timestamp.now().normalize()
    if horizon == "YTD":
        return pd.Timestamp(f"{now.year}-01-01")
    return now - HORIZON_OFFSETS[horizon]


def _strip_tz(s: pd.Series) -> pd.Series:
    if s.index.tz is not None:
        s = s.copy()
        s.index = s.index.tz_localize(None)
    return s


def _pct_color(val):
    if val is None or (isinstance(val, float) and np.isnan(val)):
        return "—", "#6b7b8d"
    return (f"+{val:.2f}%", "#00D4AA") if val >= 0 else (f"{val:.2f}%", "#E76F51")


# ── Header ───────────────────────────────────────────────────────────────────
st.markdown("""
<div class="header-bar">
    <span class="header-logo">/// COFFEE DERIVATIVES</span>
    <span class="nav-tab-active">OVERVIEW</span>
    <span class="nav-tab">PHYSICAL</span>
    <span class="nav-tab">POSITIONING</span>
    <span class="nav-tab">WEATHER</span>
    <span class="nav-tab">BRAZIL PARITY</span>
</div>
""", unsafe_allow_html=True)

# ── Load data ────────────────────────────────────────────────────────────────
with st.spinner("Loading market data…"):
    kc_price = fetch_kc_front()
    rc_price = fetch_rc_front()
    kc_hist = fetch_kc_history()
    rc_hist = fetch_rc_history()
    curve = fetch_forward_curve(n=8)

kc_s = _strip_tz(kc_hist["Close"]) if not kc_hist.empty else None
rc_s_usd = _strip_tz(rc_hist["Close"]) if not rc_hist.empty else None
rc_s_cl = rc_s_usd * USD_T_TO_CENTS_LB if rc_s_usd is not None else None

spread_s = None
if kc_s is not None and rc_s_cl is not None:
    sp = (kc_s - rc_s_cl).dropna()
    spread_s = sp if not sp.empty else None

rc_cl_price = round(rc_price * USD_T_TO_CENTS_LB, 2) if rc_price else None
spread_val = round(kc_price - rc_cl_price, 2) if (kc_price and rc_cl_price) else None
spread_mean = round(float(spread_s.mean()), 2) if spread_s is not None else None

kc_perf = compute_performance(kc_s) if kc_s is not None else {}
rc_perf = compute_performance(rc_s_usd) if rc_s_usd is not None else {}

# ── MAIN LAYOUT ──────────────────────────────────────────────────────────────
left_col, center_col, right_col = st.columns([1.2, 3.5, 1.8])

# ═══════════════════════════════════════════════════════════════════════════
# LEFT COLUMN: Spot Prices + Market Indices + News
# ═══════════════════════════════════════════════════════════════════════════
with left_col:
    # ── Spot Prices ──
    st.markdown('<div class="section-header">SPOT PRICES</div>', unsafe_allow_html=True)

    kc_1d_txt, kc_1d_color = _pct_color(kc_perf.get("1D"))
    kc_1m_txt, _ = _pct_color(kc_perf.get("1M"))

    items = []
    if kc_price:
        items.append(("KC Arabica", f"{kc_price:.2f}", "¢/lb", kc_perf.get("1D"), kc_perf.get("1M")))
    if rc_price:
        rc_1d = rc_perf.get("1D")
        rc_1m = rc_perf.get("1M")
        items.append(("RC Robusta", f"{rc_price:,.0f}", "$/t", rc_1d, rc_1m))
    if rc_cl_price:
        items.append(("RC (¢/lb)", f"{rc_cl_price:.2f}", "¢/lb", None, None))
    if spread_val is not None:
        items.append(("Arb-Rob Spread", f"{spread_val:.2f}", "¢/lb", None, None))

    for name, val, unit, d1, d1m in items:
        d1_txt, d1_col = _pct_color(d1)
        dm_txt, dm_col = _pct_color(d1m)
        st.markdown(f"""
        <div class="metric-card">
            <div style="display:flex;justify-content:space-between;align-items:baseline;">
                <span class="metric-label">{name}</span>
                <span class="metric-sub">{unit}</span>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:0.2rem;">
                <span class="metric-value" style="color:#00D4AA;">{val}</span>
                <span style="font-size:0.75rem;">
                    <span style="color:{d1_col}">{d1_txt}</span>
                    <span style="color:{dm_col};margin-left:0.5rem;">{dm_txt}</span>
                </span>
            </div>
        </div>
        """, unsafe_allow_html=True)

    # ── Coffee News ──
    st.markdown('<div class="section-header">COFFEE NEWS</div>', unsafe_allow_html=True)

    news = fetch_coffee_news()
    if news:
        for article in news[:7]:
            sent = article["sentiment"]
            sent_bg = SENTIMENT_COLORS.get(sent, "#457B9D")
            age = article.get("age", "")
            st.markdown(f"""
            <div class="news-item">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                    <span class="news-sentiment" style="background:{sent_bg};color:#fff;">{sent}</span>
                    <span class="news-meta">{age}</span>
                </div>
                <div class="news-title"><b>{article['title'][:90]}</b></div>
                <div class="news-summary">{article['summary'][:150]}…</div>
                <a class="news-link" href="{article['url']}" target="_blank">READ ARTICLE →</a>
            </div>
            """, unsafe_allow_html=True)
    else:
        st.info("No coffee news available at the moment.")

# ═══════════════════════════════════════════════════════════════════════════
# CENTER COLUMN: Charts
# ═══════════════════════════════════════════════════════════════════════════
with center_col:
    # ── Top row: Price Evolution ──
    top_chart, top_right = st.columns([2, 1.2])

    with top_chart:
        st.markdown("""
        <div style="display:flex;justify-content:space-between;align-items:center;">
            <div>
                <span style="font-size:0.9rem;font-weight:700;color:#fafafa;">PRICE EVOLUTION</span><br>
                <span style="font-size:0.7rem;color:#6b7b8d;">KC ARABICA // FRONT MONTH</span>
            </div>
        </div>
        """, unsafe_allow_html=True)

        horizon = st.radio(
            "Horizon", list(HORIZON_OFFSETS.keys()), index=4, horizontal=True,
            label_visibility="collapsed", key="main_horizon"
        )

        if kc_s is not None:
            cutoff = _cutoff(horizon)
            sub = kc_s[kc_s.index >= cutoff].dropna()
            if not sub.empty:
                fig = go.Figure()
                fig.add_trace(go.Scatter(
                    x=sub.index, y=sub.values,
                    name="KC Arabica",
                    line=dict(color=C_KC, width=2),
                    fill="tozeroy",
                    fillcolor="rgba(0,212,170,0.08)",
                ))

                seas = compute_seasonal(kc_hist[["Close"]] if not kc_hist.empty else pd.DataFrame())
                if not seas.empty:
                    aligned = apply_seasonal_to_series(sub, seas)
                    if not aligned.empty:
                        fig.add_trace(go.Scatter(
                            x=sub.index, y=aligned.values,
                            name="5y Seasonal",
                            line=dict(color=C_SEA, width=1.5, dash="dash"),
                            opacity=0.6,
                        ))

                fig.update_layout(
                    yaxis_title="¢/lb",
                    legend=dict(orientation="h", y=1.02, x=0.5, xanchor="center"),
                    height=320,
                    template=T,
                    margin=dict(l=40, r=10, t=10, b=30),
                    paper_bgcolor="rgba(0,0,0,0)",
                    plot_bgcolor="rgba(0,0,0,0)",
                    xaxis=dict(gridcolor="rgba(30,42,58,0.5)"),
                    yaxis=dict(gridcolor="rgba(30,42,58,0.5)"),
                )
                st.plotly_chart(fig, use_container_width=True)

    # ── Top right: Term Structure ──
    with top_right:
        st.markdown("""
        <div>
            <span style="font-size:0.9rem;font-weight:700;color:#fafafa;">FUTURES TERM STRUCTURE</span><br>
            <span style="font-size:0.7rem;color:#6b7b8d;">KC ARABICA (ICE) // DELIVERY MONTH</span>
        </div>
        """, unsafe_allow_html=True)

        kc_curve = pd.DataFrame(curve["KC"])
        if not kc_curve.empty:
            fig_ts = go.Figure()
            fig_ts.add_trace(go.Scatter(
                x=kc_curve["contract"], y=kc_curve["price"],
                name="KC (¢/lb)", mode="lines+markers",
                line=dict(color=C_KC, width=2),
                marker=dict(size=7, color=C_KC),
            ))

            rc_curve = pd.DataFrame(curve["RC"])
            if not rc_curve.empty:
                rc_c = rc_curve.copy()
                rc_c["price_cl"] = rc_c["price"] * USD_T_TO_CENTS_LB
                fig_ts.add_trace(go.Scatter(
                    x=rc_c["contract"], y=rc_c["price_cl"],
                    name="RC (¢/lb equiv.)", mode="lines+markers",
                    line=dict(color=C_RC, width=2),
                    marker=dict(size=7, color=C_RC),
                ))

            if len(kc_curve) >= 2:
                f_p, l_p = kc_curve["price"].iloc[0], kc_curve["price"].iloc[-1]
                structure = "Contango" if l_p > f_p else "Backwardation"
                slope = (l_p / f_p - 1) * 100
                title_str = f"KC — {structure} ({slope:+.1f}%)"
            else:
                title_str = "KC — Term Structure"

            fig_ts.update_layout(
                title=dict(text=title_str, font=dict(size=11, color="#8899aa")),
                yaxis_title="¢/lb",
                legend=dict(orientation="h", y=1.02),
                height=320,
                template=T,
                margin=dict(l=40, r=10, t=30, b=30),
                paper_bgcolor="rgba(0,0,0,0)",
                plot_bgcolor="rgba(0,0,0,0)",
                xaxis=dict(gridcolor="rgba(30,42,58,0.5)"),
                yaxis=dict(gridcolor="rgba(30,42,58,0.5)"),
            )
            st.plotly_chart(fig_ts, use_container_width=True)
        else:
            st.info("Forward curve not available.")

    # ── Bottom row: Spread Monitor + Calendar Spread ──
    bot_left, bot_right = st.columns(2)

    with bot_left:
        st.markdown("""
        <div>
            <span style="font-size:0.9rem;font-weight:700;color:#fafafa;">SPREAD MONITOR</span><br>
            <span style="font-size:0.7rem;color:#6b7b8d;">Arabica premium over Robusta // ¢/lb</span>
        </div>
        """, unsafe_allow_html=True)

        sel_spread = st.selectbox("Spread", list(SPREAD_OPTS.keys()),
                                  label_visibility="collapsed", key="spread_sel")
        stype, sm1, sm2, cross_yr = SPREAD_OPTS[sel_spread]

        sp_data = pd.Series(dtype=float)
        if stype == "arb_rob":
            if spread_s is not None:
                sp_data = spread_s
        else:
            sp_data = fetch_intramarket_spread(sm1, sm2, cross_year=cross_yr)

        if not sp_data.empty:
            sp_mean = float(sp_data.mean())
            sp_std = float(sp_data.std())
            p5 = float(sp_data.quantile(0.05))
            p95 = float(sp_data.quantile(0.95))

            fig_sp = go.Figure()
            fig_sp.add_hrect(y0=sp_mean - sp_std, y1=sp_mean + sp_std,
                             fillcolor="rgba(0,212,170,0.06)", layer="below", line_width=0)

            for pval, label in [(p5, "P5"), (p95, "P95")]:
                fig_sp.add_hline(y=pval, line=dict(color="rgba(200,200,200,0.15)", dash="dot", width=1),
                                 annotation_text=f"{label} ({pval:.2f})",
                                 annotation_position="bottom right",
                                 annotation_font=dict(color="#6b7b8d", size=9))

            fig_sp.add_hline(y=sp_mean, line=dict(color=C_SP, dash="dash", width=1.5),
                             annotation_text=f"Mean ({sp_mean:.2f})",
                             annotation_position="bottom right",
                             annotation_font=dict(color=C_SP, size=10))

            fig_sp.add_trace(go.Scatter(
                x=sp_data.index, y=sp_data.values,
                name=sel_spread, line=dict(color=C_KC, width=1.5),
            ))

            current = float(sp_data.iloc[-1])
            fig_sp.update_layout(
                title=dict(text=f"Current: {current:.2f} ¢/lb", font=dict(size=11, color="#8899aa")),
                yaxis_title="¢/lb",
                legend=dict(orientation="h", y=1.02),
                height=320,
                template=T,
                margin=dict(l=40, r=10, t=30, b=30),
                paper_bgcolor="rgba(0,0,0,0)",
                plot_bgcolor="rgba(0,0,0,0)",
                xaxis=dict(gridcolor="rgba(30,42,58,0.5)"),
                yaxis=dict(gridcolor="rgba(30,42,58,0.5)"),
            )
            st.plotly_chart(fig_sp, use_container_width=True)

    with bot_right:
        st.markdown("""
        <div>
            <span style="font-size:0.9rem;font-weight:700;color:#fafafa;">CALENDAR SPREAD</span><br>
            <span style="font-size:0.7rem;color:#6b7b8d;">KC N−Z (Jul−Dec) // ¢/lb</span>
        </div>
        """, unsafe_allow_html=True)

        nz_data = fetch_intramarket_spread("N", "Z", cross_year=False)
        if not nz_data.empty:
            nz_mean = float(nz_data.mean())
            current_nz = float(nz_data.iloc[-1])
            nz_min = float(nz_data.min())
            nz_max = float(nz_data.max())

            fig_nz = go.Figure()
            fig_nz.add_hline(y=nz_mean, line=dict(color=C_SP, dash="dash", width=1.5),
                             annotation_text=f"Mean ({nz_mean:.2f})",
                             annotation_position="bottom right",
                             annotation_font=dict(color=C_SP, size=10))

            fig_nz.add_trace(go.Scatter(
                x=nz_data.index, y=nz_data.values,
                name="N-Z", line=dict(color=C_KC, width=1.5),
            ))

            fig_nz.update_layout(
                title=dict(
                    text=f"Current: {current_nz:.2f} | Min: {nz_min:.2f} | Max: {nz_max:.2f}",
                    font=dict(size=10, color="#8899aa")
                ),
                yaxis_title="¢/lb",
                legend=dict(orientation="h", y=1.02),
                height=320,
                template=T,
                margin=dict(l=40, r=10, t=30, b=30),
                paper_bgcolor="rgba(0,0,0,0)",
                plot_bgcolor="rgba(0,0,0,0)",
                xaxis=dict(gridcolor="rgba(30,42,58,0.5)"),
                yaxis=dict(gridcolor="rgba(30,42,58,0.5)"),
            )
            st.plotly_chart(fig_nz, use_container_width=True)
        else:
            st.info("N-Z spread data not available.")

# ═══════════════════════════════════════════════════════════════════════════
# RIGHT COLUMN: Performance table + Spread Dashboard + Polymarket
# ═══════════════════════════════════════════════════════════════════════════
with right_col:
    # ── Performance Table ──
    st.markdown('<div class="section-header">PERFORMANCE</div>', unsafe_allow_html=True)

    perf_data = {}
    if kc_perf:
        perf_data["KC Arabica"] = kc_perf
    if rc_perf:
        perf_data["RC Robusta"] = rc_perf

    for name, perf in perf_data.items():
        st.markdown(f'<div class="metric-label" style="margin-top:0.5rem;">{name}</div>',
                    unsafe_allow_html=True)
        cols = st.columns(4)
        for i, (k, label) in enumerate([("1D", "1D"), ("1M", "1M"), ("YTD", "YTD"), ("1Y", "1Y")]):
            val = perf.get(k)
            txt, col = _pct_color(val)
            cols[i].markdown(
                f'<div style="text-align:center;"><div class="metric-sub">{label}</div>'
                f'<div style="color:{col};font-weight:600;font-size:0.85rem;">{txt}</div></div>',
                unsafe_allow_html=True
            )

    # ── Spread Dashboard ──
    st.markdown('<div class="section-header">SPREAD DASHBOARD</div>', unsafe_allow_html=True)

    if spread_val is not None:
        st.markdown(f"""
        <div class="spread-item">
            <span class="spread-label">Arb-Rob</span>
            <span class="spread-value" style="color:{'#00D4AA' if spread_val > 0 else '#E76F51'}">
                {spread_val:+.2f} ¢/lb
            </span>
        </div>
        """, unsafe_allow_html=True)

    spreads_to_show = [
        ("KC K-N", "K", "N", False),
        ("KC N-Z", "N", "Z", False),
        ("KC Z-H", "Z", "H", True),
    ]
    for label, m1, m2, cross in spreads_to_show:
        sp = fetch_intramarket_spread(m1, m2, cross_year=cross)
        if not sp.empty:
            val = float(sp.iloc[-1])
            st.markdown(f"""
            <div class="spread-item">
                <span class="spread-label">{label}</span>
                <span class="spread-value" style="color:{'#00D4AA' if val > 0 else '#E76F51'}">
                    {val:+.2f} ¢/lb
                </span>
            </div>
            """, unsafe_allow_html=True)

    # ── Polymarket ──
    st.markdown('<div class="section-header">POLYMARKET — COFFEE</div>', unsafe_allow_html=True)

    poly_markets = fetch_coffee_markets()
    if poly_markets:
        for m in poly_markets[:5]:
            yes = m.get("yes_pct")
            vol = m.get("volume", 0)
            vol_str = f"${vol:,.0f}" if vol else "—"
            st.markdown(f"""
            <div class="poly-card">
                <div class="poly-question">{m['question'][:100]}</div>
                <div style="display:flex;justify-content:space-between;align-items:center;">
                    <span class="poly-yes">YES {yes:.0f}%</span>
                    <span class="metric-sub">Vol: {vol_str}</span>
                </div>
                <div class="metric-sub">Ends: {m.get('end_date', '—')}</div>
            </div>
            """, unsafe_allow_html=True)
    else:
        st.markdown("""
        <div class="poly-card">
            <div class="poly-question">No active coffee prediction markets found on Polymarket.</div>
            <div class="metric-sub">Markets will appear here when available.</div>
        </div>
        """, unsafe_allow_html=True)

# ── Footer ───────────────────────────────────────────────────────────────────
st.markdown("---")
st.caption(
    "Sources: ICE Futures via Yahoo Finance · "
    "News: Google News RSS · "
    "Polymarket: Gamma API · "
    "Conversion: 1 USD/t ÷ 22.0462 = ¢/lb"
)
