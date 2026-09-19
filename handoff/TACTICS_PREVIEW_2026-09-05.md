# 战术磁贴强化等级与 S4 落位预览 · 2026-09-05

- 首发/替补共用 magnet 模板补齐 S4 的 em.league-magnet-upgrade.level-N，使用已有紫/金/红金分档 CSS；能力值优先 effectiveOverall。预览补齐简化位置与职责标签。
- 原 playPreview 忽略所选模式，轮播 position1/2/3 并留下未清理的 5.4 秒 timeout。现已删除，由独立 shape-preview-controller 实现选择、轨迹、过渡、恢复及异步版本取消。
- 默认站位只恢复；进攻/防守发送当前站位方案、11人首发、位置、阵型线、职责和战术参数到 POST /api/campaign/tactics/preview。经过当前账号认证，检查11个独立本队球员和有限坐标，不改存档、不触发比赛。
- 原样移植 ../s4/versus/v2/tactical-shape-preview-v2.js 到对应已移植 engine 路径，复用当前比赛引擎 dynamic-shape、战术参数和 V2_MATCH_PARAMETERS。server/application/tactical-preview.mjs 适配黄狗风云独立实例 ID 与当前阵容。
- 预览保留 until 默认站位/切换方案/修改战术/关闭窗口；恢复真实磁贴位置并清理轨迹。快切模式、关闭窗口和修改方案后忽略过期请求与动画回调。预览点显示位置和职责，训练标记在点模式隐藏。
- 变更：tactics-page.js，client/tactics/shape-preview-controller.js，server/application/tactical-preview.mjs，server/http/campaign-api-handler.mjs，engine/s4-v2.1/versus/v2/tactical-shape-preview-v2.js，s4-tactics-original.css。入口缓存 20260905-tactics-preview-v1。
- 测试：落位/职责/方案差异、只读及归属校验、默认恢复、异步取消、现有战术/API 共 21/21；JS 和 CSS 语法通过。新测试 test/tactical-preview.test.js 已纳入 npm test。日志 .tactics-preview-check.log。
- 未操作浏览器或启停服务。新增后端预览接口需要用户重启服务并刷新游戏后验收。

## 2026-09-05：战术磁贴悬浮窗显示球员特性

- 修复 `tactics-page.js` 的 `playerTooltip`：悬浮窗在核心能力下方显示强化特性名称与效果说明，多项特性逐行排列。
- 兼容当前 `{ id, name, summary }` 特性对象和旧存档中的字符串特性；无特性球员不添加空白的“强化特性”区域。
- 自定义悬浮窗仍沿用现有视口边缘避让、鼠标跟随、键盘聚焦和拖拽时关闭逻辑。
- 前端缓存更新为 `tactics-traits-v1`。纯前端修改，刷新页面即可。
- 战术、代表卡和落位预览专项测试 17/17 通过，包含双特性名称/说明、旧字符串特性和无特性用例；`tactics-page.js` 语法检查通过。未操作服务或浏览器。

## 2026-09-05：强化特性全链路审计与 996 体力修复

- 用户要求悬浮窗取消特性前空行和“强化特性”标题；现在能力行后直接逐行显示“名称：说明”。
- 审计强化存储：`EnhancementService.chooseTrait` 持久化 `{id,name,summary}`，`enhancementTraitIds` 保留解锁记录；重载、降级、独立卡实例及比赛快照测试均覆盖。
- 审计特性池：当前强化可产出 19 个 YDL 特性，共 14 类 hook：`attribute/allAttributes/height/fixedFitness/position/chemistry/affinityWildcard/penaltyDraw/firstPenaltySave/redCardImmune/injury/teamInjuryTransfer/teamLightningProtection/argentinaCount`。所有特性 ID 均进入 V2.1 `traitDefinitions`，各 hook 均有内联、空间、羁绊、控球链或比赛事件消费者。
- 修复前端断链：新增 `shared/config/player-trait-presentation.mjs`，复用 S4 `trait-runtime` 与 YDL trait pool。战术磁贴体力条、悬浮窗核心数值、位置适配颜色、球队列表关键属性、球员 26 项详情、身高和体能统一由特性呈现层计算。
- 条件型效果在战术板按当前方案计算：默认方案按平局阶段，领先/落后方案按第 70 分钟相应比分状态；战术和打法传入规则。未确定比赛天气时使用晴天，正式比赛由实时分钟、比分和天气重新计算。
- 996 (`stoppage-time-expert`)：战术磁贴体力条、悬浮窗和球队详情从 100 修正为 94；耐力属性仍是卡片自身的 99，两者含义不同。比赛快照此前正确固定 94，但比赛对象创建瞬间曾保留 100，现 `cloneTeam` 初始化即应用 `fixedFitness`，整个比赛周期都是 94。
- 球员详情的特性区域也补充效果说明；卡面继续只展示短名称，强化三选一界面原本就完整展示名称与说明。
- 版本 `tactics-traits-v2`。包含比赛引擎修改，用户需重启 4370 后刷新。未操作浏览器、服务或真实账号存档。
- 验证：预检 52/52、主测试 239/239、Three 46/46，合计 337 项通过。新增全部 19 特性入快照、14 hook 消费路径、996 引擎/前端、条件战术、天气、属性、身高和位置适配一致性测试；日志 `.trait-integration-full-v2.log`。
