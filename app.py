"""
Coffee Market Monitor — Brick 1: Futures & Spread
ICE KC (arabica, New York)  ·  ICE RC (robusta, London)
"""

from datetime import datetime

import numpy as np
import pandas as pd
import plotly.graph_objects as go
import streamlit as st

from utils.futures import (
    USD_T_TO_CENTS_LB,
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

# ── Config ────────────────────────────────────────────────────────────────────
st.set_page_config(
    page_title="Coffee Market Monitor",
    page_icon="☕",
    layout="wide",
    initial_sidebar_state="collapsed",
)

T    = "plotly_dark"
C_KC  = "#F4A261"
C_RC  = "#457B9D"
C_SP  = "#E76F51"
C_SEA = "#52B788"

HORIZON_OFFSETS: dict = {
    "1M":  pd.DateOffset(months=1),
    "3M":  pd.DateOffset(months=3),
    "6M":  pd.DateOffset(months=6),
    "YTD": None,
    "1Y":  pd.DateOffset(years=1),
    "2Y":  pd.DateOffset(years=2),
    "5Y":  pd.DateOffset(years=5),
}

SPREAD_OPTS: dict = {
    "KC − RC  (Arb/Rob)": ("arb_rob", "K",  "N",  False),
    "KC  K−N  (May−Jul)": ("intra",   "K",  "N",  False),
    "KC  N−Z  (Jul−Dec)": ("intra",   "N",  "Z",  False),
    "KC  Z−H  (Dec−Mar)": ("intra",   "Z",  "H",  True),
    "KC  H−K  (Mar−May)": ("intra",   "H",  "K",  False),
}

KEEP_METRICS = ["Price", "1D", "1M", "YTD", "1Y"]


def _cutoff(horizon: str) -> pd.Timestamp:
    now = pd.Timestamp.now().normalize()
    return pd.Timestamp(f"{now.year}-01-01") if horizon == "YTD" \
        else now - HORIZON_OFFSETS[horizon]


def _strip_tz(s: pd.Series) -> pd.Series:
    if s.index.tz is not None:
        s = s.copy()
        s.index = s.index.tz_localize(None)
    return s


# ── Header ────────────────────────────────────────────────────────────────────
c_title, c_btn = st.columns([8, 1])
c_title.title("☕ Coffee Market Monitor")
c_title.caption(
    f"Updated {datetime.utcnow().strftime('%d %b %Y  %H:%M')} UTC  ·  "
    "ICE KC (New York)  ·  ICE RC (London)"
)
if c_btn.button("↺  Refresh", use_container_width=True):
    st.cache_data.clear()
    st.rerun()

st.divider()

# ── Load data ─────────────────────────────────────────────────────────────────
with st.spinner("Loading…"):
    kc_price = fetch_kc_front()
    rc_price = fetch_rc_front()
    kc_hist  = fetch_kc_history()
    rc_hist  = fetch_rc_history()
    curve    = fetch_forward_curve(n=10)

kc_s     = _strip_tz(kc_hist["Close"]) if not kc_hist.empty else None
rc_s_usd = _strip_tz(rc_hist["Close"]) if not rc_hist.empty else None
rc_s_cl  = rc_s_usd * USD_T_TO_CENTS_LB if rc_s_usd is not None else None
spread_s: pd.Series | None = None
if kc_s is not None and rc_s_cl is not None:
    sp = (kc_s - rc_s_cl).dropna()
    spread_s = sp if not sp.empty else None

rc_cl_price = round(rc_price * USD_T_TO_CENTS_LB, 2) if rc_price else None
spread_val  = round(kc_price - rc_cl_price, 2) if (kc_price and rc_cl_price) else None
spread_mean = round(float(spread_s.mean()), 2) if spread_s is not None else None

# ── KPI row ───────────────────────────────────────────────────────────────────
c1, c2, c3, c4, c5 = st.columns(5)
c1.metric("KC Arabica (NY)",      f"{kc_price:.2f} ¢/lb"    if kc_price else "—",
          help="ICE KC front month, cents/lb")
c2.metric("RC Robusta (London)",  f"${rc_price:,.0f} /t"    if rc_price else "—",
          help="ICE RC front month, USD/tonne")
c3.metric("RC (¢/lb equiv.)",     f"{rc_cl_price:.2f} ¢/lb" if rc_cl_price else "—",
          help="RC ÷ 22.0462 — same unit as KC for comparison")
c4.metric("Spread KC−RC",         f"{spread_val:.2f} ¢/lb"  if spread_val is not None else "—",
          help="KC − RC (¢/lb) — arabica premium over robusta")
if spread_val is not None and spread_mean is not None:
    delta = round(spread_val - spread_mean, 2)
    c5.metric("vs 5y avg", f"{spread_mean:.1f} ¢/lb",
              delta=f"{delta:+.2f}", help="current spread vs. 5-year historical average")
else:
    c5.metric("vs 5y avg", "—")

if rc_price is None:
    st.warning(
        "**RC data unavailable** — Yahoo Finance does not carry ICE London futures.  \n"
        "To enable the spread: export RC historical data from "
        "**investing.com → Robusta Coffee → Historical Data** and save the unmodified file "
        "as **`data/rc_history.csv`**.  The Investing.com format "
        "(columns `Dernier`, date `DD/MM/YYYY`, numbers like `3.476,00`) is auto-detected.",
        icon="⚠️",
    )

st.divider()

# ─────────────────────────────────────────────────────────────────────────────
# SECTION 1 · Market Overview
# ─────────────────────────────────────────────────────────────────────────────
st.subheader("📊 Market Overview")

CHART: dict[str, pd.Series] = {}
PERF:  dict[str, tuple[pd.Series, str]] = {}

if kc_s is not None:
    CHART["KC Arabica"]   = kc_s
    PERF["KC Arabica"]    = (kc_s, "¢/lb")
if rc_s_cl is not None:
    CHART["RC Robusta"]   = rc_s_cl
    PERF["RC Robusta"]    = (rc_s_usd, "USD/t")
if spread_s is not None:
    CHART["Spread KC−RC"] = spread_s
    PERF["Spread KC−RC"]  = (spread_s, "¢/lb")

COLORS = {"KC Arabica": C_KC, "RC Robusta": C_RC, "Spread KC−RC": C_SP}

opts    = list(CHART.keys())
default = opts[:min(2, len(opts))]
selected = st.multiselect("Assets", opts, default=default)

if not selected:
    st.info("Select at least one asset.")
else:
    chart_col, table_col = st.columns([2, 1])

    # ── Chart (controls live inside this column) ──────────────────────────────
    with chart_col:
        cc1, cc2, cc3 = st.columns([5, 3, 3])
        horizon   = cc1.radio("Horizon", list(HORIZON_OFFSETS.keys()), index=2, horizontal=True)
        mode      = cc2.radio("Mode", ["Price", "Perf. %"], horizontal=True)
        show_seas = cc3.checkbox("5y Seasonal", value=True, disabled=(mode == "Perf. %"))

        cutoff = _cutoff(horizon)
        fig    = go.Figure()

        for name in selected:
            if name not in CHART:
                continue
            series = CHART[name]
            sub = series[series.index >= cutoff].dropna()
            if sub.empty:
                continue

            if mode == "Perf. %":
                base = sub.iloc[0]
                y = (sub / base - 1) * 100 if base != 0 else sub * 0.0
            else:
                y = sub

            fig.add_trace(go.Scatter(
                x=sub.index, y=y.values,
                name=name,
                line=dict(color=COLORS.get(name, "#aaa"), width=2),
            ))

            if show_seas and mode == "Price":
                seas = compute_seasonal(series.to_frame("Close"))
                if not seas.empty:
                    aligned = apply_seasonal_to_series(sub, seas)
                    fig.add_trace(go.Scatter(
                        x=sub.index, y=aligned.values,
                        name=f"Seasonal — {name}",
                        line=dict(color=C_SEA, width=1.5, dash="dash"),
                        opacity=0.8,
                    ))

        if mode == "Perf. %":
            fig.add_hline(y=0, line=dict(color="rgba(200,200,200,0.2)", width=1))

        fig.update_layout(
            yaxis_title="change (%)" if mode == "Perf. %" else "cents / lb",
            legend=dict(orientation="h", y=1.05),
            height=420,
            template=T,
            margin=dict(l=0, r=0, t=10, b=0),
        )
        st.plotly_chart(fig, use_container_width=True)
        if mode == "Price" and rc_s_cl is not None and "RC Robusta" in selected:
            st.caption("RC converted to ¢/lb (÷ 22.0462) for a common axis with KC.")

    # ── Metrics table ──────────────────────────────────────────────────────────
    with table_col:
        rows: dict[str, dict] = {}
        for name in selected:
            if name not in PERF:
                continue
            series, unit = PERF[name]
            p = compute_performance(series)
            if not p:
                continue
            last_val = float(series.dropna().iloc[-1])
            rows[name] = {
                "Price": f"{last_val:.2f} {unit}",
                "1D":    p.get("1D"),
                "1M":    p.get("1M"),
                "YTD":   p.get("YTD"),
                "1Y":    p.get("1Y"),
            }

        if rows:
            # Assets as rows, metrics as columns
            raw = pd.DataFrame(rows).T[KEEP_METRICS]

            PCT_COLS = ["1D", "1M", "YTD", "1Y"]

            display = raw.copy()
            for col in PCT_COLS:
                display[col] = display[col].apply(
                    lambda v: f"{float(v):+.2f} %"
                    if (v is not None and not (isinstance(v, float) and np.isnan(v)))
                    else "—"
                )

            def _color(val: object) -> str:
                if isinstance(val, str):
                    if val.startswith("+"):
                        return "color: #52B788; font-weight: 600"
                    if val.startswith("-"):
                        return "color: #E76F51; font-weight: 600"
                return ""

            st.dataframe(
                display.style.applymap(_color),
                use_container_width=True,
                height=160,
            )

st.divider()

# ─────────────────────────────────────────────────────────────────────────────
# SECTION 2 · Futures Analysis
# ─────────────────────────────────────────────────────────────────────────────
st.subheader("📉 Futures Analysis")

if curve["RC"]:
    st.caption("")
else:
    st.caption("ℹ️  RC forward curve not available via API (ICE London contracts not on Yahoo Finance).")

sp_col, ts_col = st.columns([1, 1])

# ── Spread history ─────────────────────────────────────────────────────────────
with sp_col:
    st.markdown("**Spread History**")
    sel_spread = st.selectbox(" ", list(SPREAD_OPTS.keys()), label_visibility="collapsed")
    stype, sm1, sm2, cross_yr = SPREAD_OPTS[sel_spread]

    sp_data: pd.Series = pd.Series(dtype=float)
    if stype == "arb_rob":
        if spread_s is not None:
            sp_data = spread_s
        else:
            st.info("RC data required. Provide `data/rc_history.csv`.")
    else:
        with st.spinner("Fetching contract data…"):
            sp_data = fetch_intramarket_spread(sm1, sm2, cross_year=cross_yr)
        if sp_data.empty:
            st.warning(
                f"Contracts {sm1}/{sm2} not available on Yahoo Finance. "
                "Try KC − RC instead."
            )

    if not sp_data.empty:
        cutoff2y = pd.Timestamp.now().normalize() - pd.DateOffset(years=2)
        sp_plot  = sp_data[sp_data.index >= cutoff2y]
        sp_mean  = float(sp_data.mean())
        sp_std   = float(sp_data.std())

        sp_seas         = compute_seasonal(sp_data.to_frame("Close"))
        sp_seas_aligned = apply_seasonal_to_series(sp_plot, sp_seas) \
            if not sp_seas.empty else pd.Series(dtype=float)

        fig_sp = go.Figure()

        # ±1σ band
        fig_sp.add_hrect(
            y0=sp_mean - sp_std, y1=sp_mean + sp_std,
            fillcolor="rgba(82,183,136,0.10)", layer="below", line_width=0,
        )
        fig_sp.add_trace(go.Scatter(
            x=sp_plot.index, y=sp_plot.values,
            name=sel_spread,
            line=dict(color=C_KC, width=2),
        ))
        if not sp_seas_aligned.empty:
            fig_sp.add_trace(go.Scatter(
                x=sp_plot.index, y=sp_seas_aligned.values,
                name="5y Seasonal",
                line=dict(color=C_SEA, width=1.5, dash="dash"),
            ))

        # Mean line
        fig_sp.add_hline(
            y=sp_mean,
            line=dict(color=C_SEA, dash="dot", width=1.5),
            annotation_text=f"  avg {sp_mean:.1f}¢",
            annotation_position="bottom right",
            annotation_font=dict(color=C_SEA),
        )
        # σ band labels on the right edge
        last_x = sp_plot.index[-1]
        for y_val, label in [
            (sp_mean + sp_std, f"+1σ  {sp_mean + sp_std:.1f}¢"),
            (sp_mean - sp_std, f"−1σ  {sp_mean - sp_std:.1f}¢"),
        ]:
            fig_sp.add_annotation(
                x=last_x, y=y_val,
                text=label,
                xanchor="right",
                yanchor="bottom",
                font=dict(color=C_SEA, size=11),
                showarrow=False,
            )

        fig_sp.update_layout(
            title=sel_spread,
            yaxis_title="cents / lb",
            legend=dict(orientation="h", y=1.05),
            height=380,
            template=T,
            margin=dict(l=0, r=0, t=40, b=0),
        )
        st.plotly_chart(fig_sp, use_container_width=True)

# ── Term structure ─────────────────────────────────────────────────────────────
with ts_col:
    st.markdown("**Term Structure**")
    kc_curve = pd.DataFrame(curve["KC"])
    rc_curve = pd.DataFrame(curve["RC"])

    if kc_curve.empty:
        st.warning(
            "KC forward curve not available from Yahoo Finance.  \n"
            "Tickers like `KCH26.NYB` may not be supported in your region."
        )
    else:
        fig_ts = go.Figure()
        fig_ts.add_trace(go.Scatter(
            x=kc_curve["contract"],
            y=kc_curve["price"],
            name="KC (¢/lb)",
            mode="lines+markers",
            line=dict(color=C_KC, width=2),
            marker=dict(size=9),
        ))
        if not rc_curve.empty:
            rc_c = rc_curve.copy()
            rc_c["price_cl"] = rc_c["price"] * USD_T_TO_CENTS_LB
            fig_ts.add_trace(go.Scatter(
                x=rc_c["contract"],
                y=rc_c["price_cl"],
                name="RC (¢/lb equiv.)",
                mode="lines+markers",
                line=dict(color=C_RC, width=2),
                marker=dict(size=9),
            ))

        if len(kc_curve) >= 2:
            f_p = kc_curve["price"].iloc[0]
            l_p = kc_curve["price"].iloc[-1]
            structure  = "Contango" if l_p > f_p else "Backwardation"
            slope_pct  = (l_p / f_p - 1) * 100
            title_str  = f"KC — {structure}  ({slope_pct:+.1f}%  front → back)"
        else:
            title_str = "KC — Term Structure"

        fig_ts.update_layout(
            title=title_str,
            xaxis_title="Contract",
            yaxis_title="cents / lb",
            legend=dict(orientation="h", y=1.05),
            height=380,
            template=T,
            margin=dict(l=0, r=0, t=40, b=0),
        )
        st.plotly_chart(fig_ts, use_container_width=True)

# ── Footer ─────────────────────────────────────────────────────────────────────
st.divider()
st.caption(
    "Sources: ICE Futures via Yahoo Finance  ·  "
    "RC fallback: ICE Futures Europe settlements (manual CSV)  ·  "
    "Conversion: 1 USD/t ÷ 22.0462 = ¢/lb"
)
