<div align="center">

# 拾页 · Shiye

找一本想读的书，留在自己的书架里。

[下载安装](https://github.com/yifanchen12/shiye/releases/latest) · [使用说明](#怎么用) · [源码构建](mobile/README.md)

</div>

拾页是一个小说书城和本地阅读器，支持 Windows、Android 和 iOS。按分类发现新书，搜索书名，下载到当前设备后继续阅读。应用自带界面，联网时直接连接书源，不需要另外安装 Python、Node 或代理软件。

## 下载与安装

| 设备 | 下载 | 打开方式 |
| --- | --- | --- |
| Windows 10 / 11（64 位） | [Windows 程序](https://github.com/yifanchen12/shiye/releases/latest/download/shiye-windows-x64.zip) | 右键“全部解压”，打开文件夹，双击 `拾页.exe`。旁边的文件也要保留。 |
| Android | [APK](https://github.com/yifanchen12/shiye/releases/latest/download/shiye-android.apk) | 下载后安装，按系统提示允许浏览器安装应用。 |
| iPhone / iPad | [未签名 IPA](https://github.com/yifanchen12/shiye/releases/latest/download/shiye-ios-unsigned.ipa) | Safari 下载到“文件”，用自己的有效签名方式签名后安装。 |

**iPhone 下载 IPA 不等于安装完成。** 当前提供的是未签名包，不走 App Store，需要自行签名。签名安装完成后，搜索、下载和阅读不依赖电脑。

安卓目前使用预览签名。更新前先在书架备份；如果系统提示签名不一致，备份后再卸载旧版安装。

## 怎么用

### 找书

- **分类**：在推荐区上方选择“全部／男频／女频”，再选择题材。男频包括玄幻、仙侠武侠、都市、历史、科幻、游戏、悬疑；女频包括言情、现代言情、古代言情、幻想言情、青春校园和纯爱。
- **热榜**：起点、番茄、晋江分开显示，保留官方名次。官网临时无法读取时，已有的官方记录会标明“缓存”和原始时间。
- **先检验再推荐**：章节源读取目录并实测首、中、末章；TXT 源实际获取文件检查。失败、付费或登录提示不进入推荐，通过一本就展示一本。抽样通过表示当前链路可用，完整下载仍需逐章成功。
- **持续推荐**：向下滑动，自动接着读取后续书目，不停留在前 24 本；重复书目会合并。加载失败时可以重试，到了来源末页会提示。
- **搜索**：输入书名，打开书籍详情，选择“下载并保存到本机”。完整下载后才加入书架。

封面优先使用来源中的真实图片，缺失时显示带书名和作者的蓝灰书封。分类依据来源标签；只标为“言情”的书归入“言情”，不按书名猜成古言或现言。

### 阅读

在本地书架打开一本书，点右上角 **Aa 设置**：

| 翻页方式 | 效果 |
| --- | --- |
| 仿真 | 纸张随手势卷起，纸背文字淡化、镜像并虚化，带折痕和阴影。 |
| 左右滑动 | 整页横向移动，停在下一页。 |
| 上下滑动 | 正文连续纵向滚动，继续衔接后续章节。 |

三种模式共用阅读位置，切换模式、字号或行距后接着读。支持目录、宋体／黑体、六种阅读背景和进度恢复。

### 管理书架

- **导入 TXT**：从设备选择文件，也可以直接粘贴正文。
- **导出**：把一本书导出为 TXT。
- **备份书库**：导出 JSON 备份，在另一台设备中选择“恢复备份”。

正文、封面和进度保存在当前设备。Windows 版使用 `%APPDATA%\ShiyeReader`，更换程序文件夹不会清空书库。换手机、卸载应用或清理数据前，先备份。

## 书源

搜索、查源、加载下一批、下载和打开书籍时，使用同一种旋转变形的书本动画；有实际总量时显示真实进度。

应用使用已启用的书源规则，下载前核对书名和作者。长篇某章读取失败时，会尝试从其他启用来源补读同书、同作者、唯一匹配的章节；全部失败则报错，不把缺章文件显示为下载完成。

不同书源的可用性会变化。书源设置中可以关闭不想使用的来源；分类书目目前由 qb5200 的公开完本目录提供。细分类信息不完整时，可以切回大类继续浏览。

个人 `config.toml` 不提交到仓库，安装包只包含公开的非敏感规则。

## 开发

主要界面和三个平台的构建在 [`mobile/`](mobile/) 中，见[开发说明](mobile/README.md)。原有 Python 归档脚本仍保留在 `novel_archiver/`，配置示例见 [`config.example.toml`](config.example.toml)。

## 参考与许可

加载动效参考 [Kazumi 官方 LoadingIndicator](https://github.com/Predidit/Kazumi/blob/main/lib/bean/widget/loading_indicator.dart) 的旋转变形方式，书本和形状为拾页自绘。

界面布局参考 [shadcn/ui](https://github.com/shadcn-ui/ui) 的导航、卡片和抽屉组织方式；仿真折纸几何基于 [StPageFlip](https://github.com/Nodlik/StPageFlip)。手机容器使用 [Capacitor](https://github.com/ionic-team/capacitor)，Windows 容器使用 [Electron](https://github.com/electron/electron)。

本项目采用 [MIT License](LICENSE)。封面与书籍内容的权利归相应权利人，请只保存你有权使用的内容。
