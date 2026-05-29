from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Iterable

from bs4 import BeautifulSoup

from .config import SourceConfig
from .downloader import (
    HttpClient,
    clean_7shutxt_title,
    extract_7shutxt_label,
    find_7shutxt_txt_link,
    make_7shutxt_download_page_url,
    normalize_7shutxt_detail_url,
    normalize_7shutxt_genre,
)
from .models import BookCandidate
from .utils import absolute_url, require_authorized_source, text_or_empty


class RankingSource:
    def iter_books(self, limit: int) -> Iterable[BookCandidate]:
        raise NotImplementedError


def build_ranking_source(config: SourceConfig, http: HttpClient) -> RankingSource:
    require_authorized_source(config)
    if config.type == "json_catalog":
        return JsonCatalogSource(config, http)
    if config.type == "html_ranking":
        return HtmlRankingSource(config, http)
    if config.type == "fanqie_ranking":
        return FanqieRankingSource(config, http)
    if config.type == "qidian_completed_ranking":
        return QidianCompletedRankingSource(config, http)
    if config.type == "10000txt_ranking":
        return WanbenRankingSource(config, http)
    if config.type == "7shutxt_ranking":
        return QishuRankingSource(config, http)
    raise ValueError(f"未知榜单源类型: {config.type}")


class JsonCatalogSource(RankingSource):
    def __init__(self, config: SourceConfig, http: HttpClient) -> None:
        self.config = config
        self.http = http

    def iter_books(self, limit: int) -> Iterable[BookCandidate]:
        values = self.config.values
        if values.get("url"):
            raw = self.http.get_text(values["url"])
        else:
            raw = Path(values["path"]).read_text(encoding="utf-8")
        data = json.loads(raw)
        for index, item in enumerate(data):
            if index >= limit:
                break
            yield BookCandidate(
                title=item["title"],
                author=item.get("author", "佚名"),
                genre=item.get("genre", "未分类"),
                gender=item.get("gender", ""),
                status=item.get("status", ""),
                rank_type=item.get("rank_type", values.get("rank_type", "")),
                source_url=item.get("source_url", ""),
                detail_url=item.get("detail_url", ""),
                download_url=item.get("download_url", ""),
                expected_chapters=item.get("expected_chapters"),
                last_chapter_title=item.get("last_chapter_title", ""),
                extra={k: v for k, v in item.items() if k not in BOOK_FIELDS},
            )


class HtmlRankingSource(RankingSource):
    def __init__(self, config: SourceConfig, http: HttpClient) -> None:
        self.config = config
        self.http = http

    def iter_books(self, limit: int) -> Iterable[BookCandidate]:
        count = 0
        for page_url in self._page_urls():
            soup = BeautifulSoup(self.http.get_text(page_url), "html.parser")
            for link in soup.select(self.config.values["book_link_selector"]):
                if count >= limit:
                    return
                href = link.get("href")
                if not href:
                    continue
                detail_url = absolute_url(href, self.config.values.get("base_url") or page_url)
                book = self._parse_detail(detail_url)
                count += 1
                yield book

    def _page_urls(self) -> Iterable[str]:
        values = self.config.values
        if values.get("ranking_url"):
            yield values["ranking_url"]
            return
        template = values["page_url_template"]
        start = int(values.get("start_page", 1))
        end = int(values.get("end_page", start))
        for page in range(start, end + 1):
            yield template.format(page=page)

    def _parse_detail(self, detail_url: str) -> BookCandidate:
        values = self.config.values
        soup = BeautifulSoup(self.http.get_text(detail_url), "html.parser")
        download_url = ""
        download_selector = values.get("download_link_selector")
        if download_selector:
            link = soup.select_one(download_selector)
            if link and link.get("href"):
                download_url = absolute_url(link["href"], values.get("base_url") or detail_url)

        return BookCandidate(
            title=text_or_empty(soup, values.get("title_selector")) or "未知书名",
            author=text_or_empty(soup, values.get("author_selector")) or "佚名",
            genre=text_or_empty(soup, values.get("genre_selector")) or "未分类",
            status=text_or_empty(soup, values.get("status_selector")),
            rank_type=values.get("rank_type", ""),
            source_url=detail_url,
            detail_url=detail_url,
            download_url=download_url,
            expected_chapters=parse_int(text_or_empty(soup, values.get("expected_chapters_selector"))),
            last_chapter_title=text_or_empty(soup, values.get("last_chapter_selector")),
        )


