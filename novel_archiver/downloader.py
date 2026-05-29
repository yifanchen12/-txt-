from __future__ import annotations

import time
import re
import urllib.parse
import urllib.robotparser
from dataclasses import dataclass
from typing import Callable, Iterable, Optional

import requests
from bs4 import BeautifulSoup

from .config import NetworkConfig, SourceConfig
from .models import BookCandidate
from .utils import absolute_url, require_authorized_source, text_or_empty


class DownloadBlockedError(RuntimeError):
    """Raised when a file host returns an access/upgrade page instead of the TXT."""


class DownloadHostUnavailableError(RuntimeError):
    """Raised when a resolved file data host is temporarily unreachable."""


@dataclass(frozen=True)
class ResolvedDownload:
    url: str
    source_name: str
    book: BookCandidate
    referer: str = ""


class HttpClient:
    def __init__(self, config: NetworkConfig) -> None:
        self.config = config
        self.session = requests.Session()
        self.session.headers.update({"User-Agent": config.user_agent})
        self._last_request_at = 0.0
        self._robots: dict[str, urllib.robotparser.RobotFileParser] = {}

    def get_text(self, url: str) -> str:
        response = self._get(url)
        response.encoding = response.apparent_encoding or response.encoding
        return response.text

    def get_bytes(
        self,
        url: str,
        referer: str = "",
        progress_callback: Callable[[int, int | None], None] | None = None,
    ) -> bytes:
        headers = {}
        if referer:
            headers["Referer"] = referer
        if not progress_callback:
            return self._get(url, headers=headers).content

        response = self._get(url, headers=headers, stream=True)
        total = parse_content_length(response.headers.get("content-length"))
        chunks: list[bytes] = []
        downloaded = 0
        progress_callback(downloaded, total)
        for chunk in response.iter_content(chunk_size=128 * 1024):
            if not chunk:
                continue
            chunks.append(chunk)
            downloaded += len(chunk)
            progress_callback(downloaded, total)
        return b"".join(chunks)

    def _get(
        self,
        url: str,
        headers: dict[str, str] | None = None,
        stream: bool = False,
    ) -> requests.Response:
        self._check_robots(url)
        last_error: Exception | None = None
        max_attempts = 3 if is_ctfile_data_url(url) else 5
        for attempt in range(max_attempts):
            elapsed = time.monotonic() - self._last_request_at
            if elapsed < self.config.request_delay_seconds:
                time.sleep(self.config.request_delay_seconds - elapsed)
            try:
                response = self.session.get(
                    url,
                    timeout=max(self.config.timeout_seconds, 90),
                    headers=headers or None,
                    stream=stream,
                )
            except requests.RequestException as exc:
                last_error = exc
                if attempt < max_attempts - 1:
                    time.sleep(self._retry_delay(url, attempt, None))
                    continue
                break
            self._last_request_at = time.monotonic()
            if self._looks_like_ctfile_premium_page(response):
                raise DownloadBlockedError(
                    "CTFile ordinary download returned a premium/client upgrade page instead of TXT."
                )
            if response.status_code in {429, 500, 502, 503, 504}:
                last_error = requests.HTTPError(f"HTTP {response.status_code}", response=response)
                if attempt >= max_attempts - 1:
                    break
                retry_after = response.headers.get("Retry-After")
                delay = self._retry_delay(url, attempt, retry_after)
                time.sleep(delay)
                continue
            response.raise_for_status()
            return response
        if last_error:
            if is_ctfile_data_url(url):
                raise DownloadHostUnavailableError(f"CTFile data host failed after retries: {last_error}") from last_error
            raise last_error
        raise RuntimeError(f"request failed: {url}")

    def _check_robots(self, url: str) -> None:
        if not self.config.respect_robots_txt:
            return
        parsed = urllib.parse.urlparse(url)
        base = f"{parsed.scheme}://{parsed.netloc}"
        parser = self._robots.get(base)
        if parser is None:
            parser = urllib.robotparser.RobotFileParser()
            parser.set_url(urllib.parse.urljoin(base, "/robots.txt"))
            try:
                parser.read()
            except Exception:
                pass
            self._robots[base] = parser
        if not parser.can_fetch(self.config.user_agent, url):
            raise PermissionError(f"robots.txt 不允许抓取: {url}")

    @staticmethod
    def _looks_like_ctfile_premium_page(response: requests.Response) -> bool:
        if response.status_code not in {200, 403, 429, 500, 502, 503, 504}:
            return False
        content_type = response.headers.get("content-type", "").lower()
        if "html" not in content_type:
            return False
        text = response.text[:2000].lower()
        return "590m.com/premium" in text or "window.location.href" in text and "/premium/" in text

    @staticmethod
    def _retry_delay(url: str, attempt: int, retry_after: str | None) -> int:
        if retry_after and retry_after.isdigit():
            return int(retry_after)
        if is_ctfile_data_url(url):
            return 3 * (attempt + 1)
        return 8 * (attempt + 1)


