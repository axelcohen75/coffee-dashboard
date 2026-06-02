"""Curate coffee news for display - recency first, no duplicates."""

from __future__ import annotations

import re
from email.utils import parsedate_to_datetime

PRIORITY_SOURCES = ("stonex", "barchart", "ecom", "sucafina")
DISPLAY_LIMIT = 12
COFFEE_KEYWORDS = ("coffee", "arabica", "robusta", "café", "cafe", "kc ", "rc ")


def extract_source(title: str) -> str:
    if " - " in title:
        return title.rsplit(" - ", 1)[-1].strip().lower()
    return ""


def _dedupe_key(article: dict) -> str:
    """Normalized title used to catch duplicate stories from the same outlet."""
    title = article.get("title", "")
    title = title.rsplit(" - ", 1)[0]  # drop trailing source
    title = title.lower()
    title = re.sub(r"[^\w\sàâäéèêëïîôùûüçœæ]", " ", title)
    title = re.sub(r"\s+", " ", title).strip()
    return title


def _article_ts(article: dict) -> float:
    ts = article.get("_ts")
    if ts is not None:
        return float(ts)
    try:
        return parsedate_to_datetime(article["published"]).timestamp()
    except Exception:
        return 0.0


def _is_coffee_related(article: dict) -> bool:
    text = f"{article.get('title', '')} {article.get('summary', '')}".lower()
    return any(kw in text for kw in COFFEE_KEYWORDS)


def _matches_priority(article: dict, keyword: str) -> bool:
    title = article.get("title", "").lower()
    source = extract_source(article.get("title", ""))
    return keyword in title or keyword in source


def curate_news_articles(articles: list[dict], limit: int = DISPLAY_LIMIT) -> list[dict]:
    """Pick the most recent coffee-related articles, removing duplicates."""
    if not articles:
        return []

    enriched = []
    for a in articles:
        item = dict(a)
        item["_ts"] = _article_ts(item)
        item["source"] = extract_source(item.get("title", "")).title() or "Unknown"
        enriched.append(item)

    enriched.sort(key=lambda x: x["_ts"], reverse=True)

    selected: list[dict] = []
    seen_keys: set[str] = set()
    seen_urls: set[str] = set()

    for article in enriched:
        if len(selected) >= limit:
            break
        if not _is_coffee_related(article) and not any(
            _matches_priority(article, kw) for kw in PRIORITY_SOURCES
        ):
            continue
        key = _dedupe_key(article)
        url = article.get("url", "")
        if key and key in seen_keys:
            continue
        if url and url in seen_urls:
            continue
        selected.append(article)
        if key:
            seen_keys.add(key)
        if url:
            seen_urls.add(url)

    selected.sort(key=lambda x: x["_ts"], reverse=True)

    cleaned = []
    for a in selected[:limit]:
        item = {k: v for k, v in a.items() if k != "_ts"}
        cleaned.append(item)
    return cleaned
