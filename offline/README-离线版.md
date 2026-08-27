# YDL S4 Offline（Apple Silicon）

这是仅供朋友间使用的 YDL 单机存档。它不连接线上服务器，也不包含好友对战、计算节点市场或线上运营配置。

## 在 Apple Silicon Mac 上生成 DMG

将整个构建套件复制到 M 系列 Mac，打开“终端”，进入套件目录后执行：

```bash
zsh offline/macos/build-dmg.sh
```

生成物位于 `dist/YDL-S4-Offline-macOS-arm64-v1.0.0.dmg`，同时会生成 SHA-256 校验文件。Windows 无法原生执行 Apple 的 `codesign` 和 `hdiutil`，所以最终 DMG 必须在 Mac 上完成这一步。

## 使用

1. 将 `YDL S4 Offline.app` 拖入“应用程序”。
2. 首次启动请右键应用并选择“打开”。
3. 浏览器会自动打开球队选择页；可选择任意球队进入，其他球队由 AI 接管。
4. 返回球队选择页后，可切换到其他球队并修改其阵容与战术。
5. 本地后台地址：`http://127.0.0.1:4318/admin/`
6. 本地后台密码：`ydl-offline`

游戏数据保存在：

`~/Library/Application Support/YDL S4 Offline/`

备份单机进度时，请退出应用后完整复制该文件夹。删除该文件夹会重置为 DMG 内置的初始存档。

## 说明

- 只监听本机 `127.0.0.1`，局域网其他设备无法访问。
- 内置的是停服归档中最完整的球员运营数据库与球员图片资源。
- 原玩家登录凭据、密码摘要、后台操作历史、纪律记录、计算节点记录和私密服务器配置均未包含。
- 后台 Excel 导入导出和图片转 WebP 所需依赖均已随 Apple Silicon 应用载荷内置。

