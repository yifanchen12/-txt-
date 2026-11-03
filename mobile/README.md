# 拾页前端与应用构建

[下载正式构建](https://github.com/yifanchen12/shiye/releases/latest) · [使用说明](../README.md)

同一套 Vanilla JS 界面运行于网页、Capacitor 手机应用及 Electron Windows 程序。原生应用直接连接书源；网页开发服务通过受限的同源接口处理跨域请求。

## 本地开发

```sh
cd mobile
npm ci
npm run dev
```

开发服务默认只监听 `127.0.0.1:5178`。

```sh
npm test
npm run build
npm run desktop
npm run package:windows
```

Windows 输出为 `desktop-out/拾页-win32-x64/拾页.exe`。书库使用稳定的 `shiye://library/` 来源和 `%APPDATA%\ShiyeReader` 目录，更新程序时保留数据。

## 模块

- `src/main.js` / `src/style.css` / `src/shell.css`：书城、分类、搜索、书架和设置。
- `src/discovery.js`：真实书目分页、频道题材匹配和去重。
- `src/verified-feed.js`：候选书并发核验，正文检查通过才追加到推荐，取消后停止追加。
- `src/loading.js`：搜索、查源、推荐、下载和阅读打开共用的旋转变形加载组件。
- `scripts/generate-icons.mjs`：从自绘 SVG 生成 PNG 与多尺寸 ICO，每次构建自动执行。
- `src/reader.js` / `src/reader-effects.js`：三种阅读模式，共用字符偏移和阅读设置；仿真纸背效果只作用于卷起的页面。
- `src/catalog.js` / `src/network.js`：榜单、书源匹配、下载和平台网络访问。
- `src/storage.js`：本机书库、正文、设置和缓存。
- `desktop/`：Windows 窗口、隔离请求桥与本地页面协议。
- `scripts/prepare-native.mjs`：生成手机工程后的平台配置。

## 手机构建

```sh
npm run build
npx cap add android
npx cap add ios
node scripts/prepare-native.mjs
```

GitHub Actions 在 Windows、Linux、macOS 分别打包 Windows ZIP、安卓 APK、真实 iPhone 设备构建的未签名 IPA，随后发布 Releases。**未签名 IPA 不能直接安装**；CI 编译成功不等于真机测试成功。iOS 签名材料不进入仓库。

### Mac mini 本地签名和 iPhone 17e 安装

先安装 Xcode 26.0 或更新版本，在 Xcode → Settings → Accounts 中登录 Apple ID。iPhone 连接 Mac、信任电脑，并在系统设置中开启开发者模式。

```sh
cd mobile
npm ci
npm run ios:device -- setup    # 首次录入 Team ID、设备 ID、Bundle ID
npm run ios:device -- install  # 自动构建、开发签名、安装
```

后续拉取代码更新后，执行 `npm run ios:device -- install` 即可。只构建不安装使用 `npm run ios:device -- build`。首次录入的本地参数保存在被 Git 忽略的 `.ios-device.env`；也支持 `APPLE_TEAM_ID`、`IOS_DEVICE_ID`、`IOS_BUNDLE_ID` 环境变量覆盖。脚本支持 Swift Package Manager `.xcodeproj` 和 CocoaPods `.xcworkspace`。

详见 [Mac mini iOS 签名、设备信任、故障排查及四项真机验收](docs/ios-device-install.md)。

联网检查：

```sh
node scripts/check-direct-sources.mjs
node scripts/check-discovery.mjs
node scripts/check-verified-feed.mjs
```

第二项检查连续三页真实分类书目，要求数量超过 24 且没有重复。报告仅保存状态和元数据，不发布小说正文。

## 参考

推荐和榜单匹配调用 `verifyDownload`：章节源检查完整目录并实取首中末章（各至少 200 字），文件源实取 TXT 并排除 HTML/过短文件；下载入口通过 `recheck: true` 重新解析。检查表明当时抽样可读，完整书籍仍需逐章下载成功。

加载动画参考 [Kazumi 官方 LoadingIndicator](https://github.com/Predidit/Kazumi/blob/main/lib/bean/widget/loading_indicator.dart) 的旋转变形方式，图案与形状为本项目自绘。

界面导航、卡片和抽屉组织参考 [shadcn/ui](https://github.com/shadcn-ui/ui)（MIT），没有引入 React 或 Tailwind。折纸几何使用 StPageFlip 2.0.7（MIT），纸背镜像淡字、虚化与三种模式衔接由本项目实现。
