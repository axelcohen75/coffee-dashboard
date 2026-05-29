"""
Coffee futures data — ICE KC (arabica, New York) and ICE RC (robusta, London).

Unit convention:
  KC  → cents / lb          (Yahoo Finance native)
  RC  → USD / metric tonne  (native)
  RC* → cents / lb          (converted for spread)

Conversion: rc_cents_lb = rc_usd_t / 22.0462
  because 1 metric tonne = 2204.62 lbs
  so 1 USD/t × (100 cts/$) / 2204.62 lbs = 1/22.0462 ¢/lb
"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd
import streamlit as st
import yfinance as yf

# ── Constants ─────────────────────────────────────────────────────────────────

USD_T_TO_CENTS_LB: float = 100 / 2204.62   # ≈ 0.04536

# ICE KC delivery months: Mar H, May K, Jul N, Sep U, Dec Z
KC_MONTHS = ["H", "K", "N", "U", "Z"]
# ICE RC delivery months: Jan F, Mar H, May K, Jul N, Sep U, Nov X
RC_MONTHS = ["F", "H", "K", "N", "U", "X"]

MONTH_TO_INT = {
    "F": 1, "G": 2, "H": 3, "J": 4, "K": 5, "M": 6,
    "N": 7, "Q": 8, "U": 9, "V": 10, "X": 11, "Z": 12,
}

DATA_DIR = Path(__file__).parent.parent / "data"


# ── Internal helpers ──────────────────────────────────────────────────────────

def _yf(ticker: str, period: str = "5d") -> pd.DataFrame:
    """Download yfinance data, strip timezone, return empty DF on failure."""
    try:
        df = yf.Ticker(ticker).history(period=period, auto_adjust=True)
        if df.empty:
            return pd.DataFrame()
        if df.index.tz is not None:
            df.index = df.index.tz_localize(None)
        return df
    except Exception:
        return pd.DataFrame()


def _euro_float(val) -> float:
    """
    Convert Investing.com French number string to float.
    '3.476,00'  →  3476.0   (dot = thousands sep, comma = decimal)
    '1,79%'     →  1.79
    ''          →  NaN
    """
    s = str(val).strip().strip('"')
    if s in ("", "-", "nan"):
        return float("nan")
    s = s.replace("%", "").replace("K", "e3").replace("M", "e6")
    s = s.replace(".", "").replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return float("nan")


def _load_investing_csv(path: Path) -> pd.DataFrame:
    """
    Parse Investing.com French-locale CSV export.
    Expected columns: Date, Dernier, Ouv., Plus Haut, Plus Bas, Vol., Variation %
    Date format: DD/MM/YYYY  — prices: European decimal (3.476,00 = 3476.0 USD/t)
    """
    df = pd.read_csv(path, quotechar='"', dtype=str)
    df.columns = [c.strip() for c in df.columns]

    date_col  = "Date"
    close_col = "Dernier"   # "Last" in French

    df[date_col] = pd.to_datetime(df[date_col], format="%d/%m/%Y", dayfirst=True)
    df["Close"]  = df[close_col].apply(_euro_float)

    df = df.set_index(date_col).sort_index()
    df = df[df.index.dayofweek < 5]          # drop weekends (some CSV sources include them)
    df = df[["Close"]].dropna()
    return df


def _load_csv(filename: str) -> pd.DataFrame:
    """
    Load a CSV from data/.
    Auto-detects Investing.com French format (has 'Dernier' column)
    or falls back to standard Date/Close format.
    """
    path = DATA_DIR / filename
    if not path.exists():
        return pd.DataFrame()
    try:
        # Peek at header to detect format
        header = pd.read_csv(path, nrows=0, quotechar='"')
        header.columns = [c.strip() for c in header.columns]

        if "Dernier" in header.columns:
            return _load_investing_csv(path)

        # Standard format: Date, Close
        df = pd.read_csv(path, parse_dates=["Date"], index_col="Date")
        df.index = pd.to_datetime(df.index)
        if df.index.tz is not None:
            df.index = df.index.tz_localize(None)
        return df.sort_index()
    except Exception:
        return pd.DataFrame()


# ── Front month prices ────────────────────────────────────────────────────────

@st.cache_data(ttl=3600)
def fetch_kc_front() -> float | None:
    """Last KC settle in cents/lb."""
    df = _yf("KC=F", "5d")
    return round(float(df["Close"].iloc[-1]), 2) if not df.empty else None


@st.cache_data(ttl=3600)
def fetch_rc_front() -> float | None:
    """Last RC settle in USD/tonne. Tries yfinance, then CSV fallback."""
    df = _yf("RC=F", "5d")
    if not df.empty:
        return round(float(df["Close"].iloc[-1]), 0)
    # CSV fallback: data/rc_history.csv or data/rc_front.csv
    for fname in ("rc_front.csv", "rc_history.csv"):
        csv_df = _load_csv(fname)
        if not csv_df.empty and "Close" in csv_df.columns:
            return round(float(csv_df["Close"].iloc[-1]), 0)
    return None


# ── Forward curve ─────────────────────────────────────────────────────────────

@st.cache_data(ttl=3600)
def fetch_forward_curve(n: int = 4) -> dict[str, list[dict]]:
    """
    Attempt to retrieve the next n contracts for KC and RC.
    Ticker format tried: {BASE}{MONTH}{YY}.NYB  (e.g. KCH26.NYB)
    Returns {'KC': [...], 'RC': [...]} — empty list if unavailable.
    """
    now = datetime.now()
    curves: dict[str, list[dict]] = {"KC": [], "RC": []}

    for base, months in [("KC", KC_MONTHS), ("RC", RC_MONTHS)]:
        for year in [now.year, now.year + 1, now.year + 2]:
            yr2 = str(year)[-2:]
            for m in months:
                if len(curves[base]) >= n:
                    break
                ticker = f"{base}{m}{yr2}.NYB"
                df = _yf(ticker, "5d")
                if not df.empty:
                    curves[base].append({
                        "contract": f"{m}{yr2}",
                        "price": round(float(df["Close"].iloc[-1]), 2),
                        "month": MONTH_TO_INT[m],
                        "year": year,
                    })
            if len(curves[base]) >= n:
                break

    return curves


# ── Historical data (5 years) ─────────────────────────────────────────────────

@st.cache_data(ttl=86400)
def fetch_kc_history() -> pd.DataFrame:
    """5 years of KC daily closes."""
    df = _yf("KC=F", "5y")
    return df[["Close"]] if not df.empty else pd.DataFrame()


@st.cache_data(ttl=86400)
def fetch_rc_history() -> pd.DataFrame:
    """5 years of RC daily closes. Falls back to data/rc_history.csv."""
    df = _yf("RC=F", "5y")
    if not df.empty:
        return df[["Close"]]
    csv_df = _load_csv("rc_history.csv")
    return csv_df[["Close"]] if not csv_df.empty else pd.DataFrame()


# ── Seasonal average ──────────────────────────────────────────────────────────

def compute_seasonal(df: pd.DataFrame, col: str = "Close") -> pd.DataFrame:
    """
    Average price by day-of-year, computed on all years except the current one.
    Returns DataFrame[doy, seasonal_avg].
    """
    if df.empty or col not in df.columns:
        return pd.DataFrame()
    d = df.copy()
    d.index = pd.to_datetime(d.index)
    if d.index.tz is not None:
        d.index = d.index.tz_localize(None)
    d["year"] = d.index.year
    d["doy"] = d.index.dayofyear
    hist = d[d["year"] < datetime.now().year]
    if hist.empty:
        return pd.DataFrame()
    # Median is robust to years with exceptional price levels (e.g. 2025 KC spike).
    out = hist.groupby("doy")[col].median().reset_index()
    out.columns = ["doy", "seasonal_avg"]

    # Circular 21-day smooth: pad both ends with the opposite end so the
    # Dec→Jan year boundary transitions smoothly instead of jumping.
    smooth = 21
    vals   = out["seasonal_avg"].values.copy()
    padded = np.concatenate([vals[-smooth:], vals, vals[:smooth]])
    smoothed = pd.Series(padded).rolling(smooth, center=True, min_periods=1).mean().values
    out["seasonal_avg"] = smoothed[smooth: smooth + len(vals)]
    return out


def apply_seasonal_to_series(price_series: pd.Series, seasonal: pd.DataFrame) -> pd.Series:
    """
    Build a continuous DAILY series from the doy-indexed seasonal, then
    reindex to the price series trading-day index.

    Using a daily intermediate step (+ linear interpolation for missing doys)
    ensures there are no year-boundary jumps in the displayed overlay.
    """
    if seasonal.empty or price_series.empty:
        return pd.Series(dtype=float)
    doy_map = seasonal.set_index("doy")["seasonal_avg"].to_dict()

    # Create a daily calendar covering the display range
    daily_idx = pd.date_range(price_series.index.min(), price_series.index.max(), freq="D")
    daily_vals = pd.Series(
        [doy_map.get(int(d.dayofyear), np.nan) for d in daily_idx],
        index=daily_idx,
    )
    # Fill any gap (e.g. doy 366 absent in non-leap-year seasonal)
    daily_filled = daily_vals.interpolate(method="linear").ffill().bfill()

    # Return only the trading days present in price_series
    return daily_filled.reindex(price_series.index).rename("seasonal_avg")


def compute_performance(series: pd.Series) -> dict:
    """
    Returns performance metrics dict: 1D, 1W, 1M, 3M, YTD, 1Y (all in %),
    plus 52w high/low and distance from 52w high.
    """
    s = series.dropna().sort_index()
    if len(s) < 2:
        return {}
    last  = float(s.iloc[-1])
    today = s.index[-1]

    def _pct(ref: float | None) -> float | None:
        return round((last / ref - 1) * 100, 2) if (ref and ref != 0) else None

    def _ref(offset) -> float | None:
        sub = s[s.index >= today - offset]
        return float(sub.iloc[0]) if not sub.empty else None

    ytd_sub  = s[s.index >= pd.Timestamp(f"{today.year}-01-01")]
    past_52w = s[s.index >= today - pd.Timedelta(days=365)]
    h52 = float(past_52w.max()) if not past_52w.empty else None
    l52 = float(past_52w.min()) if not past_52w.empty else None

    return {
        "1D":       _pct(float(s.iloc[-2])),
        "1W":       _pct(_ref(pd.Timedelta(days=7))),
        "1M":       _pct(_ref(pd.DateOffset(months=1))),
        "3M":       _pct(_ref(pd.DateOffset(months=3))),
        "YTD":      _pct(float(ytd_sub.iloc[0]) if not ytd_sub.empty else None),
        "1Y":       _pct(_ref(pd.DateOffset(years=1))),
        "52w Haut": h52,
        "52w Bas":  l52,
        "vs 52w H": round((last / h52 - 1) * 100, 1) if h52 else None,
    }


@st.cache_data(ttl=86400)
def fetch_intramarket_spread(m1: str, m2: str, cross_year: bool = False) -> pd.Series:
    """
    Build continuous KC intra-spread history: contract m1 minus contract m2.

    cross_year=False → KCm1{Y} - KCm2{Y}     (e.g. K-N: May vs Jul same year)
    cross_year=True  → KCm1{Y} - KCm2{Y+1}   (e.g. Z-H: Dec Y vs Mar Y+1)

    Concatenates across the last 3 years + current. Returns empty Series if
    Yahoo Finance doesn't carry the contracts.
    """
    now = datetime.now()
    pieces = []
    for yr in range(now.year - 3, now.year + 2):
        yr2      = str(yr)[-2:]
        yr2_next = str(yr + 1)[-2:]
        t2_year  = yr2_next if cross_year else yr2
        df1 = _yf(f"KC{m1}{yr2}.NYB",   "3y")
        df2 = _yf(f"KC{m2}{t2_year}.NYB", "3y")
        if not df1.empty and not df2.empty:
            s = (df1["Close"] - df2["Close"]).dropna()
            if not s.empty:
                pieces.append(s)
    if not pieces:
        return pd.Series(dtype=float)
    result = pd.concat(pieces).sort_index()
    return result[~result.index.duplicated(keep="first")]