class DownloadResolver:
    def __init__(self, source_configs: list[SourceConfig], http: HttpClient) -> None:
        self.source_configs = [s for s in source_configs if s.enabled]
        self.http = http

    def resolve(self, book: BookCandidate) -> Optional[ResolvedDownload]:
        return next(iter(self.iter_resolved(book)), None)

    def iter_resolved(self, book: BookCandidate) -> Iterable[ResolvedDownload]:
        for source in self.source_configs:
            require_authorized_source(source)
            try:
                if source.type == "direct_from_candidate":
                    if book.download_url:
                        url = self._resolve_download_url(book.download_url, source)
                        referer = str(book.extra.get("download_page_url") or book.download_url)
                        yield ResolvedDownload(url, source.name, book, referer=referer)
                elif source.type == "html_search":
                    result = self._resolve_html_search(source, book)
                    if result:
                        yield result
                elif source.type == "10000txt_search":
                    result = self._resolve_10000txt_search(source, book)
                    if result:
                        yield result
                elif source.type == "7shutxt_search":
                    result = self._resolve_7shutxt_search(source, book)
                    if result:
                        yield result
                elif source.type == "txt80_search":
                    result = self._resolve_txt80_search(source, book)
                    if result:
                        yield result
                else:
                    raise ValueError(f"未知下载源类型: {source.type}")
            except ValueError:
                raise
            except Exception:
                continue

    def _resolve_html_search(
        self,
        source: SourceConfig,
        book: BookCandidate,
    ) -> Optional[ResolvedDownload]:
        values = source.values
        template = values["search_url_template"]
        search_url = template.format(
            title=urllib.parse.quote_plus(book.title),
            author=urllib.parse.quote_plus(book.author),
        )
        html = self.http.get_text(search_url)
        soup = BeautifulSoup(html, "html.parser")
        for link in soup.select(values["result_link_selector"]):
            href = link.get("href")
            if not href:
                continue
            detail_url = absolute_url(href, values.get("base_url") or search_url)
            detail = BeautifulSoup(self.http.get_text(detail_url), "html.parser")
            title = text_or_empty(detail, values.get("title_selector"))
            author = text_or_empty(detail, values.get("author_selector"))
            status = text_or_empty(detail, values.get("status_selector")) or values.get("assume_status", "")
            if title and normalize_match(title) != normalize_match(book.title):
                continue
            if book.author and author and normalize_match(author) != normalize_match(book.author):
                continue
            download = detail.select_one(values["download_link_selector"])
            if not download or not download.get("href"):
                continue
            resolved_book = BookCandidate(
                title=title or book.title,
                author=author or book.author,
                genre=text_or_empty(detail, values.get("genre_selector")) or book.genre,
                gender=book.gender,
                status=status or book.status,
                rank_type=book.rank_type,
                source_url=detail_url,
                detail_url=detail_url,
                download_url=absolute_url(download["href"], values.get("base_url") or detail_url),
                expected_chapters=parse_optional_int(text_or_empty(detail, values.get("expected_chapters_selector"))) or book.expected_chapters,
                last_chapter_title=text_or_empty(detail, values.get("last_chapter_selector")) or book.last_chapter_title,
                trust_completed=book.trust_completed,
                ranking_source=book.ranking_source,
                extra=dict(book.extra),
            )
            return ResolvedDownload(
                self._resolve_download_url(resolved_book.download_url, source),
                source.name,
                resolved_book,
                referer=resolved_book.download_url,
            )
        return None

    def _resolve_10000txt_search(
        self,
        source: SourceConfig,
        book: BookCandidate,
    ) -> Optional[ResolvedDownload]:
        values = source.values
        base_url = values.get("base_url", "https://www.10000txt.com/")
        search_url = values.get(
            "search_url",
            absolute_url("/zb_system/cmd.php?act=search", base_url),
        )
        exact_title = bool(values.get("exact_title", True))
        max_results = int(values.get("max_results", 30))

        response = self.http.session.post(
            search_url,
            data={"q": book.title},
            headers={"Referer": base_url},
            timeout=self.http.config.timeout_seconds,
        )
        response.raise_for_status()
        response.encoding = response.apparent_encoding or response.encoding
        soup = BeautifulSoup(response.text, "html.parser")

        for link in soup.select("ul.list-it h2 a[href]")[:max_results]:
            result_heading = link.get_text("", strip=True) or link.get("title") or ""
            result_title, result_author, _ = parse_10000txt_heading(result_heading)
            if exact_title and result_title and normalize_match(result_title) != normalize_match(book.title):
                continue
            if not exact_title and result_title and normalize_match(book.title) not in normalize_match(result_title):
                continue
            if book.author and result_author and normalize_match(result_author) != normalize_match(book.author):
                continue
            detail_url = absolute_url(link["href"], base_url)
            candidate = self._parse_10000txt_detail(detail_url, source, book)
            if not candidate:
                continue
            if exact_title and normalize_match(candidate.title) != normalize_match(book.title):
                continue
            if not exact_title and normalize_match(book.title) not in normalize_match(candidate.title):
                continue
            if book.author and normalize_match(candidate.author) != normalize_match(book.author):
                continue
            if not candidate.download_url:
                continue
            return ResolvedDownload(
                self._resolve_download_url(candidate.download_url, source),
                source.name,
                candidate,
                referer=candidate.download_url,
            )
        return None

    def _parse_10000txt_detail(
        self,
        detail_url: str,
        source: SourceConfig,
        fallback: BookCandidate,
    ) -> Optional[BookCandidate]:
        html = self.http.get_text(detail_url)
        soup = BeautifulSoup(html, "html.parser")
        heading = text_or_empty(soup, "h1")
        if not heading:
            return None
        title, author, status = parse_10000txt_heading(heading)
        genre = text_or_empty(soup, ".info a[href*='?cate=']")
        if not genre:
            breadcrumbs = soup.select(".breadcrumb a[href*='?cate=']")
            if breadcrumbs:
                genre = breadcrumbs[-1].get_text(" ", strip=True)

        download_url = ""
        for link in soup.select(".content a[href]"):
            link_text = link.get_text(" ", strip=True)
            href = link.get("href", "")
            if "下载" in link_text or is_ctfile_url(href):
                download_url = absolute_url(href, detail_url)
                break

        return BookCandidate(
            title=title or fallback.title,
            author=author or fallback.author,
            genre=genre or fallback.genre or "Uncategorized",
            gender=fallback.gender,
            status=status or fallback.status,
            rank_type=fallback.rank_type,
            source_url=detail_url,
            detail_url=detail_url,
            download_url=download_url,
            expected_chapters=fallback.expected_chapters,
            last_chapter_title=fallback.last_chapter_title,
            trust_completed=fallback.trust_completed,
            ranking_source=fallback.ranking_source,
            extra=dict(fallback.extra),
        )

    def _resolve_7shutxt_search(
        self,
        source: SourceConfig,
        book: BookCandidate,
    ) -> Optional[ResolvedDownload]:
        values = source.values
        base_url = values.get("base_url", "https://www.7shutxt.com/")
        search_url = values.get("search_url", absolute_url("/e/search/index.php", base_url))
        exact_title = bool(values.get("exact_title", True))
        max_results = int(values.get("max_results", 30))

        response = self.http.session.post(
            search_url,
            data={"show": "title,zuozhe", "keyboard": book.title, "Submit": ""},
            headers={"Referer": base_url},
            timeout=self.http.config.timeout_seconds,
        )
        response.raise_for_status()
        response.encoding = response.apparent_encoding or response.encoding
        soup = BeautifulSoup(response.text, "html.parser")

        seen: set[str] = set()
        for link in soup.select("a[href]"):
            if len(seen) >= max_results:
                break
            href = link.get("href", "")
            if "article-" not in href and "ShowInfo.php" not in href:
                continue
            detail_url = normalize_7shutxt_detail_url(absolute_url(href, base_url))
            if detail_url in seen:
                continue
            seen.add(detail_url)
            candidate = self._parse_7shutxt_detail(detail_url, source, book)
            if not candidate:
                continue
            if exact_title and normalize_match(candidate.title) != normalize_match(book.title):
                continue
            if not exact_title and normalize_match(book.title) not in normalize_match(candidate.title):
                continue
            if book.author and candidate.author and normalize_match(candidate.author) != normalize_match(book.author):
                continue
            if not candidate.download_url:
                continue
            return ResolvedDownload(
                candidate.download_url,
                source.name,
                candidate,
                referer=str(candidate.extra.get("download_page_url") or candidate.detail_url),
            )
        return None

    def _parse_7shutxt_detail(
        self,
        detail_url: str,
        source: SourceConfig,
        fallback: BookCandidate,
    ) -> Optional[BookCandidate]:
        base_url = source.values.get("base_url", "https://www.7shutxt.com/")
        detail_url = normalize_7shutxt_detail_url(detail_url)
        html = self.http.get_text(detail_url)
        soup = BeautifulSoup(html, "html.parser")
        heading = text_or_empty(soup, "h1")
        title = clean_7shutxt_title(heading) or fallback.title
        author = extract_7shutxt_label(soup, "书籍作者") or fallback.author
        genre = extract_7shutxt_label(soup, "书籍分类") or fallback.genre or "未分类"
        status = extract_7shutxt_label(soup, "写作进度") or fallback.status
        if "完结" in status:
            status = "已完结"

        download_page_url = make_7shutxt_download_page_url(detail_url, base_url)
        download_url = ""
        if download_page_url:
            download_html = self.http.get_text(download_page_url)
            download_soup = BeautifulSoup(download_html, "html.parser")
            download_url = find_7shutxt_txt_link(download_soup, download_page_url)

        return BookCandidate(
            title=title,
            author=author or "佚名",
            genre=normalize_7shutxt_genre(genre),
            gender=fallback.gender,
            status=status or "已完结",
            rank_type=fallback.rank_type,
            source_url=detail_url,
            detail_url=detail_url,
            download_url=download_url,
            expected_chapters=fallback.expected_chapters,
            last_chapter_title=fallback.last_chapter_title,
            trust_completed=fallback.trust_completed,
            ranking_source=fallback.ranking_source,
            extra={**dict(fallback.extra), "download_page_url": download_page_url},
        )

    def _resolve_txt80_search(
        self,
        source: SourceConfig,
        book: BookCandidate,
    ) -> Optional[ResolvedDownload]:
        values = source.values
        base_url = values.get("base_url", "https://www.txt80.cc/")
        search_url = values.get("search_url", absolute_url("/e/search/index.php", base_url))
        exact_title = bool(values.get("exact_title", True))
        max_results = int(values.get("max_results", 30))

        response = self.http.session.post(
            search_url,
            data={
                "show": "title,softsay,softwriter",
                "keyboard": book.title,
                "Submit22": "",
                "tbname": "download",
                "tempid": "1",
            },
            headers={"Referer": base_url},
            timeout=self.http.config.timeout_seconds,
        )
        response.raise_for_status()
        response.encoding = response.apparent_encoding or response.encoding
        soup = BeautifulSoup(response.text, "html.parser")

        seen: set[str] = set()
        for link in soup.select("a[href]"):
            if len(seen) >= max_results:
                break
            href = link.get("href", "")
            text = link.get_text(" ", strip=True)
            if "/txt" not in href or not href.endswith(".html"):
                continue
            if "TXT" not in text.upper() and "下载" not in text:
                continue
            detail_url = absolute_url(href, base_url)
            if detail_url in seen:
                continue
            seen.add(detail_url)

            candidate = self._parse_txt80_detail(detail_url, source, book)
            if not candidate:
                continue
            if exact_title and normalize_match(candidate.title) != normalize_match(book.title):
                continue
            if not exact_title and normalize_match(book.title) not in normalize_match(candidate.title):
                continue
            if book.author and candidate.author and normalize_match(candidate.author) != normalize_match(book.author):
                continue
            if not candidate.download_url:
                continue
            return ResolvedDownload(
                candidate.download_url,
                source.name,
                candidate,
                referer=str(candidate.extra.get("download_page_url") or candidate.detail_url),
            )
        return None

    def _parse_txt80_detail(
        self,
        detail_url: str,
        source: SourceConfig,
        fallback: BookCandidate,
    ) -> Optional[BookCandidate]:
        base_url = source.values.get("base_url", "https://www.txt80.cc/")
        html = self.http.get_text(detail_url)
        soup = BeautifulSoup(html, "html.parser")

        title = text_or_empty(soup, "dd.bt h2") or clean_txt80_title(text_or_empty(soup, "title")) or fallback.title
        author = extract_txt80_label(soup, "小说作者") or fallback.author
        status = extract_txt80_label(soup, "小说状态") or fallback.status
        if "完结" in status or "完本" in status:
            status = "已完结"
        genre = extract_txt80_label(soup, "小说分类") or fallback.genre or "未分类"
        download_page_url = ""
        for link in soup.select("a[href]"):
            if "进入小说下载地址" in link.get_text(" ", strip=True):
                download_page_url = absolute_url(link["href"], base_url)
                break
        if not download_page_url:
            return None

        download_soup = BeautifulSoup(self.http.get_text(download_page_url), "html.parser")
        download_url = find_txt80_txt_link(download_soup)
        if not download_url:
            return None
        download_url = absolute_url(download_url, download_page_url)

        return BookCandidate(
            title=title,
            author=author or "佚名",
            genre=normalize_txt80_genre(genre),
            gender=fallback.gender,
            status=status or "已完结",
            rank_type=fallback.rank_type,
            source_url=detail_url,
            detail_url=detail_url,
            download_url=download_url,
            expected_chapters=fallback.expected_chapters,
            last_chapter_title=fallback.last_chapter_title,
            trust_completed=fallback.trust_completed,
            ranking_source=fallback.ranking_source,
            extra={**dict(fallback.extra), "download_page_url": download_page_url},
        )

    def _resolve_download_url(self, url: str, source: SourceConfig) -> str:
        if is_ctfile_url(url):
            return self._resolve_ctfile_url(url, source)
        return url

    def _resolve_ctfile_url(self, url: str, source: SourceConfig) -> str:
        parsed = urllib.parse.urlparse(url)
        parts = [part for part in parsed.path.split("/") if part]
        if len(parts) < 2 or parts[0] != "f":
            return url

        file_query = parts[1]
        passcode = urllib.parse.parse_qs(parsed.query).get("p", [""])[0]
        passcode = passcode or source.values.get("ctfile_passcode", "")
        api = source.values.get("ctfile_api", "https://webapi.ctfile.com")
        headers = {
            "Referer": url,
            "Origin": f"{parsed.scheme}://{parsed.netloc}",
        }

        getfile = self.http.session.get(
            api + "/getfile.php",
            params={
                "path": "f",
                "f": file_query,
                "passcode": passcode,
                "r": time.time(),
                "ref": "",
                "url": url,
            },
            headers=headers,
            timeout=self.http.config.timeout_seconds,
        )
        getfile.raise_for_status()
        metadata = getfile.json()
        if metadata.get("code") != 200 or not metadata.get("file"):
            raise RuntimeError(f"ctfile metadata error: {metadata.get('message') or metadata.get('code')}")

        file_info = metadata["file"]
        wait_seconds = int(file_info.get("wait_seconds") or 0)
        if wait_seconds > 0:
            time.sleep(wait_seconds + 1)

        download = self.http.session.get(
            api + "/get_file_url.php",
            params={
                "uid": file_info["userid"],
                "fid": file_info["file_id"],
                "folder_id": 0,
                "share_id": "",
                "file_chk": file_info["file_chk"],
                "start_time": file_info.get("start_time", 0),
                "wait_seconds": wait_seconds,
                "mb": 0,
                "app": 0,
                "acheck": 0,
                "verifycode": file_info.get("verifycode", ""),
                "rd": time.time(),
            },
            headers=headers,
            timeout=self.http.config.timeout_seconds,
        )
        download.raise_for_status()
        payload = download.json()
        if payload.get("code") == 302 and payload.get("url"):
            return payload["url"]
        if payload.get("code") == 200 and payload.get("downurl"):
            return payload["downurl"]
        raise RuntimeError(f"ctfile download url error: {payload.get('message') or payload.get('code')}")


