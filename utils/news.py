"""
Coffee news aggregation with sentiment tagging.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

import streamlit as st


@dataclass
class NewsItem:
    title: str
    summary: str
    source: str
    url: str
    published: str
    sentiment: str  # "BULL", "BEAR", "NEUTRAL"
    age: str


SENTIMENT_COLORS = {
    "BULL": "#52B788",
    "BEAR": "#E76F51",
    "NEUTRAL": "#457B9D",
}


@st.cache_data(ttl=3600)
def fetch_coffee_news() -> list[dict]:
    """Fetch coffee commodity news from RSS feeds."""
    import requests
    import xml.etree.ElementTree as ET

    feeds = [
        ("https://news.google.com/rss/search?q=coffee+futures+price&hl=en-US&gl=US&ceid=US:en", "Google News"),
        ("https://news.google.com/rss/search?q=arabica+robusta+coffee+market&hl=en-US&gl=US&ceid=US:en", "Google News"),
        ("https://news.google.com/rss/search?q=brazil+coffee+crop+harvest&hl=en-US&gl=US&ceid=US:en", "Google News"),
        ("https://news.google.com/rss/search?q=ICE+coffee+commodity&hl=en-US&gl=US&ceid=US:en", "Google News"),
    ]

    articles = []
    seen_titles = set()

    for feed_url, source in feeds:
        try:
            r = requests.get(feed_url, timeout=10,
                             headers={"User-Agent": "Mozilla/5.0"})
            if r.status_code != 200:
                continue
            root = ET.fromstring(r.content)
            for item in root.findall(".//item")[:8]:
                title = item.findtext("title", "").strip()
                if not title or title in seen_titles:
                    continue
                seen_titles.add(title)

                link = item.findtext("link", "")
                pub_date = item.findtext("pubDate", "")
                desc = item.findtext("description", "")
                if "<" in desc:
                    import re
                    desc = re.sub(r"<[^>]+>", "", desc)
                desc = desc[:200].strip()

                age = _compute_age(pub_date)
                sentiment = _classify_sentiment(title + " " + desc)

                articles.append({
                    "title": title,
                    "summary": desc,
                    "source": source,
                    "url": link,
                    "published": pub_date,
                    "sentiment": sentiment,
                    "age": age,
                })
        except Exception:
            continue

    articles.sort(key=lambda x: x.get("published", ""), reverse=True)
    return articles[:15]


def _compute_age(pub_date: str) -> str:
    if not pub_date:
        return ""
    try:
        from email.utils import parsedate_to_datetime
        dt = parsedate_to_datetime(pub_date)
        now = datetime.now(dt.tzinfo) if dt.tzinfo else datetime.utcnow()
        delta = now - dt
        hours = delta.total_seconds() / 3600
        if hours < 1:
            return f"{int(delta.total_seconds() / 60)}m ago"
        if hours < 24:
            return f"{int(hours)}h ago"
        return f"{int(hours / 24)}d ago"
    except Exception:
        return ""


def _classify_sentiment(text: str) -> str:
    text_lower = text.lower()

    bull_words = [
        "surge", "soar", "rally", "jump", "rise", "gain", "higher", "bull",
        "shortage", "drought", "frost", "freeze", "supply concern", "tight supply",
        "record high", "supply deficit", "crop damage", "low stocks", "export ban",
        "stockpile decline", "production cut", "demand surge", "price spike",
        "backwardation", "upward", "climbing", "increase", "strong demand",
    ]
    bear_words = [
        "fall", "drop", "decline", "slump", "plunge", "slide", "lower", "bear",
        "surplus", "bumper crop", "abundant", "oversupply", "record harvest",
        "weak demand", "contango", "price drop", "selloff", "sell-off",
        "downward", "recession", "glut", "excess", "production increase",
        "ceasefire", "deal", "easing",
    ]

    bull_score = sum(1 for w in bull_words if w in text_lower)
    bear_score = sum(1 for w in bear_words if w in text_lower)

    if bull_score > bear_score:
        return "BULL"
    if bear_score > bull_score:
        return "BEAR"
    return "NEUTRAL"
