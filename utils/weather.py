"""
Weather data for Brazilian coffee regions via Open-Meteo API.
"""

from __future__ import annotations

import pandas as pd
import streamlit as st

COFFEE_ZONES = {
    "Sul de Minas": {"lat": -21.5, "lon": -45.0},
    "Cerrado Mineiro": {"lat": -19.0, "lon": -47.5},
    "Mogiana (SP)": {"lat": -20.5, "lon": -47.0},
    "Matas de Minas": {"lat": -19.0, "lon": -42.0},
    "Espírito Santo (Conilon)": {"lat": -19.5, "lon": -40.5},
}

PHENOLOGY = [
    ("Floraison", "Sep", "Oct", "#E76F51"),
    ("Formation grains", "Nov", "Jan", "#F4A261"),
    ("Maturation", "Feb", "Apr", "#2A9D8F"),
    ("Récolte", "May", "Aug", "#264653"),
    ("Repos végétatif", "Jun", "Aug", "#457B9D"),
]


def _fetch_open_meteo(lat: float, lon: float, start: str, end: str) -> pd.DataFrame:
    import requests
    url = "https://archive-api.open-meteo.com/v1/archive"
    params = {
        "latitude": lat,
        "longitude": lon,
        "start_date": start,
        "end_date": end,
        "daily": "temperature_2m_min,temperature_2m_max,precipitation_sum",
        "timezone": "America/Sao_Paulo",
    }
    try:
        r = requests.get(url, params=params, timeout=30)
        r.raise_for_status()
        data = r.json()["daily"]
        df = pd.DataFrame(data)
        df["time"] = pd.to_datetime(df["time"])
        df = df.set_index("time")
        return df
    except Exception:
        return pd.DataFrame()


def _fetch_forecast(lat: float, lon: float) -> pd.DataFrame:
    import requests
    url = "https://api.open-meteo.com/v1/forecast"
    params = {
        "latitude": lat,
        "longitude": lon,
        "daily": "temperature_2m_min,temperature_2m_max,precipitation_sum",
        "timezone": "America/Sao_Paulo",
        "forecast_days": 14,
    }
    try:
        r = requests.get(url, params=params, timeout=15)
        r.raise_for_status()
        data = r.json()["daily"]
        df = pd.DataFrame(data)
        df["time"] = pd.to_datetime(df["time"])
        df = df.set_index("time")
        return df
    except Exception:
        return pd.DataFrame()


@st.cache_data(ttl=43200)
def fetch_zone_weather(zone_name: str, years: int = 5) -> pd.DataFrame:
    coords = COFFEE_ZONES[zone_name]
    end = pd.Timestamp.now().normalize()
    start = end - pd.DateOffset(years=years)
    hist = _fetch_open_meteo(coords["lat"], coords["lon"],
                             start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d"))
    forecast = _fetch_forecast(coords["lat"], coords["lon"])
    if not hist.empty and not forecast.empty:
        forecast = forecast[forecast.index > hist.index.max()]
        return pd.concat([hist, forecast])
    return hist if not hist.empty else forecast


def compute_anomalies(df: pd.DataFrame) -> dict:
    if df.empty:
        return {}
    now = pd.Timestamp.now().normalize()
    current_year = now.year
    doy_now = now.dayofyear

    df = df.copy()
    df["doy"] = df.index.dayofyear
    df["year"] = df.index.year

    hist = df[df["year"] < current_year]
    curr = df[df["year"] == current_year]

    precip_30d = curr[curr.index >= now - pd.Timedelta(days=30)]
    precip_30d_sum = precip_30d["precipitation_sum"].sum() if not precip_30d.empty else 0

    hist_30d = hist[(hist["doy"] >= doy_now - 30) & (hist["doy"] <= doy_now)]
    hist_30d_avg = hist_30d.groupby("year")["precipitation_sum"].sum().mean() if not hist_30d.empty else 0

    precip_anomaly = ((precip_30d_sum / hist_30d_avg) - 1) * 100 if hist_30d_avg > 0 else 0

    precip_90d = curr[curr.index >= now - pd.Timedelta(days=90)]
    precip_90d_sum = precip_90d["precipitation_sum"].sum() if not precip_90d.empty else 0
    hist_90d = hist[(hist["doy"] >= doy_now - 90) & (hist["doy"] <= doy_now)]
    hist_90d_avg = hist_90d.groupby("year")["precipitation_sum"].sum().mean() if not hist_90d.empty else 0
    drought_index = precip_90d_sum / hist_90d_avg if hist_90d_avg > 0 else 1.0

    recent_min = curr[curr.index >= now - pd.Timedelta(days=7)]["temperature_2m_min"].min() \
        if not curr.empty else 20.0

    frost_alert = recent_min < 4.0 if pd.notna(recent_min) else False
    drought_alert = drought_index < 0.5

    return {
        "precip_30d": round(precip_30d_sum, 1),
        "precip_30d_avg": round(hist_30d_avg, 1),
        "precip_anomaly_pct": round(precip_anomaly, 1),
        "drought_index": round(drought_index, 2),
        "min_temp_7d": round(recent_min, 1) if pd.notna(recent_min) else None,
        "frost_alert": frost_alert,
        "drought_alert": drought_alert,
    }
