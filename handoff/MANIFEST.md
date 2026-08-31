# Handoff Manifest

更新时间：2026-08-31（Asia/Shanghai）

## 2026-08-31 当前清单

- handoff/ROADMAP_2026-08-31.md：当前总路线，取代旧路线的优先级。
- handoff/UPDATE_2026-08-31.md：最新功能、数据、约束与测试基线。
- handoff/README.md：交接入口与阅读顺序。
- handoff/CURRENT_STATE.md：当前摘要加历史状态。
- handoff/NEW_CHAT_PROMPT.md：下一次对话提示。
- handoff/CHANGED_FILES.txt：当前关键文件清单。
- handoff/PACKAGE_CONTENTS_2026-08-31.md：本次本地对话交接压缩包说明。
- assets/expedition-tokens/：默认款 + 9 个国家款战棋素材及 manifest。
- engine/campaign-weather.mjs：每地块整点天气。
- client/map/territory-weather-layer-controller.js：静态天气地块覆盖。
- shared/player-card/ 与 client/player-card/：标准球员卡契约、渲染器和详情。
- client/yoogle/ 与 styles/yoogle.css：YOOGLE 搜索。
- client/ui/WINDOW_STANDARDS.md、standard-window.js、wide-window.js、small-window.js：三套窗口标准。
- admin-v2.html、admin-v2.css、admin-v2.js：S4 底座上的 YDL Admin。
- server/application/player-library-service.mjs：球员库管理。
- assets/data/s4-player-catalog.json：842 人正式目录。
- assets/data/s4-player-base-catalog.json：842 人基础目录。
- assets/data/s4-player-profile-registry.json：386 条有效卡画注册。

最新验证：npm run check；预检 31/31、主测试 89/89 通过。浏览器验收由用户执行。

以下是 2026-08-30 的历史清单；如有冲突，以上方当前清单为准。

## 交接文档

- `handoff/README.md`
- `handoff/CURRENT_STATE.md`
- `handoff/NEW_CHAT_PROMPT.md`
- `handoff/CHANGED_FILES.txt`
- `handoff/MANIFEST.md`
- `handoff/ROADMAP_ADMIN_2026-08-29.md`（后续阶段路线、S4 Admin 取舍与新后台信息架构）

## 应用入口

- `index.html`
- `app.js`
- `campaign-entry.js`
- `campaign-service.mjs`
- `server.mjs`
- `package.json`

## 地图与领地

- `territory-model.js`
- `client/map/campaign-map-data.js`
- `client/map/campaign-map-geometry.js`
- `client/map/campaign-minimap-controller.js`（左下角战役缩略地图、视口同步与拖框平移）
- `client/map/inertial-wheel-zoom.js`（鼠标锚定、逐帧推进和指数减速的地图滚轮控制器）
- `client/map/territory-presentation.js`
- `client/territory/territory-controller.js`
- `client/maritime/maritime-controller.js`
- `client/challenge/challenge-controller.js`
- `assets/data/territory-index.json`
- `assets/data/campaign-territories.geojson`
- `assets/data/natural-earth-countries-50m.geojson`
- `assets/data/europe-cities.json`
- `assets/data/south-america-cities.json`
- `assets/data/europe-clubs.json`

## 球员与战术

- `assets/data/s4-player-catalog.json`
- `assets/data/s4-player-base-catalog.json`
- `assets/data/s4-production-content-overrides.json`\n- `assets/data/s4-player-profile-registry.json`\n- `assets/player-profiles/`\n- `scripts/sync-player-profiles.mjs`\n- `scripts/import-s4-player-profiles.mjs`
- `tactics-page.js`
- `formation-rules.js`
- `s4-tactics-original.css`
- `styles/player-card.css`

## AI、比赛与 S4 电视转播

- `engine/territory-ai.mjs`
- `engine/campaign-match-engine.mjs`
- `engine/s4-v2.1/`
- `campaign-broadcast.js`（S4 电视台组件、本地播放、双回合切换、滚动保持）
- `styles/campaign-broadcast.css`（S4 电视台最终 UI 与响应式布局）

## 服务端模块

- `server/application/building-service.mjs`
- `server/application/economy-service.mjs`
- `server/application/challenge-service.mjs`
- `server/infrastructure/json-campaign-repository.mjs`
- `server/infrastructure/campaign-save-migrations.mjs`
- `server/http/campaign-api-handler.mjs`
- `server/scheduler/challenge-scheduler.mjs`
- `shared/config/`
- `shared/config/buildings.mjs`
- `shared/football/labels.js`

## 设施资源

- `assets/building-icons-v2/`
- `client/buildings/building-marker-controller.js`（地块设施聚合节点、环形展开与图片延迟加载）
- `client/buildings/building-panel-controller.js`（地块设施预览、可建菜单、施工进度与建造请求）

## 测试

- `test/building-marker-controller.test.js`
- `test/building-panel-controller.test.js`
- `test/building-service.test.js`
- `test/campaign-broadcast.test.js`
- `test/campaign-service.test.js`
- `test/campaign-match-engine.test.js`
- `test/territory-model.test.js`
- `test/app-map-regression.test.js`
- `test/campaign-map-view.test.js`
- `test/campaign-minimap-controller.test.js`
- `test/inertial-wheel-zoom.test.js`
- `test/territory-controller.test.js`
- `test/maritime-controller.test.js`
- `test/challenge-controller.test.js`
- `test/refactor-foundation.test.js`
- `test/refactor-services.test.js`


## Admin 与球员库管理

- `admin-v2.html`（S4 风格后台正式入口）
- `admin-v2.css`
- `admin-v2.js`
- `server/application/admin-service.mjs`（RBAC、任务、审计、管理员操作）
- `server/application/player-library-service.mjs`（目录、覆盖、暂存、发布、卡画、审计）
- `server/http/admin-api-handler.mjs`
- `test/player-library-service.test.js`
- `handoff/PLAYER_LIBRARY_ADMIN_2026-08-30.md`

最近验证：`npm run check`，74/74 通过。
