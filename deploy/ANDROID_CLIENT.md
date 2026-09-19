# 黄狗风云安卓朋友测试版

正式入口：https://yellowdogsleague.online/versus/ 。Android 8 及以上，横屏（登录页也是横屏）。客户端加载同一个正式游戏，沿用原账号与存档。

## 下载安装

首次可直接把 yellowdogs-android-v2.apk 发给朋友安装。已安装旧版的手机可覆盖安装，保留登录信息；不要卸载再装。

下方发布步骤完成后，下载地址为：
https://yellowdogsleague.online/android/releases/yellowdogs-android-v2.apk

## 服务器发布（admin 用户）

这是独立的安卓发布包，不需要重新安装游戏。脚本只配置安卓下载路径并 reload Nginx，不重启游戏、不导入账号、不修改存档或发放资源。

1. 在服务器准备私有上传目录：

```bash
mkdir -p /home/admin/ydl-android-upload
chmod 700 /home/admin/ydl-android-upload
```

2. 将 yellowdogs-android-release-v2.tar.gz 上传到这个目录；同目录上传包外的 .sha256 校验文件。

```bash
cd /home/admin/ydl-android-upload
sha256sum -c yellowdogs-android-release-v2.tar.gz.sha256
tar -xzf yellowdogs-android-release-v2.tar.gz
cd yellowdogs-android-release
python3 publish-android-release.py --check
sudo python3 publish-android-release.py
```

脚本先校验 APK 和当前 Nginx，保存旧配置到 /var/backups/yellowdogs-android/，再安装 APK、检查并重载 Nginx，最后发布更新信息。失败会尝试恢复旧配置。重复发布相同文件可安全重试；禁止同版本号替换不同 APK、禁止版本倒退。

3. 验收：

```bash
curl -fsS https://yellowdogsleague.online/android/releases/latest.json
curl -I https://yellowdogsleague.online/android/releases/yellowdogs-android-v2.apk
sudo systemctl is-active yellowdogs-rougelite
```

更新 JSON 应显示 versionCode 2、versionName 0.1.1，APK 请求应返回 200，游戏服务应仍为 active。手机右上角 ⋮ → 检查更新，当前版本应提示已经是最新版。

APK 实际目录 /var/lib/yellowdogs-android/releases；Nginx 引用 /etc/nginx/snippets/yellowdogs-android-releases.conf。仍然仅开放 80/443，不新增端口。若代理/CDN设置浏览器挑战，需要允许 /android/releases/ 的普通 HTTPS 下载，否则原生更新请求可能无法通过。

## 自动更新的边界

游戏网页内容随服务器更新；客户端每次冷启动自动检查 APK，回到前台超过 6 小时也会检查，菜单可随时手动检查。发现新版本后弹窗，用户确认后下载，并核对文件大小、SHA256、应用包名、版本和签名，再调用 Android 系统安装。

首次更新可能要求允许“黄狗风云”安装应用，之后仍须在系统安装界面确认。这不是静默安装。更新接口未发布时，自动检查失败不会妨碍游戏，手动检查会提示暂时不可用。

## 后续构建与发布

修改 android-client/client.json，每次发布递增 versionCode，更新 versionName。使用 JDK17 和本机 Android SDK36：

```powershell
python -X utf8 scripts/build-android-client.py --java-home 'C:\Program Files\Java\jdk-17.0.2'
python -X utf8 scripts/package-android-release.py
```

构建与打包产物位于 outputs/android/。后续服务器操作相同，压缩包名按新的版本号变化。旧版 APK 可保留便于已有下载链接继续有效，latest.json 只指向最新版本。

必须私下备份 outputs/android-private/ 的签名密钥和密码；未来更新必须保持同一签名。它们没有放进公开发布包，也不要上传至网页下载目录。丢失密钥后无法制作兼容覆盖安装的新版。

## 验证范围

见同一构建目录的 DEVICE_QA.json、BUILD.json、SIGNATURE.txt。已完成构建、策略校验与真实 USB 手机安装检查。正式服务器发布、跨版本联网下载及系统安装仍需发布更新接口后验收；不要将“已实现”理解为已经在正式服发布。
