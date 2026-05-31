"""CFTC Commitments of Traders data for coffee futures.

The Streamlit dashboard prefers curated local CSV files in ``data/`` so the
positioning page stays deterministic during desk prep. Live CFTC data remains as
an Arabica fallback when the local file is absent.
"""

from __future__ import annotations

import io
from pathlib import Path

import pandas as pd
import streamlit as st


COFFEE_CODE = "083731"
DATA_DIR = Path(__file__).resolve().parent.parent / "data"

LOCAL_COT_FILES = {
    "Arabica": ["Arabica_COT.csv", "ice_arabica_cot.csv"],
    "Robusta": ["Robusta_COT.csv", "ice_robusta_cot.csv"],
}

COT_COLUMNS = {
    "Report_Date_as_YYYY-MM-DD": "date",
    "Report_Date_as_MM_DD_YYYY": "date",
    "As_of_Date_In_Form_YYMMDD": "date",
    "Market_and_Exchange_Names": "market_name",
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

REQUIRED_POSITION_COLUMNS = [
    "mm_long", "mm_short", "mm_net",
    "prod_long", "prod_short", "prod_net",
    "swap_long", "swap_short", "swap_net",
    "other_long", "other_short", "other_net",
    "oi",
]


def _local_cot_path(market: str) -> Path | None:
    for filename in LOCAL_COT_FILES.get(market, []):
        path = DATA_DIR / filename
        if path.exists():
            return path
    return None


@st.cache_data(ttl=300)
def available_local_cot_markets() -> dict[str, str]:
    """Return local COT markets available in data/ as {market: filename}."""
    markets: dict[str, str] = {}
    for market in LOCAL_COT_FILES:
        path = _local_cot_path(market)
        if path is not None:
            markets[market] = path.name
    return markets


def _coerce_numeric(df: pd.DataFrame, columns: list[str]) -> None:
    for col in columns:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)


def _normalise_cot_frame(df: pd.DataFrame, market: str, source: str) -> pd.DataFrame:
    df = df.rename(columns={col: COT_COLUMNS.get(col, col) for col in df.columns})

    if "date" not in df.columns:
        raise ValueError("COT file must include a report date column")

    df["date"] = pd.to_datetime(df["date"], errors="coerce")
    df = df.dropna(subset=["date"]).copy()

    _coerce_numeric(df, [col for col in REQUIRED_POSITION_COLUMNS if col in df.columns])

    derived_pairs = {
        "mm_net": ("mm_long", "mm_short"),
        "prod_net": ("prod_long", "prod_short"),
        "swap_net": ("swap_long", "swap_short"),
        "other_net": ("other_long", "other_short"),
    }
    for net_col, (long_col, short_col) in derived_pairs.items():
        if net_col not in df.columns and {long_col, short_col}.issubset(df.columns):
            df[net_col] = df[long_col] - df[short_col]

    for col in REQUIRED_POSITION_COLUMNS:
        if col not in df.columns:
            df[col] = 0

    df = df.set_index("date").sort_index()
    df = df[~df.index.duplicated(keep="last")]
    df["market"] = market
    df["source"] = source
    return df[REQUIRED_POSITION_COLUMNS + ["market", "source"]]


@st.cache_data(ttl=300)
def load_local_cot_data(market: str = "Arabica") -> pd.DataFrame:
    """Load a curated local COT CSV from data/ and normalise its schema."""
    path = _local_cot_path(market)
    if path is None:
        return pd.DataFrame()
    try:
        raw = pd.read_csv(path)
        return _normalise_cot_frame(raw, market=market, source=path.name)
    except Exception:
        return pd.DataFrame()


@st.cache_data(ttl=86400)
def fetch_cot_data(market: str = "Arabica", prefer_local: bool = True) -> pd.DataFrame:
    """
    Fetch COT data for a coffee market.

    Returns a DataFrame indexed by report date with columns:
    mm_long, mm_short, mm_net, prod_long, prod_short, prod_net,
    swap_long, swap_short, swap_net, other_long, other_short, other_net, oi.
    """
    if prefer_local:
        local = load_local_cot_data(market)
        if not local.empty:
            return local

    if market != "Arabica":
        return pd.DataFrame()

    return _fetch_live_arabica_cot()


