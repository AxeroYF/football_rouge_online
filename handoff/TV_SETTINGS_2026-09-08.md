# 电视台外观设置 · 2026-09-08

用户要求将 S4 草皮颜色／看台／背景选项引入黄狗风云设置。

## 已交付

设置 → 电视台外观，标准窗口内提供实时球场预览、选后自动保存、恢复默认：
- 草皮颜色：经典绿／浅灰（S4 深浅主题草皮配色拆成独立选项）。
- 草皮纹理：纵向条纹／棋盘草纹／纯色。
- 看台：无效果／经典分层／陡峭压迫／连续环形。
- 电视台背景：无效果／流星雨。

按当前浏览器和 playerId 保存个人观赛偏好，key 为 yellowdogs-tv-appearance-v1: + encodeURIComponent(playerId)。不是主场服务器属性；不改变其他玩家画面，无后端接口或真实账号存档修改。默认绿色、条纹、经典看台、无背景。设置页面说明本地按账号记忆。坏存储／旧未知值回退默认，保存失败显示提示；账号改变或退出时清理窗口和偏好。

## 实现

S4 依据：S4_source_snapshot/S4-final-887df19-20260827/source/versus/public/app.js 的 broadcastVenueProfile、broadcastMeteorParticlesMarkup 和球场管理选项；broadcast-venue-fix.css 的最终整列看台／草皮纹理及浅灰配色；styles.css 的电视台流星雨动画。没有引入 S4 商业解锁、扩容或主场更名功能。

- client/settings/tv-appearance.js：选项白名单、默认值、本地按账号读写、DOM 样式属性和流星层复用。
- client/settings/tv-settings-controller.js：标准窗口和设置入口、预览、立即保存／恢复默认、账号切换。
- styles/tv-settings.css：仅作用于电视台及预览的草皮／看台；不改球员卡与赞助商品牌色。手机减少流星数量，reduced-motion 停止动画。
- campaign-broadcast.js：保留 broadcast-v2-content 容器，只更新内部战况，流星层保持在旁边；每轮同步不重建流星动画，关闭观赛清空。
- app.js／index.html：入口接线与版本 20260908-tv-v1，设置窗口阻止地图操作事件冒泡。

## 验证

55 项相关测试（外观持久化、转播、赞助、地图）通过。scripts/review-tv-settings.mjs 通过 27 项隔离浏览器检查：所有纹理与看台、两个草色、48 流星、刷新恢复、实际引擎比赛应用、同步保持流星 DOM、原色球员卡、居中、减少动态效果、关闭清理、恢复默认和 320／390／768px 可用。已查看桌面设置、浅灰比赛、手机设置截图，证据 outputs/tv-settings-20260908/。

纯前端更新，Ctrl+F5 即可。没有重启现有服务、修改真实玩家数据、提交或部署。