def normalize_match(value: str) -> str:
    return "".join(value.lower().split())


def parse_optional_int(value: str) -> int | None:
    digits = "".join(ch for ch in value if ch.isdigit())
    return int(digits) if digits else None


def parse_content_length(value: str | None) -> int | None:
    if not value:
        return None
    try:
        number = int(value)
    except ValueError:
        return None
    return number if number >= 0 else None


def parse_10000txt_heading(value: str) -> tuple[str, str, str]:
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


def clean_7shutxt_title(value: str) -> str:
    value = value.strip()
    title_match = re.search(r"《(.+?)》", value)
    if title_match:
        return title_match.group(1).strip().strip("《》")
    value = re.sub(r"txt下载.*$", "", value, flags=re.IGNORECASE)
    value = re.sub(r"TXT电子书下载地址.*$", "", value, flags=re.IGNORECASE)
    return value.strip(" 《》_")


def extract_7shutxt_label(soup: BeautifulSoup, label: str) -> str:
    pattern = re.compile(re.escape(label) + r"\s*[：:]\s*([^：:]+)")
    for node in soup.select("li"):
        text = re.sub(r"\s+", " ", node.get_text(" ", strip=True))
        match = pattern.search(text)
        if match:
            return clean_7shutxt_label_value(match.group(1))
    return ""


