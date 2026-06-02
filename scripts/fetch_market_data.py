"""
Coffee Market Data Fetcher
Pulls all market data via yfinance + public APIs and writes a single
static JSON to docs/data/market-data.json.

Run manually:   python scripts/fetch_market_data.py
Or via GitHub Actions on schedule.
"""

from __future__ import annotations

import json
import sys
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd
import requests
import yfinance as yf

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from scripts.news_curation import curate_news_articles, extract_source
from scripts.news_helpers import enrich_news_articles
from utils.conversions import LBS_PER_SACA, USD_T_TO_CENTS_LB

OUT = ROOT / "docs" / "data" / "market-data.json"

# ── Constants ────────────────────────────────────────────────────────────────
KC_MONTHS = ["H", "K", "N", "U", "Z"]
RC_MONTHS = ["F", "H", "K", "N", "U", "X"]
MONTH_TO_INT = {
    "F": 1, "G": 2, "H": 3, "J": 4, "K": 5, "M": 6,
    "N": 7, "Q": 8, "U": 9, "V": 10, "X": 11, "Z": 12,
}
MONTH_LABELS = {
    1: "Jan", 2: "Feb", 3: "Mar", 4: "Apr", 5: "May", 6: "Jun",
    7: "Jul", 8: "Aug", 9: "Sep", 10: "Oct", 11: "Nov", 12: "Dec",
}

COFFEE_ZONES = {
    "Sul de Minas": {"lat": -21.5, "lon": -45.0},
    "Cerrado Mineiro": {"lat": -19.0, "lon": -47.5},
    "Mogiana (SP)": {"lat": -20.5, "lon": -47.0},
    "Matas de Minas": {"lat": -19.0, "lon": -42.0},
    "Espirito Santo (Conilon)": {"lat": -19.5, "lon": -40.5},
}

DATA_DIR = ROOT / "data"


# ── Helpers ──────────────────────────────────────────────────────────────────

def _yf(ticker: str, period: str = "5d") -> pd.DataFrame:
    try:
        df = yf.Ticker(ticker).history(period=period, auto_adjust=True)
        if df.empty:
            return pd.DataFrame()
        if df.index.tz is not None:
            df.index = df.index.tz_localize(None)
        return df
    except Exception:
        return pd.DataFrame()


def _ts(s: pd.Series) -> list[dict]:
    """Convert a Series to [{date, value}, ...]."""
    s = s.dropna()
    return [{"date": d.strftime("%Y-%m-%d"), "value": round(float(v), 4)}
            for d, v in s.items()]


def _perf(s: pd.Series) -> dict:
    """Compute performance metrics from a price series."""
    s = s.dropna().sort_index()
    if len(s) < 2:
        return {}
    last = float(s.iloc[-1])
    today = s.index[-1]

    def pct(ref):
        return round((last / ref - 1) * 100, 2) if ref and ref != 0 else None

    def ref(offset):
        sub = s[s.index >= today - offset]
        return float(sub.iloc[0]) if not sub.empty else None

    ytd = s[s.index >= pd.Timestamp(f"{today.year}-01-01")]
    w52 = s[s.index >= today - pd.Timedelta(days=365)]

    return {
        "price": round(last, 2),
        "1d": pct(float(s.iloc[-2])),
        "1w": pct(ref(pd.Timedelta(days=7))),
        "1m": pct(ref(pd.DateOffset(months=1))),
        "3m": pct(ref(pd.DateOffset(months=3))),
        "ytd": pct(float(ytd.iloc[0]) if not ytd.empty else None),
        "1y": pct(ref(pd.DateOffset(years=1))),
        "52w_high": round(float(w52.max()), 2) if not w52.empty else None,
        "52w_low": round(float(w52.min()), 2) if not w52.empty else None,
    }


def _euro_float(val) -> float:
    s = str(val).strip().strip('"')
    if s in ("", "-", "nan"):
        return float("nan")
    s = s.replace("%", "").replace("K", "e3").replace("M", "e6")
    s = s.replace(".", "").replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return float("nan")


def _load_rc_csv() -> pd.DataFrame:
    for fname in ("robusta_futures_price_history.csv",):
        path = DATA_DIR / fname
        if not path.exists():
            continue
        try:
            header = pd.read_csv(path, nrows=0, quotechar='"')
            header.columns = [c.strip() for c in header.columns]
            if "Dernier" in header.columns:
                df = pd.read_csv(path, quotechar='"', dtype=str)
                df.columns = [c.strip() for c in df.columns]
                df["Date"] = pd.to_datetime(df["Date"], format="%d/%m/%Y", dayfirst=True)
                df["Close"] = df["Dernier"].apply(_euro_float)
                df = df.set_index("Date").sort_index()
                return df[["Close"]].dropna()
            else:
                df = pd.read_csv(path, parse_dates=["Date"], index_col="Date")
                return df[["Close"]].sort_index().dropna()
        except Exception:
            continue
    return pd.DataFrame()



