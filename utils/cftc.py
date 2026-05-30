"""
CFTC Commitments of Traders data for coffee futures.
"""

from __future__ import annotations

import io

import pandas as pd
import streamlit as st


COFFEE_CODE = "083731"


@st.cache_data(ttl=86400)
def fetch_cot_data() -> pd.DataFrame:
    """
    Fetch CFTC COT Disaggregated Futures Only report for coffee.
    Returns DataFrame with columns: date, mm_long, mm_short, mm_net,
    prod_long, prod_short, prod_net, oi.
    """
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
            oi_col = _find_col(["open_interest", "all"]) or _find_col(["open_interest"])

            if not all([mm_long_col, mm_short_col]):
                continue

            result = pd.DataFrame({
                "date": pd.to_datetime(coffee[date_col]),
                "mm_long": pd.to_numeric(coffee[mm_long_col], errors="coerce"),
                "mm_short": pd.to_numeric(coffee[mm_short_col], errors="coerce"),
                "prod_long": pd.to_numeric(coffee.get(prod_long_col, 0), errors="coerce") if prod_long_col else 0,
                "prod_short": pd.to_numeric(coffee.get(prod_short_col, 0), errors="coerce") if prod_short_col else 0,
                "oi": pd.to_numeric(coffee.get(oi_col, 0), errors="coerce") if oi_col else 0,
            })
            result["mm_net"] = result["mm_long"] - result["mm_short"]
            result["prod_net"] = result["prod_long"] - result["prod_short"]
            result = result.set_index("date").sort_index()
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