class FanqieRankingSource(RankingSource):
    def __init__(self, config: SourceConfig, http: HttpClient) -> None:
        self.config = config
        self.http = http

    def iter_books(self, limit: int) -> Iterable[BookCandidate]:
        count = 0
        seen: set[str] = set()
        values = self.config.values
        ranking_url = values.get("ranking_url", "https://fanqienovel.com/rank")
        base_url = values.get("base_url", "https://fanqienovel.com")
        page_size = int(values.get("page_size", 10))
        max_pages = int(values.get("max_pages", 10))
        completed_only = bool(values.get("completed_only", False))

        html = self.http.get_text(ranking_url)
        state = parse_fanqie_initial_state(html)
        rank = state.get("rank", {}) if state else {}
        rank_version = str(values.get("rank_version") or rank.get("rankVersion") or "")
        targets = fanqie_rank_targets(values, rank)
        if not targets:
            first_books = rank.get("book_list") or []
            for book in self._iter_detail_books(first_books, base_url, seen, completed_only=completed_only):
                if count >= limit:
                    return
                count += 1
                yield book
            return

        url = absolute_url("/api/rank/category/list", base_url)
        for category_id, gender, rank_mold in targets:
            for page_index in range(max_pages):
                if count >= limit:
                    return
                data = self._fetch_rank_api(
                    url=url,
                    ranking_url=ranking_url,
                    category_id=str(category_id),
                    gender=str(gender),
                    rank_mold=str(rank_mold),
                    rank_version=rank_version,
                    offset=page_index * page_size,
                    limit=page_size,
                )
                items = (((data.get("data") or {}).get("book_list")) or [])
                if not items:
                    break
                for book in self._iter_detail_books(
                    items,
                    base_url,
                    seen,
                    gender=normalize_fanqie_gender(gender),
                    completed_only=completed_only,
                ):
                    if count >= limit:
                        return
                    count += 1
                    yield book

    def _fetch_rank_api(
        self,
        url: str,
        ranking_url: str,
        category_id: str,
        gender: str,
        rank_mold: str,
        rank_version: str,
        offset: int,
        limit: int,
    ) -> dict:
        response = self.http.session.get(
            url,
            params={
                "app_id": 2503,
                "rank_list_type": 3,
                "offset": offset,
                "limit": limit,
                "category_id": category_id,
                "rank_version": rank_version,
                "gender": gender,
                "rankMold": rank_mold,
            },
            headers={"Referer": ranking_url, "Accept": "application/json, text/plain, */*"},
            timeout=self.http.config.timeout_seconds,
        )
        response.raise_for_status()
        return response.json()

    def _iter_detail_books(
        self,
        items: list[dict],
        base_url: str,
        seen: set[str],
        gender: str = "",
        completed_only: bool = False,
    ) -> Iterable[BookCandidate]:
        for item in items:
            book_id = str(item.get("bookId") or item.get("book_id") or "")
            if not book_id or book_id in seen:
                continue
            seen.add(book_id)
            detail_url = absolute_url(f"/page/{book_id}", base_url)
            try:
                book = self._parse_detail(detail_url, item, gender=gender)
            except Exception:
                title = str(item.get("bookName") or "").strip()
                author = str(item.get("author") or "").strip()
                if not title:
                    continue
                book = BookCandidate(
                    title=title,
                    author=author or "佚名",
                    genre=parse_fanqie_category(item.get("categoryV2")) or item.get("category") or "未分类",
                    gender=gender,
                    status=fanqie_status(item.get("creationStatus")),
                    rank_type=self.config.values.get("rank_type", "番茄榜单"),
                    source_url=detail_url,
                    detail_url=detail_url,
                    last_chapter_title=str(item.get("lastChapterTitle") or ""),
                    expected_chapters=parse_int(str(item.get("chapterTotal") or "")),
                )
            if completed_only and fanqie_status(book.status) != "已完结":
                continue
            yield book

    def _parse_detail(self, detail_url: str, fallback: dict, gender: str = "") -> BookCandidate:
        book_id = str(fallback.get("bookId") or fallback.get("book_id") or detail_url.rstrip("/").rsplit("/", 1)[-1])
        info_url = absolute_url(f"/api/book/info?bookId={book_id}", self.config.values.get("base_url", "https://fanqienovel.com"))
        response = self.http.session.get(
            info_url,
            headers={"Referer": detail_url, "Accept": "application/json, text/plain, */*"},
            timeout=self.http.config.timeout_seconds,
        )
        response.raise_for_status()
        page = (response.json().get("data") or {})
        title = str(page.get("bookName") or fallback.get("bookName") or "").strip()
        author = str(page.get("author") or page.get("authorName") or fallback.get("author") or "").strip()
        status = fanqie_status(page.get("creationStatus") or fallback.get("creationStatus"))
        genre = parse_fanqie_category(page.get("categoryV2")) or parse_fanqie_category(fallback.get("categoryV2"))
        return BookCandidate(
            title=title.strip() or "未知书名",
            author=author or "佚名",
            genre=genre or str(fallback.get("category") or "未分类"),
            gender=gender,
            status=status or fanqie_status(page.get("creationStatus") or fallback.get("creationStatus")),
            rank_type=self.config.values.get("rank_type", "番茄榜单"),
            source_url=detail_url,
            detail_url=detail_url,
            expected_chapters=parse_int(str(page.get("chapterTotal") or "")),
            last_chapter_title=str(page.get("lastChapterTitle") or fallback.get("lastChapterTitle") or ""),
        )


