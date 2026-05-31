"""Positioning page: CFTC trader positioning for coffee markets."""

from __future__ import annotations

from pathlib import Path

import pandas as pd
import plotly.graph_objects as go
import streamlit as st
from plotly.subplots import make_subplots

from utils.cftc import (
    available_local_cot_markets,
    compute_percentile,
    compute_zscore,
    fetch_cot_data,
)

st.set_page_config(page_title="Positioning | Coffee Monitor", page_icon="📊", layout="wide")

T = "plotly_dark"
C_LONG = "#00D4AA"
C_SHORT = "#E76F51"
C_NET = "#F4A261"
C_COMM = "#457B9D"
C_SWAP = "#9B5DE5"
C_OTHER = "#E9C46A"
GRID = "rgba(30,42,58,0.5)"

st.markdown("""
<style>
    .stApp { background-color: #0a0e1a; }
    .block-container { padding-top: 1rem; }
    .section-header {
        font-size: 0.75rem; color: #6b7b8d; letter-spacing: 1.5px;
        text-transform: uppercase; padding: 0.5rem 0; border-bottom: 1px solid #1e2a3a;
        margin: 0.5rem 0;
    }
    .desk-card {
        background: #141824; border: 1px solid #1e2a3a; border-radius: 4px;
        padding: 0.85rem 1rem; margin: 0.5rem 0 1rem 0;
        color: #d0d8e0; font-size: 0.88rem; line-height: 1.45;
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
    <span style="font-size:0.75rem;color:#6b7b8d;">CFTC COT — MANAGED MONEY, COMMERCIALS, SWAPS & OTHER REPORTABLES</span>
</div>
""", unsafe_allow_html=True)


def _fmt_lots(value: float | int | None) -> str:
    if value is None or pd.isna(value):
        return "—"
    return f"{float(value):+,.0f} lots"


def _fmt_plain(value: float | int | None) -> str:
    if value is None or pd.isna(value):
        return "—"
    return f"{float(value):,.0f}"


def _latest_valid(series: pd.Series, default: float = 0.0) -> float:
    clean = series.dropna()
    if clean.empty:
        return default
    return float(clean.iloc[-1])


def _window_label(window: int) -> str:
    return "2Y" if window == 104 else f"{window}w"


local_markets = available_local_cot_markets()
market_options = list(local_markets) or ["Arabica"]

with st.sidebar:
    st.markdown("### Positioning inputs")
    selected_market = st.selectbox("Market", market_options, index=0)
    lookback = st.selectbox("Display window", ["All", "2Y", "1Y", "6M"], index=0)
    z_window = st.selectbox("Z-score window", [104, 52, 26], index=0, format_func=_window_label)

    if "Robusta" not in local_markets:
        st.caption("Robusta COT local absent. Add `data/Robusta_COT.csv` with the same schema to enable it.")

with st.spinner("Loading local COT positioning data…"):
    cot = fetch_cot_data(selected_market)

if cot.empty:
    st.error(
        "No COT data available. Add `data/Arabica_COT.csv` or `data/Robusta_COT.csv` "
        "with CFTC-style long/short/net columns."
    )
    st.stop()

cot = cot.copy()
source = str(cot["source"].iloc[-1]) if "source" in cot else "unknown"
market = str(cot["market"].iloc[-1]) if "market" in cot else selected_market

for prefix in ["mm", "prod", "swap", "other"]:
    cot[f"{prefix}_pct_oi"] = cot[f"{prefix}_net"] / cot["oi"].replace(0, pd.NA) * 100
    cot[f"{prefix}_wow"] = cot[f"{prefix}_net"].diff()

cot["oi_wow"] = cot["oi"].diff()
cot["mm_zscore"] = compute_zscore(cot["mm_net"], window=z_window)
cot["mm_percentile"] = compute_percentile(cot["mm_net"], window=z_window)

if lookback != "All":
    offsets = {"2Y": pd.DateOffset(years=2), "1Y": pd.DateOffset(years=1), "6M": pd.DateOffset(months=6)}
    cutoff = cot.index.max() - offsets[lookback]
    view = cot[cot.index >= cutoff]
