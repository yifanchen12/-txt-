# 小说归档助手

这是一个合规版小说归档爬虫框架：它可以抓取你配置的公开榜单/书目页面，并且只会从你确认有授权、公共版权或你自己拥有下载权的 TXT 来源下载小说。

它不会内置或协助抓取盗版 TXT 下载站点。你可以把合法来源写进 `config.toml`，程序会自动完成：

- 抓取月票榜、推荐榜等配置的榜单页面
- 只下载完本/已完结作品
- 检测 TXT 是否疑似完整，避免只包含上架前章节的残缺文本
- 按类别归档到 `E:\xiaoshou`
- 文件名格式：`书名 - 作者.txt`
- 归档总大小上限默认 `50GB`
- 可在启动器或网页里直接填写存储位置、容量上限，并选择只入库男频、女频或自定义分类
- 记录 manifest，避免重复下载
- 遵守 `robots.txt`，并带请求间隔

## 安装

建议使用 Python 3.11+。这台机器默认的 `python` 是 3.5，但已经安装了 `py -3.14`，所以建议用下面的命令。

```powershell
py -3.14 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
Copy-Item config.example.toml config.toml
```

编辑 `config.toml`，把你有权使用的榜单源和 TXT 下载源填进去。

## 运行

先试跑，不写入文件：

```powershell
.\.venv\Scripts\python.exe -m novel_archiver --config config.toml --dry-run
```

确认无误后正式下载：

```powershell
.\.venv\Scripts\python.exe -m novel_archiver --config config.toml
```

启动本地检索/自动下载服务：

```powershell
.\.venv\Scripts\python.exe -m novel_archiver --config config.toml --serve
```

也可以直接双击：

```text
NovelArchiveLauncher.exe
```

EXE 会启动一个小窗口、打开网页，并按 `[launcher]` 配置自动检索榜单里本地缺失的完本小说。窗口里的“检索，缺失则自动下载”可以手动输入书名触发下载。

窗口顶部可以直接修改存储位置、容量上限和入库范围。入库范围支持“全部类别”“只存男频”“只存女频”“自定义分类”；选择自定义时，多个分类用逗号分隔，例如 `玄幻，都市，科幻`。保存后会写入 `config.toml`；如果服务由当前启动器启动，设置会立即生效。

默认地址：

```text
http://127.0.0.1:8765/
```

接口：

- `GET /api/search?title=书名&author=作者`：只检索本地库
- `GET /api/ensure?title=书名&author=作者`：本地没有时自动从授权下载源搜索并下载
- `POST /api/ensure`：JSON 请求体，字段为 `title`、`author`、`genre`
- `GET /api/settings`：读取存储与分类设置
- `POST /api/settings`：写入设置，JSON 字段为 `archive_root`、`max_size` 或 `max_bytes`、`category_preset`、`allowed_genres`

如果接口返回 `source_not_configured`，表示本地库没找到，而且 `config.toml` 里还没有启用真实的授权搜索下载源。需要把 `[[download_sources]]` 中 `type = "html_search"` 的来源改成真实授权站点，并设置 `enabled = true`。

已配置的 `10000txt` 来源默认使用精确书名匹配：搜索《斗罗大陆》不会自动下载《斗罗大陆V重生唐三》或同人作品。要允许模糊匹配，可在 `config.toml` 的 `[[download_sources]] name = "10000txt"` 下把 `exact_title = false`。

分类设置也可以直接写在 `config.toml`：

```toml
[filters]
category_preset = "all"  # all / male / female / custom
allowed_genres = []      # category_preset = "custom" 时生效
```

## 来源配置说明

每个来源必须显式设置：

```toml
authorized = true
license_note = "说明为什么这个来源可以被你下载，例如公共版权、站点授权、自己的备份等"
```

如果没有这些字段，程序会跳过来源。

### JSON 书目源

适合你自己维护一份榜单或从授权 API 导出的数据：

```toml
[[ranking_sources]]
name = "my_authorized_catalog"
type = "json_catalog"
enabled = true
authorized = true
license_note = "我拥有这些文本的下载权"
path = "samples/catalog.example.json"
rank_type = "月票榜"
```

### 通用 HTML 榜单源

适合结构比较稳定的授权网站：

```toml
[[ranking_sources]]
name = "official_rank"
type = "html_ranking"
enabled = false
authorized = true
license_note = "官方授权下载页"
rank_type = "推荐榜"
page_url_template = "https://authorized.example/rank/recommend?page={page}"
start_page = 1
end_page = 3
base_url = "https://authorized.example"
book_link_selector = ".rank-list a.book"
title_selector = "h1.book-title"
author_selector = ".book-author"
genre_selector = ".book-genre"
status_selector = ".book-status"
last_chapter_selector = ".last-chapter"
download_link_selector = "a.download-txt"
```

### 授权 TXT 搜索源

当榜单详情页没有直接 TXT 链接时，可以配置一个你有权使用的搜索源：

```toml
[[download_sources]]
name = "authorized_txt_search"
type = "html_search"
enabled = false
authorized = true
license_note = "授权 TXT 下载站"
search_url_template = "https://authorized.example/search?q={title}+{author}"
base_url = "https://authorized.example"
result_link_selector = ".result a.title"
title_selector = "h1"
author_selector = ".author"
status_selector = ".status"
download_link_selector = "a[href$='.txt']"
```

## 完整性检测

程序会综合以下信号判断：

- 元数据状态必须是 `完本`、`已完结`、`completed` 等
- TXT 结尾不能含有 `未完待续`、`连载中`、`持续更新` 等明显未完结信号
- 尽量要求结尾出现 `全书完`、`大结局`、`完结`、`终章`、`尾声`、`完本感言` 等信号
- 自动统计章节数，低于阈值会跳过
- 如果来源提供 `expected_chapters` 或 `last_chapter_title`，会与 TXT 内容比对

完整性检测不是魔法验真，只能降低残缺文本混进归档的概率。对重要来源，最好配置 `expected_chapters` 或最后章节标题。
