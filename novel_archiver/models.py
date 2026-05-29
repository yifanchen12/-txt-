from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from typing import Any


@dataclass
class BookCandidate:
    title: str
    author: str
    genre: str = "未分类"
    gender: str = ""
    status: str = ""
    rank_type: str = ""
    source_url: str = ""
    detail_url: str = ""
    download_url: str = ""
    expected_chapters: int | None = None
    last_chapter_title: str = ""
    ranking_source: str = ""
    download_source: str = ""
    extra: dict[str, Any] = field(default_factory=dict)

    @property
    def identity(self) -> str:
        raw = f"{self.title}\0{self.author}".encode("utf-8")
        return hashlib.sha1(raw).hexdigest()

    @property
    def display_name(self) -> str:
        return f"《{self.title}》 - {self.author}"