else:
    view = cot

latest = cot.iloc[-1]
previous = cot.iloc[-2] if len(cot) > 1 else latest
current_z = _latest_valid(cot["mm_zscore"])
current_pct = _latest_valid(cot["mm_percentile"])
report_date = cot.index[-1].strftime("%Y-%m-%d")

st.caption(f"Source: `{source}` · Market: {market} · Last COT report: {report_date} · Rows: {len(cot):,}")

c1, c2, c3, c4, c5, c6 = st.columns(6)
c1.metric("MM Net", _fmt_lots(latest["mm_net"]), delta=_fmt_lots(latest["mm_net"] - previous["mm_net"]))
c2.metric(f"MM Z ({_window_label(z_window)})", f"{current_z:+.2f}σ")
c3.metric("MM Percentile", f"{current_pct:.0f}%")
c4.metric("Commercial Net", _fmt_lots(latest["prod_net"]), delta=_fmt_lots(latest["prod_net"] - previous["prod_net"]))
c5.metric("Open Interest", _fmt_plain(latest["oi"]), delta=_fmt_plain(latest["oi"] - previous["oi"]))
c6.metric("MM % OI", f"{latest['mm_pct_oi']:+.1f}%")

if current_z >= 2 or current_pct >= 90:
    desk_read = (
        "Specs are crowded long. For a coffee trading interview, frame this as a liquidation risk: "
        "bullish fundamentals can still matter, but price is more vulnerable if momentum stalls."
    )
elif current_z <= -2 or current_pct <= 10:
    desk_read = (
        "Specs are crowded short. This is a contrarian bullish setup if weather, Brazil differentials, "
        "or certified stocks start confirming tighter supply."
    )
elif latest["mm_wow"] > 0 and latest["prod_wow"] < 0:
    desk_read = (
        "Funds added length while commercials sold into the move. That is trend-confirming, but also means "
        "the next COT should be checked for whether producers keep scaling hedges."
    )
else:
    desk_read = (
        "Positioning is not at an extreme. The cleaner read is to combine COT with price trend, Brazil parity, "
        "weather flags and stocks before making a directional argument."
    )

st.markdown(f"<div class='desk-card'><b>Desk read:</b> {desk_read}</div>", unsafe_allow_html=True)

# ── Net positioning across trader groups ────────────────────────────────────
left, right = st.columns([2.3, 1])

with left:
    st.markdown('<div class="section-header">NET POSITIONING BY TRADER GROUP</div>', unsafe_allow_html=True)
    fig_net = go.Figure()
    traces = [
        ("Managed Money", "mm_net", C_NET),
        ("Commercials", "prod_net", C_COMM),
        ("Swap Dealers", "swap_net", C_SWAP),
        ("Other Reportables", "other_net", C_OTHER),
    ]
    for name, col, color in traces:
        fig_net.add_trace(go.Scatter(
            x=view.index, y=view[col], name=name,
            line=dict(color=color, width=2 if col in {"mm_net", "prod_net"} else 1.5),
        ))
    fig_net.add_hline(y=0, line=dict(color="rgba(200,200,200,0.2)", width=1))
    fig_net.update_layout(
        height=430, template=T, legend=dict(orientation="h", y=1.08),
        margin=dict(l=45, r=10, t=25, b=30),
        paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)",
        yaxis_title="Net lots",
        xaxis=dict(gridcolor=GRID), yaxis=dict(gridcolor=GRID),
    )
    st.plotly_chart(fig_net, use_container_width=True)

