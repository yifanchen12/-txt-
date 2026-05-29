from __future__ import annotations

import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from .archive import ArchiveStore
from .completeness import CompletenessChecker
from .config import (
    CATEGORY_PRESET_LABELS,
    AppConfig,
    book_matches_filter,
    effective_allowed_genres,
    format_size_for_config,
    load_config,
    save_user_settings,
)
from .downloader import DownloadBlockedError, DownloadHostUnavailableError, DownloadResolver, HttpClient
from .models import BookCandidate
from .sources import build_ranking_source


@dataclass
class DownloadResult:
    status: str
    message: str
    book: BookCandidate | None = None
    path: str = ""
    bytes: int = 0
    local_matches: list[dict[str, Any]] | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "message": self.message,
            "book": None if self.book is None else {
                "title": self.book.title,
                "author": self.book.author,
                "genre": self.book.genre,
                "gender": self.book.gender,
                "status": self.book.status,
                "trust_completed": self.book.trust_completed,
                "source_url": self.book.source_url,
                "download_source": self.book.download_source,
            },
            "path": self.path,
            "bytes": self.bytes,
            "local_matches": self.local_matches or [],
        }


class NovelArchiverService:
    def __init__(self, config: AppConfig, config_path: Path | None = None) -> None:
        self.config = config
        self.config_path = config_path
        self.progress_callback: Callable[[BookCandidate, str, int, int | None], None] | None = None
        self.http = HttpClient(config.network)
        self._build_runtime_components()

    def _build_runtime_components(self) -> None:
        self.store = ArchiveStore(
            root=self.config.archive.root,
            max_bytes=self.config.archive.max_bytes,
            manifest_name=self.config.archive.manifest_name,
        )
        self.checker = CompletenessChecker(self.config.completeness, self.config.filters)
        self.resolver = DownloadResolver(self.config.download_sources, self.http)

    @classmethod
    def from_config_path(cls, path: Path) -> "NovelArchiverService":
        return cls(load_config(path), config_path=path)

    def reconfigure(self, config: AppConfig) -> None:
        self.config = config
        self.http.config = config.network
        self.http.session.headers.update({"User-Agent": config.network.user_agent})
        self._build_runtime_components()

    def settings_to_dict(self) -> dict[str, Any]:
        filters = self.config.filters
        return {
            "archive_root": str(self.config.archive.root),
            "max_bytes": self.config.archive.max_bytes,
            "max_size": format_size_for_config(self.config.archive.max_bytes),
            "category_preset": filters.category_preset,
            "category_label": CATEGORY_PRESET_LABELS.get(filters.category_preset, filters.category_preset),
            "allowed_genres": filters.allowed_genres,
            "effective_allowed_genres": effective_allowed_genres(filters),
        }

    def update_user_settings(
        self,
        archive_root: str,
        max_bytes: str,
        category_preset: str,
        allowed_genres: list[str] | str,
    ) -> dict[str, Any]:
        if self.config_path is None:
            raise RuntimeError("当前服务没有配置文件路径，无法保存设置。")
        config = save_user_settings(
            self.config_path,
            archive_root=archive_root,
            max_bytes=max_bytes,
            category_preset=category_preset,
            allowed_genres=allowed_genres,
        )
        self.reconfigure(config)
        return self.settings_to_dict()

    def search_local(self, title: str, author: str = "") -> list[dict[str, Any]]:
        return self.store.find(title, author)

    def ensure_book(
        self,
        title: str,
        author: str = "",
        genre: str = "",
        progress_callback: Callable[[BookCandidate, str, int, int | None], None] | None = None,
    ) -> DownloadResult:
        found = self.store.find_exact(title, author)
        if found:
            return DownloadResult(
                status="exists",
                message="Book already exists in archive.",
                path=str(found.get("path", "")),
                bytes=int(found.get("bytes", 0) or 0),
                local_matches=[found],
            )

        candidate = BookCandidate(
            title=title.strip(),
            author=author.strip(),
            genre=genre.strip() or "未分类",
        )
        return self.download_book(candidate, dry_run=False, progress_callback=progress_callback)

    def download_book(
        self,
        book: BookCandidate,
        dry_run: bool,
        progress_callback: Callable[[BookCandidate, str, int, int | None], None] | None = None,
    ) -> DownloadResult:
        if not self._has_searchable_download_source(book):
            return DownloadResult(
                "source_not_configured",
                (
                    "No searchable download source is enabled. Configure an authorized "
                    "html_search source in config.toml, or crawl a ranking source that "
                    "provides download_url."
                ),
                book,
            )

        resolved_any = False
        last_result: DownloadResult | None = None

        for resolved in self.resolver.iter_resolved(book):
            resolved_any = True
            resolved_book = resolved.book
            resolved_book.download_source = resolved.source_name

            if not self.checker.metadata_is_completed(resolved_book):
                last_result = DownloadResult(
                    "skipped",
                    f"Book is not marked completed: {resolved_book.status or 'unknown'}",
                    resolved_book,
                )
                continue

            if not self._book_is_allowed(resolved_book):
                last_result = DownloadResult(
                    "category_filtered",
                    self._category_filter_message(resolved_book),
                    resolved_book,
                )
                continue

            try:
                content = self.http.get_bytes(
                    resolved.url,
                    referer=resolved.referer,
                    progress_callback=self._make_progress_callback(
                        resolved_book,
                        resolved.source_name,
                        progress_callback,
                    ),
                )
            except DownloadBlockedError as exc:
                last_result = DownloadResult(
                    "download_blocked",
                    f"普通下载主机返回了升级/客户端页面，已尝试后续备用源: {exc}",
                    resolved_book,
                )
                continue
            except DownloadHostUnavailableError as exc:
                last_result = DownloadResult(
                    "download_unavailable",
                    f"普通下载文件主机暂时不可用，已尝试后续备用源: {exc}",
                    resolved_book,
                )
                continue
            except Exception as exc:
                last_result = DownloadResult(
                    "download_error",
                    f"Download host temporarily failed, tried next fallback if available: {exc}",
                    resolved_book,
                )
                continue

            complete, reason = self.checker.content_is_complete(resolved_book, content)
            if not complete:
                last_result = DownloadResult("skipped", f"Text looks incomplete: {reason}", resolved_book)
                continue

            if not self.store.has_capacity_for(len(content)):
                return DownloadResult("full", "Archive size limit reached.", resolved_book)

            target = self.store.write_book(resolved_book, content, dry_run=dry_run)
            return DownloadResult(
                "downloaded" if not dry_run else "dry_run",
                "Book downloaded." if not dry_run else "Dry run passed.",
                resolved_book,
                str(target),
                len(content),
            )

        if resolved_any and last_result:
            return last_result
        return DownloadResult(
            "not_found",
            "No exact completed title match was found in enabled authorized sources.",
            book,
        )

    def crawl_rankings(self, dry_run: bool = False, limit: int | None = None) -> dict[str, int]:
        scanned = 0
        downloaded = 0
        skipped = 0

        for source_config in self.config.ranking_sources:
            if not source_config.enabled:
                continue
            source = build_ranking_source(source_config, self.http)
            source_limit = self.config.filters.max_books_per_source
            source_scanned = 0
            source_counts = {
                "downloaded": 0,
                "exists": 0,
                "not_found": 0,
                "not_completed": 0,
                "other_skipped": 0,
                "errors": 0,
            }
            print(f"\nRanking source: {source_config.name}", flush=True)

            for book in source.iter_books(self.config.filters.max_books_per_source):
                if limit is not None and scanned >= limit:
                    break
                scanned += 1
                source_scanned += 1

                book.ranking_source = source_config.name
                print(
                    f"  [{source_scanned}/{source_limit}] checking: {book.display_name} "
                    f"[{book.status or 'unknown'}]",
                    flush=True,
                )
                if not self._book_is_allowed(book):
                    skipped += 1
                    source_counts["other_skipped"] += 1
                    print(f"  skip category: {book.display_name} [{book.genre or 'unknown'}]", flush=True)
                    print(source_progress_line(source_scanned, source_limit, source_counts), flush=True)
                    continue

                if not self.checker.metadata_is_completed(book):
                    skipped += 1
                    source_counts["not_completed"] += 1
                    print(f"  skip not completed: {book.display_name} [{book.status or 'unknown'}]", flush=True)
                    print(source_progress_line(source_scanned, source_limit, source_counts), flush=True)
                    continue

                if self.store.is_downloaded(book):
                    skipped += 1
                    source_counts["exists"] += 1
                    print(f"  exists: {book.display_name}", flush=True)
                    print(source_progress_line(source_scanned, source_limit, source_counts), flush=True)
                    continue

                try:
                    result = self.download_book(
                        book,
                        dry_run=dry_run,
                        progress_callback=make_progress_printer(),
                    )
                except Exception as exc:
                    skipped += 1
                    source_counts["errors"] += 1
                    print(f"  error: {book.display_name}; {exc}", flush=True)
                    print(source_progress_line(source_scanned, source_limit, source_counts), flush=True)
                    continue
                if result.status in {"downloaded", "dry_run"}:
                    downloaded += 1
                    source_counts["downloaded"] += 1
                    print(f"  {result.status}: {result.path}", flush=True)
                elif result.status == "full":
                    skipped += 1
                    source_counts["other_skipped"] += 1
                    print(f"  full: archive size limit reached, stopping crawl.", flush=True)
                    print(source_progress_line(source_scanned, source_limit, source_counts), flush=True)
                    return {"scanned": scanned, "downloaded": downloaded, "skipped": skipped}
                else:
                    skipped += 1
                    if result.status == "not_found":
                        source_counts["not_found"] += 1
                    else:
                        source_counts["other_skipped"] += 1
                    print(f"  {result.status}: {book.display_name}; {result.message}", flush=True)
                print(source_progress_line(source_scanned, source_limit, source_counts), flush=True)

            print(f"Source summary: {source_config.name}", flush=True)
            print(source_progress_line(source_scanned, source_limit, source_counts), flush=True)

            if limit is not None and scanned >= limit:
                break

        return {"scanned": scanned, "downloaded": downloaded, "skipped": skipped}

    def _has_searchable_download_source(self, book: BookCandidate) -> bool:
        for source in self.config.download_sources:
            if not source.enabled:
                continue
            if source.type == "html_search":
                return True
            if source.type == "10000txt_search":
                return True
            if source.type == "7shutxt_search":
                return True
            if source.type == "txt80_search":
                return True
            if source.type == "direct_from_candidate" and book.download_url:
                return True
        return False

    def _book_is_allowed(self, book: BookCandidate) -> bool:
        return book_matches_filter(book.genre, book.gender, self.config.filters)

    def _category_filter_message(self, book: BookCandidate) -> str:
        settings = self.settings_to_dict()
        label = settings["category_label"]
        genre = book.genre or "unknown"
        return f"Book category does not match archive setting ({label}): {genre}"

    def _make_progress_callback(
        self,
        book: BookCandidate,
        source_name: str,
        progress_callback: Callable[[BookCandidate, str, int, int | None], None] | None,
    ) -> Callable[[int, int | None], None] | None:
        callbacks = [callback for callback in (self.progress_callback, progress_callback) if callback is not None]
        if not callbacks:
            return None

        def notify(downloaded: int, total: int | None) -> None:
            for callback in callbacks:
                try:
                    callback(book, source_name, downloaded, total)
                except Exception:
                    pass

        return notify