def _load_two_column_history(filename: str, value_col: str | None = None) -> dict:
    """Load a Date/value CSV from data/ into dashboard JSON shape."""
    path = DATA_DIR / filename
    if not path.exists():
        return {"current": None, "history": [], "source": filename}
    try:
        df = pd.read_csv(path)
        if "Date" not in df.columns:
            return {"current": None, "history": [], "source": filename}
        if value_col is None:
            candidates = [c for c in df.columns if c != "Date"]
            value_col = candidates[0] if candidates else None
        if value_col is None or value_col not in df.columns:
            return {"current": None, "history": [], "source": filename}
        df["Date"] = pd.to_datetime(df["Date"], errors="coerce")
        df[value_col] = pd.to_numeric(df[value_col], errors="coerce")
        df = df.dropna(subset=["Date", value_col]).sort_values("Date")
        history = [{"date": d.strftime("%Y-%m-%d"), "value": round(float(v), 4)} for d, v in zip(df["Date"], df[value_col])]
        return {
            "current": history[-1]["value"] if history else None,
            "history": history,
            "source": filename,
        }
    except Exception as exc:
        print(f"    Failed to load {filename}: {exc}")
        return {"current": None, "history": [], "source": filename}


def load_cepea_data() -> dict:
    print("  Loading CEPEA Arabica CSV…")
    return _load_two_column_history("cepea_arabica_usd_bag.csv", "Price US$")


def fetch_dxy() -> dict:
    print("  Loading DXY history…")
    return _load_two_column_history("dxy_index_history.csv", "Price")


def _tradingview_quotes(symbols: list[str]) -> dict[str, dict]:
    """Fetch delayed public TradingView quotes via the scanner endpoint."""
    if not symbols:
        return {}
    columns = [
        "name", "description", "close", "open", "high", "low",
        "change", "volume", "currency", "type", "subtype", "exchange",
    ]
    payload = {
        "symbols": {"tickers": symbols, "query": {"types": []}},
        "columns": columns,
    }
    try:
        resp = requests.post(
            "https://scanner.tradingview.com/futures/scan",
            json=payload,
            timeout=15,
            headers={"User-Agent": "Mozilla/5.0", "Content-Type": "application/json"},
        )
        if resp.status_code != 200:
            return {}
        result = {}
        for row in resp.json().get("data", []):
            values = row.get("d", [])
            if len(values) != len(columns):
                continue
            result[row.get("s")] = dict(zip(columns, values))
        return result
    except Exception as exc:
        print(f"    TradingView quote fetch failed: {exc}")
        return {}


def _tradingview_robusta_symbols(n: int = 8) -> list[dict]:
    """Build upcoming ICEEUR Robusta contract symbols for TradingView."""
    now = datetime.utcnow()
    contracts = []
    for year in [now.year, now.year + 1, now.year + 2]:
        for code in RC_MONTHS:
            month = MONTH_TO_INT[code]
            if year == now.year and month < now.month:
                continue
            contracts.append({
                "symbol": f"ICEEUR:RC{code}{year}",
                "contract": f"{code}{str(year)[-2:]}",
                "delivery_month": f"{MONTH_LABELS[month]} {year}",
                "month": month,
                "year": year,
            })
            if len(contracts) >= n:
                return contracts
    return contracts


def _fetch_tradingview_robusta_curve(n: int = 8) -> list[dict]:
    contracts = _tradingview_robusta_symbols(n)
    quotes = _tradingview_quotes([c["symbol"] for c in contracts])
    curve = []
    for contract in contracts:
        quote = quotes.get(contract["symbol"])
        if not quote:
            continue
        try:
            price = round(float(quote.get("close")), 2)
        except (TypeError, ValueError):
            continue
        curve.append({
            **contract,
            "price": price,
            "source": "tradingview_delayed",
            "description": quote.get("description"),
            "volume": quote.get("volume") or 0,
            "change": quote.get("change"),
        })
    return curve

# ── Seasonal ─────────────────────────────────────────────────────────────────

def _seasonal(s: pd.Series) -> list[dict]:
    """Compute 5y seasonal average by day-of-year."""
    s = s.dropna()
    if len(s) < 252:
        return []
    df = pd.DataFrame({"close": s})
    df["year"] = df.index.year
    df["doy"] = df.index.dayofyear
    hist = df[df["year"] < datetime.now().year]
    if hist.empty:
        return []
    avg = hist.groupby("doy")["close"].median()
    vals = avg.values.copy()
    pad = 21
    padded = np.concatenate([vals[-pad:], vals, vals[:pad]])
    smoothed = pd.Series(padded).rolling(pad, center=True, min_periods=1).mean().values
    result = smoothed[pad: pad + len(vals)]
    return [{"doy": int(d), "value": round(float(v), 2)} for d, v in zip(avg.index, result)]


# ══════════════════════════════════════════════════════════════════════════════
# FETCHERS
# ══════════════════════════════════════════════════════════════════════════════

