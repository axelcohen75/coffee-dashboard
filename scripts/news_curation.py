"""Curate coffee news for display - recency first."""

from __future__ import annotations

from email.utils import parsedate_to_datetime

PRIORITY_SOURCES = ("stonex", "barchart", "ecom", "sucafina")
DISPLAY_LIMIT = 12
COFFEE_KEYWORDS = ("coffee", "arabica", "robusta", "café", "cafe", "kc ", "rc ")


def extract_source(title: str) -> str:
    if " - " in title:
        return title.rsplit(" - ", 1)[-1].strip().lower()
    return ""


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
    """Pick the most recent coffee-related articles."""
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
    seen_titles: set[str] = set()
    def add(article: dict) -> None:
        title = article.get("title", "")
        if title in seen_titles:
            return
        selected.append(article)
        seen_titles.add(title)

    for article in enriched:
        if len(selected) >= limit:
            break
        if article["title"] in seen_titles:
            continue
        if not _is_coffee_related(article) and not any(
            _matches_priority(article, kw) for kw in PRIORITY_SOURCES
        ):
            continue
        add(article)

    selected.sort(key=lambda x: x["_ts"], reverse=True)

    cleaned = []
    for a in selected[:limit]:
        item = {k: v for k, v in a.items() if k != "_ts"}
        cleaned.append(item)
    return cleaned
