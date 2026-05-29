from __future__ import annotations

import unittest

from novel_archiver.completeness import CompletenessChecker
from novel_archiver.config import CompletenessConfig, FilterConfig
from novel_archiver.models import BookCandidate
from novel_archiver.sources import configured_page_urls


class CompletenessTrustTests(unittest.TestCase):
    def setUp(self) -> None:
        self.checker = CompletenessChecker(
            CompletenessConfig(min_bytes=1, min_chapters=2, require_ending_signal=True),
            FilterConfig(
                max_books_per_source=100,
                completed_statuses=["完本", "已完结"],
                category_preset="all",
                allowed_genres=[],
            ),
        )
        self.content = "\n".join(
            [
                "第一章 开始",
                "这里是正文",
                "第二章 继续",
                "这里还是正文",
            ]
        ).encode("utf-8")

    def test_trusted_completed_book_skips_status_and_ending_signal(self) -> None:
        book = BookCandidate(title="测试书", author="作者", status="", trust_completed=True)

        self.assertTrue(self.checker.metadata_is_completed(book))
        self.assertEqual(self.checker.content_is_complete(book, self.content), (True, "通过"))

    def test_trusted_completed_book_skips_chapter_count(self) -> None:
        book = BookCandidate(title="测试书", author="作者", trust_completed=True)

        self.assertEqual(self.checker.content_is_complete(book, "正文正文".encode("utf-8")), (True, "通过"))

    def test_untrusted_book_still_requires_ending_signal(self) -> None:
        book = BookCandidate(title="测试书", author="作者", status="完本")

        complete, reason = self.checker.content_is_complete(book, self.content)

        self.assertFalse(complete)
        self.assertEqual(reason, "结尾缺少完结信号")

    def test_incomplete_tail_still_blocks_trusted_book(self) -> None:
        book = BookCandidate(title="测试书", author="作者", trust_completed=True)
        content = self.content + "\n未完待续".encode("utf-8")

        complete, reason = self.checker.content_is_complete(book, content)

        self.assertFalse(complete)
        self.assertEqual(reason, "结尾出现未完结/持续更新信号")

    def test_configured_page_urls_combines_explicit_urls_and_templates(self) -> None:
        urls = list(
            configured_page_urls(
                {
                    "urls": ["https://example.test/start"],
                    "url_templates": ["https://example.test/page/{page}"],
                    "start_page": 1,
                    "end_page": 2,
                },
                default_urls=["https://example.test/default"],
            )
        )

        self.assertEqual(
            urls,
            [
                "https://example.test/start",
                "https://example.test/page/1",
                "https://example.test/page/2",
            ],
        )


if __name__ == "__main__":
    unittest.main()