with right:
    st.markdown('<div class="section-header">MM CROWDING GAUGE</div>', unsafe_allow_html=True)
    gauge_color = C_SHORT if current_z > 1.5 else C_LONG if current_z < -1.5 else C_NET
    fig_gauge = go.Figure(go.Indicator(
        mode="gauge+number",
        value=current_z,
        number=dict(suffix="σ", font=dict(size=30, color="#fafafa")),
        gauge=dict(
            axis=dict(range=[-3, 3], tickcolor="#6b7b8d", tickvals=[-3, -2, -1, 0, 1, 2, 3]),
            bar=dict(color=gauge_color), bgcolor="#141824", bordercolor="#1e2a3a",
            steps=[
                dict(range=[-3, -2], color="rgba(0,212,170,0.2)"),
                dict(range=[-2, -1], color="rgba(0,212,170,0.1)"),
                dict(range=[-1, 1], color="rgba(69,123,157,0.1)"),
                dict(range=[1, 2], color="rgba(231,111,81,0.1)"),
                dict(range=[2, 3], color="rgba(231,111,81,0.2)"),
            ],
            threshold=dict(line=dict(color="#fafafa", width=2), thickness=0.8, value=current_z),
        ),
        title=dict(text=f"Managed Money<br>{_window_label(z_window)} Z-Score", font=dict(size=11, color="#6b7b8d")),
    ))
    fig_gauge.update_layout(height=280, template=T, margin=dict(l=15, r=15, t=40, b=10), paper_bgcolor="rgba(0,0,0,0)")
    st.plotly_chart(fig_gauge, use_container_width=True)
    st.metric("Crowding percentile", f"{current_pct:.0f}%")

# ── Money manager detail and z-score history ────────────────────────────────
chart_a, chart_b = st.columns(2)

with chart_a:
    st.markdown('<div class="section-header">MANAGED MONEY LONG / SHORT BUILD</div>', unsafe_allow_html=True)
    fig_mm = go.Figure()
    fig_mm.add_trace(go.Bar(x=view.index, y=view["mm_long"], name="MM Longs", marker=dict(color=C_LONG, opacity=0.45)))
    fig_mm.add_trace(go.Bar(x=view.index, y=-view["mm_short"], name="MM Shorts", marker=dict(color=C_SHORT, opacity=0.45)))
    fig_mm.add_trace(go.Scatter(x=view.index, y=view["mm_net"], name="MM Net", line=dict(color=C_NET, width=2)))
    fig_mm.add_hline(y=0, line=dict(color="rgba(200,200,200,0.2)", width=1))
    fig_mm.update_layout(
        height=360, template=T, barmode="relative", legend=dict(orientation="h", y=1.08),
        margin=dict(l=45, r=10, t=20, b=30), paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)",
        yaxis_title="Lots", xaxis=dict(gridcolor=GRID), yaxis=dict(gridcolor=GRID),
    )
    st.plotly_chart(fig_mm, use_container_width=True)

with chart_b:
    st.markdown('<div class="section-header">Z-SCORE & PERCENTILE HISTORY</div>', unsafe_allow_html=True)
    fig_z = make_subplots(specs=[[{"secondary_y": True}]])
    fig_z.add_hrect(y0=-2, y1=2, fillcolor="rgba(69,123,157,0.05)", layer="below", line_width=0)
    fig_z.add_trace(go.Scatter(
        x=view.index, y=view["mm_zscore"], name="MM Net Z-score",
        line=dict(color=C_NET, width=1.8), fill="tozeroy", fillcolor="rgba(244,162,97,0.08)"
    ))
    fig_z.add_trace(go.Scatter(
        x=view.index, y=view["mm_percentile"], name="Percentile",
        line=dict(color=C_LONG, width=1.4, dash="dot")
    ), secondary_y=True)
    for level, label in [(2, "+2σ"), (-2, "-2σ")]:
        fig_z.add_hline(y=level, line=dict(color="rgba(200,200,200,0.25)", dash="dot", width=1),
                        annotation_text=label, annotation_font=dict(color="#6b7b8d", size=9))
    fig_z.update_layout(
        height=360, template=T, legend=dict(orientation="h", y=1.08),
        margin=dict(l=45, r=45, t=20, b=30), paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)",
    )
    fig_z.update_xaxes(gridcolor=GRID)
    fig_z.update_yaxes(title_text="Z-score", gridcolor=GRID, secondary_y=False)
    fig_z.update_yaxes(title_text="Percentile", range=[0, 100], gridcolor="rgba(0,0,0,0)", secondary_y=True)
    st.plotly_chart(fig_z, use_container_width=True)

