# macOS / Xcode iPhone 真机安装

本流程在 Mac mini 本地执行；GitHub Actions 发布的 `shiye-ios-unsigned.ipa` **没有开发签名，不能直接安装**。CI 编译成功不代表真机安装、联网或阅读功能通过。

## 首次准备

1. 安装完整版 Xcode，打开一次并接受许可；必要时运行 `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`，检查 `xcodebuild -version`。
2. Xcode → Settings → Accounts 登录 Apple ID。在团队详情中确认 10 位 Team ID。免费 Personal Team 可以尝试开发签名，但设备数、证书和有效期存在限制；自动签名可能要求在 Xcode 中确认。
3. 用数据线连接 iPhone，解锁并选择“信任此电脑”。在 iPhone 的“设置 → 隐私与安全性 → 开发者模式”开启并按提示重启、确认。部分系统须先连接 Xcode 才显示该选项。
4. 在 Mac mini 执行：
   
   ```bash
   git clone https://github.com/yifanchen12/shiye.git
   cd shiye/mobile
   npm ci
   xcrun devicectl list devices
   export APPLE_TEAM_ID=XXXXXXXXXX
   export IOS_DEVICE_ID='设备 UDID'
   npm run ios:device -- install
   ```

   将 Team ID 和设备 UDID 替换成自己的真实值。不要提交 Apple 账号密码、私钥、证书或 Provisioning Profile。若 Bundle ID 在团队中冲突，可指定 `export IOS_BUNDLE_ID=你的反向域名标识`，之后保持不变，否则系统会视作另一款 App，书库数据不会自动迁移。

## 后续使用

每次更新代码后，在 `mobile/` 目录运行 `npm run ios:device -- install`。脚本执行 Web 构建、创建或同步 iOS 工程、应用原生配置、自动签名构建并安装到指定设备。仅构建用 `npm run ios:device -- build`。首次若 Xcode 要求选择团队或处理签名，请打开 `mobile/ios/App/App.xcworkspace`，选中 App Target → Signing & Capabilities，开启 Automatically manage signing 并选择相同 Team，然后重试脚本。不要打开 `.xcodeproj` 替代 workspace。

## 常见故障

- `xcodebuild: command not found`：安装完整版 Xcode 并修正 `xcode-select`。
- `No profiles`、`requires a development team`、`Signing certificate`：检查 Team ID、Xcode 登录状态、自动签名、网络及团队权限；免费账号可能需要先在 Xcode 手动确认。
- `Bundle identifier unavailable`：设置团队下唯一的 `IOS_BUNDLE_ID`，后续保持稳定。
- `Unable to find a destination` / `device unavailable`：解锁手机、重新信任电脑、检查数据线、Xcode 的 Devices and Simulators 以及 `xcrun devicectl list devices`。
- 安装失败或打开提示开发者不受信任：确认开发者模式已开启；如系统提示，在“设置 → 通用 → VPN 与设备管理”信任对应开发者。不同 iOS 版本提示可能不同。
- 启动即退出：使用 Xcode Devices and Simulators 或 Console 查看设备日志；核对 Bundle ID、签名与部署目标。
- 网络搜索失败：检查 iPhone 网络、来源站点可访问性及 iOS ATS 策略。现有原生配置仅为特定 HTTP 域名设置例外，不能据此认定所有书源均可用。

## iPhone 17e 最短验收

1. 打开已签名安装的“拾页”，连接 Wi-Fi 或蜂窝网络，输入一部可合法获取的测试作品书名，执行联网搜索，确认返回书目和可用来源。
2. 选择明确授权的来源，下载测试书籍；等待下载完成，确认书籍进入本机书架并可打开全文。不要用仅有搜索结果或首章预览代替下载成功。
3. 打开书籍阅读若干页，记录章节和阅读位置，随后关闭网络（飞行模式并关闭 Wi-Fi），强制退出并重新打开 App，确认正文仍可离线阅读。
4. 在离线状态下继续阅读并退出 App，重新打开，核对章节和阅读位置是否恢复。再恢复网络，复核书架及下载状态。

记录测试日期、iOS 版本、安装方式、书源、书名及四项测试的通过/失败结果。任何一项未在真实 iPhone 上执行，都应标记“未验证”，而不是“通过”。