def fetch_futures() -> dict:
    print("  Fetching KC & RC futures…")
    kc_hist = _yf("KC=F", "10y")
    rc_hist_yf = _yf("RC=F", "10y")

    rc_csv = pd.DataFrame()
    if rc_hist_yf.empty:
        rc_csv = _load_rc_csv()

    rc_hist = rc_hist_yf if not rc_hist_yf.empty else rc_csv

    kc_s = kc_hist["Close"] if not kc_hist.empty else pd.Series(dtype=float)
    rc_s = rc_hist["Close"] if not rc_hist.empty else pd.Series(dtype=float)

    kc_front = round(float(kc_s.iloc[-1]), 2) if not kc_s.empty else None
    rc_front = round(float(rc_s.iloc[-1]), 0) if not rc_s.empty else None
    rc_front_cl = round(rc_front * USD_T_TO_CENTS_LB, 2) if rc_front else None
    arb_rob = round(kc_front - rc_front_cl, 2) if (kc_front and rc_front_cl) else None

    # Arb-rob history
    arb_rob_hist = []
    if not kc_s.empty and not rc_s.empty:
        rc_cl = rc_s * USD_T_TO_CENTS_LB
        sp = (kc_s - rc_cl).dropna()
        arb_rob_hist = _ts(sp)
        arb_rob_mean = round(float(sp.mean()), 2)
        arb_rob_std = round(float(sp.std()), 2)
    else:
        arb_rob_mean = None
        arb_rob_std = None

    return {
        "kc": {
            "front": kc_front,
            "unit": "¢/lb",
            "history": _ts(kc_s),
            "performance": _perf(kc_s) if not kc_s.empty else {},
            "seasonal": _seasonal(kc_s) if not kc_s.empty else [],
        },
        "rc": {
            "front": rc_front,
            "front_cents_lb": rc_front_cl,
            "unit": "$/t",
            "source": "yfinance" if not rc_hist_yf.empty else ("csv" if not rc_csv.empty else "unavailable"),
            "history": _ts(rc_s),
            "history_cents_lb": _ts(rc_s * USD_T_TO_CENTS_LB) if not rc_s.empty else [],
            "performance": _perf(rc_s) if not rc_s.empty else {},
            "seasonal": _seasonal(rc_s) if not rc_s.empty else [],
        },
        "arb_rob": {
            "current": arb_rob,
            "mean": arb_rob_mean,
            "std": arb_rob_std,
            "history": arb_rob_hist,
        },
    }


def fetch_forward_curve(n: int = 8) -> dict:
    print("  Fetching forward curves…")
    now = datetime.now()
    curves = {"kc": [], "rc": []}

    for year in [now.year, now.year + 1, now.year + 2]:
        yr2 = str(year)[-2:]
        for m in KC_MONTHS:
            if len(curves["kc"]) >= n:
                break
            ticker = f"KC{m}{yr2}.NYB"
            df = _yf(ticker, "5d")
            if not df.empty:
                curves["kc"].append({
                    "contract": f"{m}{yr2}",
                    "price": round(float(df["Close"].iloc[-1]), 2),
                    "month": MONTH_TO_INT[m],
                    "year": year,
                    "source": "yfinance",
                })
        if len(curves["kc"]) >= n:
            break

    tv_rc = _fetch_tradingview_robusta_curve(n)
    if tv_rc:
        curves["rc"] = tv_rc
        print(f"    Robusta curve: {len(tv_rc)} contracts from TradingView delayed quotes")
    else:
        print("    TradingView Robusta curve unavailable; trying yfinance tickers")
        for year in [now.year, now.year + 1, now.year + 2]:
            yr2 = str(year)[-2:]
            for m in RC_MONTHS:
                if len(curves["rc"]) >= n:
                    break
                ticker = f"RC{m}{yr2}.NYB"
                df = _yf(ticker, "5d")
                if not df.empty:
                    curves["rc"].append({
                        "contract": f"{m}{yr2}",
                        "price": round(float(df["Close"].iloc[-1]), 2),
                        "month": MONTH_TO_INT[m],
                        "year": year,
                        "source": "yfinance",
                    })
            if len(curves["rc"]) >= n:
                break

    return curves

def fetch_spreads() -> dict:
    print("  Fetching calendar spreads…")
    now = datetime.now()
    spread_defs = [
        ("kn", "K", "N", False, "KC K-N (May-Jul)"),
        ("nz", "N", "Z", False, "KC N-Z (Jul-Dec)"),
        ("zh", "Z", "H", True, "KC Z-H (Dec-Mar)"),
        ("hk", "H", "K", False, "KC H-K (Mar-May)"),
    ]

    result = {}
    for key, m1, m2, cross_yr, label in spread_defs:
        pieces = []
        for yr in range(now.year - 3, now.year + 2):
            yr2 = str(yr)[-2:]
            yr2_next = str(yr + 1)[-2:]
            t2_yr = yr2_next if cross_yr else yr2
            df1 = _yf(f"KC{m1}{yr2}.NYB", "3y")
            df2 = _yf(f"KC{m2}{t2_yr}.NYB", "3y")
            if not df1.empty and not df2.empty:
                s = (df1["Close"] - df2["Close"]).dropna()
                if not s.empty:
                    pieces.append(s)

        if pieces:
            combined = pd.concat(pieces).sort_index()
            combined = combined[~combined.index.duplicated(keep="first")]
            current = round(float(combined.iloc[-1]), 2)
            mean = round(float(combined.mean()), 2)
            std = round(float(combined.std()), 2)
            p5 = round(float(combined.quantile(0.05)), 2)
            p95 = round(float(combined.quantile(0.95)), 2)
            result[key] = {
                "label": label,
                "current": current,
                "mean": mean,
                "std": std,
                "p5": p5,
                "p95": p95,
                "history": _ts(combined),
            }

    return result