# ── Net as % of OI ───────────────────────────────────────────────────────────
st.markdown('<div class="section-header">NET POSITION AS % OF OPEN INTEREST</div>', unsafe_allow_html=True)
fig_pct = go.Figure()
for name, col, color in [
    ("Managed Money", "mm_pct_oi", C_NET),
    ("Commercials", "prod_pct_oi", C_COMM),
    ("Swap Dealers", "swap_pct_oi", C_SWAP),
    ("Other Reportables", "other_pct_oi", C_OTHER),
]:
    fig_pct.add_trace(go.Scatter(x=view.index, y=view[col], name=name, line=dict(color=color, width=1.8)))
fig_pct.add_hline(y=0, line=dict(color="rgba(200,200,200,0.2)", width=1))
fig_pct.update_layout(
    height=320, template=T, legend=dict(orientation="h", y=1.08),
    margin=dict(l=45, r=10, t=20, b=30), paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)",
    yaxis_title="% of open interest", xaxis=dict(gridcolor=GRID), yaxis=dict(gridcolor=GRID),
)
st.plotly_chart(fig_pct, use_container_width=True)

# ── Tables ──────────────────────────────────────────────────────────────────
st.markdown('<div class="section-header">LATEST REPORT SNAPSHOT</div>', unsafe_allow_html=True)
rows = []
for label, prefix in [
    ("Managed Money", "mm"),
    ("Commercials", "prod"),
    ("Swap Dealers", "swap"),
    ("Other Reportables", "other"),
]:
    rows.append({
        "Trader group": label,
        "Long": latest[f"{prefix}_long"],
        "Short": latest[f"{prefix}_short"],
        "Net": latest[f"{prefix}_net"],
        "WoW net change": latest[f"{prefix}_wow"],
        "Net / OI": latest[f"{prefix}_pct_oi"],
    })
snapshot = pd.DataFrame(rows)
st.dataframe(
    snapshot.style.format({
        "Long": "{:,.0f}", "Short": "{:,.0f}", "Net": "{:+,.0f}",
        "WoW net change": "{:+,.0f}", "Net / OI": "{:+.1f}%",
    }),
    use_container_width=True,
    hide_index=True,
)

recent = cot[["mm_net", "mm_wow", "prod_net", "prod_wow", "swap_net", "other_net", "oi"]].tail(8).copy()
recent.index = recent.index.strftime("%Y-%m-%d")
recent.columns = ["MM net", "MM WoW", "Commercial net", "Commercial WoW", "Swap net", "Other net", "Open interest"]
st.markdown('<div class="section-header">RECENT WEEKLY FLOW</div>', unsafe_allow_html=True)
st.dataframe(
    recent.style.format({col: "{:+,.0f}" for col in recent.columns if col != "Open interest"}).format({"Open interest": "{:,.0f}"}),
    use_container_width=True,
)

# ── Latest weekly note link ─────────────────────────────────────────────────
st.markdown('<div class="section-header">WEEKLY MARKET NOTE</div>', unsafe_allow_html=True)
notes_dir = Path(__file__).parent.parent / "notes"
notes = sorted(notes_dir.glob("*.md"), reverse=True) if notes_dir.exists() else []

if notes:
    latest_note = notes[0]
    st.markdown(f"📝 Latest note: **{latest_note.stem}**")
    with st.expander("View note"):
        st.markdown(latest_note.read_text())
else:
    st.info(
        "No weekly notes yet. Run `python scripts/generate_weekly_market_note.py` each Friday to generate one. "
        "The 'My read' section is for your manual market commentary."
    )

st.markdown("---")
st.caption(
    "Sources: local CFTC COT CSVs in data/ · Disaggregated Futures Only schema · "
    "Z-score/percentile based on selected rolling window"
)
