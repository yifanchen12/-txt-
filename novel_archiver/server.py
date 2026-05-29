from __future__ import annotations

import html
import json
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from .config import CATEGORY_PRESET_LABELS
from .service import NovelArchiverService


class NovelRequestHandler(BaseHTTPRequestHandler):
    service: NovelArchiverService

    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        query = urllib.parse.parse_qs(parsed.query)
        if parsed.path == "/":
            self._send_html(self._home_page())
            return
        if parsed.path == "/api/search":
            title = first(query, "title") or first(query, "q")
            author = first(query, "author")
            matches = self.service.search_local(title, author) if title else []
            self._send_json({"found": bool(matches), "items": matches})
            return
        if parsed.path == "/api/ensure":
            title = first(query, "title") or first(query, "q")
            author = first(query, "author")
            genre = first(query, "genre")
            if not title:
                self._send_json({"status": "error", "message": "Missing title."}, status=400)
                return
            try:
                result = self.service.ensure_book(title, author, genre)
            except Exception as exc:
                self._send_json({"status": "error", "message": str(exc)})
                return
            self._send_json(result.to_dict())
            return
        if parsed.path == "/ensure":
            title = first(query, "title") or first(query, "q")
            author = first(query, "author")
            genre = first(query, "genre")
            if not title:
                self._send_html(self._home_page("Please enter a title."))
                return
            try:
                result = self.service.ensure_book(title, author, genre)
            except Exception as exc:
                result = {"status": "error", "message": str(exc)}
                self._send_html(self._result_page(result))
                return
            self._send_html(self._result_page(result.to_dict()))
            return
        if parsed.path == "/api/status":
            self._send_json(
                {
                    "archive_root": str(self.service.store.root),
                    "used_bytes": self.service.store.used_bytes(),
                    "max_bytes": self.service.config.archive.max_bytes,
                    "settings": self.service.settings_to_dict(),
                }
            )
            return
        if parsed.path == "/api/settings":
            self._send_json(self.service.settings_to_dict())
            return
        self._send_json({"status": "error", "message": "Not found."}, status=404)

    def do_POST(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/settings":
            data = self._read_form_payload()
            try:
                settings = self.service.update_user_settings(
                    archive_root=first(data, "archive_root"),
                    max_bytes=first(data, "max_bytes"),
                    category_preset=first(data, "category_preset"),
                    allowed_genres=first(data, "allowed_genres"),
                )
            except Exception as exc:
                self._send_html(self._home_page(f"设置保存失败：{exc}"), status=400)
                return
            self._send_html(self._home_page(f"设置已保存：{settings['archive_root']} / {settings['max_size']}"))
            return
        if parsed.path == "/api/settings":
            try:
                data = self._read_json_payload()
            except ValueError as exc:
                self._send_json({"status": "error", "message": str(exc)}, status=400)
                return
            try:
                settings = self.service.update_user_settings(
                    archive_root=str(data.get("archive_root") or data.get("root") or "").strip(),
                    max_bytes=str(data.get("max_bytes") or data.get("max_size") or "").strip(),
                    category_preset=str(data.get("category_preset") or "").strip(),
                    allowed_genres=data.get("allowed_genres") or "",
                )
                self._send_json({"status": "ok", "settings": settings})
            except Exception as exc:
                self._send_json({"status": "error", "message": str(exc)}, status=400)
            return
        if parsed.path != "/api/ensure":
            self._send_json({"status": "error", "message": "Not found."}, status=404)
            return
        try:
            data = self._read_json_payload()
        except ValueError as exc:
            self._send_json({"status": "error", "message": str(exc)}, status=400)
            return
        title = str(data.get("title") or data.get("q") or "").strip()
        if not title:
            self._send_json({"status": "error", "message": "Missing title."}, status=400)
            return
        try:
            result = self.service.ensure_book(
                title=title,
                author=str(data.get("author") or "").strip(),
                genre=str(data.get("genre") or "").strip(),
            )
            self._send_json(result.to_dict())
        except Exception as exc:
            self._send_json({"status": "error", "message": str(exc)})

    def log_message(self, format: str, *args: Any) -> None:
        print("%s - %s" % (self.address_string(), format % args))

    def _send_json(self, payload: dict[str, Any], status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_html(self, body: str, status: int = 200) -> None:
        data = body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _read_body(self) -> str:
        length = int(self.headers.get("Content-Length", "0") or "0")
        return self.rfile.read(length).decode("utf-8") if length else ""

    def _read_json_payload(self) -> dict[str, Any]:
        payload = self._read_body() or "{}"
        try:
            data = json.loads(payload)
        except json.JSONDecodeError as exc:
            raise ValueError("Invalid JSON.") from exc
        if not isinstance(data, dict):
            raise ValueError("JSON payload must be an object.")
        return data

    def _read_form_payload(self) -> dict[str, list[str]]:
        return urllib.parse.parse_qs(self._read_body(), keep_blank_values=True)

    def _home_page(self, message: str = "") -> str:
        msg = f"<p class='msg'>{html.escape(message)}</p>" if message else ""
        settings = self.service.settings_to_dict()
        category_options = "\n".join(
            "<option value='{value}'{selected}>{label}</option>".format(
                value=html.escape(value),
                label=html.escape(label),
                selected=" selected" if value == settings["category_preset"] else "",
            )
            for value, label in CATEGORY_PRESET_LABELS.items()
        )
        allowed_genres = "，".join(settings["allowed_genres"])
        return f"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>小说归档助手</title>
  <style>
    body {{ font-family: system-ui, sans-serif; margin: 32px; max-width: 820px; color:#202124; }}
    h1 {{ margin-bottom: 8px; }}
    h2 {{ margin: 26px 0 10px; font-size: 20px; }}
    label {{ display:block; margin: 14px 0 6px; }}
    input, select {{ width:100%; box-sizing:border-box; padding:10px; font-size:16px; }}
    button {{ margin-top:16px; padding:10px 16px; font-size:16px; cursor:pointer; }}
    .msg {{ color:#a33; }}
    code {{ background:#f3f3f3; padding:2px 5px; }}
    .meta {{ color:#5f6368; line-height:1.6; }}
  </style>
</head>
<body>
  <h1>小说归档助手</h1>
  <p class="meta">当前存储位置：<code>{html.escape(settings["archive_root"])}</code><br>
  容量上限：<code>{html.escape(settings["max_size"])}</code>，
  入库范围：<code>{html.escape(settings["category_label"])}</code></p>
  {msg}
  <h2>存储与分类设置</h2>
  <form action="/settings" method="post">
    <label>存储位置</label>
    <input name="archive_root" value="{html.escape(settings["archive_root"])}" required>
    <label>存储空间大小</label>
    <input name="max_bytes" value="{html.escape(settings["max_size"])}" required>
    <label>入库范围</label>
    <select name="category_preset">{category_options}</select>
    <label>自定义分类，选择“自定义分类”时生效，可用逗号分隔</label>
    <input name="allowed_genres" value="{html.escape(allowed_genres)}" placeholder="玄幻，都市，科幻">
    <button type="submit">保存设置</button>
  </form>
  <h2>检索/自动下载</h2>
  <form action="/ensure" method="get">
    <label>书名</label>
    <input name="title" required autofocus>
    <label>作者，可选</label>
    <input name="author">
    <label>分类，可选</label>
    <input name="genre" placeholder="玄幻">
    <button type="submit">检索，缺失则自动下载</button>
  </form>
  <p>JSON API: <code>/api/search?title=...</code>、<code>/api/ensure?title=...</code>、<code>/api/settings</code></p>
</body>
</html>"""

    def _result_page(self, result: dict[str, Any]) -> str:
        escaped = html.escape(json.dumps(result, ensure_ascii=False, indent=2))
        return f"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Novel Archive Result</title>
  <style>
    body {{ font-family: system-ui, sans-serif; margin: 32px; max-width: 900px; }}
    pre {{ white-space: pre-wrap; background:#f6f6f6; padding:16px; }}
    a {{ display:inline-block; margin-bottom:18px; }}
  </style>
</head>
<body>
  <a href="/">Back</a>
  <h1>Result</h1>
  <pre>{escaped}</pre>
</body>
</html>"""


def first(query: dict[str, list[str]], key: str) -> str:
    values = query.get(key, [])
    return values[0].strip() if values else ""


def build_httpd(
    service: NovelArchiverService,
    host: str | None = None,
    port: int | None = None,
) -> ThreadingHTTPServer:
    bind_host = host or service.config.server.host
    bind_port = port or service.config.server.port
    class Handler(NovelRequestHandler):
        pass

    Handler.service = service
    return ThreadingHTTPServer((bind_host, bind_port), Handler)


def run_server(config_path: Path, host: str | None = None, port: int | None = None) -> None:
    service = NovelArchiverService.from_config_path(config_path)
    bind_host = host or service.config.server.host
    bind_port = port or service.config.server.port
    httpd = build_httpd(service, bind_host, bind_port)
    print(f"Novel archive server running at http://{bind_host}:{bind_port}/")
    httpd.serve_forever()
