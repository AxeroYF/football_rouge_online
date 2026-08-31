# 下一次对话提示

## 2026-08-31 当前提示（优先使用）

请继续维护黄狗风云项目，工作树是：

D:\Project\game_test\.worktrees\Rougelite

先完整阅读：

- handoff/ROADMAP_2026-08-31.md
- handoff/UPDATE_2026-08-31.md
- handoff/CURRENT_STATE.md 顶部“当前权威摘要”
- handoff/MANIFEST.md 顶部“2026-08-31 当前清单”

当前最重要的结论：

- 游戏定位是大地图远征经营 + 异步战略推进 + S4 V2.1 自动比赛模拟。
- 下一主线是远征队领域模型、真实时间移动、地图战棋、抵达挑战和休整闭环。
- 球员库为 842 人，卡画注册 386 条；29 名 DLC4 计划无卡画球员不是异常。
- Admin、统一球员卡、26 项详情、YOOGLE、三套窗口规范和动态天气基础已经完成。
- 10 个远征战棋素材已经入库，尚未接入运行时。
- 天气每真实小时刷新，目前只影响比赛；地图天气层默认关闭且为静态地块覆盖。
- 最近 npm run check：预检 31/31、主测试 89/89 通过。
- 浏览器测试由用户执行。

硬性约束：

1. 运行时不得引用 .worktrees\s4、S4_source_snapshot 或服务器备份目录。
2. 球员卡必须走 shared/player-card 契约与 client/player-card 渲染器。
3. 不重新设计 S4 成熟战术板与电视台。
4. 标准窗口、加宽窗口、小型窗口不得混用。
5. 天气层不要恢复成小图标或动画。
6. 前端修改后更新 cache-bust，代码修改后运行 npm run check。

以下为 2026-08-30 的历史提示，仅供追溯：

请继续维护黄狗风云项目，工作树是：

`D:\Project\game_test\.worktrees\Rougelite`

先完整阅读：

- `handoff/README.md`
- `handoff/CURRENT_STATE.md`
- `handoff/CHANGED_FILES.txt`
- `handoff/MANIFEST.md`
- `handoff/ROADMAP_ADMIN_2026-08-29.md`

当前状态：

- S4 成熟阵容战术页已迁入。
- S4 V2.1 引擎及依赖已完全放在 Rougelite 工作树内。
- 地块 AI 驻军、11 套阵型、主位置选人、核心国家能力加成已接入。
- 地块挑战已改为两回合总比分、加时和点球。
- S4 成熟电视台组件和最终 UI 已直接迁入本地，包含联合球场、S4 磁贴、事件栏、数据栏、战术摘要停靠和滚动保持。
- 比赛由服务器按墙钟时间和单链切片实时推进，客户端按固定节奏读取快照，赛果只在终场生成。
- 地图主界面浮层、弹窗、按钮、开关和建队入口已统一为 S4 式圆角。`n- S4 球员卡画已改为注册表驱动，支持通过导入脚本批量接入新卡画和头像。
- 地块情报卡默认隐藏，点击显示，重复点击同一地块或点击空白处关闭；卡片位于地图左上角。
- CampaignService 已拆出 repository、migration、EconomyService、ChallengeService、HTTP handler 和 scheduler。
- app.js 已拆出 campaign-store、地图数据/几何/展示、TerritoryController、MaritimeController 和 ChallengeController。
- app.js 当前 718 行；地图滚轮惯性和缩略地图已独立拆到 `client/map/inertial-wheel-zoom.js`、`client/map/campaign-minimap-controller.js`，下一步仍可拆 Leaflet 图层/城市 controller 和顶栏/键盘 application shell。
- 地图滚轮已使用鼠标锚定、逐帧推进和指数减速，Leaflet 原生定时聚合跳级已关闭；结束时不再播放二次动画或吸附刻度，设施和豪门缩放时保持展开。
- 左下角缩略地图显示领土颜色和主地图白色视口框，拖动框可平移主地图；国境线和主要城市开关位于缩略图上沿。
- 最近 `npm run check` 为 73/73 通过。
- 浏览器验收由用户执行。
- 后续路线已明确：先完成 Admin/RBAC/审计/资源流水/统一任务等数据基础，再完成三套阵容、共享体力、次数限制、失败惩罚、PvP 金币托管和并发锁组成的征服闭环；详细取舍见 `handoff/ROADMAP_ADMIN_2026-08-29.md`。

硬性要求：

1. 不得让黄狗风云运行时引用 `.worktrees\s4`、`S4_source_snapshot` 或其他 S4 文件夹。
2. 若需要 S4 源码，可以读取并迁移，但最终代码、样式与资源必须复制到 Rougelite 工作树。
3. 不要重新设计或简化已经成熟的 S4 阵容战术 UI 和电视台 UI。
4. 电视台代码必须继续维护在 `campaign-broadcast.js` 与 `styles/campaign-broadcast.css`，不得回退到临时自定义直播界面。
5. 修改后运行 `npm run check`。
6. 修改前端后更新资源 cache-bust 版本。`n7. 球员卡画变更优先更新注册表和导入流程，不要再针对单个球员硬编码。

