from __future__ import annotations

import re

from .config import CompletenessConfig, FilterConfig
from .models import BookCandidate


CHAPTER_RE = re.compile(
    r"(^|\n)\s*(第[零一二三四五六七八九十百千万\d]+[章节卷回集部篇]|Chapter\s+\d+)",
    re.IGNORECASE,
)

ENDING_SIGNALS = (
    "全书完",
    "全文完",
    "完本",
    "完结",
    "大结局",
    "终章",
    "尾声",
    "完本感言",
)

INCOMPLETE_SIGNALS = (
    "未完待续",
    "连载中",
    "持续更新",
    "最新章节",
    "敬请期待",
    "待续",
)


class CompletenessChecker:
    def __init__(self, config: CompletenessConfig, filters: FilterConfig) -> None:
        self.config = config
        self.completed_statuses = {s.strip().lower() for s in filters.completed_statuses}

    def metadata_is_completed(self, book: BookCandidate) -> bool:
        if book.trust_completed:
            return True
        status = (book.status or "").strip().lower()
        return status in self.completed_statuses

    def content_is_complete(self, book: BookCandidate, content: bytes) -> tuple[bool, str]:
        if len(content) < self.config.min_bytes:
            return False, f"文件过小 {len(content)} bytes"

        text = decode_text(content)
        normalized_tail = normalize_text(text[-12000:])
        full_text_for_counts = normalize_text(text)

        if any(signal in normalized_tail for signal in INCOMPLETE_SIGNALS):
            return False, "结尾出现未完结/持续更新信号"

        if book.trust_completed:
            return True, "通过"

        chapter_count = len(CHAPTER_RE.findall(full_text_for_counts))
        if chapter_count < self.config.min_chapters:
            return False, f"章节数过少 {chapter_count}"

        if book.expected_chapters and chapter_count < int(book.expected_chapters) * 0.95:
            return False, f"章节数 {chapter_count} 少于来源期望 {book.expected_chapters}"

        if book.last_chapter_title:
            wanted = normalize_text(book.last_chapter_title)
            if wanted and wanted not in full_text_for_counts[-50000:]:
                return False, f"找不到最后章节标题：{book.last_chapter_title}"

        has_ending = any(signal in normalized_tail for signal in ENDING_SIGNALS)
        if self.config.require_ending_signal and not book.trust_completed and not has_ending:
            return False, "结尾缺少完结信号"

        return True, "通过"


def decode_text(content: bytes) -> str:
    for encoding in ("utf-8-sig", "utf-8", "gb18030", "gbk", "big5"):
        try:
            return content.decode(encoding)
        except UnicodeDecodeError:
            continue
    return content.decode("utf-8", errors="ignore")


def normalize_text(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    return re.sub(r"[ \t\u3000]+", "", text)
