# Shiye · 拾页

[Download for Windows, Android and iOS](https://github.com/yifanchen12/shiye/releases/latest) · [中文说明](README.md)

Shiye combines a novel catalog with a local reader. Discover books by category, browse Qidian / Fanqie / Jinjiang lists, search by title, and save books to the current device.

## Install

- **Windows 10 / 11 x64:** download `shiye-windows-x64.zip`, extract the entire folder, and run `拾页.exe`. Keep the accompanying files.
- **Android:** install `shiye-android.apk`. Back up your library before upgrading preview builds, since their signing certificates may differ.
- **iPhone / iPad:** download `shiye-ios-unsigned.ipa` and sign it using your own valid signing method. Downloading an unsigned IPA in Safari does not install it. No App Store release is required.

The installed applications connect directly to sources. Running the reader does not require a separate computer service, Python, Node, or proxy application.

## Read and discover

- Browse general, male-oriented and female-oriented categories and common genres. Categories use source metadata rather than guesses based on book titles.
- Scroll to append additional real catalog pages; duplicate books are merged. Failed pages can be retried without skipping them.
- Official lists retain their original ranks. Cached lists show their retrieval time.
- Missing covers use a blue-gray title-and-author design.
- Choose **paper curl**, **horizontal page sliding**, or **continuous vertical scrolling**. Reading position is shared across modes.
- Adjust font, size, line spacing and six backgrounds. Resume where you left off.
- Import or export TXT files; back up and restore the library as JSON.

Books enter the local library only after a successful complete download. Failed chapters may be read from another enabled source only when the book, author and chapter match unambiguously.

## Local data

Books and reading progress stay on the current device. On Windows the data directory is `%APPDATA%\ShiyeReader`. Back up before uninstalling or clearing application data. Catalog discovery currently uses the public qb5200 completed-book directory; fine-grained genres depend on the source metadata.

## Build

See [`mobile/README.md`](mobile/README.md). The original Python archiving tools remain in `novel_archiver/`. Personal `config.toml` files and credentials are not included in releases.

## Credits

UI organization references [shadcn/ui](https://github.com/shadcn-ui/ui). Paper-fold geometry uses [StPageFlip](https://github.com/Nodlik/StPageFlip); platform containers use [Capacitor](https://github.com/ionic-team/capacitor) and [Electron](https://github.com/electron/electron).

[MIT License](LICENSE). Book covers and content remain the property of their respective rights holders.
