# 小说归档助手

[English](README.en.md)

小说归档助手是一个面向个人书库管理的 TXT 小说归档工具。它可以从用户明确确认有权使用的榜单、书目页和下载源中检索完本作品，按分类归档到本地目录，并通过容量上限、分类过滤、重复检测和完整性检查控制入库质量。

> 合规说明：本项目不内置盗版来源，也不鼓励或协助下载无授权内容。请只配置你拥有下载权、备份权、公共版权使用权，或已获得站点授权的来源。

## 功能概览

- 自动滚榜：支持从多个榜单源持续扫描书目，直到达到配置的扫描数量或本地容量上限。
- 多源下载：默认支持 `10000txt`、`7shutxt`、`txt80` 以及可配置的通用 HTML 下载源。
- 本地归档：按小说分类创建目录，文件名格式为 `书名 - 作者.txt`。
- 容量控制：可设置本地书库最大容量，例如 `50GB`、`800MB`。
- 分类过滤：支持全部类别、只存男频、只存女频、自定义分类。
- 完本榜信任策略：默认完本榜可跳过强制完本结尾信号检查，提高滚榜入库率。
- 完整性保护：仍会拦截过小文件，以及结尾含有 `未完待续`、`连载中` 等明显未完结信号的文本。
- 去重记录：使用 manifest 记录已入库书籍，避免重复下载。
- 双入口使用：提供命令行模式、本地 Web 服务和 Windows 桌面启动器。

## 项目结构

```text
novel_archiver/
  archive.py        本地归档、容量检查、manifest 管理
  cli.py            命令行入口
  completeness.py   TXT 完整性检查
  config.py         TOML 配置解析和设置写回
  downloader.py     下载源解析和文件下载
  server.py         本地 Web/API 服务
  service.py        核心业务编排
  sources.py        榜单源解析
launcher.py         Windows 桌面启动器
config.example.toml 默认配置模板
tests/              单元测试
```

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

试跑模式不会写入文件，适合先确认来源、过滤条件和下载流程：

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

默认访问地址：

```text
http://127.0.0.1:8765/
```

Windows 用户也可以直接双击：

```text
NovelArchiveLauncher.exe
```

启动器会打开本地页面，并根据 `[launcher]` 配置自动开始滚榜。窗口顶部可以直接修改存储位置、容量上限和入库范围；保存后写入 `config.toml`，由当前启动器启动的服务会立即生效。

## 核心配置

### 归档目录和容量

```toml
[archive]
root = "E:\\xiaoshou"
max_bytes = "50GB"
manifest_name = ".novel_manifest.json"
```

- `root`：本地书库存储目录。
- `max_bytes`：最大容量，支持 `B`、`KB`、`MB`、`GB`、`TB`。
- `manifest_name`：去重记录文件名。

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
allowed_genres = ["玄幻", "都市", "科幻"]
```

### 完整性策略

```toml
[completeness]
min_bytes = 102400
min_chapters = 20
require_ending_signal = true
```

普通来源会综合检查文件大小、章节数、最后章节标题和结尾完本信号。默认完本榜来源设置了 `trust_completed = true`，因此会跳过章节数、最后章节标题和“必须出现完本字样”的要求，但仍会检查文件大小和明显未完结信号。

### 启动器行为

```toml
[launcher]
open_browser = true
auto_crawl_on_start = true
```

- `open_browser`：启动桌面程序时自动打开本地页面。
- `auto_crawl_on_start`：启动后自动滚榜入库。

## 默认来源

默认模板启用了三个书目榜单：

- `10000txt_home_recommend`
- `7shutxt_recommend`
- `txt80_all_books`

这些榜单均设置：

```toml
trust_completed = true
```

这表示程序默认信任它们为完本榜单，以提高自动入库效率。如果你希望更严格地检查 TXT 内容，可以将对应来源的 `trust_completed` 改为 `false`。

每个来源必须声明授权：

```toml
authorized = true
license_note = "说明该来源为什么可被下载，例如公共版权、站点授权或个人备份"
```

未声明授权信息的来源会被跳过。

## API

本地服务提供以下接口：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/search?title=书名&author=作者` | 只检索本地书库 |
| `GET` | `/api/ensure?title=书名&author=作者` | 本地缺失时自动搜索并下载 |
| `POST` | `/api/ensure` | JSON 请求体，字段为 `title`、`author`、`genre` |
| `GET` | `/api/settings` | 读取存储和分类设置 |
| `POST` | `/api/settings` | 写入存储和分类设置 |
| `GET` | `/api/status` | 查看容量、路径和运行状态 |

`POST /api/settings` 示例：

```json
{
  "archive_root": "D:\\novels",
  "max_size": "80GB",
  "category_preset": "custom",
  "allowed_genres": ["玄幻", "都市", "科幻"]
}
```

## 常见状态

- `downloaded`：已成功下载并写入本地书库。
- `dry_run`：试跑通过，未写入文件。
- `exists`：本地已存在该书。
- `full`：容量达到上限，滚榜停止。
- `category_filtered`：不符合分类设置。
- `source_not_configured`：未启用可用下载源。
- `not_found`：已启用来源中未找到精确匹配。
- `skipped`：被完整性或状态规则跳过。

## 开发和测试

运行单元测试：

```powershell
.\.venv\Scripts\python.exe -m unittest discover -v
```

编译检查：

```powershell
.\.venv\Scripts\python.exe -m compileall novel_archiver launcher.py
```

重新打包 Windows 启动器：

```powershell
.\.venv\Scripts\python.exe -m PyInstaller --noconfirm NovelArchiveLauncher.spec
Copy-Item dist\NovelArchiveLauncher.exe NovelArchiveLauncher.exe -Force
```

## 许可和责任

本项目仅提供本地归档自动化框架。用户需要自行确认来源的授权、版权和使用条款，并对配置的来源和下载行为负责。