class QidianCompletedRankingSource(RankingSource):
    def __init__(self, config: SourceConfig, http: HttpClient) -> None:
        self.config = config
        self.http = http

    def iter_books(self, limit: int) -> Iterable[BookCandidate]:
        values = self.config.values
        base_url = values.get("base_url", "https://m.qidian.com/")
        female_base_url = values.get("female_base_url", "https://m.qdmm.com/")
        genders = values.get("genders") or [values.get("gender", "male")]
        configured_category_ids = values.get("category_ids")
        order_by = str(values.get("order_by", ""))
        count = 0
        seen: set[str] = set()

        for gender in genders:
            gender_base_url = female_base_url if str(gender) == "female" else base_url
            category_ids = (
                values.get(f"{gender}_category_ids")
                or configured_category_ids
                or self._fetch_category_ids(gender_base_url, str(gender))
            )
            for category_id in category_ids:
                for page_num in range(1, int(values.get("max_pages_per_category", 50)) + 1):
                    if count >= limit:
                        return
                    url = qidian_category_url(gender_base_url, category_id, str(gender), order_by, page_num)
                    try:
                        soup = BeautifulSoup(self.http.get_text(url), "html.parser")
                    except Exception:
                        break
                    page_data = parse_qidian_page_data(soup)
                    records = (((page_data.get("pageProps") or {}).get("pageData") or {}).get("list") or {}).get("records") or []
                    if not records:
                        break
                    before = count
                    for record in records:
                        if count >= limit:
                            return
                        book_id = str(record.get("bid") or "")
                        if not book_id or book_id in seen:
                            continue
                        seen.add(book_id)
                        if "完" not in str(record.get("state") or ""):
                            continue
                        count += 1
                        yield BookCandidate(
                            title=str(record.get("bName") or "未知书名").strip(),
                            author=str(record.get("bAuth") or "佚名").strip(),
                            genre=str(record.get("cat") or "未分类").strip(),
                            gender=str(gender),
                            status="完本",
                            rank_type=values.get("rank_type", "起点完本分类榜"),
                            source_url=absolute_url(f"/book/{book_id}/", gender_base_url),
                            detail_url=absolute_url(f"/book/{book_id}/", gender_base_url),
                        )
                    page_props = (page_data.get("pageProps") or {}).get("pageData") or {}
                    if ((page_props.get("list") or {}).get("isLast")) or count == before:
                        break

    def _fetch_category_ids(self, base_url: str, gender: str) -> list[int]:
        url = absolute_url("/category/", base_url)
        if gender == "female":
            url = "https://m.qdmm.com/category/"
        soup = BeautifulSoup(self.http.get_text(url), "html.parser")
        page_data = parse_qidian_page_data(soup)
        info = (((page_data.get("pageProps") or {}).get("pageData") or {}).get("info")) or []
        return [int(item["catId"]) for item in info if item.get("catId")]


