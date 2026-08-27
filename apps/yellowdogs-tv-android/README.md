# 黄狗TV 安卓端框架

这是与现有黄狗TV保持同一视觉体系的 Android 客户端。当前开发版本为 `mobile0.6`，固定连接 `https://yellowdogsleague.online`。

目前包含：

- 球队账号登录
- 黄狗联赛直播列表和直播预告
- 球队完整日程、历史战绩和与网页端一致的重点比赛事件
- 联赛排名、冠军杯小组赛排名和淘汰赛对阵
- 直播比分、双方球场站位、事件流和技术统计
- 预测V9胜平负、总进球、红黄牌和半全场四类玩法
- 我的预测记录和预测收益排行榜
- YOOGLE 全服球员搜索、球员卡与 26 项能力值详情（按需加载目录）
- 我的账号、手动刷新和退出
- Android 左右边缘返回手势（按应用内页面层级返回）
- 每日重置后自动刷新当天比赛、直播和预测记录
- 黄狗TV正式品牌图标和启动页

## Windows 浏览器预览

先启动现有游戏开发服务器：

```powershell
cd D:\Project\game_test\.worktrees\s4
npm run devtool
```

再开一个 PowerShell：

```powershell
cd D:\Project\game_test\.worktrees\s4\apps\yellowdogs-tv-android
npm run dev
```

打开 `http://127.0.0.1:4320`。开发预览服务器会把 `/api` 请求代理到 `http://127.0.0.1:4310`。

如果游戏服务器不在默认端口：

```powershell
$env:YDTV_API_TARGET='http://127.0.0.1:你的端口'
npm run dev
```

## Android Studio 模拟器/真机

安装 Android Studio（包含 Android SDK、模拟器和 JDK）后执行：

```powershell
cd D:\Project\game_test\.worktrees\s4\apps\yellowdogs-tv-android
npm install
npm run android
```

Android Studio 打开后，可选择模拟器运行，也可以在安卓手机启用“开发者选项/USB调试”后通过数据线运行。

安装好 Android SDK 后，也可以直接在 PowerShell 构建调试 APK：

```powershell
npm run android:debug
```

APK 输出位置为 `android\app\build\outputs\apk\debug\app-debug.apk`。

朋友分发版固定连接正式服务器，无需填写服务器地址。Windows 浏览器开发预览仍可通过本地代理连接 `http://127.0.0.1:4310`。

## 当前框架限制

- 账号凭证暂存于 WebView 本地存储，正式发布前应改为 Android Keystore。
- 直播目前沿用轮询；正式版建议新增 SSE 增量直播接口。
- 直播目前使用高频轮询，后续可改成 SSE 增量直播接口以进一步降低流量。
- Android 原生边缘返回仍有已知兼容问题，本版本暂未接入原生返回插件。