def clean_7shutxt_label_value(value: str) -> str:
    for next_label in ("书籍分类", "书籍大小", "书籍类型", "下载方式", "写作进度", "上传时间", "登录操作"):
        value = value.split(next_label, 1)[0]
    return value.strip(" ：:")


def normalize_7shutxt_genre(value: str) -> str:
    value = re.sub(r"\s+", "", value)
    return value.replace("小说", "") or "未分类"


def normalize_7shutxt_detail_url(url: str) -> str:
    parsed = urllib.parse.urlparse(url)
    query = urllib.parse.parse_qs(parsed.query)
    classid = query.get("classid", [""])[0]
    book_id = query.get("id", [""])[0]
    if classid and book_id:
        return urllib.parse.urlunparse((parsed.scheme, parsed.netloc, f"/article-{classid}-{book_id}.html", "", "", ""))
    return url


def make_7shutxt_download_page_url(detail_url: str, base_url: str) -> str:
    match = re.search(r"article-(\d+)-(\d+)\.html", detail_url)
    if not match:
        return ""
    classid, book_id = match.groups()
    return absolute_url(f"/download-{classid}-{book_id}.html", base_url)


def find_7shutxt_txt_link(soup: BeautifulSoup, page_url: str) -> str:
    for link in soup.select("a[href]"):
        href = link.get("href", "")
        text = link.get_text(" ", strip=True)
        if "pathid=0" in href and "DownSys" in href:
            return absolute_url(href, page_url)
        if "TXT" in text.upper() and "下载地址" in text and "RAR" not in text.upper():
            return absolute_url(href, page_url)
    return ""


