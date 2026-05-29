from __future__ import annotations

import json
import queue
import shutil
import socket
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from pathlib import Path
from tkinter import BOTH, END, LEFT, RIGHT, Button, Entry, Frame, Label, StringVar, Tk, Text, filedialog, messagebox
from tkinter.ttk import Combobox, Progressbar

from novel_archiver.config import CATEGORY_PRESET_LABELS, format_size_for_config, load_config, parse_genre_list, save_user_settings
from novel_archiver.server import build_httpd
from novel_archiver.service import NovelArchiverService, format_bytes


CATEGORY_LABEL_TO_VALUE = {label: value for value, label in CATEGORY_PRESET_LABELS.items()}


def app_dir() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


def ensure_config(base: Path) -> Path:
    config = base / "config.toml"
    if config.exists():
        return config
    example = base / "config.example.toml"
    if example.exists():
        shutil.copyfile(example, config)
        return config
    raise FileNotFoundError("Missing config.toml next to the launcher.")


def browser_url(host: str, port: int) -> str:
    display_host = "127.0.0.1" if host in {"", "0.0.0.0", "::"} else host
    return f"http://{display_host}:{port}/"


def port_is_open(host: str, port: int) -> bool:
    check_host = "127.0.0.1" if host in {"", "0.0.0.0", "::"} else host
    try:
        with socket.create_connection((check_host, port), timeout=1.5):
            return True
    except OSError:
        return False


