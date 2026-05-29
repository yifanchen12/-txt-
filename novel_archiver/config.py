from __future__ import annotations

import re
import tomllib
from dataclasses import dataclass
from pathlib import Path
from typing import Any


MALE_GENRES = [
    "玄幻",
    "奇幻",
    "武侠",
    "仙侠",
    "都市",
    "现实",
    "军事",
    "历史",
    "游戏",
    "体育",
    "科幻",
    "悬疑",
    "轻小说",
    "短篇",
    "二次元",
    "诸天无限",
]

FEMALE_GENRES = [
    "古代言情",
    "现代言情",
    "都市言情",
    "浪漫青春",
    "青春校园",
    "仙侠奇缘",
    "玄幻言情",
    "悬疑推理",
    "科幻空间",
    "游戏竞技",
    "现实生活",
    "宫斗宅斗",
    "豪门总裁",
    "穿越重生",
    "女频",
    "同人",
    "短篇",
    "轻小说",
]

CATEGORY_PRESETS = {
    "all": [],
    "male": MALE_GENRES,
    "female": FEMALE_GENRES,
    "custom": [],
}

CATEGORY_PRESET_LABELS = {
    "all": "全部类别",
    "male": "只存男频",
    "female": "只存女频",
    "custom": "自定义分类",
}

CATEGORY_PRESET_ALIASES = {
    "": "all",
    "all": "all",
    "全部": "all",
    "全部类别": "all",
    "male": "male",
    "boy": "male",
    "boys": "male",
    "男频": "male",
    "只存男频": "male",
    "female": "female",
    "girl": "female",
    "girls": "female",
    "女频": "female",
    "只存女频": "female",
    "custom": "custom",
    "自定义": "custom",
    "自定义分类": "custom",
}


@dataclass(frozen=True)
class ArchiveConfig:
    root: Path
    max_bytes: int
    manifest_name: str


@dataclass(frozen=True)
class NetworkConfig:
    user_agent: str
    request_delay_seconds: float
    timeout_seconds: int
    respect_robots_txt: bool


@dataclass(frozen=True)
class FilterConfig:
    max_books_per_source: int
    completed_statuses: list[str]
    category_preset: str
    allowed_genres: list[str]


@dataclass(frozen=True)
class CompletenessConfig:
    min_bytes: int
    min_chapters: int
    require_ending_signal: bool


@dataclass(frozen=True)
class ServerConfig:
    host: str
    port: int


@dataclass(frozen=True)
class LauncherConfig:
    open_browser: bool
    auto_crawl_on_start: bool


@dataclass(frozen=True)
class SourceConfig:
    name: str
    type: str
    enabled: bool
    authorized: bool
    license_note: str
    values: dict[str, Any]


@dataclass(frozen=True)
class AppConfig:
    archive: ArchiveConfig
    network: NetworkConfig
    filters: FilterConfig
    completeness: CompletenessConfig
    server: ServerConfig
    launcher: LauncherConfig
    ranking_sources: list[SourceConfig]
    download_sources: list[SourceConfig]


def load_config(path: Path) -> AppConfig:
    if not path.exists():
        raise FileNotFoundError(f"找不到配置文件: {path}")
    path = path.resolve()
    raw = tomllib.loads(path.read_text(encoding="utf-8-sig"))

    archive = raw.get("archive", {})
    network = raw.get("network", {})
    filters = raw.get("filters", {})
    completeness = raw.get("completeness", {})
    server = raw.get("server", {})
    launcher = raw.get("launcher", {})

    allowed_genres = parse_genre_list(filters.get("allowed_genres", []))
    category_preset = normalize_category_preset(
        filters.get("category_preset", "custom" if allowed_genres else "all")
    )

    return AppConfig(
        archive=ArchiveConfig(
            root=Path(archive.get("root", r"E:\xiaoshuo")),
            max_bytes=parse_size(archive.get("max_bytes", "50GB")),
            manifest_name=archive.get("manifest_name", ".novel_manifest.json"),
        ),
        network=NetworkConfig(
            user_agent=network.get("user_agent", "NovelArchiver/1.0"),
            request_delay_seconds=float(network.get("request_delay_seconds", 2.0)),
            timeout_seconds=int(network.get("timeout_seconds", 30)),
            respect_robots_txt=bool(network.get("respect_robots_txt", True)),
        ),
        filters=FilterConfig(
            max_books_per_source=int(filters.get("max_books_per_source", 100)),
            completed_statuses=list(filters.get("completed_statuses", ["完本", "已完结"])),
            category_preset=category_preset,
            allowed_genres=allowed_genres,
        ),
        completeness=CompletenessConfig(
            min_bytes=int(completeness.get("min_bytes", 102400)),
            min_chapters=int(completeness.get("min_chapters", 20)),
            require_ending_signal=bool(completeness.get("require_ending_signal", True)),
        ),
        server=ServerConfig(
            host=str(server.get("host", "127.0.0.1")),
            port=int(server.get("port", 8765)),
        ),
        launcher=LauncherConfig(
            open_browser=bool(launcher.get("open_browser", True)),
            auto_crawl_on_start=bool(launcher.get("auto_crawl_on_start", True)),
        ),
        ranking_sources=parse_sources(raw.get("ranking_sources", []), "ranking_sources", path.parent),
        download_sources=parse_sources(raw.get("download_sources", []), "download_sources", path.parent),
    )


