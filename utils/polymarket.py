"""
Polymarket coffee-related prediction markets.
Uses the Polymarket CLOB API (public, no auth needed for reads).
"""

from __future__ import annotations

import streamlit as st


@st.cache_data(ttl=1800)
def fetch_coffee_markets() -> list[dict]:
    """
    Search Polymarket for coffee-related prediction markets.
    Returns list of dicts with: question, outcome_yes, outcome_no, volume, url, end_date.
    """
    import requests

    markets = []

    search_terms = ["coffee", "arabica", "robusta", "coffee price", "coffee futures"]

    for term in search_terms:
        try:
            url = "https://gamma-api.polymarket.com/markets"
            params = {
                "limit": 10,
                "active": "true",
                "closed": "false",
                "query": term,
            }
            r = requests.get(url, params=params, timeout=15,
                             headers={"User-Agent": "Mozilla/5.0"})
            if r.status_code != 200:
                continue

            data = r.json()
            if not isinstance(data, list):
                continue

            for m in data:
                question = m.get("question", "")
                if not question:
                    continue

                q_lower = question.lower()
                if not any(k in q_lower for k in ["coffee", "arabica", "robusta", "cafe", "café"]):
                    continue

                slug = m.get("slug", "")
                market_url = f"https://polymarket.com/event/{slug}" if slug else ""

                outcomes = m.get("outcomePrices", "")
                if isinstance(outcomes, str):
                    try:
                        import json
                        prices = json.loads(outcomes)
                    except Exception:
                        prices = []
                else:
                    prices = outcomes if isinstance(outcomes, list) else []

                yes_price = float(prices[0]) * 100 if len(prices) > 0 else None
                no_price = float(prices[1]) * 100 if len(prices) > 1 else None

                volume = m.get("volume", 0)
                try:
                    volume = float(volume)
                except (TypeError, ValueError):
                    volume = 0

                end_date = m.get("endDate", "")

                markets.append({
                    "question": question,
                    "yes_pct": round(yes_price, 1) if yes_price else None,
                    "no_pct": round(no_price, 1) if no_price else None,
                    "volume": volume,
                    "url": market_url,
                    "end_date": end_date[:10] if end_date else "",
                    "image": m.get("image", ""),
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
    return unique[:10]
