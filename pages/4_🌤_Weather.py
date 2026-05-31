"""Weather page: Minas Gerais and Cerrado coffee-region conditions."""

import numpy as np
import pandas as pd
import plotly.graph_objects as go
import streamlit as st

from utils.weather import (
    COFFEE_ZONES,
    PHENOLOGY,
    compute_anomalies,
    fetch_zone_weather,
)

st.set_page_config(page_title="Weather | Coffee Monitor", page_icon="🌤", layout="wide")

T = "plotly_dark"
C_TEMP = "#E76F51"
C_TEMP_MIN = "#457B9D"
C_PRECIP = "#00D4AA"
C_AVG = "rgba(200,200,200,0.3)"

st.markdown("""
<style>
    .stApp { background-color: #0a0e1a; }
    .block-container { padding-top: 1rem; }
    .section-header {
        font-size: 0.75rem; color: #6b7b8d; letter-spacing: 1.5px;
        text-transform: uppercase; padding: 0.5rem 0; border-bottom: 1px solid #1e2a3a;
        margin: 0.5rem 0;
    }
    .alert-banner {
        padding: 0.8rem 1rem; border-radius: 4px; margin-bottom: 1rem;
        font-size: 0.85rem; font-weight: 600;
    }
    .alert-frost { background: rgba(231,111,81,0.2); border: 1px solid #E76F51; color: #E76F51; }
    .alert-drought { background: rgba(244,162,97,0.2); border: 1px solid #F4A261; color: #F4A261; }
    .alert-ok { background: rgba(0,212,170,0.1); border: 1px solid #1e2a3a; color: #00D4AA; }
    div[data-testid="stMetric"] {
        background: #141824; border: 1px solid #1e2a3a; border-radius: 4px;
        padding: 0.6rem; text-align: center;
    }
    #MainMenu {visibility: hidden;} footer {visibility: hidden;} header {visibility: hidden;}
</style>
""", unsafe_allow_html=True)

st.markdown("""
<div style="display:flex;align-items:center;gap:1rem;padding-bottom:0.5rem;border-bottom:1px solid #1e2a3a;">
    <span style="font-size:1.2rem;font-weight:800;color:#fafafa;letter-spacing:2px;">/// WEATHER</span>
    <span style="font-size:0.75rem;color:#6b7b8d;">BRAZIL COFFEE REGIONS — MINAS GERAIS & CERRADO</span>
</div>
""", unsafe_allow_html=True)

st.markdown("")

# ── Load weather data ──
with st.spinner("Fetching weather data from Open-Meteo…"):
    zone_data = {}
    zone_anomalies = {}
    for zone_name in COFFEE_ZONES:
        df = fetch_zone_weather(zone_name, years=5)
        zone_data[zone_name] = df
        if not df.empty:
            zone_anomalies[zone_name] = compute_anomalies(df)

# ── Alert banner ──
active_alerts = []
for zone, anom in zone_anomalies.items():
    if anom.get("frost_alert"):
        active_alerts.append(f"🥶 FROST ALERT: {zone} — Min temp {anom['min_temp_7d']}°C (last 7 days)")
    if anom.get("drought_alert"):
        active_alerts.append(f"🏜️ DROUGHT ALERT: {zone} — Drought index {anom['drought_index']:.2f} (90d precip / historical avg)")

if active_alerts:
    for alert in active_alerts:
        css = "alert-frost" if "FROST" in alert else "alert-drought"
        st.markdown(f'<div class="alert-banner {css}">{alert}</div>', unsafe_allow_html=True)
else:
    st.markdown('<div class="alert-banner alert-ok">✓ No active weather alerts across monitored zones</div>',
                unsafe_allow_html=True)

# ── Map ──
st.markdown('<div class="section-header">COFFEE REGIONS — ANOMALY MAP</div>', unsafe_allow_html=True)

map_data = []
for zone, coords in COFFEE_ZONES.items():
    anom = zone_anomalies.get(zone, {})
    precip_anom = anom.get("precip_anomaly_pct", 0)
    color = "#E76F51" if precip_anom < -30 else "#F4A261" if precip_anom < -10 \
        else "#00D4AA" if precip_anom < 20 else "#457B9D"
    map_data.append({
        "zone": zone,
        "lat": coords["lat"],
        "lon": coords["lon"],
        "precip_anomaly": precip_anom,
        "color": color,
    })