def parse_sources(items: list[dict[str, Any]], group_name: str, base_dir: Path) -> list[SourceConfig]:
    sources: list[SourceConfig] = []
    for item in items:
        name = item.get("name", "")
        source_type = item.get("type", "")
        if not name or not source_type:
            raise ValueError(f"{group_name} 中每个来源都必须有 name 和 type")
        authorized = bool(item.get("authorized", False))
        license_note = str(item.get("license_note", "")).strip()
        values = dict(item)
        if values.get("path"):
            source_path = Path(values["path"])
            if not source_path.is_absolute():
                values["path"] = str(base_dir / source_path)
        for key in ("name", "type", "enabled", "authorized", "license_note"):
            values.pop(key, None)
        sources.append(
            SourceConfig(
                name=name,
                type=source_type,
                enabled=bool(item.get("enabled", True)),
                authorized=authorized,
                license_note=license_note,
                values=values,
            )
        )
    return sources


def parse_size(value: Any) -> int:
    if isinstance(value, int):
        return value
    text = str(value).strip().upper()
    match = re.fullmatch(r"(\d+(?:\.\d+)?)\s*(B|KB|MB|GB|TB)?", text)
    if not match:
        raise ValueError(f"无法解析容量: {value}")
    number = float(match.group(1))
    unit = match.group(2) or "B"
    multipliers = {
        "B": 1,
        "KB": 1024,
        "MB": 1024**2,
        "GB": 1024**3,
        "TB": 1024**4,
    }
    return int(number * multipliers[unit])


def format_size_for_config(value: int) -> str:
    for unit, multiplier in (
        ("TB", 1024**4),
        ("GB", 1024**3),
        ("MB", 1024**2),
        ("KB", 1024),
    ):
        if value >= multiplier and value % multiplier == 0:
            return f"{value // multiplier}{unit}"
    for unit, multiplier in (
        ("TB", 1024**4),
        ("GB", 1024**3),
        ("MB", 1024**2),
        ("KB", 1024),
    ):
        if value >= multiplier:
            return f"{value / multiplier:.2f}{unit}"
    return f"{value}B"


def parse_genre_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        parts = re.split(r"[,，;；\n]+", value)
    else:
        parts = [str(item) for item in value]
    genres: list[str] = []
    seen: set[str] = set()
    for part in parts:
        genre = part.strip()
        if not genre:
            continue
        key = normalize_genre(genre)
        if key in seen:
            continue
        seen.add(key)
        genres.append(genre)
    return genres


def normalize_category_preset(value: Any) -> str:
    key = str(value or "").strip().lower()
    normalized = CATEGORY_PRESET_ALIASES.get(key)
    if normalized:
        return normalized
    raise ValueError(
        "分类预设必须是 all、male、female、custom，或中文：全部、男频、女频、自定义"
    )


def effective_allowed_genres(filters: FilterConfig) -> list[str]:
    if filters.category_preset == "all":
        return []
    if filters.category_preset == "custom":
        return filters.allowed_genres
    return list(CATEGORY_PRESETS[filters.category_preset])


def normalize_genre(value: str) -> str:
    text = re.sub(r"\s+", "", str(value).lower())
    text = text.replace("小说", "")
    return text


