from __future__ import annotations

import re
import urllib.parse
from pathlib import Path
from typing import Any

from bs4 import BeautifulSoup

from .config import SourceConfig


WINDOWS_RESERVED = {
    "CON",
    "PRN",
    "AUX",
    "NUL",
    *(f"COM{i}" for i in range(1, 10)),
    *(f"LPT{i}" for i in range(1, 10)),
}


def ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def safe_filename(value: str) -> str:
    cleaned = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", value).strip()
    cleaned = re.sub(r"\s+", " ", cleaned).rstrip(".")
    if not cleaned:
        cleaned = "未命名"
    if cleaned.upper() in WINDOWS_RESERVED:
        cleaned = f"_{cleaned}"
    return cleaned[:180]


def normalize_key(value: str) -> str:
    return "".join(str(value).lower().split())


def absolute_url(href: str, base_url: str) -> str:
    return urllib.parse.urljoin(base_url, href)


def text_or_empty(soup: BeautifulSoup, selector: str | None) -> str:
    if not selector:
        return ""
    element = soup.select_one(selector)
    return element.get_text(" ", strip=True) if element else ""


def require_authorized_source(config: SourceConfig) -> None:
    if not config.authorized or not config.license_note:
        raise PermissionError(
            f"来源 {config.name} 未声明授权信息。请设置 authorized=true 并填写 license_note。"
        )
