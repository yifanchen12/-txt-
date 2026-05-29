from __future__ import annotations

import json
from dataclasses import asdict
from pathlib import Path
from typing import Any

from .models import BookCandidate
from .utils import ensure_dir, normalize_key, safe_filename


class ArchiveStore:
    def __init__(self, root: Path, max_bytes: int, manifest_name: str) -> None:
        self.root = root
        self.max_bytes = max_bytes
        self.manifest_path = root / manifest_name
        ensure_dir(root)
        self.manifest = self._load_manifest()

    def _load_manifest(self) -> dict[str, Any]:
        if not self.manifest_path.exists():
            return {"books": {}}
        try:
            return json.loads(self.manifest_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return {"books": {}}

    def _save_manifest(self) -> None:
        self.manifest_path.write_text(
            json.dumps(self.manifest, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def used_bytes(self) -> int:
        total = 0
        for path in self.root.rglob("*"):
            if path.is_file():
                total += path.stat().st_size
        return total

    def has_capacity_for(self, size: int) -> bool:
        return self.used_bytes() + size <= self.max_bytes

    def is_downloaded(self, book: BookCandidate) -> bool:
        record = self.manifest.get("books", {}).get(book.identity)
        if not record:
            return False
        path = Path(record.get("path", ""))
        return path.exists() and path.stat().st_size == record.get("bytes")

    def find(self, title: str, author: str = "") -> list[dict[str, Any]]:
        title_key = normalize_key(title)
        author_key = normalize_key(author)
        results: list[dict[str, Any]] = []

        for identity, record in self.manifest.get("books", {}).items():
            if self._record_matches(record, title_key, author_key):
                item = dict(record)
                item["identity"] = identity
                item["source"] = "manifest"
                results.append(item)

        seen_paths = {str(Path(item.get("path", ""))).lower() for item in results}
        if self.root.exists():
            for path in self.root.rglob("*.txt"):
                key = str(path).lower()
                if key in seen_paths:
                    continue
                parsed = self._record_from_path(path)
                if self._record_matches(parsed, title_key, author_key):
                    parsed["identity"] = ""
                    parsed["source"] = "filesystem"
                    results.append(parsed)
        return results

    def find_exact(self, title: str, author: str = "") -> dict[str, Any] | None:
        title_key = normalize_key(title)
        author_key = normalize_key(author)
        for record in self.find(title, author):
            record_title = normalize_key(str(record.get("title", "")))
            record_author = normalize_key(str(record.get("author", "")))
            if record_title == title_key and (not author_key or record_author == author_key):
                return record
        return None

    def _record_matches(self, record: dict[str, Any], title_key: str, author_key: str) -> bool:
        record_title = normalize_key(str(record.get("title", "")))
        record_author = normalize_key(str(record.get("author", "")))
        if title_key and title_key not in record_title:
            return False
        if author_key and author_key not in record_author:
            return False
        return True

    def _record_from_path(self, path: Path) -> dict[str, Any]:
        stem = path.stem
        if " - " in stem:
            title, author = stem.rsplit(" - ", 1)
        else:
            title, author = stem, ""
        return {
            "path": str(path),
            "bytes": path.stat().st_size,
            "title": title,
            "author": author,
            "genre": path.parent.name if path.parent != self.root else "",
            "status": "",
        }

    def target_path(self, book: BookCandidate) -> Path:
        genre = safe_filename(book.genre or "未分类")
        filename = safe_filename(f"{book.title} - {book.author}.txt")
        return self.root / genre / filename

    def write_book(self, book: BookCandidate, content: bytes, dry_run: bool) -> Path:
        target = self.target_path(book)
        if dry_run:
            return target
        ensure_dir(target.parent)
        target.write_bytes(content)
        self.manifest.setdefault("books", {})[book.identity] = {
            "path": str(target),
            "bytes": len(content),
            "title": book.title,
            "author": book.author,
            "genre": book.genre,
            "gender": book.gender,
            "status": book.status,
            "trust_completed": book.trust_completed,
            "ranking_source": book.ranking_source,
            "download_source": book.download_source,
            "metadata": asdict(book),
        }
        self._save_manifest()
        return target
