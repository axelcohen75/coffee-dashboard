"""
Brazil parity calculation: FOB Santos export parity vs CEPEA internal price.
"""

from __future__ import annotations

import pandas as pd
import streamlit as st

from utils.conversions import LBS_PER_SACA


@st.cache_data(ttl=43200)
def fetch_brl_usd() -> pd.DataFrame:
    """BRL/USD PTAX from Banco Central do Brasil API."""
    import requests
    url = "https://api.bcb.gov.br/dados/serie/bcdata.sgs.10813/dados?formato=json"
    try:
        r = requests.get(url, timeout=30)
        r.raise_for_status()
        data = r.json()
        df = pd.DataFrame(data)
        df["data"] = pd.to_datetime(df["data"], format="%d/%m/%Y")
        df["valor"] = df["valor"].astype(float)
        df = df.set_index("data").rename(columns={"valor": "BRL_USD"})
        return df.sort_index()
    except Exception:
        return pd.DataFrame()


@st.cache_data(ttl=43200)
def fetch_brl_usd_recent() -> float | None:
    df = fetch_brl_usd()
    if df.empty:
        return None
    return round(float(df["BRL_USD"].iloc[-1]), 4)


def compute_parity(kc_cents_lb: float, fx_brl_usd: float,
                   differential: float = -5.0) -> float:
    fob_cents = kc_cents_lb + differential
    fob_reais_saca = fob_cents * LBS_PER_SACA / 100.0 * fx_brl_usd
    return round(fob_reais_saca, 2)


def compute_parity_series(kc_series: pd.Series, fx_series: pd.Series,
                          differential: float = -5.0) -> pd.Series:
    aligned = pd.DataFrame({"kc": kc_series, "fx": fx_series}).dropna()
    if aligned.empty:
        return pd.Series(dtype=float)
    fob = (aligned["kc"] + differential) * LBS_PER_SACA / 100.0 * aligned["fx"]
    return fob.rename("parity_reais_saca")


def sensitivity_matrix(kc_base: float, fx_base: float,
                       differential: float = -5.0) -> pd.DataFrame:
    kc_range = [kc_base * (1 + d / 100) for d in [-10, -5, 0, 5, 10]]
    fx_range = [fx_base * (1 + d / 100) for d in [-10, -5, 0, 5, 10]]
    rows = {}
    for kc in kc_range:
        row = {}
        for fx in fx_range:
            row[f"FX {fx:.2f}"] = compute_parity(kc, fx, differential)
        rows[f"KC {kc:.1f}"] = row
    return pd.DataFrame(rows).T
