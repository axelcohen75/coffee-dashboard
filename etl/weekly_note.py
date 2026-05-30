"""
Weekly market note generator.
Run every Friday via GitHub Action cron or manually: python etl/weekly_note.py

Generates notes/YYYY-Www-market-note.md with a structured snapshot
of the coffee market. The "My read" section is left blank for manual input.
"""

from __future__ import annotations

import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))


def generate_note() -> str:
    import numpy as np

    now = datetime.utcnow()
    week = now.isocalendar()[1]
    year = now.year

    # Try to fetch live data; fall back to placeholders
    kc_price = "—"
    rc_price = "—"
    arb_rob = "—"
    stocks = "—"
    cepea = "—"
    gap = "—"
    mm_net = "—"
    mm_z = "—"
    weather_flags = "no active alerts"

    try:
        from utils.futures import fetch_kc_front, fetch_rc_front, USD_T_TO_CENTS_LB
        kc = fetch_kc_front.__wrapped__() if hasattr(fetch_kc_front, '__wrapped__') else None
        rc = fetch_rc_front.__wrapped__() if hasattr(fetch_rc_front, '__wrapped__') else None
        if kc is None:
            import yfinance as yf
            df = yf.Ticker("KC=F").history(period="5d")
            kc = round(float(df["Close"].iloc[-1]), 2) if not df.empty else None
        if kc:
            kc_price = f"{kc:.2f} ¢/lb"
        if rc:
            rc_price = f"{rc:,.0f} $/t"
            if kc:
                rc_cl = rc * USD_T_TO_CENTS_LB
                arb_rob = f"{kc - rc_cl:.2f} ¢/lb"
    except Exception:
        pass

    try:
        from utils.brazil import fetch_brl_usd_recent, compute_parity
        fx = fetch_brl_usd_recent.__wrapped__() if hasattr(fetch_brl_usd_recent, '__wrapped__') else None
        if fx and kc_price != "—":
            kc_val = float(kc_price.split()[0])
            parity = compute_parity(kc_val, fx, -5.0)
            cepea_est = parity * 1.02
            gap_val = cepea_est - parity
            cepea = f"~R${cepea_est:,.0f}/saca (est.)"
            gap = f"R${gap_val:+,.0f}/saca"
    except Exception:
        pass

    note = f"""# Coffee Market Note — Week {week:02d}, {year}

## Snapshot
- KC front: {kc_price}
- RC front: {rc_price}
- Arb-rob: {arb_rob}
- ICE arabica stocks: {stocks}
- CEPEA: {cepea} | Parity gap: {gap}

## Positioning
Managed money net: {mm_net} ({mm_z} vs 2y)

## Weather flags
{weather_flags}

## My read
_[Write 3-5 lines of your personal market commentary here each Friday.]_

---
Generated: {now.strftime('%Y-%m-%d %H:%M')} UTC
"""
    return note


def main():
    now = datetime.utcnow()
    week = now.isocalendar()[1]
    year = now.year

    notes_dir = ROOT / "notes"
    notes_dir.mkdir(exist_ok=True)

    filename = f"{year}-W{week:02d}-market-note.md"
    filepath = notes_dir / filename

    note = generate_note()
    filepath.write_text(note)
    print(f"Written: {filepath}")


if __name__ == "__main__":
    main()
