"""News summary helpers — imported by fetch_market_data.py."""

from __future__ import annotations

import json
import re
import time
from html import unescape
from urllib.parse import quote, urlparse

import requests


def normalize_news_text(text: str) -> str:
    text = re.sub(r"\s+", " ", (text or "").strip().lower())
    text = re.sub(r"[^\w\sàâäéèêëïîôùûüçœæ\-]", "", text)
    return text.strip()


def news_duplicate_of_title(title: str, summary: str) -> bool:
    title_norm = normalize_news_text(title.split(" - ")[0].split("…")[0])
    summary_norm = normalize_news_text(summary)
    if not summary_norm:
        return True
    if title_norm and (title_norm in summary_norm or summary_norm in title_norm):
        return True
    return title_norm[:70] == summary_norm[:70]


def first_sentence(text: str) -> str:
    text = re.sub(r"\s+", " ", (text or "").strip())
    if not text:
        return ""
    match = re.match(r"^(.+?[.!?…]+(?:\s|$))", text)
    if match:
        return match.group(1).strip()
    if len(text) <= 220:
        return text
    return text[:220].rsplit(" ", 1)[0] + "…"


def decode_google_news_url(source_url: str) -> str | None:
    if "news.google.com" not in source_url:
        return source_url
    art_id = urlparse(source_url).path.rstrip("/").split("/")[-1].split("?")[0]
    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
    for base in (
        f"https://news.google.com/articles/{art_id}",
        f"https://news.google.com/rss/articles/{art_id}",
    ):
        try:
            resp = requests.get(base, timeout=12, headers=headers)
            if resp.status_code != 200:
                continue
            sg = re.search(r'data-n-a-sg="([^"]+)"', resp.text)
            ts = re.search(r'data-n-a-ts="([^"]+)"', resp.text)
            if not sg or not ts:
                continue
            signature, timestamp = sg.group(1), ts.group(1)
            inner = (
                '["garturlreq",'
                '[["X","X",["X","X"],null,null,1,1,"US:en",null,1,null,null,null,null,null,0,1],'
                '"X","X",1,[1,1,1],1,1,null,0,0,null,0],'
                f'"{art_id}",{timestamp},"{signature}"]'
            )
            payload = "f.req=" + quote(json.dumps([[["Fbv4je", inner]]]))
            post = requests.post(
                "https://news.google.com/_/DotsSplashUi/data/batchexecute",
                headers={
                    "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
                    "User-Agent": headers["User-Agent"],
                },
                data=payload,
                timeout=12,
            )
            if post.status_code != 200:
                continue
            body = post.text
            if body.startswith(")]}'"):
                body = body[5:].strip()
            match = re.search(r'garturlres\\",\\"(https?://[^\\"]+)', body)
            if not match:
                match = re.search(r'garturlres","(https?://[^"]+)', body)
            if match:
                return match.group(1)
            outer = json.loads(body)
            return json.loads(json.loads(outer[0][2])[1])
        except Exception:
            continue
    return None


def _fetch_html(url: str) -> str:
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept-Language": "en-US,en;q=0.9,fr;q=0.8",
    }
    for attempt in range(2):
        try:
            resp = requests.get(url, timeout=12, headers=headers, allow_redirects=True)
            if resp.status_code == 200:
                return resp.text
        except Exception:
            pass
        time.sleep(0.4)
    return ""


def extract_article_lead(url: str, title: str = "") -> str:
    if "news.google.com" in url or "google.com" in urlparse(url).netloc:
        return ""
    html = _fetch_html(url)
    if not html:
        return ""

    # Candidate descriptions, in order of preference.
    meta_patterns = (
        r'<meta[^>]+property=["\']og:description["\'][^>]+content=["\']([^"\']+)',
        r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:description["\']',
        r'<meta[^>]+name=["\']twitter:description["\'][^>]+content=["\']([^"\']+)',
        r'<meta[^>]+name=["\']description["\'][^>]+content=["\']([^"\']+)',
        r'"description"\s*:\s*"([^"]{40,400})"',
    )
    for pattern in meta_patterns:
        match = re.search(pattern, html, re.I)
        if match:
            meta = unescape(match.group(1)).strip()
            if len(meta) >= 40 and not (title and news_duplicate_of_title(title, meta)):
                return meta

    # Fall back to the first substantive body paragraph.
    for paragraph in re.findall(r"<p[^>]*>(.*?)</p>", html, re.I | re.S):
        lead = unescape(re.sub(r"<[^>]+>", "", paragraph))
        lead = re.sub(r"\s+", " ", lead).strip()
        if len(lead) >= 60 and not (title and news_duplicate_of_title(title, lead)):
            return lead
    return ""


def enrich_news_summary(article: dict) -> str:
    title = article.get("title", "")
    rss_summary = article.get("summary", "")
    if rss_summary and not news_duplicate_of_title(title, rss_summary):
        return first_sentence(rss_summary)

    url = article.get("url", "")
    if not url:
        return ""

    publisher_url = decode_google_news_url(url) or url
    lead = extract_article_lead(publisher_url, title)
    if not lead or news_duplicate_of_title(title, lead):
        return ""
    return first_sentence(lead)


def enrich_news_articles(articles: list[dict], limit: int = 8) -> None:
    for index, article in enumerate(articles[:limit]):
        try:
            lead = enrich_news_summary(article)
            if lead:
                article["summary"] = lead
            elif news_duplicate_of_title(article.get("title", ""), article.get("summary", "")):
                article["summary"] = ""
        except Exception:
            if news_duplicate_of_title(article.get("title", ""), article.get("summary", "")):
                article["summary"] = ""
        if index < limit - 1:
            time.sleep(0.15)
