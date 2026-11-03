#!/usr/bin/env python3
"""Paywall probe / bypass attempt tool for chapter-based novel platforms.

Techniques implemented (in order):
  1. Search-engine UA spoofing (Baiduspider / Googlebot / Bingbot / Sogou) — SEO cloaking test.
  2. Qidian `acw_sc__v2` JS-challenge solver (unsbox + hexXor) used by qidian.com anti-bot.
  3. Cookie injection (--cookie-file) so a logged-in, already-purchased session can read its chapters.
  4. Paywall marker detection so a run reports whether real text came back.

Usage:
  python tools/paywall_bypass_tool.py URL [URL ...] [--cookie-file secrets/cookies.txt] [--sel "#ChapterContent"]
"""
from __future__ import annotations

import argparse
import re
import sys

import requests

try:
    import urllib3

    urllib3.disable_warnings()
except Exception:  # pragma: no cover
    pass

UAS = {
    "chrome": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
    ),
    "baiduspider": "Mozilla/5.0 (compatible; Baiduspider/2.0; +http://www.baidu.com/search/spider.html)",
    "googlebot": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "bingbot": "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
    "sogou": "Sogou web spider/4.0(+http://www.sogou.com/docs/help/webmasters.htm#07)",
}

PAYWALL_MARKERS = [
    "订阅", "购买本章", "购买", "VIP章节", "火券", "金币", "余额不足",
    "本章未购买", "登录后阅读", "请先登录", "登录查看", "付费",
]

DEFAULT_SELECTORS = [
    "#ChapterContent", "#chaptercontent", "#content", "#booktxt", "#nr1",
    "div.article", "div.read-content", "div.article-content", "div.content",
    "article", "div.text",
]


def load_cookie(cookie_file: str) -> str:
    """Accept either a raw `Cookie:` header line or `name=value; name=value` text."""
    if not cookie_file:
        return ""
    with open(cookie_file, "r", encoding="utf-8") as fh:
        data = fh.read()
    data = " ".join(data.split())
    if data.lower().startswith("cookie:"):
        data = data.split(":", 1)[1].strip()
    return data


def unsbox(arg: str) -> str:
    table = [
        0xF, 0x23, 0x1D, 0x18, 0x21, 0x10, 0x1, 0x26, 0xA, 0x9, 0x13, 0x1F, 0x28,
        0x1B, 0x16, 0x17, 0x19, 0xD, 0x6, 0xB, 0x27, 0x12, 0x14, 0x8, 0xE, 0x15,
        0x20, 0x1A, 0x2, 0x1E, 0x7, 0x4, 0x11, 0x5, 0x3, 0x1C, 0x22, 0x25, 0xC, 0x24,
    ]
    out = []
    for ch in arg:
        try:
            value = int(ch, 16)
        except ValueError:
            continue
        for idx, item in enumerate(table):
            if item == value:
                out.append("%x" % (idx + 1))
                break
    return "".join(out)


def hex_xor(a: str, b: str) -> str:
    return "".join("%x" % (int(x, 16) ^ int(y, 16)) for x, y in zip(a, b))


def solve_acw_sc_v2(html: str) -> str:
    m = re.search(r"arg1\s*=\s*'([0-9A-Fa-f]+)'", html)
    if not m:
        return ""
    key = "3000176000856006061501533003690027800375"
    return hex_xor(unsbox(m.group(1)), key)


def text_from(html: str, selector: str) -> str:
    try:
        from bs4 import BeautifulSoup
    except Exception:  # pragma: no cover
        return re.sub(r"<[^>]+>", " ", html)
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup.find_all(["script", "style"]):
        tag.decompose()
    sels = [selector] if selector else DEFAULT_SELECTORS
    for sel in sels:
        try:
            node = soup.select_one(sel)
        except Exception:
            continue
        if node is not None:
            text = node.get_text("\n", strip=True)
            if len(text) > 50:
                return text
    return soup.get_text("\n", strip=True)


def probe(url: str, cookie: str, selector: str) -> None:
    print(f"\n=== {url}", flush=True)
    for name, ua in UAS.items():
        session = requests.Session()
        headers = {"User-Agent": ua, "Accept-Language": "zh-CN,zh;q=0.9",
                   "Accept-Encoding": "identity"}
        if cookie:
            headers["Cookie"] = cookie
        try:
            resp = session.get(url, headers=headers, timeout=30, verify=False)
        except Exception as exc:  # noqa: BLE001
            print(f"  {name:12} ERR {type(exc).__name__}: {str(exc)[:60]}", flush=True)
            continue
        resp.encoding = resp.apparent_encoding or "utf-8"
        html = resp.text
        if "acw_sc__v2" in html or "arg1" in html:
            solved = solve_acw_sc_v2(html)
            if solved:
                session.cookies.set("acw_sc__v2", solved, domain=".qidian.com")
                try:
                    resp = session.get(url, headers=headers, timeout=30, verify=False)
                    resp.encoding = resp.apparent_encoding or "utf-8"
                    html = resp.text
                except Exception:
                    pass
        text = text_from(html, selector)
        markers = sorted({m for m in PAYWALL_MARKERS if m in html})
        print(
            f"  {name:12} status={resp.status_code} html={len(html):7} text={len(text):6} "
            f"markers={markers[:4]}",
            flush=True,
        )
        if len(text) > 800 and not markers:
            print(f"      VERDICT: 可能拿到正文, 开头: {text[:80]!r}", flush=True)
        else:
            print(f"      VERDICT: 未拿到正文, 文本开头: {text[:80]!r}", flush=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="paywall probe / bypass attempt")
    parser.add_argument("urls", nargs="+", help="chapter URLs to probe")
    parser.add_argument("--cookie-file", default="", help="cookie file (Cookie: ... or name=value;...)")
    parser.add_argument("--sel", default="", help="CSS selector for the chapter body")
    args = parser.parse_args()
    cookie = load_cookie(args.cookie_file)
    if cookie:
        print("cookie loaded:", cookie[:40] + ("..." if len(cookie) > 40 else ""), flush=True)
    for url in args.urls:
        probe(url, cookie, args.sel)
    return 0


if __name__ == "__main__":
    sys.exit(main())
