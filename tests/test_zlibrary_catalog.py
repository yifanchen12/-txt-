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


if __name__ == "__main__":
    unittest.main()
