# 2026-09-20：联军移动和 Windows 客户端

当前线上已确认 R13。R14 已打包，尚未部署。

R14 六个文件：app.js、index.html、client/map/foreign-unit-controller.js、server/application/map-unit-visibility.mjs、server/http/static-handler.mjs、assets/data/desktop-resources.json。

联军盟友专用行程投影；敌方不获取路线。地图轨迹和通知进度共用 unitTravelProgress/interpolateMapTravel 与服务器时钟。通知 DOM 仅行程变化时重建，计时只更新值；抵达等待服务器确认，再清除轨迹与定时器。陆海空使用相同行程字段。

验证：完整游戏 1320 项通过；联军专项 48 项；浏览器验证 50% 对应中点、空运标签、轨迹去重、滚动保持与抵达清理。一次早期全量出现临时文件 EPERM；对应测试单独复测及最后全量均通过。

Windows 客户端目录 windows-client。独立 package-lock，Electron 44.4.3。安装器约 113 MiB；核心地图约 28.8 MiB。图片按需哈希校验缓存，核心更新原子切换清单，坏文件修复，清理不删登录。桌面程序更新目前覆盖安装，未配置签名自动升级源。未签名，须如实告知用户。

R14 基线链、压缩包内容、模拟 apply/rollback 已验证。真实 Linux 服务没有远程更新，本轮不触碰线上存档。保留之前 R13 recovery 修复过的健康检查。

未处理且不得宣称修复：服务器 OOM、后台发卡内部字段在联军投影暴露。发卡问题上轮只读审计，不在本次用户要求范围内。