class WanbenRankingSource(RankingSource):
    def __init__(self, config: SourceConfig, http: HttpClient) -> None:
        self.config = config
        self.http = http

    def iter_books(self, limit: int) -> Iterable[BookCandidate]:
        count = 0
        seen: set[str] = set()
        values = self.config.values
        selector = values.get("book_link_selector", ".main-left a[href*='?id=']")
        base_url = values.get("base_url", "https://www.10000txt.com/")

        for page_url in self._page_urls():
            soup = BeautifulSoup(self.http.get_text(page_url), "html.parser")
            for link in soup.select(selector):
                if count >= limit:
                    return
                href = link.get("href")
                if not href or "?id=" not in href:
                    continue
                detail_url = absolute_url(href, base_url)
                if detail_url in seen:
                    continue
                seen.add(detail_url)
                heading = link.get_text("", strip=True) or link.get("title", "")
                title, author, status = parse_10000txt_heading(heading)
                if not title:
                    continue
                book = self._parse_detail(detail_url, title, author, status)
                count += 1
                yield book

    def _page_urls(self) -> Iterable[str]:
        values = self.config.values
        urls = values.get("urls")
        if urls:
            for url in urls:
                yield url
            return
        if values.get("ranking_url"):
            yield values["ranking_url"]
            return
        template = values.get("page_url_template", "https://www.10000txt.com/")
        start = int(values.get("start_page", 1))
        end = int(values.get("end_page", start))
        for page in range(start, end + 1):
            yield template.format(page=page)

    def _parse_detail(self, detail_url: str, title: str, author: str, status: str) -> BookCandidate:
        values = self.config.values
        soup = BeautifulSoup(self.http.get_text(detail_url), "html.parser")
        heading = text_or_empty(soup, "h1")
        parsed_title, parsed_author, parsed_status = parse_10000txt_heading(heading)
        genre = text_or_empty(soup, ".info a[href*='?cate=']")
        if not genre:
            breadcrumbs = soup.select(".breadcrumb a[href*='?cate=']")
            if breadcrumbs:
                genre = breadcrumbs[-1].get_text(" ", strip=True)

        download_url = ""
        for link in soup.select(".content a[href]"):
            link_text = link.get_text(" ", strip=True)
            href = link.get("href", "")
            if "下载" in link_text or "ctfile.com" in href or "z701.com" in href:
                download_url = absolute_url(href, detail_url)
                break

        return BookCandidate(
            title=parsed_title or title,
            author=parsed_author or author or "佚名",
            genre=genre or "未分类",
            status=parsed_status or status or "完本",
            rank_type=values.get("rank_type", "10000txt"),
            source_url=detail_url,
            detail_url=detail_url,
            download_url=download_url,
        )


class QishuRankingSource(RankingSource):
    def __init__(self, config: SourceConfig, http: HttpClient) -> None:
        self.config = config
        self.http = http

    def iter_books(self, limit: int) -> Iterable[BookCandidate]:
        count = 0
        seen: set[str] = set()
        values = self.config.values
        selector = values.get("book_link_selector", "a[href*='article-'], a[href*='ShowInfo.php']")
        base_url = values.get("base_url", "https://www.7shutxt.com/")

        for page_url in self._page_urls():
            soup = BeautifulSoup(self.http.get_text(page_url), "html.parser")
            for link in soup.select(selector):
                if count >= limit:
                    return
                href = link.get("href")
                if not href:
                    continue
                detail_url = normalize_7shutxt_detail_url(absolute_url(href, base_url))
                if detail_url in seen:
                    continue
                seen.add(detail_url)
                book = self._parse_detail(detail_url)
                if not book.title:
                    continue
                count += 1
                yield book

    def _page_urls(self) -> Iterable[str]:
        values = self.config.values
        urls = values.get("urls")
        if urls:
            for url in urls:
                yield url
            return
        if values.get("ranking_url"):
            yield values["ranking_url"]
            return
        yield "https://www.7shutxt.com/txt-best.html"

    def _parse_detail(self, detail_url: str) -> BookCandidate:
        values = self.config.values
        base_url = values.get("base_url", "https://www.7shutxt.com/")
        detail_url = normalize_7shutxt_detail_url(detail_url)
        soup = BeautifulSoup(self.http.get_text(detail_url), "html.parser")
        title = clean_7shutxt_title(text_or_empty(soup, "h1"))
        author = extract_7shutxt_label(soup, "书籍作者") or "佚名"
        genre = normalize_7shutxt_genre(extract_7shutxt_label(soup, "书籍分类"))
        status = extract_7shutxt_label(soup, "写作进度")
        if "完结" in status:
            status = "已完结"

        download_page_url = make_7shutxt_download_page_url(detail_url, base_url)
        download_url = ""
        if download_page_url:
            download_soup = BeautifulSoup(self.http.get_text(download_page_url), "html.parser")
            download_url = find_7shutxt_txt_link(download_soup, download_page_url)

        return BookCandidate(
            title=title,
            author=author,
            genre=genre or "未分类",
            status=status or "已完结",
            rank_type=values.get("rank_type", "7shutxt"),
            source_url=detail_url,
            detail_url=detail_url,
            download_url=download_url,
            extra={"download_page_url": download_page_url},
        )


