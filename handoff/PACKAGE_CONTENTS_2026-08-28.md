# Handoff 包内容索引

本次交接同步日期：2026-08-29

## 运行时代码

- `app.js`
- `index.html`
- `styles.css`
- `server.mjs`
- `campaign-service.mjs`
- `territory-model.js`
- `maritime-routes.mjs`
- `tactics-page.js`
- `tactics-lineup-rules.js`
- `formation-rules.js`
- `campaign-broadcast.js`
- `styles/campaign-broadcast.css`
- `client/core/campaign-api-client.js`
- `client/core/campaign-store.js`
- `client/challenge/challenge-controller.js`
- `client/maritime/maritime-controller.js`
- `client/map/campaign-map-data.js`
- `client/map/campaign-map-geometry.js`
- `client/map/territory-presentation.js`
- `client/territory/territory-controller.js`
- `server/infrastructure/json-campaign-repository.mjs`
- `server/application/economy-service.mjs`
- `server/application/challenge-service.mjs`
- `server/domain/player-map-colors.mjs`
- `server/http/campaign-api-handler.mjs`
- `server/infrastructure/campaign-save-migrations.mjs`
- `server/scheduler/challenge-scheduler.mjs`
- `shared/config/`
- `shared/football/labels.js`

## 数据与脚本

- `scripts/build-maritime-data.mjs`
- `assets/data/campaign-coastlines.json`

## 测试

- `test/maritime-routes.test.js`
- `test/tactics-lineup-rules.test.js`
- `test/campaign-service.test.js`
- `test/refactor-foundation.test.js`
- `test/refactor-services.test.js`
- `test/campaign-api-handler.test.js`
- `test/campaign-map-view.test.js`
- `test/challenge-controller.test.js`
- `test/maritime-controller.test.js`
- `test/territory-controller.test.js`
- 当前校验结果：`npm run check` 通过，54/54 测试通过（最新增量见 `UPDATE_2026-08-29.md`）。

## 交接说明

- 跨海征战使用本地海岸线数据和航线规划器，不依赖 S4 工作树运行时路径。
- 己方海岸地块才显示出海征战；内陆地块和己方领土不显示普通挑战入口。
- 比赛电视台、后台比分卡、两回合冷却、账号管理和三站位战术规则均已包含在 Rougelite 工作树。
- 浏览器验收由用户执行，本包不包含浏览器验收结论。
- 第一阶段模块化重构记录见 `REFACTOR_2026-08-29.md`。
- ChallengeService 与 campaign-store 第三阶段记录同样见 `REFACTOR_2026-08-29.md`。
- app.js 地图基础拆分的第四阶段记录同样见 `REFACTOR_2026-08-29.md`。
- app.js 领地、跨海和挑战控制器的第五阶段记录同样见 `REFACTOR_2026-08-29.md`。
