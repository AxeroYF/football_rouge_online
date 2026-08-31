# 黄狗风云球员库与 Admin 重做交接

更新时间：2026-08-30（Asia/Shanghai）

> 历史快照提示：本文的 723/245/294 统计已过期。当前口径为 842 名球员、386 条有效卡画注册、注册文件缺失 0。请优先阅读 UPDATE_2026-08-31.md 与 YDL_PLAYER_LIBRARY_UNIFICATION_2026-08-30.md。

## 结论

原有 Rougelite Admin 只是登录、任务和金币调整的 P0 临时页面，现已替换为以 S4 内容运营后台为设计与功能底座的黄狗风云工作台。保留现有 RBAC、任务和操作审计；首个完整业务模块为“球员库管理 / 球员卡工作室 / 数据审计”。

运行时仍只读取 Rougelite 本地文件，不引用 `.worktrees/s4` 或其他 S4 目录。

## 当前球员库审计

- 生产目录球员：723 名。
- 基础目录球员：723 名。
- 两个目录 ID 完全一致：无单边缺失。
- 评级：S 73、A 269、B 212、C 169。
- 位置：GK 69、CB 120、LB 45、RB 42、DM 62、AM 108、LM 25、RM 22、ST 159、LW 32、RW 39。
- 26 项属性缺失：0。
- 按 S4 `playerOverallFromAttributes` 算法复核的总评错配：0。
- 重复球员 ID：0。
- 生产运营覆盖：188 名球员。

## 卡画审计

- 卡画注册表：245 条。
- 已绑定生产球员：245 名，覆盖率 33.9%。
- 卡画来源：传奇组 163、A级组 82。
- 注册表缺失文件：0。
- 孤立注册记录：0。
- `assets/player-profiles` 内 PNG/WebP：539 个。
- 其中 245 个被注册表引用；294 个位于 `s4-imported/`，属于已从 S4 复制但尚未按球员 ID 建立映射的候选资源。
- 294 个候选资源未删除，后续应在球员卡工作室中逐一确认身份后绑定，不能按文件名自动猜测。

## 需要人工复核的同名球员

1. “科克曲”
   - `s4-fc26-243245`：土耳其、贝西克塔斯、AM、B、80。
   - `s4-fc26-193747`：西班牙、马德里竞技、AM、C、76。
   - 第二条很可能应使用“科克”等不同中文名，但本轮不擅自修改身份数据。
2. “米林科维奇”
   - `s4-fc26-238095`：塞尔维亚、诺丁汉森林、CB、B、84。
   - `s4-fc26-223848`：塞尔维亚、利雅得新月、AM、B、85。
   - 两人 ID、位置和俱乐部不同，属于姓名本地化需要细分，不是重复 ID。

## 已实现的 Admin 球员库能力

- S4 风格工作台外壳、左侧模块导航、生产数据 KPI。
- 正式库＋暂存池统一搜索；按评级、位置、卡画状态筛选。
- 编辑姓名、来源名、评级、主副位置、惯用脚、国籍、俱乐部和身高。
- 完整编辑 26 项生产属性，保存后用 S4 算法重算总评。
- 正式球员修改写入 `s4-production-content-overrides.json`，同时更新当前生产目录和服务器内存对象。
- 新球员先制作成暂存卡，支持 JSON 批量制卡和发布批次。
- 暂存卡选择后批量上线；上线内容进入基础目录、生产目录和当前运行时球员池。
- 球员卡画上传、浏览器端缩放并转换为最大 1600px WebP、实时位置和宽度调整。
- 卡画文件写入 `assets/player-profiles/admin/`，映射写入统一注册表，并同步基础/生产目录引用。
- 生产目录、基础目录、属性、总评、重复 ID/姓名、卡画缺失、孤立映射和未引用资产审计。
- 所有球员修改、制卡、发布和卡画保存操作进入管理员审计日志。

## 新增主要文件

- `admin-v2.html`
- `admin-v2.css`
- `admin-v2.js`
- `server/application/player-library-service.mjs`
- `test/player-library-service.test.js`

## API

- `GET /api/admin/player-library`
- `GET /api/admin/player-library/players`
- `GET /api/admin/player-library/players/:id`
- `GET /api/admin/player-library/audit`
- `POST /api/admin/player-library/players/:id`
- `POST /api/admin/player-library/drafts`
- `POST /api/admin/player-library/batches`
- `POST /api/admin/player-library/publish`
- `POST /api/admin/player-library/profiles/:id`

## 验证

- `npm run check`：74/74 通过。
- `/admin` 实际服务器加载：HTTP 200。
- `admin-v2.js` 实际服务器加载：HTTP 200。
- 浏览器控制组件初始化崩溃，因此截图级视觉验收尚未完成，需用户打开 `/admin` 继续验收。

## 后续建议

1. 人工确认并绑定 294 个未映射候选卡画。
2. 修正两个同名组的中文本地化。
3. 把 S4 的 Excel 导入/模板能力迁入当前批量制卡入口；当前版本已支持 JSON 批量导入，不依赖 ExcelJS。
4. 下一批按相同原则迁移玩家/球队、经济、世界地图和挑战运营模块，删除 S4 联赛、杯赛、投注等黄狗风云不需要的模块。