def _fetch_live_arabica_cot() -> pd.DataFrame:
    """Fetch CFTC COT Disaggregated Futures Only report for Arabica coffee."""
    import requests

    urls = [
        "https://www.cftc.gov/dea/newcot/f_disagg.txt",
        "https://www.cftc.gov/dea/newcot/FinFutYY.txt",
    ]

    for base_url in [
        "https://www.cftc.gov/files/dea/history/fut_disagg_txt_{}.zip",
    ]:
        for year in range(2024, 2019, -1):
            urls.append(base_url.format(year))

    frames = []
    for url in urls:
        try:
            r = requests.get(url, timeout=30)
            if r.status_code != 200:
                continue

            if url.endswith(".zip"):
                import zipfile
                with zipfile.ZipFile(io.BytesIO(r.content)) as z:
                    for name in z.namelist():
                        if name.endswith(".txt"):
                            content = z.read(name).decode("utf-8", errors="replace")
                            df = pd.read_csv(io.StringIO(content), low_memory=False)
                            break
                    else:
                        continue
            else:
                df = pd.read_csv(io.StringIO(r.text), low_memory=False)

            cftc_col = None
            for col in df.columns:
                if "CFTC_Commodity_Code" in col or "Commodity_Code" in col.replace(" ", "_"):
                    cftc_col = col
                    break
            if cftc_col is None:
                for col in df.columns:
                    if "commodity" in col.lower() and "code" in col.lower():
                        cftc_col = col
                        break

            if cftc_col is None:
                continue

            df[cftc_col] = df[cftc_col].astype(str).str.strip()
            coffee = df[df[cftc_col] == COFFEE_CODE].copy()
            if coffee.empty:
                continue

            date_col = None
            for col in coffee.columns:
                if "report_date" in col.lower() or "as_of_date" in col.lower():
                    date_col = col
                    break
            if date_col is None:
                continue

            def _find_col(keywords):
                for col in coffee.columns:
                    cl = col.lower().replace(" ", "_")
                    if all(k in cl for k in keywords):
                        return col
                return None

            mm_long_col = _find_col(["m_money", "long", "all"]) or _find_col(["money_manager", "long"])
            mm_short_col = _find_col(["m_money", "short", "all"]) or _find_col(["money_manager", "short"])
            prod_long_col = _find_col(["prod_merc", "long", "all"]) or _find_col(["producer", "long"])
            prod_short_col = _find_col(["prod_merc", "short", "all"]) or _find_col(["producer", "short"])
            swap_long_col = _find_col(["swap", "long", "all"])
            swap_short_col = _find_col(["swap", "short", "all"])
            other_long_col = _find_col(["other_rept", "long", "all"])
            other_short_col = _find_col(["other_rept", "short", "all"])
            oi_col = _find_col(["open_interest", "all"]) or _find_col(["open_interest"])

            if not all([mm_long_col, mm_short_col]):
                continue

            result = pd.DataFrame({
                "date": pd.to_datetime(coffee[date_col]),
                "mm_long": pd.to_numeric(coffee[mm_long_col], errors="coerce"),
                "mm_short": pd.to_numeric(coffee[mm_short_col], errors="coerce"),
                "prod_long": pd.to_numeric(coffee.get(prod_long_col, 0), errors="coerce") if prod_long_col else 0,
                "prod_short": pd.to_numeric(coffee.get(prod_short_col, 0), errors="coerce") if prod_short_col else 0,
                "swap_long": pd.to_numeric(coffee.get(swap_long_col, 0), errors="coerce") if swap_long_col else 0,
                "swap_short": pd.to_numeric(coffee.get(swap_short_col, 0), errors="coerce") if swap_short_col else 0,
                "other_long": pd.to_numeric(coffee.get(other_long_col, 0), errors="coerce") if other_long_col else 0,
                "other_short": pd.to_numeric(coffee.get(other_short_col, 0), errors="coerce") if other_short_col else 0,
                "oi": pd.to_numeric(coffee.get(oi_col, 0), errors="coerce") if oi_col else 0,
            })
            result = _normalise_cot_frame(result, market="Arabica", source="CFTC live")
            frames.append(result)

        except Exception:
            continue

    if not frames:
        return pd.DataFrame()

    combined = pd.concat(frames).sort_index()
    return combined[~combined.index.duplicated(keep="last")]


def compute_zscore(series: pd.Series, window: int = 104) -> pd.Series:
    mean = series.rolling(window, min_periods=20).mean()
    std = series.rolling(window, min_periods=20).std()
    return ((series - mean) / std).rename("zscore")


def compute_percentile(series: pd.Series, window: int = 104) -> pd.Series:
    """Rolling percentile rank of the latest value inside a trailing window."""
    def _rank(values) -> float:
        s = pd.Series(values).dropna()
        if s.empty:
            return float("nan")
        return float((s <= s.iloc[-1]).mean() * 100)

    return series.rolling(window, min_periods=20).apply(_rank, raw=False).rename("percentile")