fig_map = go.Figure()
for m in map_data:
    anom = zone_anomalies.get(m["zone"], {})
    hover = (f"<b>{m['zone']}</b><br>"
             f"Precip anomaly (30d): {m['precip_anomaly']:+.0f}%<br>"
             f"Min temp (7d): {anom.get('min_temp_7d', '—')}°C<br>"
             f"Drought index: {anom.get('drought_index', '—')}")
    fig_map.add_trace(go.Scattergeo(
        lat=[m["lat"]], lon=[m["lon"]],
        text=[m["zone"]],
        hovertext=[hover],
        hoverinfo="text",
        marker=dict(size=18, color=m["color"], opacity=0.8,
                    line=dict(width=2, color="#fafafa")),
        name=m["zone"],
        showlegend=False,
    ))
    fig_map.add_trace(go.Scattergeo(
        lat=[m["lat"] + 0.3], lon=[m["lon"]],
        text=[f"<b>{m['zone']}</b><br>{m['precip_anomaly']:+.0f}%"],
        mode="text",
        textfont=dict(size=9, color="#fafafa"),
        showlegend=False,
        hoverinfo="skip",
    ))

fig_map.update_geos(
    center=dict(lat=-20, lon=-44),
    projection_scale=12,
    showland=True, landcolor="#141824",
    showocean=True, oceancolor="#0a0e1a",
    showlakes=False,
    showcountries=True, countrycolor="#1e2a3a",
    showcoastlines=True, coastlinecolor="#1e2a3a",
    bgcolor="rgba(0,0,0,0)",
)
fig_map.update_layout(
    height=350,
    template=T,
    margin=dict(l=0, r=0, t=10, b=10),
    paper_bgcolor="rgba(0,0,0,0)",
    geo=dict(bgcolor="rgba(0,0,0,0)"),
)
st.plotly_chart(fig_map, use_container_width=True)

# ── Zone details ──
st.markdown('<div class="section-header">ZONE DETAILS — TEMPERATURE & PRECIPITATION</div>',
            unsafe_allow_html=True)

selected_zone = st.selectbox("Select zone", list(COFFEE_ZONES.keys()),
                             label_visibility="collapsed")

df = zone_data.get(selected_zone, pd.DataFrame())
anom = zone_anomalies.get(selected_zone, {})