def parse_int(value: str) -> int | None:
    digits = "".join(ch for ch in value if ch.isdigit())
    return int(digits) if digits else None


def parse_fanqie_initial_state(html: str) -> dict:
    match = re.search(r"window\.__INITIAL_STATE__=(\{.*?\});", html, re.S)
    if not match:
        return {}
    try:
        return json.loads(match.group(1))
    except json.JSONDecodeError:
        return {}


def first_fanqie_category_id(items: list[dict]) -> str:
    for item in items:
        value = item.get("curent_category_id") or item.get("current_category_id") or item.get("pos_category_id")
        if value:
            return str(value)
    return ""


def fanqie_rank_targets(values: dict, rank: dict) -> list[tuple[str, str, str]]:
    configured_ids = values.get("category_ids")
    configured_genders = values.get("genders")
    if configured_ids:
        genders = configured_genders or [values.get("gender", 0)]
        rank_molds = values.get("rank_molds") or [values.get("rank_mold", 2)]
        return [
            (str(category_id), str(gender), str(rank_mold))
            for category_id in configured_ids
            for gender in genders
            for rank_mold in rank_molds
        ]

    rank_molds = values.get("rank_molds") or [values.get("rank_mold", 2)]
    categories = rank.get("rankCategoryTypeList") or {}
    targets: list[tuple[str, str, str]] = []
    for gender_name, gender_value in (("female", "0"), ("male", "1")):
        for item in categories.get(gender_name) or []:
            category_id = item.get("id")
            if category_id:
                for rank_mold in rank_molds:
                    targets.append((str(category_id), gender_value, str(rank_mold)))
    return targets


def parse_fanqie_category(value: object) -> str:
    if not value:
        return ""
    data = value
    if isinstance(value, str):
        try:
            data = json.loads(value)
        except json.JSONDecodeError:
            return value
    if isinstance(data, list):
        for item in data:
            if isinstance(item, dict) and item.get("MainCategory") and item.get("Name"):
                return str(item["Name"])
        for item in data:
            if isinstance(item, dict) and item.get("Name"):
                return str(item["Name"])
    return ""


def fanqie_status(value: object) -> str:
    text = str(value or "")
    if text in {"0", "已完结", "完结", "完本"}:
        return "已完结"
    if text in {"1", "连载", "连载中"}:
        return "连载中"
    return text


def normalize_fanqie_gender(value: object) -> str:
    text = str(value or "").strip().lower()
    if text in {"1", "male", "男频", "男"}:
        return "male"
    if text in {"0", "female", "女频", "女"}:
        return "female"
    return text


def parse_qidian_page_data(soup: BeautifulSoup) -> dict:
    script = soup.select_one("#vite-plugin-ssr_pageContext")
    if not script:
        return {}
    try:
        return json.loads(script.get_text()).get("pageContext", {})
    except json.JSONDecodeError:
        return {}


def qidian_category_url(
    base_url: str,
    category_id: int | str,
    gender: str,
    order_by: str,
    page_num: int = 1,
) -> str:
    params = ["isfinish1"]
    if order_by:
        params.append(f"orderby{order_by}")
    params.append(gender)
    url = absolute_url(f"/category/catid{category_id}/{'-'.join(params)}/", base_url)
    if page_num > 1:
        return f"{url}?pageNum={page_num}"
    return url


def parse_10000txt_heading(value: str) -> tuple[str, str, str]:
    import re

    title = ""
    author = ""
    status = ""
    title_match = re.search(r"《(.+?)》", value)
    if title_match:
        title = title_match.group(1).strip()
    author_match = re.search(r"作者[：:]\s*(.+)$", value)
    if author_match:
        author = author_match.group(1).strip()
    if any(token in value for token in ("完结", "完本", "全本", "精校")):
        status = "完本"
    return title, author, status


BOOK_FIELDS = {
    "title",
    "author",
    "genre",
    "gender",
    "status",
    "rank_type",
    "source_url",
    "detail_url",
    "download_url",
    "expected_chapters",
    "last_chapter_title",
}