def fetch_brazil() -> dict:
    print("  Fetching Brazil parity data…")
    fx = None
    fx_history = []
    try:
        start = (pd.Timestamp.now() - pd.DateOffset(years=6)).strftime("%d/%m/%Y")
        end = pd.Timestamp.now().strftime("%d/%m/%Y")
        r = requests.get(
            f"https://api.bcb.gov.br/dados/serie/bcdata.sgs.10813/dados?formato=json&dataInicial={start}&dataFinal={end}",
            timeout=30,
            headers={"Accept": "application/json", "User-Agent": "Mozilla/5.0"},
        )
        r.raise_for_status()
        data = r.json()
        df = pd.DataFrame(data)
        df["data"] = pd.to_datetime(df["data"], format="%d/%m/%Y")
        df["valor"] = df["valor"].astype(float)
        df = df.set_index("data").sort_index()
        fx = round(float(df["valor"].iloc[-1]), 4)
        fx_history = [{"date": d.strftime("%Y-%m-%d"), "value": round(float(v), 4)}
                      for d, v in df["valor"].items()]
    except Exception as e:
        print(f"    Warning: Could not fetch BRL/USD: {e}")

    kc_hist = _yf("KC=F", "5y")
    kc_s = kc_hist["Close"] if not kc_hist.empty else pd.Series(dtype=float)

    # Placeholder FOB Santos vs KC (¢/lb): not sourced from market data.
    differential = -5.0
    parity = None
    parity_history = []

    if fx and not kc_s.empty:
        kc_front = float(kc_s.iloc[-1])
        fob = kc_front + differential
        parity = round(fob * LBS_PER_SACA / 100.0 * fx, 2)

        # Build parity history
        try:
            start2 = (pd.Timestamp.now() - pd.DateOffset(years=6)).strftime("%d/%m/%Y")
            end2 = pd.Timestamp.now().strftime("%d/%m/%Y")
            r2 = requests.get(
                f"https://api.bcb.gov.br/dados/serie/bcdata.sgs.10813/dados?formato=json&dataInicial={start2}&dataFinal={end2}",
                timeout=30,
                headers={"Accept": "application/json", "User-Agent": "Mozilla/5.0"},
            )
            fx_df = pd.DataFrame(r2.json())
            fx_df["data"] = pd.to_datetime(fx_df["data"], format="%d/%m/%Y")
            fx_df["valor"] = fx_df["valor"].astype(float)
            fx_df = fx_df.set_index("data").sort_index()

            kc_clean = kc_s.copy()
            if kc_clean.index.tz is not None:
                kc_clean.index = kc_clean.index.tz_localize(None)

            aligned = pd.DataFrame({"kc": kc_clean, "fx": fx_df["valor"]}).dropna()
            if not aligned.empty:
                par = (aligned["kc"] + differential) * LBS_PER_SACA / 100.0 * aligned["fx"]
                parity_history = _ts(par)
        except Exception:
            pass

    # Sensitivity matrix
    sensitivity = []
    if fx and not kc_s.empty:
        kc_front = float(kc_s.iloc[-1])
        for kc_delta in [-10, -5, 0, 5, 10]:
            kc_val = kc_front * (1 + kc_delta / 100)
            row = {"kc": round(kc_val, 1), "kc_delta": kc_delta, "values": []}
            for fx_delta in [-10, -5, 0, 5, 10]:
                fx_val = fx * (1 + fx_delta / 100)
                par = round((kc_val + differential) * LBS_PER_SACA / 100.0 * fx_val, 0)
                row["values"].append({
                    "fx": round(fx_val, 2),
                    "fx_delta": fx_delta,
                    "parity": par,
                })
            sensitivity.append(row)

    return {
        "fx": fx,
        "fx_history": fx_history,
        "differential": differential,
        "parity": parity,
        "parity_history": parity_history,
        "sensitivity": sensitivity,
    }


