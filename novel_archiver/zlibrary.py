from __future__ import annotations

import re
import urllib.parse
from pathlib import Path
from typing import Any, Iterable

from bs4 import BeautifulSoup

from .models import BookCandidate
from .utils import absolute_url, text_or_empty


DEFAULT_RESULT_LINK_SELECTOR = "a[href*='/book/']"
DEFAULT_DOWNLOAD_LINK_SELECTOR = (
    "a[href*='/dl/'], a[href*='/download/'], a[href*='/downloads/'], "
    "a[href*='download'], button[data-href*='/dl/']"
)
ACADEMIC_DEFAULT_GENRE = "学术-综合"


def zlibrary_request_headers(values: dict[str, Any]) -> dict[str, str]:
    headers: dict[str, str] = {
        "Accept-Language": str(values.get("accept_language") or "zh-CN,zh;q=0.9,en;q=0.8"),
    }
    cookie = str(values.get("cookie") or "").strip()
    cookie_file = str(values.get("cookie_file") or "").strip()
    if cookie_file:
        cookie = read_cookie_header(Path(cookie_file))
    if cookie:
        headers["Cookie"] = cookie
    return headers


def read_cookie_header(path: Path) -> str:
    if not path.exists():
        return ""
    text = path.read_text(encoding="utf-8-sig").strip()
    if not text:
        return ""
    if "\t" not in text and "=" in text:
        return " ".join(line.strip() for line in text.splitlines() if line.strip() and not line.startswith("#"))

    cookies: list[str] = []
    for line in text.splitlines():
        line = line.strip()
        if line.startswith("#HttpOnly_"):
            line = line.removeprefix("#HttpOnly_")
        if not line or line.startswith("#"):
            continue
        parts = line.split("\t")
        if len(parts) >= 7:
            name = parts[5].strip()
            value = parts[6].strip()
            if name:
                cookies.append(f"{name}={value}")
    return "; ".join(cookies)


def zlibrary_search_queries(values: dict[str, Any]) -> list[str]:
    raw = values.get("search_queries") or values.get("queries") or []
    if isinstance(raw, str):
        raw = [part.strip() for part in re.split(r"[,，\n]", raw)]
    return [str(item).strip() for item in raw if str(item).strip()]


def zlibrary_search_url(values: dict[str, Any], query: str) -> str:
    base_url = str(values.get("base_url") or "https://z-library.im/").strip()
    template = str(values.get("search_url_template") or "").strip()
    encoded = urllib.parse.quote_plus(query)
    if template:
        return template.format(query=encoded, raw_query=query)
    return absolute_url(f"/s/?q={encoded}", base_url)


def iter_zlibrary_result_urls(html: str, page_url: str, values: dict[str, Any]) -> Iterable[str]:
    soup = BeautifulSoup(html, "html.parser")
    selector = str(values.get("result_link_selector") or DEFAULT_RESULT_LINK_SELECTOR)
    seen: set[str] = set()
    for link in soup.select(selector):
        href = link.get("href")
        if not href:
            continue
        detail_url = absolute_url(href, values.get("base_url") or page_url)
        if detail_url in seen:
            continue
        seen.add(detail_url)
        yield detail_url


def parse_zlibrary_detail_candidate(
    html: str,
    detail_url: str,
    values: dict[str, Any],
    fallback: BookCandidate | None = None,
) -> BookCandidate:
    soup = BeautifulSoup(html, "html.parser")
    title = selector_text(soup, values, "title_selector", "h1")
    author = selector_text(
        soup,
        values,
        "author_selector",
        "a[href*='/author/'], .authors a, .book-author a, .color-blue",
    )
    category_text = selector_text(
        soup,
        values,
        "category_selector",
        ".breadcrumb a, .breadcrumbs a, a[href*='/category/'], a[href*='/s/']",
        join_all=True,
    )
    description = selector_text(
        soup,
        values,
        "description_selector",
        ".book-description, .description, #bookDescriptionBox, [itemprop='description']",
    )
    format_text = selector_text(
        soup,
        values,
        "format_selector",
        ".bookProperty, .property_value, .details, .bookDetailsBox, body",
    )
    download_url = zlibrary_download_url(soup, detail_url, values)
    fallback_extra = dict(fallback.extra) if fallback else {}
    item = {
        "title": title or (fallback.title if fallback else ""),
        "author": author or (fallback.author if fallback else ""),
        "category": category_text or (fallback.genre if fallback else ""),
        "description": description,
        "file_format": infer_zlibrary_file_format(download_url, format_text, fallback_extra),
    }
    genre = academic_category(item, default=str(values.get("default_genre") or ACADEMIC_DEFAULT_GENRE))
    source_url = fallback.source_url if fallback and fallback.source_url else detail_url
    rank_type = (
        fallback.rank_type
        if fallback and fallback.rank_type
        else str(values.get("rank_type") or "Z-Library授权学术书目")
    )
    status = fallback.status if fallback and fallback.status else str(values.get("assume_status") or "已授权")

    return BookCandidate(
        title=item["title"],
        author=item["author"] or "佚名",
        genre=genre,
        gender=fallback.gender if fallback else "",
        status=status,
        rank_type=rank_type,
        source_url=source_url,
        detail_url=detail_url,
        download_url=download_url,
        expected_chapters=fallback.expected_chapters if fallback else None,
        last_chapter_title=fallback.last_chapter_title if fallback else "",
        trust_completed=bool(values.get("trust_completed", True)),
        ranking_source=fallback.ranking_source if fallback else "",
        extra={
            **fallback_extra,
            "source_kind": "zlibrary_web",
            "file_format": item["file_format"],
            "download_page_url": detail_url,
        },
    )


