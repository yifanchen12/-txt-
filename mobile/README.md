# 拾页：手机与 Windows 本地小说阅读器

[下载 APK / IPA / Windows 程序](https://github.com/yifanchen12/-txt-/releases/latest)

应用内置前端和公开书源规则，手机通过原生 HTTP 直接连接书源，不需要安装 Clash 或配置代理。联网搜索、下载、本地阅读均不要求电脑开机，也不要求连接电脑上的 Python 服务。

## 安装

- **Windows 电脑**：下载 `shiye-windows-x64.zip`，右键“全部解压”，打开解压后的文件夹，双击 `拾页.exe`。整个文件夹都要保留。程序自带运行环境，不用安装 Node、Python 或代理软件，也不用启动本地网页服务器。书库保存在当前 Windows 用户的 `%APPDATA%\ShiyeReader`；更换程序文件夹不会清空书库。适用于 Windows 10 / 11 x64。
- **安卓**：下载 `shiye-android.apk`，允许该浏览器安装应用后打开。当前为使用自动生成调试签名的预览版，不同构建之间可能需要先备份书库再卸载旧版安装。
- **iPhone / iPad**：下载 `shiye-ios-unsigned.ipa`。这是为真实 iOS 设备编译的**未签名 IPA**，需要用户使用自己的有效签名方式签名后安装。Safari 下载文件不等于完成安装。文件名、发行说明均明确标注未签名状态；无 App Store 流程。
- 手机最低系统版本以当前 Capacitor 原生工程要求为准：本版本生成的 iOS 工程以 iOS 15 为目标；安卓要求 Android 7 / API 24 或更新。浏览器组件及系统过旧时请先更新系统 WebView。

## 使用

首页展示起点畅销榜、番茄阅读榜和晋江总分榜的分区。可下载榜只显示已匹配书名、作者、完本状态和正文入口的作品，保留官方原始名次；页面同时显示更新日期和来源失败情况。匹配到入口仍可能因站点变化在实际下载时失败，只有完整保存后才显示“已保存”。

下方推荐展示官方榜单书目和当前搜索结果。封面来自同作品的官方详情页或下载源；暂时取不到原作封面时，使用明确标注的书名占位封面，不用其他小说的图片冒充。

搜索输入完整书名，结果逐源出现。书名与作者共同用于匹配，避免下载同名的其他作品。当前源的检索规则主要针对书名；不支持把只输入作者名当作可靠的作者全作品检索。

打开书籍详情，点击“下载并保存到本机”。正文全部下载成功后加入本地书架，失败或取消不把缺章内容当成完整书籍入库。章节下载支持分页，保留中止与重试操作；重试会重新获取正文。

本地书架支持：

- 导入 UTF-8、GB18030、UTF-16 TXT，自动识别章节；
- 完全离线阅读、目录跳转、阅读位置恢复；
- 14–34 号字体、行距、宋体/黑体、默认/浅蓝/浅黄/米色/浅绿/深夜背景（颜色参考当前起点公开阅读页的六套主题）；
- 随手势折页、纸张背面与阴影的仿真翻页，也可改为直接翻页；
- TXT 导出以及整个书库的 JSON 备份和恢复。

正文、封面和进度存储在当前应用或浏览器的本机数据库中，不自动同步到其他设备。卸载应用或清理浏览器数据前，请先备份。单本 TXT 导入限制 80 MB。

## 书源与隐私

`src/default-sources.json` 由现有个人配置的公开字段白名单导出，保留新增的已授权书源规则，不包含 Cookie、账号密码、私钥、Token 或个人磁盘路径。个人 `config.toml` 不覆盖、不提交。

手机原生 HTTP 不受浏览器 CORS 限制，但不会绕过站点登录、付费、验证码或其他访问限制。不提供付费网盘解析。仅使用你有权下载与保存的作品。

书源可能出现连接失败、反爬拦截、封面过期或网页结构变化。界面如实显示失败或占位，不生成虚构排行榜。HTTPS 保持证书验证；仅为原配置中 HTTP-only 的 `kenshuzw.la` 添加单域名 HTTP 例外。

## 本地开发与网页运行

```sh
cd mobile
npm ci
npm test
npm run dev
```

开发服务器仅监听本机，提供限制到公开配置域名的 `/api/fetch` 代理。网页浏览器的联网搜索需要该配套代理；纯静态托管只能保证本地书库阅读，不能冒充拥有任意跨域下载能力。原生手机应用不使用此代理。

```sh
npm run build
npx cap add android
npx cap add ios
node scripts/prepare-native.mjs
```

`cloud/worker.js` 和 `wrangler.jsonc` 提供可选的独立云端网页运行入口，不依赖个人电脑；部署需要拥有相应云账号，源码交付不等于已部署。

## 安装包构建

Windows 使用 Electron 封装同一书城与阅读器：`npm run package:windows`，输出 `desktop-out/拾页-win32-x64/拾页.exe`。窗口加载本机页面，通过隔离的请求桥和现有书源白名单直接读取内容；不打开系统端口、不依赖 Python 或 Vite。`--smoke-test` 会验证页面加载及书源直连，结果仅为状态元数据。

仓库 `.github/workflows/mobile-release.yml` 在 GitHub 的 Linux 与 macOS 环境中编译。前端测试、安卓 APK 和 iOS device build 均成功后，才发布 GitHub Release。

- Android：`npx cap add android`，`node scripts/prepare-native.mjs`，`./gradlew assembleDebug`。
- iOS：`npx cap add ios`，`node scripts/prepare-native.mjs`，Xcode `generic/platform=iOS` + `CODE_SIGNING_ALLOWED=NO`；把实际生成的 `App.app` 放入 `Payload/` 后压缩成 IPA。不是把网页 ZIP 重命名为 IPA。
- `sha256sum` 校验文件随安装包发布。
- Xcode 和 Android 原生目录在 CI 中从锁定依赖生成，不提交机器路径或签名材料。

构建成功、安装包存在、手机安装和真机联网下载分别验证，互不替代。当前机器是 Windows，iOS 原生编译依赖 GitHub macOS 构建结果。

## 第三方许可

原项目为 MIT。Capacitor 与 StPageFlip 使用 MIT 许可；依赖许可随源代码和依赖包提供。页面书封版权归各作品权利人及来源方，应用不宣称拥有。

## 连接验证

GitHub 构建额外使用没有 Clash 的干净 Linux 环境执行 `node scripts/check-direct-sources.mjs`，实际检索书名并读取首尾章节。该检查通过后才发布安装包。来源可达性仍会受当地网络及源站状态影响，不能把一次测试当作所有运营商和地区均可访问的保证。

搜索页区分“没有匹配书目”和“下载源连接失败”，并可展开每个失败源的原因。起点榜单支持页面实际返回的 `pageContext` 外层。缺失或失效封面统一使用书名、作者的蓝灰占位书封。

起点官网未返回榜单数据时，使用此前真实抓取的官方榜单记录，并显示原始时间和‘缓存’。下载入口仍现场核对；这份记录不标为实时榜单。

长篇某章读取失败时，会尝试从已启用的其他来源补读同书、同作者、唯一同名章节；匹配不到或全部失败则报错，整本成功后才加入书库。保存书目会记录实际使用的来源。