def fetch_weather() -> dict:
    print("  Fetching weather data…")
    zones = {}

    for zone_name, coords in COFFEE_ZONES.items():
        try:
            end = pd.Timestamp.now().normalize()
            start = end - pd.DateOffset(years=2)

            r = requests.get("https://archive-api.open-meteo.com/v1/archive", params={
                "latitude": coords["lat"],
                "longitude": coords["lon"],
                "start_date": start.strftime("%Y-%m-%d"),
                "end_date": end.strftime("%Y-%m-%d"),
                "daily": "temperature_2m_min,temperature_2m_max,precipitation_sum",
                "timezone": "America/Sao_Paulo",
            }, timeout=30)
            r.raise_for_status()
            data = r.json()["daily"]

            df = pd.DataFrame(data)
            df["time"] = pd.to_datetime(df["time"])
            df = df.set_index("time")

            # Forecast
            try:
                rf = requests.get("https://api.open-meteo.com/v1/forecast", params={
                    "latitude": coords["lat"],
                    "longitude": coords["lon"],
                    "daily": "temperature_2m_min,temperature_2m_max,precipitation_sum",
                    "timezone": "America/Sao_Paulo",
                    "forecast_days": 14,
                }, timeout=15)
                rf.raise_for_status()
                fdata = rf.json()["daily"]
                fdf = pd.DataFrame(fdata)
                fdf["time"] = pd.to_datetime(fdf["time"])
                fdf = fdf.set_index("time")
                fdf = fdf[fdf.index > df.index.max()]
                df = pd.concat([df, fdf])
            except Exception:
                pass

            # Compute anomalies
            now_ts = pd.Timestamp.now().normalize()
            doy_now = now_ts.dayofyear
            cy = now_ts.year
            df["doy"] = df.index.dayofyear
            df["year"] = df.index.year
            hist = df[df["year"] < cy]
            curr = df[df["year"] == cy]

            p30 = curr[curr.index >= now_ts - pd.Timedelta(days=30)]
            p30_sum = float(p30["precipitation_sum"].sum()) if not p30.empty else 0
            h30 = hist[(hist["doy"] >= doy_now - 30) & (hist["doy"] <= doy_now)]
            h30_avg = float(h30.groupby("year")["precipitation_sum"].sum().mean()) if not h30.empty else 0
            p_anomaly = round(((p30_sum / h30_avg) - 1) * 100, 1) if h30_avg > 0 else 0

            p90 = curr[curr.index >= now_ts - pd.Timedelta(days=90)]
            p90_sum = float(p90["precipitation_sum"].sum()) if not p90.empty else 0
            h90 = hist[(hist["doy"] >= doy_now - 90) & (hist["doy"] <= doy_now)]
            h90_avg = float(h90.groupby("year")["precipitation_sum"].sum().mean()) if not h90.empty else 0
            drought_idx = round(p90_sum / h90_avg, 2) if h90_avg > 0 else 1.0

            recent_min = float(curr[curr.index >= now_ts - pd.Timedelta(days=7)]["temperature_2m_min"].min()) \
                if not curr.empty else 20.0
            if pd.isna(recent_min):
                recent_min = 20.0

            frost = recent_min < 4.0
            drought = drought_idx < 0.5

            # Last 90 days for charts
            last90 = df[df.index >= now_ts - pd.Timedelta(days=90)]
            temp_data = [
                {"date": d.strftime("%Y-%m-%d"),
                 "tmin": round(float(row["temperature_2m_min"]), 1) if pd.notna(row["temperature_2m_min"]) else None,
                 "tmax": round(float(row["temperature_2m_max"]), 1) if pd.notna(row["temperature_2m_max"]) else None,
                 "precip": round(float(row["precipitation_sum"]), 1) if pd.notna(row["precipitation_sum"]) else 0}
                for d, row in last90.iterrows()
            ]

            # Historical average temp by doy
            hist_avg = []
            if not hist.empty:
                avg = hist.groupby("doy").agg(
                    tmin_avg=("temperature_2m_min", "mean"),
                    tmax_avg=("temperature_2m_max", "mean"),
                    precip_avg=("precipitation_sum", "mean"),
                )
                for doy_val, row in avg.iterrows():
                    hist_avg.append({
                        "doy": int(doy_val),
                        "tmin_avg": round(float(row["tmin_avg"]), 1),
                        "tmax_avg": round(float(row["tmax_avg"]), 1),
                        "precip_avg": round(float(row["precip_avg"]), 1),
                    })

            zones[zone_name] = {
                "lat": coords["lat"],
                "lon": coords["lon"],
                "precip_30d": round(p30_sum, 1),
                "precip_30d_avg": round(h30_avg, 1),
                "precip_anomaly_pct": p_anomaly,
                "drought_index": drought_idx,
                "min_temp_7d": round(recent_min, 1),
                "frost_alert": frost,
                "drought_alert": drought,
                "recent_data": temp_data,
                "historical_avg": hist_avg,
            }
            print(f"    {zone_name}: OK")
        except Exception as e:
            print(f"    {zone_name}: FAILED — {e}")
            zones[zone_name] = {
                "lat": coords["lat"], "lon": coords["lon"],
                "error": str(e),
            }

    return zones


