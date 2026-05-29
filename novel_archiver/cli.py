from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .config import load_config
from .server import run_server
from .service import NovelArchiverService


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Authorized novel archiver")
    parser.add_argument("--config", default="config.toml", help="Path to config TOML")
    parser.add_argument("--dry-run", action="store_true", help="Do not write files")
    parser.add_argument("--limit", type=int, default=None, help="Limit total candidates")
    parser.add_argument("--serve", action="store_true", help="Start local search/download server")
    parser.add_argument("--host", default=None, help="Server host override")
    parser.add_argument("--port", type=int, default=None, help="Server port override")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    if args.serve:
        run_server(Path(args.config), host=args.host, port=args.port)
        return 0

    config = load_config(Path(args.config))
    service = NovelArchiverService(config)

    print(f"归档目录: {service.store.root}")
    print(f"容量上限: {config.archive.max_bytes / 1024 / 1024 / 1024:.2f} GB")
    print("模式:", "试跑，不写入文件" if args.dry_run else "正式下载")
    summary = service.crawl_rankings(dry_run=args.dry_run, limit=args.limit)
    print(
        f"\n完成：扫描 {summary['scanned']} 本，"
        f"下载 {summary['downloaded']} 本，跳过 {summary['skipped']} 本。"
    )
    return 0
