# 小说归档助手

[English](README.en.md)

小说归档助手是一个面向个人书库管理的本地归档工具。它可以从用户明确确认有权使用的榜单、书目、网页搜索源和本地目录中检索作品，按分类写入本地书库，并通过容量上限、分类过滤、重复检测、完整性检查和每日下载限额控制入库质量。

> 合规说明：本项目不内置无授权内容，也不鼓励或协助下载无授权内容。请只配置你拥有下载权、备份权、公共版权使用权，或已获得站点/机构授权的来源。用户需要自行确认来源授权、版权状态和站点条款。

## 功能概览

- 自动滚榜：持续扫描已授权榜单，直到达到扫描上限、每日下载上限或本地容量上限。
- 多源下载：支持默认 TXT 下载源、通用 HTML 源、候选书直链/本地文件，以及授权 Z-Library 学术源。
- 本地归档：按分类创建目录，文件名格式为 `书名 - 作者.扩展名`。
- 容量控制：可设置本地书库最大容量，例如 `50GB`、`800MB`。
- 分类过滤：支持全部类别、只存男频、只存女频、自定义分类。
- 学术分类：Z-Library 学术资料会归入 `学术-数学`、`学术-计算机`、`学术-医学` 等目录。
- 完整性保护：TXT 会检查文件大小、章节、结尾信号；PDF/EPUB 等非文本学术文件在授权可信来源下按文件大小和元数据入库。
- 去重记录：使用 manifest 记录已入库书籍，避免重复下载。
- 多入口使用：命令行、本地 Web/API 服务和 Windows 桌面启动器。

## 安装

建议使用 Python 3.11 或更新版本。当前项目已在 Python 3.14 虚拟环境中验证。

```powershell
py -3.14 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
Copy-Item config.example.toml config.toml
```

安装后请编辑 `config.toml`，确认存储路径、容量上限、分类策略和授权来源。

## 快速运行

试跑模式不会写入文件：

```powershell
.\.venv\Scripts\python.exe -m novel_archiver --config config.toml --dry-run
```

正式入库：

```powershell
.\.venv\Scripts\python.exe -m novel_archiver --config config.toml
```

限制本次扫描数量：

```powershell
.\.venv\Scripts\python.exe -m novel_archiver --config config.toml --limit 50
```

启动本地 Web 服务：

```powershell
.\.venv\Scripts\python.exe -m novel_archiver --config config.toml --serve
```

Windows 用户也可以直接双击：

```text
NovelArchiveLauncher.exe
```

启动器会打开本地页面，并根据 `[launcher]` 配置自动开始滚榜入库。窗口顶部可以修改存储位置、容量上限和入库范围；保存后写入 `config.toml`。

## 核心配置

### 归档目录和容量

```toml
[archive]
root = "E:\\xiaoshuo"
max_bytes = "50GB"
manifest_name = ".novel_manifest.json"
```

- `root`：本地书库目录。
- `max_bytes`：最大容量，支持 `B`、`KB`、`MB`、`GB`、`TB`。
- `manifest_name`：去重和下载统计文件名。

### 分类策略

```toml
[filters]
max_books_per_source = 10000
completed_statuses = ["完本", "已完结", "已完成", "completed", "complete", "finished"]
category_preset = "all"
allowed_genres = []
```

`category_preset` 可选值：

- `all`：全部类别。
- `male`：只存男频。
- `female`：只存女频。
- `custom`：只存 `allowed_genres` 中列出的分类。

自定义分类示例：

```toml
category_preset = "custom"
allowed_genres = ["玄幻", "都市", "科幻", "学术-数学"]
```

### 完整性策略

```toml
[completeness]
min_bytes = 102400
min_chapters = 20
require_ending_signal = true
```

默认完本榜源设置了 `trust_completed = true`，会跳过强制 TXT 结尾完本信号检查，但仍会拦截过小文件和明显未完结信号。PDF、EPUB、MOBI 等非文本书籍只有在可信授权源中才会按非文本文件入库。

## Z-Library 授权学术源

项目已提供 `https://z-library.im/` 的授权学术源配置，但默认关闭，不参与自动建库。原因是该类来源通常存在账号下载限制，并且文件多为 PDF/EPUB，不适合和 TXT 小说默认滚榜混在一起自动消耗额度。