def _load_local_cot_market(market: str, filename: str) -> dict:
    """Load a curated local COT CSV and return dashboard-ready metrics."""
    path = DATA_DIR / filename
    if not path.exists():
        return {"available": False}

    df = pd.read_csv(path)
    rename = {
        "Report_Date_as_YYYY-MM-DD": "date",
        "Report_Date_as_MM_DD_YYYY": "date",
        "As_of_Date_Form_MM/DD/YYYY": "date",
        "Open_Interest_All": "oi",
        "Prod_Merc_Positions_Long_All": "prod_long",
        "Prod_Merc_Positions_Short_All": "prod_short",
        "Swap_Positions_Long_All": "swap_long",
        "Swap__Positions_Short_All": "swap_short",
        "Swap_Positions_Short_All": "swap_short",
        "M_Money_Positions_Long_All": "mm_long",
        "M_Money_Positions_Short_All": "mm_short",
        "Other_Rept_Positions_Long_All": "other_long",
        "Other_Rept_Positions_Short_All": "other_short",
        "Net_Managed_Money": "mm_net",
        "Net_Commercials": "prod_net",
        "Net_Swap": "swap_net",
        "Net_Other": "other_net",
    }
    df = df.rename(columns={col: rename.get(col, col) for col in df.columns})
    if "date" not in df:
        return {"available": False}

    df["date"] = pd.to_datetime(df["date"], errors="coerce")
    df = df.dropna(subset=["date"]).copy()

    cols = [
        "oi", "prod_long", "prod_short", "swap_long", "swap_short",
        "mm_long", "mm_short", "other_long", "other_short",
    ]
    for col in cols:
        df[col] = pd.to_numeric(df.get(col, 0), errors="coerce").fillna(0)

    net_pairs = {
        "mm_net": ("mm_long", "mm_short"),
        "prod_net": ("prod_long", "prod_short"),
        "swap_net": ("swap_long", "swap_short"),
        "other_net": ("other_long", "other_short"),
    }
    for net_col, (long_col, short_col) in net_pairs.items():
        if net_col not in df:
            df[net_col] = df[long_col] - df[short_col]
        else:
            df[net_col] = pd.to_numeric(df[net_col], errors="coerce").fillna(df[long_col] - df[short_col])

    df = df.set_index("date").sort_index()
    df = df[~df.index.duplicated(keep="last")]
    if df.empty:
        return {"available": False}

    mm_net = df["mm_net"]
    zscore = ((mm_net - mm_net.rolling(104, min_periods=20).mean()) / mm_net.rolling(104, min_periods=20).std())

    def _pct_rank(values) -> float:
        s = pd.Series(values).dropna()
        if s.empty:
            return float("nan")
        return float((s <= s.iloc[-1]).mean() * 100)

    percentile = mm_net.rolling(104, min_periods=20).apply(_pct_rank, raw=False)
    latest = df.iloc[-1]
    previous = df.iloc[-2] if len(df) > 1 else latest
    latest_z = float(zscore.dropna().iloc[-1]) if not zscore.dropna().empty else 0.0
    latest_pct = float(percentile.dropna().iloc[-1]) if not percentile.dropna().empty else 50.0

    history = []
    for d, row in df.iterrows():
        oi = float(row["oi"]) if row["oi"] else 0.0
        item = {"date": d.strftime("%Y-%m-%d")}
        for col in [
            "mm_long", "mm_short", "mm_net", "prod_long", "prod_short", "prod_net",
            "swap_long", "swap_short", "swap_net", "other_long", "other_short", "other_net", "oi",
        ]:
            item[col] = int(row[col]) if pd.notna(row[col]) else 0
        for col in ["mm", "prod", "swap", "other"]:
            item[f"{col}_pct_oi"] = round(float(row[f"{col}_net"]) / oi * 100, 2) if oi else None
        history.append(item)

    recent_flow = []
    for d, row in df.tail(8).iterrows():
        prev = df.shift(1).loc[d]
        recent_flow.append({
            "date": d.strftime("%Y-%m-%d"),
            "mm_net": int(row["mm_net"]),
            "mm_wow": int(row["mm_net"] - prev["mm_net"]) if pd.notna(prev["mm_net"]) else 0,
            "prod_net": int(row["prod_net"]),
            "prod_wow": int(row["prod_net"] - prev["prod_net"]) if pd.notna(prev["prod_net"]) else 0,
            "swap_net": int(row["swap_net"]),
            "other_net": int(row["other_net"]),
            "oi": int(row["oi"]),
        })

    return {
        "available": True,
        "market": market,
        "source": filename,
        "last_report": df.index[-1].strftime("%Y-%m-%d"),
        "rows": int(len(df)),
        "current_mm_net": int(latest["mm_net"]),
        "current_mm_wow": int(latest["mm_net"] - previous["mm_net"]),
        "current_prod_net": int(latest["prod_net"]),
        "current_prod_wow": int(latest["prod_net"] - previous["prod_net"]),
        "current_swap_net": int(latest["swap_net"]),
        "current_other_net": int(latest["other_net"]),
        "current_oi": int(latest["oi"]),
        "current_oi_wow": int(latest["oi"] - previous["oi"]),
        "current_mm_pct_oi": round(float(latest["mm_net"]) / float(latest["oi"]) * 100, 2) if latest["oi"] else None,
        "current_zscore": round(latest_z, 2),
        "current_percentile": round(latest_pct, 1),
        "history": history,
        "zscore_history": [
            {"date": d.strftime("%Y-%m-%d"), "value": round(float(v), 2)}
            for d, v in zscore.dropna().items()
        ],
        "percentile_history": [
            {"date": d.strftime("%Y-%m-%d"), "value": round(float(v), 1)}
            for d, v in percentile.dropna().items()
        ],
        "recent_flow": recent_flow,
    }


def fetch_cot() -> dict:
    print("  Loading local COT data…")
    files = {
        "Arabica": "cot_arabica_disaggregated.csv",
        "Robusta": "cot_robusta_disaggregated.csv",
    }
    markets = {}
    for market, filename in files.items():
        payload = _load_local_cot_market(market, filename)
        if payload.get("available"):
            markets[market] = payload
            print(f"    {market}: {payload['rows']} rows from {filename}")
        else:
            print(f"    {market}: missing or invalid {filename}")

    return {
        "available": bool(markets),
        "default_market": "Arabica" if "Arabica" in markets else next(iter(markets), None),
        "markets": markets,
    }