def genre_matches_filter(genre: str, filters: FilterConfig) -> bool:
    allowed = effective_allowed_genres(filters)
    if not allowed:
        return True
    genre_key = normalize_genre(genre)
    if not genre_key:
        return False
    if filters.category_preset in {"male", "female"} and genre_matches_opposite_preset(genre_key, filters.category_preset):
        return False
    for item in allowed:
        item_key = normalize_genre(item)
        if item_key and (genre_key == item_key or item_key in genre_key or genre_key in item_key):
            return True
    return False


def genre_matches_opposite_preset(genre_key: str, preset: str) -> bool:
    opposite = "female" if preset == "male" else "male"
    current_keys = {normalize_genre(item) for item in CATEGORY_PRESETS[preset]}
    opposite_keys = {normalize_genre(item) for item in CATEGORY_PRESETS[opposite]}
    if genre_key in current_keys:
        return False
    return any(item_key and (genre_key == item_key or item_key in genre_key) for item_key in opposite_keys)


def gender_matches_filter(gender: str, filters: FilterConfig) -> bool:
    if filters.category_preset not in {"male", "female"}:
        return True
    text = str(gender or "").strip().lower()
    if not text:
        return True
    aliases = {
        "男": "male",
        "男频": "male",
        "male": "male",
        "1": "male",
        "女": "female",
        "女频": "female",
        "female": "female",
        "0": "female",
    }
    normalized = aliases.get(text, text)
    return normalized == filters.category_preset


def book_matches_filter(genre: str, gender: str, filters: FilterConfig) -> bool:
    return gender_matches_filter(gender, filters) and genre_matches_filter(genre, filters)


def save_user_settings(
    config_path: Path,
    archive_root: str,
    max_bytes: str,
    category_preset: str,
    allowed_genres: list[str] | str,
) -> AppConfig:
    config_path = config_path.resolve()
    if not config_path.exists():
        raise FileNotFoundError(f"找不到配置文件: {config_path}")

    archive_root = str(archive_root).strip()
    if not archive_root:
        raise ValueError("存储位置不能为空")
    parsed_max_bytes = parse_size(max_bytes)
    if parsed_max_bytes <= 0:
        raise ValueError("存储空间大小必须大于 0")
    preset = normalize_category_preset(category_preset)
    genres = parse_genre_list(allowed_genres)

    old_text = config_path.read_text(encoding="utf-8-sig")
    new_text = old_text
    new_text = update_toml_table_values(
        new_text,
        "archive",
        {
            "root": toml_string(archive_root),
            "max_bytes": toml_string(format_size_for_config(parsed_max_bytes)),
        },
    )
    new_text = update_toml_table_values(
        new_text,
        "filters",
        {
            "category_preset": toml_string(preset),
            "allowed_genres": toml_string_list(genres),
        },
    )

    config_path.write_text(new_text, encoding="utf-8")
    try:
        return load_config(config_path)
    except Exception:
        config_path.write_text(old_text, encoding="utf-8")
        raise


def update_toml_table_values(text: str, section: str, updates: dict[str, str]) -> str:
    lines = text.splitlines()
    had_trailing_newline = text.endswith(("\n", "\r"))
    header = f"[{section}]"
    start = next((index for index, line in enumerate(lines) if line.strip() == header), None)
    if start is None:
        if lines and lines[-1].strip():
            lines.append("")
        lines.append(header)
        for key, value in updates.items():
            lines.append(f"{key} = {value}")
        return "\n".join(lines) + ("\n" if had_trailing_newline else "")

    end = len(lines)
    for index in range(start + 1, len(lines)):
        stripped = lines[index].strip()
        if stripped.startswith("[") and stripped.endswith("]"):
            end = index
            break

    seen: set[str] = set()
    key_pattern = re.compile(r"^(\s*)([A-Za-z0-9_-]+)\s*=")
    for index in range(start + 1, end):
        match = key_pattern.match(lines[index])
        if not match:
            continue
        key = match.group(2)
        if key not in updates:
            continue
        lines[index] = f"{match.group(1)}{key} = {updates[key]}"
        seen.add(key)

    missing = [key for key in updates if key not in seen]
    if missing:
        insert_at = start + 1
        for key in reversed(missing):
            lines.insert(insert_at, f"{key} = {updates[key]}")

    return "\n".join(lines) + ("\n" if had_trailing_newline else "")


def toml_string(value: str) -> str:
    import json

    return json.dumps(value, ensure_ascii=False)


def toml_string_list(values: list[str]) -> str:
    import json

    return json.dumps(values, ensure_ascii=False)