首次使用前需要：

1. 在浏览器打开 `https://z-library.im/` 并登录你的已授权账号。
2. 使用浏览器 Cookie 导出工具导出 Netscape 格式 Cookie。
3. 将 Cookie 保存为 `secrets/zlibrary.cookies.txt`。
4. 确认 `secrets/` 已被 `.gitignore` 忽略，不要提交 Cookie。

默认配置如下：

```toml
[[ranking_sources]]
name = "zlibrary_im_academic_daily"
type = "zlibrary_web"
enabled = false
authorized = true
base_url = "https://z-library.im/"
cookie_file = "secrets/zlibrary.cookies.txt"
search_queries = ["高等数学"]
daily_auto_download_limit = 0
default_genre = "学术-综合"
trust_completed = true
academic_only = true

[[download_sources]]
name = "zlibrary_im"
type = "zlibrary_web_search"
enabled = false
authorized = true
base_url = "https://z-library.im/"
cookie_file = "secrets/zlibrary.cookies.txt"
default_genre = "学术-综合"
trust_completed = true
academic_only = true
```

如需让它参与每日建库：

```toml
enabled = true
daily_auto_download_limit = 3
search_queries = ["高等数学", "线性代数", "机器学习"]
```

同时把 `download_sources` 中的 `zlibrary_im.enabled` 改为 `true`。程序会把成功下载数写入 manifest，同一天重复运行不会超过 `daily_auto_download_limit`。学术文件会按主题存入 `学术-数学`、`学术-计算机`、`学术-经济管理` 等目录。

如果只是想在启动器里手动输入 `高等数学` 这类书名并下载，不需要开启 `zlibrary_im_academic_daily`；只需要准备 Cookie，并把 `download_sources` 里的 `zlibrary_im.enabled` 改为 `true`。浏览器已经登录并不代表程序已登录，程序只读取 `cookie_file` 中的登录 Cookie。

离线或更保守的方式是使用 `zlibrary_catalog`：先手动导出你已授权下载的书目 JSON，记录本地文件路径或授权直链，再让程序从本地目录入库。示例见 [samples/zlibrary_config_snippet.example.toml](samples/zlibrary_config_snippet.example.toml)。

## 默认来源

默认模板启用三个小说榜单：

- `10000txt_home_recommend`
- `7shutxt_recommend`
- `txt80_all_books`

这些榜单设置了：

```toml
trust_completed = true
```

这表示程序默认信任它们为完本榜单，提高自动入库效率。每个来源都必须声明授权：

```toml
authorized = true
license_note = "说明该来源为何可被下载，例如公共版权、站点授权或个人备份"
```

未声明授权信息的来源会被跳过。

## API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/search?title=书名&author=作者` | 只检索本地书库 |
| `GET` | `/api/ensure?title=书名&author=作者` | 本地缺失时自动搜索并下载 |
| `POST` | `/api/ensure` | JSON 请求体，字段为 `title`、`author`、`genre` |
| `GET` | `/api/settings` | 读取存储和分类设置 |
| `POST` | `/api/settings` | 写入存储和分类设置 |
| `GET` | `/api/status` | 查看容量、路径和运行状态 |

## 常见状态

- `downloaded`：已成功下载并写入本地书库。
- `dry_run`：试跑通过，未写入文件。
- `exists`：本地已存在该书。
- `full`：容量达到上限，滚榜停止。
- `category_filtered`：不符合分类设置。
- `source_not_configured`：未启用可用下载源。
- `not_found`：已启用来源中未找到精确匹配。
- `skipped`：被完整性、状态或配额规则跳过。

## 开发和测试

```powershell
.\.venv\Scripts\python.exe -m unittest discover -v
.\.venv\Scripts\python.exe -m compileall novel_archiver launcher.py
```

重新打包 Windows 启动器：

```powershell
.\.venv\Scripts\python.exe -m PyInstaller --noconfirm NovelArchiveLauncher.spec
Copy-Item dist\NovelArchiveLauncher.exe NovelArchiveLauncher.exe -Force
```

## 许可和责任

本项目仅提供本地归档自动化框架。用户需要自行确认来源授权、版权状态、站点条款和下载行为合法性，并对自己的配置和使用负责。

本项目采用 MIT License。版权声明见 [LICENSE](LICENSE)。