def fetch_news() -> list[dict]:
    print("  Fetching coffee news…")
    import xml.etree.ElementTree as ET
    import re
    from email.utils import parsedate_to_datetime

    feeds = [
        "https://news.google.com/rss/search?q=coffee+futures+price+when:7d&hl=en-US&gl=US&ceid=US:en",
        "https://news.google.com/rss/search?q=arabica+robusta+coffee+market+when:7d&hl=en-US&gl=US&ceid=US:en",
        "https://news.google.com/rss/search?q=brazil+coffee+crop+harvest+when:14d&hl=en-US&gl=US&ceid=US:en",
        "https://news.google.com/rss/search?q=ICE+coffee+commodity+when:7d&hl=en-US&gl=US&ceid=US:en",
        "https://news.google.com/rss/search?q=coffee+price+StoneX+ECOM+Sucafina+when:14d&hl=en-US&gl=US&ceid=US:en",
        "https://news.google.com/rss/search?q=coffee+price+Barchart+when:14d&hl=en-US&gl=US&ceid=US:en",
        "https://news.google.com/rss/search?q=%22coffee+futures%22+when:3d&hl=en-US&gl=US&ceid=US:en",
        "https://news.google.com/rss/search?q=cafe+arabica+robusta+prix+when:7d&hl=fr-FR&gl=FR&ceid=FR:fr",
    ]

    bull_words = [
        "surge", "soar", "rally", "jump", "rise", "gain", "higher", "bull",
        "shortage", "drought", "frost", "freeze", "supply concern", "tight supply",
        "record high", "supply deficit", "crop damage", "low stocks",
        "backwardation", "climbing", "increase", "strong demand", "price spike",
        "demand recovery", "consumption growth", "stock draw", "inventory draw",
        "hausse", "rebond", "rallye", "en hausse", "tension", "déficit",
        "gel", "gèle", "sécheresse", "offre tendue", "reprise de la demande",
    ]
    bear_words = [
        "fall", "drop", "decline", "slump", "plunge", "slide", "lower", "bear",
        "surplus", "bumper crop", "abundant", "oversupply", "record harvest",
        "record production", "production growth", "record growth in coffee production",
        "higher output", "output increase", "supply growth", "supply increase",
        "harvest pressure", "export recovery", "inventory build", "stocks build",
        "weak demand", "contango", "price drop", "selloff", "sell-off",
        "recession", "glut", "excess", "ceasefire", "deal", "easing",
        "baisse", "chute", "recul", "en baisse", "baissé",
        "récolte record", "production record", "croissance record de la production",
        "pression", "pression de récolte", "reprise des exportations",
        "offre abondante", "offre en hausse", "faible demande",
    ]

    articles = []
    seen = set()
    for feed_url in feeds:
        try:
            r = requests.get(feed_url, timeout=10, headers={"User-Agent": "Mozilla/5.0"})
            if r.status_code != 200:
                continue
            root = ET.fromstring(r.content)
            for item in root.findall(".//item")[:8]:
                title = item.findtext("title", "").strip()
                if not title or title in seen:
                    continue
                seen.add(title)
                link = item.findtext("link", "")
                pub = item.findtext("pubDate", "")
                desc = item.findtext("description", "")
                if "<" in desc:
                    desc = re.sub(r"<[^>]+>", "", desc)
                desc = desc[:250].strip()

                age = ""
                try:
                    dt = parsedate_to_datetime(pub)
                    now = datetime.now(dt.tzinfo) if dt.tzinfo else datetime.utcnow()
                    hrs = (now - dt).total_seconds() / 3600
                    age = f"{int(hrs / 24)}d ago" if hrs >= 24 else f"{int(hrs)}h ago"
                except Exception:
                    pass

                tl = (title + " " + desc).lower()
                bs = sum(1 for w in bull_words if w in tl)
                brs = sum(1 for w in bear_words if w in tl)
                sentiment = "BULL" if bs > brs else ("BEAR" if brs > bs else "NEUTRAL")

                articles.append({
                    "title": title,
                    "summary": desc,
                    "url": link,
                    "published": pub,
                    "age": age,
                    "sentiment": sentiment,
                    "source": extract_source(title).title() or "Unknown",
                })
        except Exception:
            continue

    # Sort by parsed date, most recent first
    for a in articles:
        try:
            a["_ts"] = parsedate_to_datetime(a["published"]).timestamp()
        except Exception:
            a["_ts"] = 0
    articles.sort(key=lambda x: x["_ts"], reverse=True)
    for a in articles:
        del a["_ts"]

    articles = articles[:20]
    curated = curate_news_articles(articles, limit=12)
    enrich_news_articles(curated, limit=12)
    print(f"    {len(articles)} fetched → {len(curated)} curated (trading sources prioritized)")
    return curated


def fetch_polymarket() -> list[dict]:
    print("  Fetching Polymarket coffee & climate markets…")
    markets = []

    coffee_terms = ["coffee", "arabica", "coffee price"]
    climate_terms = [
        "hottest", "La Nina", "El Nino", "NOAA temperature",
        "global temperature record", "warmest", "climate record",
    ]

    coffee_keywords = ["coffee", "arabica", "robusta", "cafe", "café"]
    climate_keywords = [
        "hottest", "warmest", "temperature", "el nino", "el niño",
        "la nina", "la niña", "noaa", "climate", "record heat",
    ]

    for term in coffee_terms + climate_terms:
        try:
            r = requests.get("https://gamma-api.polymarket.com/markets", params={
                "limit": 10, "active": "true", "closed": "false", "query": term,
            }, timeout=15, headers={"User-Agent": "Mozilla/5.0"})
            if r.status_code != 200:
                continue
            data = r.json()
            if not isinstance(data, list):
                continue
            for m in data:
                q = m.get("question", "")
                if not q:
                    continue
                ql = q.lower()

                is_coffee = any(k in ql for k in coffee_keywords)
                is_climate = any(k in ql for k in climate_keywords)
                if not is_coffee and not is_climate:
                    continue

                slug = m.get("slug", "")
                outcomes = m.get("outcomePrices", "")
                if isinstance(outcomes, str):
                    try:
                        prices = json.loads(outcomes)
                    except Exception:
                        prices = []
                else:
                    prices = outcomes if isinstance(outcomes, list) else []
                yes = round(float(prices[0]) * 100, 1) if len(prices) > 0 else None
                no = round(float(prices[1]) * 100, 1) if len(prices) > 1 else None
                vol = 0
                try:
                    vol = float(m.get("volume", 0))
                except (TypeError, ValueError):
                    pass
                end = m.get("endDate", "")
                markets.append({
                    "question": q,
                    "yes_pct": yes,
                    "no_pct": no,
                    "volume": vol,
                    "url": f"https://polymarket.com/event/{slug}" if slug else "",
                    "end_date": end[:10] if end else "",
                    "category": "coffee" if is_coffee else "climate",
                })
        except Exception:
            continue

    seen = set()
    unique = []
    for m in markets:
        if m["question"] not in seen:
            seen.add(m["question"])
            unique.append(m)
    unique.sort(key=lambda x: x.get("volume", 0), reverse=True)
    return unique[:15]


