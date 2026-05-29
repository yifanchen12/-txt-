# Novel Archive Assistant

[中文说明](README.md)

Novel Archive Assistant is a local TXT novel archiving tool for personal library management. It scans user-approved ranking pages, catalogs, and download sources, downloads completed works, stores them by category, and controls intake through storage limits, category filters, duplicate detection, and completeness checks.

> Compliance notice: This project does not bundle piracy sources and does not encourage downloading unauthorized content. Only configure sources that you are legally allowed to use, such as public-domain content, personal backups, or officially authorized download sources.

## Features

- Automated ranking crawl: scan configured book lists until the scan limit or archive size limit is reached.
- Multiple download sources: built-in support for `10000txt`, `7shutxt`, `txt80`, and configurable generic HTML sources.
- Local archiving: store books by category with the file name format `Title - Author.txt`.
- Storage limit: set the maximum archive size, such as `50GB` or `800MB`.
- Category filtering: archive all categories, male-oriented categories, female-oriented categories, or a custom genre list.
- Trusted completed lists: default completed ranking sources can skip strict ending-signal checks to improve intake rate.
- Completeness safeguards: still blocks very small files and obvious unfinished-tail signals such as `未完待续` or `连载中`.
- Duplicate tracking: manifest-based tracking prevents repeated downloads.
- Multiple entry points: command line, local Web/API service, and Windows desktop launcher.

## Project Layout

```text
novel_archiver/
  archive.py        Local archive, capacity checks, manifest management
  cli.py            Command-line entry point
  completeness.py   TXT completeness checks
  config.py         TOML parsing and settings persistence
  downloader.py     Download source resolution and file download
  server.py         Local Web/API service
  service.py        Core orchestration
  sources.py        Ranking source parsers
launcher.py         Windows desktop launcher
config.example.toml Default configuration template
tests/              Unit tests
```

## Installation

Python 3.11 or newer is recommended. The current project has been verified with a Python 3.14 virtual environment.

```powershell
py -3.14 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
Copy-Item config.example.toml config.toml
```

After installation, edit `config.toml` to confirm your archive path, storage limit, category policy, and authorized sources.

## Quick Start

Dry run mode validates the configured sources and download flow without writing files:

```powershell
.\.venv\Scripts\python.exe -m novel_archiver --config config.toml --dry-run
```

Run a real archive crawl:

```powershell
.\.venv\Scripts\python.exe -m novel_archiver --config config.toml
```

Limit the number of scanned candidates:

```powershell
.\.venv\Scripts\python.exe -m novel_archiver --config config.toml --limit 50
```

Start the local Web service:

```powershell
.\.venv\Scripts\python.exe -m novel_archiver --config config.toml --serve
```

Default URL:

```text
http://127.0.0.1:8765/
```

Windows users can also run:

```text
NovelArchiveLauncher.exe
```

The launcher opens the local page and can automatically start crawling according to the `[launcher]` section. The top of the launcher window lets you edit the archive path, size limit, and category intake policy. Changes are written to `config.toml`; if the service was started by the launcher, they take effect immediately.

## Core Configuration

### Archive Path and Capacity

```toml
[archive]
root = "E:\\xiaoshou"
max_bytes = "50GB"
manifest_name = ".novel_manifest.json"
```

- `root`: local archive directory.
- `max_bytes`: maximum archive size. Supported units: `B`, `KB`, `MB`, `GB`, `TB`.
- `manifest_name`: duplicate tracking file.

### Category Policy

```toml
[filters]
max_books_per_source = 10000
completed_statuses = ["完本", "已完结", "已完成", "completed", "complete", "finished"]
category_preset = "all"
allowed_genres = []
```

Supported `category_preset` values:

- `all`: archive every category.
- `male`: only archive male-oriented categories.
- `female`: only archive female-oriented categories.
- `custom`: only archive genres listed in `allowed_genres`.

Custom genre example:

```toml
category_preset = "custom"
allowed_genres = ["玄幻", "都市", "科幻"]
```

### Completeness Policy

```toml
[completeness]
min_bytes = 102400
min_chapters = 20
require_ending_signal = true
```

Regular sources are checked by file size, chapter count, final chapter title, and ending signals. Default completed ranking sources use `trust_completed = true`, so they skip chapter-count, final-title, and mandatory ending-signal checks. They still block files that are too small or contain obvious unfinished-tail signals.

### Launcher Behavior

```toml
[launcher]
open_browser = true
auto_crawl_on_start = true
```

- `open_browser`: open the local page when the desktop launcher starts.
- `auto_crawl_on_start`: start archive crawling automatically.

## Default Sources

The default template enables three ranking sources:

- `10000txt_home_recommend`
- `7shutxt_recommend`
- `txt80_all_books`

These sources use:

```toml
trust_completed = true
```

This treats them as completed-book lists for a higher automatic intake rate. If you prefer stricter TXT validation, set `trust_completed` to `false` for the corresponding source.

Every source must explicitly declare authorization:

```toml
authorized = true
license_note = "Explain why this source may be downloaded, such as public-domain content, site authorization, or personal backup rights"
```

Sources without authorization metadata are skipped.

## API

The local service provides these endpoints:

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/search?title=Title&author=Author` | Search the local archive only |
| `GET` | `/api/ensure?title=Title&author=Author` | Search and download if missing |
| `POST` | `/api/ensure` | JSON body with `title`, `author`, and `genre` |
| `GET` | `/api/settings` | Read archive and category settings |
| `POST` | `/api/settings` | Update archive and category settings |
| `GET` | `/api/status` | Read path, size, and runtime status |

Example `POST /api/settings` body:

```json
{
  "archive_root": "D:\\novels",
  "max_size": "80GB",
  "category_preset": "custom",
  "allowed_genres": ["玄幻", "都市", "科幻"]
}
```

## Common Status Values

- `downloaded`: file was downloaded and written to the local archive.
- `dry_run`: validation passed without writing files.
- `exists`: the book already exists locally.
- `full`: the archive size limit has been reached and crawling stops.
- `category_filtered`: the book does not match the category policy.
- `source_not_configured`: no usable download source is enabled.
- `not_found`: no exact match was found in enabled sources.
- `skipped`: skipped by completion or metadata rules.

## Development

Run unit tests:

```powershell
.\.venv\Scripts\python.exe -m unittest discover -v
```

Run compile checks:

```powershell
.\.venv\Scripts\python.exe -m compileall novel_archiver launcher.py
```

Rebuild the Windows launcher:

```powershell
.\.venv\Scripts\python.exe -m PyInstaller --noconfirm NovelArchiveLauncher.spec
Copy-Item dist\NovelArchiveLauncher.exe NovelArchiveLauncher.exe -Force
```

## License and Responsibility

This project is a local archiving automation framework. Users are responsible for verifying source authorization, copyright status, site terms, and the legality of their own download behavior.