def clean_txt80_title(value: str) -> str:
    title_match = re.search(r"《(.+?)》", value)
    if title_match:
        return title_match.group(1).strip()
    return re.sub(r"TXT下载.*$", "", value, flags=re.IGNORECASE).strip(" 《》")


def extract_txt80_label(soup: BeautifulSoup, label: str) -> str:
    for node in soup.select("dd.db"):
        text = re.sub(r"\s+", " ", node.get_text(" ", strip=True))
        if text.startswith(label):
            value = re.sub(rf"^{re.escape(label)}\s*[：:]\s*", "", text)
            return value.strip()
    return ""


def normalize_txt80_genre(value: str) -> str:
    value = re.sub(r"\s+", "", value)
    return value.replace("小说", "") or "未分类"


def find_txt80_txt_link(soup: BeautifulSoup) -> str:
    for link in soup.select("a[href]"):
        href = link.get("href", "").strip()
        text = link.get_text(" ", strip=True)
        if href.lower().endswith(".txt") and "下载到电脑" in text:
            return href
    for link in soup.select("a[href]"):
        href = link.get("href", "").strip()
        if href.lower().endswith(".txt"):
            return href
    return ""


def is_ctfile_url(value: str) -> bool:
    host = urllib.parse.urlparse(value).netloc.lower()
    return "ctfile.com" in host or "z701.com" in host


def is_ctfile_data_url(value: str) -> bool:
    host = urllib.parse.urlparse(value).netloc.lower()
    return host.endswith(".tv002.com")