class LauncherApp:
    def __init__(self, root: Tk) -> None:
        self.root = root
        self.base = app_dir()
        self.config_path = ensure_config(self.base)
        self.config = load_config(self.config_path)
        self.host = self.config.server.host
        self.port = self.config.server.port
        self.url = browser_url(self.host, self.port)
        self.messages: queue.Queue[object] = queue.Queue()
        self.server_started_here = False
        self.service: NovelArchiverService | None = None
        self.progress_mode = "determinate"
        self.progress_running = False
        self.progress_lock = threading.Lock()
        self.progress_state: dict[str, float | int | str] = {"time": 0.0, "bytes": -1, "key": ""}
        self.category_var = StringVar(
            value=CATEGORY_PRESET_LABELS.get(self.config.filters.category_preset, "全部类别")
        )

        self.root.title("小说归档启动器")
        self.root.geometry("820x720")
        self.root.protocol("WM_DELETE_WINDOW", self.close)
        self.build_ui()
        self.start_server_if_needed()
        if self.config.launcher.open_browser:
            webbrowser.open(self.url)
        if self.server_started_here and self.config.launcher.auto_crawl_on_start:
            self.start_auto_crawl()
        self.poll_messages()

    def build_ui(self) -> None:
        Label(self.root, text="小说归档启动器", font=("Microsoft YaHei UI", 16, "bold")).pack(pady=(14, 4))
        self.status = Label(self.root, text="正在启动...", anchor="w")
        self.status.pack(fill="x", padx=16)

        settings = Frame(self.root)
        settings.pack(fill="x", padx=16, pady=(12, 4))
        Label(settings, text="存储位置").grid(row=0, column=0, sticky="w")
        Label(settings, text="容量上限").grid(row=1, column=0, sticky="w")
        Label(settings, text="入库范围").grid(row=2, column=0, sticky="w")
        Label(settings, text="自定义分类").grid(row=3, column=0, sticky="w")
        self.archive_root_entry = Entry(settings)
        self.archive_root_entry.insert(0, str(self.config.archive.root))
        self.max_bytes_entry = Entry(settings)
        self.max_bytes_entry.insert(0, format_size_for_config(self.config.archive.max_bytes))
        self.category_combo = Combobox(
            settings,
            textvariable=self.category_var,
            values=list(CATEGORY_LABEL_TO_VALUE.keys()),
            state="readonly",
        )
        self.allowed_genres_entry = Entry(settings)
        self.allowed_genres_entry.insert(0, "，".join(self.config.filters.allowed_genres))
        self.archive_root_entry.grid(row=0, column=1, sticky="ew", padx=(8, 0), pady=3)
        Button(settings, text="选择...", command=self.choose_archive_root).grid(row=0, column=2, padx=(8, 0), pady=3)
        self.max_bytes_entry.grid(row=1, column=1, columnspan=2, sticky="ew", padx=(8, 0), pady=3)
        self.category_combo.grid(row=2, column=1, columnspan=2, sticky="ew", padx=(8, 0), pady=3)
        self.allowed_genres_entry.grid(row=3, column=1, columnspan=2, sticky="ew", padx=(8, 0), pady=3)
        Button(settings, text="保存存储/分类设置", command=self.save_settings).grid(
            row=4,
            column=1,
            sticky="w",
            padx=(8, 0),
            pady=(6, 2),
        )
        settings.columnconfigure(1, weight=1)

        form = Frame(self.root)
        form.pack(fill="x", padx=16, pady=12)
        Label(form, text="书名").grid(row=0, column=0, sticky="w")
        Label(form, text="作者").grid(row=1, column=0, sticky="w")
        Label(form, text="分类").grid(row=2, column=0, sticky="w")
        self.title_entry = Entry(form)
        self.author_entry = Entry(form)
        self.genre_entry = Entry(form)
        self.title_entry.grid(row=0, column=1, sticky="ew", padx=(8, 0), pady=4)
        self.author_entry.grid(row=1, column=1, sticky="ew", padx=(8, 0), pady=4)
        self.genre_entry.grid(row=2, column=1, sticky="ew", padx=(8, 0), pady=4)
        form.columnconfigure(1, weight=1)

        actions = Frame(self.root)
        actions.pack(fill="x", padx=16)
        self.ensure_button = Button(actions, text="检索，缺失则自动下载", command=self.ensure_book)
        self.ensure_button.pack(side=LEFT)
        Button(actions, text="打开网页", command=lambda: webbrowser.open(self.url)).pack(side=LEFT, padx=8)
        Button(actions, text="退出", command=self.close).pack(side=RIGHT)

        progress = Frame(self.root)
        progress.pack(fill="x", padx=16, pady=(12, 0))
        self.progress_label = Label(progress, text="下载进度：等待任务", anchor="w")
        self.progress_label.grid(row=0, column=0, sticky="ew")
        self.progress_percent = Label(progress, text="0%", width=10, anchor="e")
        self.progress_percent.grid(row=0, column=1, sticky="e", padx=(8, 0))
        self.progress_bar = Progressbar(progress, orient="horizontal", mode="determinate", maximum=100)
        self.progress_bar.grid(row=1, column=0, columnspan=2, sticky="ew", pady=(4, 0))
        progress.columnconfigure(0, weight=1)

        self.log = Text(self.root, height=18, wrap="word")
        self.log.pack(fill=BOTH, expand=True, padx=16, pady=14)

    def choose_archive_root(self) -> None:
        initial_dir = self.archive_root_entry.get().strip() or str(self.config.archive.root)
        selected = filedialog.askdirectory(initialdir=initial_dir, title="选择小说存储位置")
        if not selected:
            return
        self.archive_root_entry.delete(0, END)
        self.archive_root_entry.insert(0, selected)

    def save_settings(self) -> None:
        archive_root = self.archive_root_entry.get().strip()
        max_bytes = self.max_bytes_entry.get().strip()
        category_preset = CATEGORY_LABEL_TO_VALUE.get(self.category_var.get(), "all")
        allowed_genres = parse_genre_list(self.allowed_genres_entry.get())
        try:
            if self.service is not None:
                settings = self.service.update_user_settings(
                    archive_root=archive_root,
                    max_bytes=max_bytes,
                    category_preset=category_preset,
                    allowed_genres=allowed_genres,
                )
                self.config = self.service.config
                self.write_log(
                    f"设置已保存并立即生效：{settings['archive_root']}，容量 {settings['max_size']}，范围 {settings['category_label']}"
                )
            else:
                self.config = save_user_settings(
                    self.config_path,
                    archive_root=archive_root,
                    max_bytes=max_bytes,
                    category_preset=category_preset,
                    allowed_genres=allowed_genres,
                )
                self.write_log("设置已保存到 config.toml；当前复用已有服务，重启该服务后生效。")
            self.refresh_settings_fields()
        except Exception as exc:
            messagebox.showerror("保存失败", str(exc))

    def refresh_settings_fields(self) -> None:
        self.archive_root_entry.delete(0, END)
        self.archive_root_entry.insert(0, str(self.config.archive.root))
        self.max_bytes_entry.delete(0, END)
        self.max_bytes_entry.insert(0, format_size_for_config(self.config.archive.max_bytes))
        self.category_var.set(CATEGORY_PRESET_LABELS.get(self.config.filters.category_preset, "全部类别"))
        self.allowed_genres_entry.delete(0, END)
        self.allowed_genres_entry.insert(0, "，".join(self.config.filters.allowed_genres))

    def start_server_if_needed(self) -> None:
        if port_is_open(self.host, self.port):
            self.status.config(text=f"服务已在运行：{self.url}")
            self.write_log(f"检测到端口 {self.port} 已有服务，直接复用。")
            return

        self.service = NovelArchiverService(self.config, config_path=self.config_path)
        self.service.progress_callback = self.queue_download_progress
        httpd = build_httpd(self.service, self.host, self.port)
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        self.server_started_here = True
        self.status.config(text=f"服务已启动：{self.url}")
        self.write_log(f"服务已启动：{self.url}")
        self.write_log(f"归档目录：{self.config.archive.root}")
        self.write_log(f"容量上限：{self.config.archive.max_bytes / 1024 / 1024 / 1024:.2f} GB")

    def start_auto_crawl(self) -> None:
        def worker() -> None:
            assert self.service is not None
            self.messages.put("开始自动检索榜单，库里缺失的完本会自动下载。")
            try:
                summary = self.service.crawl_rankings(dry_run=False)
                self.messages.put(
                    "自动检索完成：扫描 {scanned} 本，下载 {downloaded} 本，跳过 {skipped} 本。".format(
                        **summary
                    )
                )
            except Exception as exc:
                self.messages.put(f"自动检索出错：{exc}")

        threading.Thread(target=worker, daemon=True).start()

    def ensure_book(self) -> None:
        title = self.title_entry.get().strip()
        if not title:
            messagebox.showwarning("缺少书名", "请输入书名。")
            return
        payload = {
            "title": title,
            "author": self.author_entry.get().strip(),
            "genre": self.genre_entry.get().strip(),
        }
        self.ensure_button.config(state="disabled")
        self.reset_progress(f"下载进度：正在检索 {title}")
        self.write_log(f"开始检索：{title}")

        def worker() -> None:
            try:
                if self.service is not None:
                    result = self.service.ensure_book(
                        title=payload["title"],
                        author=payload["author"],
                        genre=payload["genre"],
                    ).to_dict()
                    self.queue_result_messages(result)
                    return

                self.messages.put(
                    "当前复用了已经运行的服务，只能显示最终结果；关闭旧服务后重新打开启动器，可显示实时下载进度。"
                )
                data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
                request = urllib.request.Request(
                    urllib.parse.urljoin(self.url, "/api/ensure"),
                    data=data,
                    headers={"Content-Type": "application/json; charset=utf-8"},
                    method="POST",
                )
                with urllib.request.urlopen(request, timeout=180) as response:
                    result = json.loads(response.read().decode("utf-8"))
                self.queue_result_messages(result)
            except urllib.error.URLError as exc:
                self.messages.put(f"请求失败：{exc}")
            except Exception as exc:
                self.messages.put(f"检索失败：{exc}")
            finally:
                self.messages.put("__ENABLE_BUTTON__")

        threading.Thread(target=worker, daemon=True).start()

    def poll_messages(self) -> None:
        while True:
            try:
                message = self.messages.get_nowait()
            except queue.Empty:
                break
            if message == "__ENABLE_BUTTON__":
                self.ensure_button.config(state="normal")
            elif isinstance(message, dict) and message.get("type") == "progress":
                self.update_progress(message)
            else:
                self.write_log(str(message))
        self.root.after(200, self.poll_messages)

    def queue_download_progress(self, book, source_name: str, downloaded: int, total: int | None) -> None:
        key = f"{source_name}\0{book.identity}"
        now = time.monotonic()
        is_done = bool(total and downloaded >= total)
        with self.progress_lock:
            is_new = self.progress_state["key"] != key
            enough_bytes = downloaded - int(self.progress_state["bytes"]) >= 256 * 1024
            enough_time = now - float(self.progress_state["time"]) >= 0.25
            if not (is_new or is_done or enough_bytes or enough_time):
                return
            self.progress_state["key"] = key
            self.progress_state["time"] = now
            self.progress_state["bytes"] = downloaded

        self.messages.put(
            {
                "type": "progress",
                "title": book.display_name,
                "source": source_name,
                "downloaded": downloaded,
                "total": total,
            }
        )

    def queue_result_messages(self, result: dict[str, object]) -> None:
        if result.get("status") == "source_not_configured":
            self.messages.put("本地没有找到这本书，但 config.toml 里还没有启用真实授权下载源。")
            self.messages.put(
                "请把 [[download_sources]] 里 type = \"html_search\" 的来源改成授权站点，并设置 enabled = true。"
            )
        self.messages.put(json.dumps(result, ensure_ascii=False, indent=2))

    def reset_progress(self, text: str = "下载进度：等待任务") -> None:
        if self.progress_running:
            self.progress_bar.stop()
            self.progress_running = False
        self.progress_mode = "determinate"
        self.progress_bar.config(mode="determinate", maximum=100)
        self.progress_bar["value"] = 0
        self.progress_label.config(text=text)
        self.progress_percent.config(text="0%")
        with self.progress_lock:
            self.progress_state = {"time": 0.0, "bytes": -1, "key": ""}

    def update_progress(self, message: dict[str, object]) -> None:
        title = str(message.get("title") or "")
        source = str(message.get("source") or "")
        downloaded = int(message.get("downloaded") or 0)
        total_value = message.get("total")
        total = int(total_value) if isinstance(total_value, int) and total_value > 0 else None

        if total:
            if self.progress_running:
                self.progress_bar.stop()
                self.progress_running = False
            if self.progress_mode != "determinate":
                self.progress_bar.config(mode="determinate", maximum=100)
                self.progress_mode = "determinate"
            percent = min(max(downloaded / total * 100, 0.0), 100.0)
            self.progress_bar["value"] = percent
            self.progress_percent.config(text=f"{percent:0.1f}%")
            self.progress_label.config(
                text=f"下载进度：[{source}] {title}  {format_bytes(downloaded)} / {format_bytes(total)}"
            )
            return

        if self.progress_mode != "indeterminate":
            self.progress_bar.config(mode="indeterminate")
            self.progress_mode = "indeterminate"
            self.progress_bar["value"] = 0
        if not self.progress_running:
            self.progress_bar.start(80)
            self.progress_running = True
        self.progress_percent.config(text="未知大小")
        self.progress_label.config(text=f"下载进度：[{source}] {title}  已下载 {format_bytes(downloaded)}")

    def write_log(self, message: str) -> None:
        self.log.insert(END, message + "\n")
        self.log.see(END)

    def close(self) -> None:
        self.root.destroy()


def main() -> None:
    root = Tk()
    try:
        LauncherApp(root)
    except Exception as exc:
        messagebox.showerror("启动失败", str(exc))
        raise
    root.mainloop()


if __name__ == "__main__":
    main()