def zlibrary_download_url(soup: BeautifulSoup, detail_url: str, values: dict[str, Any]) -> str:
    selector = str(values.get("download_link_selector") or DEFAULT_DOWNLOAD_LINK_SELECTOR)
    for node in soup.select(selector):
        href = node.get("href") or node.get("data-href")
        if not href:
            continue
        text = node.get_text(" ", strip=True).lower()
        if values.get("download_link_selector") or "download" in href.lower() or "/dl/" in href.lower() or "文件" in text:
            return absolute_url(href, values.get("base_url") or detail_url)
    return ""


def selector_text(
    soup: BeautifulSoup,
    values: dict[str, Any],
    key: str,
    default_selector: str,
    join_all: bool = False,
) -> str:
    selector = str(values.get(key) or default_selector).strip()
    if not selector:
        return ""
    if join_all:
        parts = [node.get_text(" ", strip=True) for node in soup.select(selector)]
        return " ".join(part for part in parts if part)
    return text_or_empty(soup, selector)


def infer_zlibrary_file_format(download_url: str, text: str, extra: dict[str, Any]) -> str:
    for value in (extra.get("file_format"), Path(urllib.parse.urlparse(download_url).path).suffix):
        cleaned = str(value or "").lower().strip().lstrip(".")
        if cleaned:
            return cleaned
    match = re.search(r"\b(pdf|epub|mobi|azw3?|djvu|fb2)\b", text, flags=re.IGNORECASE)
    return match.group(1).lower() if match else "pdf"


def zlibrary_source_accepts_book(book: BookCandidate, values: dict[str, Any]) -> bool:
    if not bool(values.get("academic_only", True)):
        return True
    genre = (book.genre or "").strip()
    manual_lookup = (
        not book.ranking_source
        and not book.detail_url
        and not book.download_url
        and genre in {"", "未分类", "鏈垎绫?"}
    )
    if manual_lookup:
        return True
    text = " ".join(
        [
            genre,
            book.rank_type,
            book.ranking_source,
            str(book.extra.get("source_kind") or ""),
        ]
    ).lower()
    return "学术" in text or "academic" in text or "zlibrary" in text


def academic_category(item: dict[str, Any], default: str = ACADEMIC_DEFAULT_GENRE) -> str:
    text = " ".join(
        [
            first_nonempty(item, "genre", "category", "subject", "discipline", "topic"),
            first_nonempty(item, "subjects", "categories", "tags", "keywords"),
            first_nonempty(item, "description", "summary"),
        ]
    ).lower()
    if not text.strip():
        return default

    category_keywords = [
        ("学术-计算机", ("computer", "programming", "software", "algorithm", "data structure", "人工智能", "机器学习", "计算机", "编程", "算法", "数据结构")),
        ("学术-数学", ("mathematics", "math", "algebra", "calculus", "statistics", "数学", "代数", "微积分", "统计")),
        ("学术-物理", ("physics", "mechanics", "quantum", "物理", "力学", "量子")),
        ("学术-化学", ("chemistry", "chemical", "化学")),
        ("学术-生物", ("biology", "biomedical", "生命科学", "生物")),
        ("学术-医学", ("medicine", "medical", "clinical", "anatomy", "医学", "临床", "解剖")),
        ("学术-工程", ("engineering", "electronics", "mechanical", "civil engineering", "工程", "电子", "机械", "土木")),
        ("学术-经济管理", ("economics", "finance", "business", "management", "accounting", "经济", "金融", "管理", "会计")),
        ("学术-法学", ("law", "legal", "jurisprudence", "法学", "法律")),
        ("学术-教育", ("education", "pedagogy", "teaching", "教育", "教学")),
        ("学术-心理学", ("psychology", "cognitive", "心理")),
        ("学术-社会科学", ("sociology", "anthropology", "political science", "社会学", "人类学", "政治学", "社会科学")),
        ("学术-历史", ("history", "archaeology", "历史", "考古")),
        ("学术-哲学", ("philosophy", "ethics", "logic", "哲学", "伦理", "逻辑")),
        ("学术-语言文学", ("linguistics", "literature", "language", "语言", "文学", "语言学")),
        ("学术-艺术", ("art", "design", "music", "艺术", "设计", "音乐")),
        ("学术-地理环境", ("geography", "earth", "environment", "climate", "地理", "环境", "气候", "地球科学")),
        ("学术-农业", ("agriculture", "forestry", "农业", "林业")),
    ]
    for category, keywords in category_keywords:
        if any(keyword in text for keyword in keywords):
            return category
    return default


def first_nonempty(item: dict[str, Any], *keys: str) -> str:
    for key in keys:
        value = item.get(key)
        if isinstance(value, list):
            text = " ".join(str(part).strip() for part in value if str(part).strip())
        elif isinstance(value, dict):
            text = str(value.get("name") or value.get("title") or value.get("value") or "").strip()
        else:
            text = str(value or "").strip()
        if text:
            return text
    return ""