# ── Simulated data for briques without free API ─────────────────────────────

def generate_stocks_data() -> dict:
    """ICE certified stocks — loads from CSV files if available, otherwise returns empty."""
    print("  Loading ICE certified stocks…")

    result = {"simulated": False}

    # Arabica stocks: data/stocks_arabica_ice_certified_by_port.csv (columns: Date, Total, port1, port2, ...)
    arab_path = DATA_DIR / "stocks_arabica_ice_certified_by_port.csv"
    if arab_path.exists():
        try:
            df = pd.read_csv(arab_path, parse_dates=["Date"])
            df = df.sort_values("Date")
            total_col = "Total" if "Total" in df.columns else df.columns[1]
            current = int(df[total_col].iloc[-1])
            one_month_idx = max(0, len(df) - 22)
            one_month_ago = int(df[total_col].iloc[one_month_idx])
            history = [{"date": row["Date"].strftime("%Y-%m-%d"), "value": int(row[total_col])}
                       for _, row in df.iterrows()]

            port_cols = [c for c in df.columns if c not in ("Date", "Total", "date", "total")]
            ports = {}
            if port_cols:
                last_row = df.iloc[-1]
                for c in port_cols:
                    val = last_row.get(c)
                    if pd.notna(val) and float(val) > 0:
                        ports[c] = int(float(val))

            result["arabica"] = {
                "current": current,
                "one_month_ago": one_month_ago,
                "history": history,
            }
            result["ports"] = ports
            print(f"    Arabica stocks: {len(history)} rows, current={current:,}")
        except Exception as e:
            print(f"    Failed to load arabica stocks CSV: {e}")
            result["arabica"] = {"current": 0, "one_month_ago": 0, "history": []}
            result["ports"] = {}
    else:
        print(f"    No arabica stocks CSV found at {arab_path}")
        print(f"    To add real data, place a CSV with columns: Date,Total,[port1],[port2],...")
        result["arabica"] = {"current": 0, "one_month_ago": 0, "history": []}
        result["ports"] = {}

    # Robusta stocks: data/stocks_robusta_ice_certified_by_port.csv (columns: Date, Total)
    rob_path = DATA_DIR / "stocks_robusta_ice_certified_by_port.csv"
    if rob_path.exists():
        try:
            df = pd.read_csv(rob_path, parse_dates=["Date"])
            df = df.sort_values("Date")
            total_col = "Total" if "Total" in df.columns else df.columns[1]
            current = int(df[total_col].iloc[-1])
            one_month_idx = max(0, len(df) - 22)
            one_month_ago = int(df[total_col].iloc[one_month_idx])
            history = [{"date": row["Date"].strftime("%Y-%m-%d"), "value": int(row[total_col])}
                       for _, row in df.iterrows()]
            port_cols = [c for c in df.columns if c not in ("Date", "Total", "date", "total")]
            robusta_ports = {}
            if port_cols:
                last_row = df.iloc[-1]
                for c in port_cols:
                    val = last_row.get(c)
                    if pd.notna(val) and float(val) > 0:
                        robusta_ports[c] = int(float(val))
            result["robusta"] = {
                "current": current,
                "one_month_ago": one_month_ago,
                "history": history,
            }
            result["robusta_ports"] = robusta_ports
            print(f"    Robusta stocks: {len(history)} rows, current={current:,}")
        except Exception as e:
            print(f"    Failed to load robusta stocks CSV: {e}")
            result["robusta"] = {"current": 0, "one_month_ago": 0, "history": []}
    else:
        print(f"    No robusta stocks CSV found at {rob_path}")
        result["robusta"] = {"current": 0, "one_month_ago": 0, "history": []}

    return result



# ══════════════════════════════════════════════════════════════════════════════
# MAIN
# ══════════════════════════════════════════════════════════════════════════════

def main():
    print(f"Coffee Market Data Fetch — {datetime.utcnow().strftime('%Y-%m-%d %H:%M')} UTC")
    print("=" * 60)

    data = {"generated": datetime.utcnow().isoformat() + "Z"}

    data["futures"] = fetch_futures()
    data["forward_curve"] = fetch_forward_curve()
    data["spreads"] = fetch_spreads()
    data["brazil"] = fetch_brazil()
    data["cepea"] = load_cepea_data()
    data["dxy"] = fetch_dxy()
    data["weather"] = fetch_weather()
    data["cot"] = fetch_cot()
    data["news"] = fetch_news()
    data["polymarket"] = fetch_polymarket()
    data["stocks"] = generate_stocks_data()

    OUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(data, f, separators=(",", ":"))

    size_mb = OUT.stat().st_size / 1_048_576
    print(f"\nWritten {OUT} ({size_mb:.1f} MB)")
    print("Done.")


if __name__ == "__main__":
    main()