def source_progress_line(current: int, total: int, counts: dict[str, int]) -> str:
    return (
        f"  progress: checked {current}/{total} | "
        f"downloaded {counts.get('downloaded', 0)} | "
        f"exists {counts.get('exists', 0)} | "
        f"not_found {counts.get('not_found', 0)} | "
        f"not_completed {counts.get('not_completed', 0)} | "
        f"other_skipped {counts.get('other_skipped', 0)} | "
        f"errors {counts.get('errors', 0)}"
    )


def make_progress_printer() -> Callable[[BookCandidate, str, int, int | None], None]:
    state: dict[str, float | int | str] = {"time": 0.0, "bytes": -1, "key": ""}

    def print_progress(book: BookCandidate, source_name: str, downloaded: int, total: int | None) -> None:
        key = f"{source_name}\0{book.identity}"
        now = time.monotonic()
        is_done = bool(total and downloaded >= total)
        is_new = state["key"] != key
        enough_bytes = downloaded - int(state["bytes"]) >= 1024 * 1024
        enough_time = now - float(state["time"]) >= 2.0
        if not (is_new or is_done or enough_bytes or enough_time):
            return

        state["key"] = key
        state["time"] = now
        state["bytes"] = downloaded
        line = f"    downloading [{source_name}] {book.display_name} {progress_text(downloaded, total)}"
        print(line, flush=True)

    return print_progress


def progress_text(downloaded: int, total: int | None) -> str:
    if total and total > 0:
        ratio = min(max(downloaded / total, 0.0), 1.0)
        width = 24
        filled = int(ratio * width)
        bar = "=" * filled + "." * (width - filled)
        percent = ratio * 100
        return f"[{bar}] {percent:5.1f}% {format_bytes(downloaded)}/{format_bytes(total)}"
    return f"[downloaded] {format_bytes(downloaded)}"


def format_bytes(value: int) -> str:
    size = float(value)
    for unit in ("B", "KB", "MB", "GB"):
        if size < 1024 or unit == "GB":
            if unit == "B":
                return f"{int(size)} {unit}"
            return f"{size:.2f} {unit}"
        size /= 1024
    return f"{size:.2f} GB"
