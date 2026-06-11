from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from novel_archiver.config import (
    AppConfig,
    ArchiveConfig,
    CompletenessConfig,
    FilterConfig,
    LauncherConfig,
    NetworkConfig,
    ServerConfig,
    SourceConfig,
)
from novel_archiver.service import NovelArchiverService
from novel_archiver.sources import academic_category
from novel_archiver.zlibrary import parse_zlibrary_detail_candidate, read_cookie_header


class ZLibraryCatalogTests(unittest.TestCase):
    def test_zlibrary_catalog_imports_local_academic_pdf(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            files_dir = root / "files"
            files_dir.mkdir()
            source_pdf = files_dir / "algorithms.pdf"
            source_pdf.write_bytes(b"%PDF-1.4\nlegal academic sample\n%%EOF")

            catalog_path = root / "zlibrary_catalog.json"
            catalog_path.write_text(
                json.dumps(
                    [
                        {
                            "title": "Algorithms",
                            "authors": ["Robert Sedgewick", "Kevin Wayne"],
                            "subject": "Computer science; Algorithms",
                            "file_format": "pdf",
                            "local_path": "files/algorithms.pdf",
                            "isbn": "9780321573513",
                            "language": "English",
                        }
                    ],
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            service = NovelArchiverService(
                AppConfig(
                    archive=ArchiveConfig(root=root / "archive", max_bytes=10 * 1024 * 1024, manifest_name=".manifest.json"),
                    network=NetworkConfig(
                        user_agent="NovelArchiverTests/1.0",
                        request_delay_seconds=0,
                        timeout_seconds=5,
                        respect_robots_txt=False,
                    ),
                    filters=FilterConfig(
                        max_books_per_source=10,
                        completed_statuses=["已授权"],
                        category_preset="all",
                        allowed_genres=[],
                    ),
                    completeness=CompletenessConfig(min_bytes=1, min_chapters=1, require_ending_signal=False),
                    server=ServerConfig(host="127.0.0.1", port=8765),
                    launcher=LauncherConfig(open_browser=False, auto_crawl_on_start=False),
                    ranking_sources=[
                        SourceConfig(
                            name="zlibrary_academic",
                            type="zlibrary_catalog",
                            enabled=True,
                            authorized=True,
                            license_note="user-owned legal academic downloads",
                            values={"path": str(catalog_path), "trust_completed": True},
                        )
                    ],
                    download_sources=[
                        SourceConfig(
                            name="catalog_file",
                            type="direct_from_candidate",
                            enabled=True,
                            authorized=True,
                            license_note="download URL or local path is already authorized by the catalog",
                            values={},
                        )
                    ],
                )
            )

            summary = service.crawl_rankings(dry_run=False)

            self.assertEqual(summary, {"scanned": 1, "downloaded": 1, "skipped": 0})
            archived = root / "archive" / "学术-计算机" / "Algorithms - Robert Sedgewick，Kevin Wayne.pdf"
            self.assertEqual(archived.read_bytes(), source_pdf.read_bytes())

    def test_academic_category_maps_subject_keywords(self) -> None:
        self.assertEqual(academic_category({"subject": "Clinical Medicine"}), "学术-医学")
        self.assertEqual(academic_category({"tags": ["Economics", "Finance"]}), "学术-经济管理")

    def test_daily_auto_download_limit_is_enforced_per_source(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            files_dir = root / "files"
            files_dir.mkdir()
            (files_dir / "math1.pdf").write_bytes(b"%PDF-1.4\nmath one\n%%EOF")
            (files_dir / "math2.pdf").write_bytes(b"%PDF-1.4\nmath two\n%%EOF")
            catalog_path = root / "catalog.json"
            catalog_path.write_text(
                json.dumps(
                    [
                        {"title": "Math One", "author": "A", "subject": "Mathematics", "file_format": "pdf", "local_path": "files/math1.pdf"},
                        {"title": "Math Two", "author": "B", "subject": "Mathematics", "file_format": "pdf", "local_path": "files/math2.pdf"},
                    ],
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            config = AppConfig(
                archive=ArchiveConfig(root=root / "archive", max_bytes=10 * 1024 * 1024, manifest_name=".manifest.json"),
                network=NetworkConfig("Tests/1.0", 0, 5, False),
                filters=FilterConfig(10, ["已授权"], "all", []),
                completeness=CompletenessConfig(1, 1, False),
                server=ServerConfig("127.0.0.1", 8765),
                launcher=LauncherConfig(False, False),
                ranking_sources=[
                    SourceConfig(
                        "zlibrary_daily",
                        "zlibrary_catalog",
                        True,
                        True,
                        "authorized",
                        {"path": str(catalog_path), "trust_completed": True, "daily_auto_download_limit": 1},
                    )
                ],
                download_sources=[SourceConfig("catalog_file", "direct_from_candidate", True, True, "authorized", {})],
            )
            service = NovelArchiverService(config)

            self.assertEqual(service.crawl_rankings(dry_run=False), {"scanned": 1, "downloaded": 1, "skipped": 0})
            self.assertEqual(service.crawl_rankings(dry_run=False), {"scanned": 0, "downloaded": 0, "skipped": 0})

    def test_zlibrary_web_detail_parses_academic_pdf(self) -> None:
        html = """
        <html><body>
          <h1>高等数学·上册：第七版</h1>
          <a href="/author/1">同济大学数学系</a>
          <nav class="breadcrumb"><a>主要的</a><a>数学 - 小学</a></nav>
          <a class="btn" href="/dl/123">PDF文件，53.97 MB</a>
        </body></html>
        """
        book = parse_zlibrary_detail_candidate(
            html,
            "https://z-library.im/book/123/高等数学.html",
            {"base_url": "https://z-library.im/", "rank_type": "Z-Library授权学术书目"},
        )

        self.assertEqual(book.title, "高等数学·上册：第七版")
        self.assertEqual(book.author, "同济大学数学系")
        self.assertEqual(book.genre, "学术-数学")
        self.assertEqual(book.extra["file_format"], "pdf")
        self.assertEqual(book.download_url, "https://z-library.im/dl/123")

    def test_netscape_cookie_file_becomes_cookie_header(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            cookie_file = Path(temp_dir) / "cookies.txt"
            cookie_file.write_text(
                "# Netscape HTTP Cookie File\n"
                ".z-library.im\tTRUE\t/\tTRUE\t1893456000\tremix_userid\t123\n"
                "#HttpOnly_.z-library.im\tTRUE\t/\tTRUE\t1893456000\tremix_userkey\tabc\n",
                encoding="utf-8",
            )

            self.assertEqual(read_cookie_header(cookie_file), "remix_userid=123; remix_userkey=abc")


if __name__ == "__main__":
    unittest.main()