if not df.empty:
    c1, c2, c3, c4 = st.columns(4)
    c1.metric("Precip 30d", f"{anom.get('precip_30d', '—')} mm",
              delta=f"{anom.get('precip_anomaly_pct', 0):+.0f}% vs avg")
    c2.metric("Hist. Avg 30d", f"{anom.get('precip_30d_avg', '—')} mm")
    c3.metric("Drought Index (90d)", f"{anom.get('drought_index', '—')}",
              help="Precip 90d / historical avg. <0.5 = drought alert")
    c4.metric("Min Temp (7d)", f"{anom.get('min_temp_7d', '—')}°C",
              help="Below 4°C = frost alert (Jun-Aug)")

    left, right = st.columns(2)

    with left:
        recent = df[df.index >= pd.Timestamp.now() - pd.Timedelta(days=90)]
        if not recent.empty:
            hist_all = df.copy()
            hist_all["doy"] = hist_all.index.dayofyear
            hist_all["year"] = hist_all.index.year
            hist_years = hist_all[hist_all["year"] < pd.Timestamp.now().year]

            fig_temp = go.Figure()

            if not hist_years.empty:
                temp_avg = hist_years.groupby("doy").agg(
                    tmin_avg=("temperature_2m_min", "mean"),
                    tmax_avg=("temperature_2m_max", "mean"),
                ).reset_index()

                today_doy = pd.Timestamp.now().dayofyear
                window_doys = range(max(1, today_doy - 90), today_doy + 1)
                avg_window = temp_avg[temp_avg["doy"].isin(window_doys)]

                ref_dates = pd.date_range(recent.index.min(), recent.index.max(), freq="D")
                ref_doys = [d.dayofyear for d in ref_dates]
                avg_mapped = temp_avg.set_index("doy")

                for col, label, color in [("tmin_avg", "Hist. Avg Min", C_AVG),
                                           ("tmax_avg", "Hist. Avg Max", C_AVG)]:
                    vals = [avg_mapped.loc[d, col] if d in avg_mapped.index else np.nan for d in ref_doys]
                    fig_temp.add_trace(go.Scatter(
                        x=ref_dates, y=vals, name=label,
                        line=dict(color=color, width=1, dash="dot"),
                    ))

            fig_temp.add_trace(go.Scatter(
                x=recent.index, y=recent["temperature_2m_max"],
                name="T max", line=dict(color=C_TEMP, width=1.5),
            ))
            fig_temp.add_trace(go.Scatter(
                x=recent.index, y=recent["temperature_2m_min"],
                name="T min", line=dict(color=C_TEMP_MIN, width=1.5),
                fill="tonexty", fillcolor="rgba(69,123,157,0.1)",
            ))

            fig_temp.add_hline(y=4, line=dict(color="#E76F51", dash="dash", width=1),
                               annotation_text="Frost threshold (4°C)",
                               annotation_font=dict(color="#E76F51", size=9))

            fig_temp.update_layout(
                title=dict(text=f"Temperature — {selected_zone} (90d)", font=dict(size=11, color="#8899aa")),
                yaxis_title="°C", height=320, template=T,
                margin=dict(l=40, r=10, t=30, b=30),
                paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)",
                legend=dict(orientation="h", y=1.08, font=dict(size=9)),
                xaxis=dict(gridcolor="rgba(30,42,58,0.5)"),
                yaxis=dict(gridcolor="rgba(30,42,58,0.5)"),
            )
            st.plotly_chart(fig_temp, use_container_width=True)

    with right:
        if not recent.empty:
            cum_precip = recent["precipitation_sum"].cumsum()
            fig_precip = go.Figure()
            fig_precip.add_trace(go.Bar(
                x=recent.index, y=recent["precipitation_sum"],
                name="Daily Precip", marker=dict(color=C_PRECIP, opacity=0.6),
            ))
            fig_precip.add_trace(go.Scatter(
                x=recent.index, y=cum_precip.values,
                name="Cumulative 30d", yaxis="y2",
                line=dict(color=C_PRECIP, width=2),
            ))

            fig_precip.update_layout(
                title=dict(text=f"Precipitation — {selected_zone} (90d)", font=dict(size=11, color="#8899aa")),
                yaxis_title="mm/day", height=320, template=T,
                margin=dict(l=40, r=40, t=30, b=30),
                paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)",
                legend=dict(orientation="h", y=1.08, font=dict(size=9)),
                yaxis2=dict(title="cumulative mm", overlaying="y", side="right",
                            gridcolor="rgba(30,42,58,0.3)"),
                xaxis=dict(gridcolor="rgba(30,42,58,0.5)"),
                yaxis=dict(gridcolor="rgba(30,42,58,0.5)"),
            )
            st.plotly_chart(fig_precip, use_container_width=True)

# ── Phenological timeline ──
st.markdown('<div class="section-header">PHENOLOGICAL CALENDAR — ARABICA COFFEE</div>',
            unsafe_allow_html=True)

month_to_num = {"Jan": 1, "Feb": 2, "Mar": 3, "Apr": 4, "May": 5, "Jun": 6,
                "Jul": 7, "Aug": 8, "Sep": 9, "Oct": 10, "Nov": 11, "Dec": 12}

fig_pheno = go.Figure()
for i, (phase, start_m, end_m, color) in enumerate(PHENOLOGY):
    s = month_to_num[start_m]
    e = month_to_num[end_m]
    if e < s:
        e += 12
    fig_pheno.add_trace(go.Bar(
        y=[phase], x=[e - s + 1], base=[s - 0.5],
        orientation="h", marker=dict(color=color, opacity=0.7),
        name=phase, showlegend=False,
        text=[phase], textposition="inside",
        textfont=dict(color="#fafafa", size=11),
    ))

current_month = pd.Timestamp.now().month
fig_pheno.add_vline(x=current_month, line=dict(color="#fafafa", width=2, dash="dash"),
                    annotation_text="Now", annotation_font=dict(color="#fafafa"))

month_labels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
fig_pheno.update_layout(
    xaxis=dict(tickmode="array", tickvals=list(range(1, 13)), ticktext=month_labels,
               gridcolor="rgba(30,42,58,0.5)", range=[0.5, 12.5]),
    yaxis=dict(gridcolor="rgba(30,42,58,0.5)"),
    height=220, template=T,
    margin=dict(l=120, r=10, t=10, b=30),
    paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)",
    barmode="stack",
)
st.plotly_chart(fig_pheno, use_container_width=True)

st.markdown("---")
st.caption(
    "Sources: Open-Meteo archive & forecast API (free, no key). "
    "Zones: Sul de Minas, Cerrado Mineiro, Mogiana, Matas de Minas, Espírito Santo. "
    "Frost threshold: <4°C (Jun-Aug). Drought index: 90d precip / historical average."
)
