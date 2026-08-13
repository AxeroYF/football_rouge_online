# YellowDogs League S4 交接入口

> 2026-08-12 最新权威状态请先阅读 `handoff/LATEST_20260812.md`。最新 V2.1 平衡热更新为 `football-ydl-s4-v21-balance-hotfix-20260812-092423.tar.gz`，SHA256 `bda8ebe17ed57ab19522e4f98e2e7dc4c90647e3e32f0a3187eaaf6dda180f0c`；当前尚未确认线上部署。SQL 存储迁移评估见 `docs/sql-storage-assessment-20260812.md`。

> 2026-08-11 18:12 最新状态请先阅读 `handoff/LATEST_20260811.md`。最新完整交接 ZIP 仅用于新对话恢复上下文，不是服务器部署包。

最新完整对话交接 ZIP：`D:\Project\game_test\.worktrees\s4\handoff\football-ydl-s4-handoff-20260811-1812.zip`。

最新生产热更新：`football-ydl-s4-honor-mail-tactics-hotfix-20260811-161002-r3.tar.gz`，SHA256 `5d4bc2b3d9b90e1013f9d8f1b03384a78c2fe3c228142f080fc01f77c4667e44`。它合并荣誉室、背包详情、邮件分类、让球显示、战术板体力、市场所有权提示、普通 A/B `+8` 框及此前重叠运行改动；R2 尚未推送，R3 尚未收到线上部署确认。

## 2026-08-05 22:00 最新状态（最高优先级）

- 最新完整开发交接包：`D:\Project\game_test\handoff\football-ydl-s4-v2-circle-demo-handoff-20260805-2200.zip`。
- 本包继承 8 月 4 日世界杯完整交接包，并覆盖此后全部在研成果：世界杯完善、休赛期友谊赛与玩家镜像、战术板 AI 对战、V2 alpha.17 平衡/播报/伤病换人、伤停计时热修、两张 A 卡和 V2 圆圈比赛 Demo。
- 圆圈 Demo 地址为 `/versus/v2-circle-demo.html`；数据由 `node devtool/generate-v2-circle-demo.js` 使用真实 V2 控球链确定性生成，展示 30 分钟比赛。
- 交接 ZIP 用于继续开发和审阅，不是生产服整体覆盖包；不包含运行存档、线上分片、`Cloud_league_data/`、`outputs/`、账号、密钥或临时素材。
- 本轮只执行了圆圈 Demo 生成、JavaScript 语法、差异检查及桌面/手机浏览器验证，按用户要求未运行完整测试。

## 2026-08-04 13:27 最新状态（最高优先级）

- 黄狗世界杯已完成可运行版本：12 支国家队、9 名真人每天随机轮换国家队、3 支 AI；每组固定 3 真人 + 1 AI，三轮小组赛后八强单场淘汰。
- 世界杯在杯赛决赛后接续时间链；后台支持当天杯赛已经结束后的补开。未提交名单会在首轮前 10 分钟自动托管，普通国家队球员临时 +3，传奇不强化。
- 国家队战术复用俱乐部完整战术板，在“阵容战术”页切换；不使用羁绊，入口在世界杯结束 30 分钟后关闭。
- 世界杯已接入电视台、比赛详情和日程数据。今日概览只显示当前玩家自己的赛程；独立“世界杯赛程”页显示所有已经确定双方的比赛，已完赛对阵可打开完整报告。
- 临时国家队球员不进入普通页面轮询重建，并在当日世界杯关闭后清理。
- 最新完整交接包：`D:\Project\game_test\handoff\football-ydl-s4-world-cup-handoff-20260804-1327.zip`。该包用于继续开发，不可整体覆盖生产服，且不含任何运行存档或分片数据。
- 验证：`test/world-cup.test.js` 5/5、`test/s4-assets.test.js` 98/98、语法检查、`npm run build` 与 `git diff --check` 均通过。

## 2026-08-03 13:20 最新状态（最高优先级）

- 正式服已恢复：启动崩溃根因是运营评级覆盖未在游戏进程生效（已部署 1141 热修，线上 team1 占用 27/33）；当前卡顿根因是 `view()` 全量构建 + 前端 12s 全量轮询在 2核2G 上打满 CPU，已产出 1320 热修（轻量同步 head + 静态 gzip + 诊断工具）。
- 最新可部署包：`handoff/football-ydl-s4-frontend-perf-light-sync-tools-hotfix-20260803-1320.tar.gz`，SHA256 `C07CBC5AFA3645E58C20997496A516C0EF1D4745025396D768D7DECE02C23153`。
- 待办：CPU 火焰定位持续 75% 占用源（`node devtool/profile-live.mjs <PID> 60`）、view() 按页签瘦身、每日重置/归档异步化。
- 详细诊断与运维注意事项见 `CURRENT_STATE.md` / `NEW_CHAT_PROMPT.md` 顶部。

## 2026-08-03 10:47 最新状态（最高优先级）

- 正式服部署商店/市场/开包性能热修后启动失败，日志为 `球队超过33人大名单额度：ydl-team-1`，systemd 曾连续自动重启 163 次；应保持 `football-s4` 停止，先完成只读诊断。
- 用户下载的最新 day6 存档 `Cloud_league_data/day6/yellowdogs-league (6).json` 为 84,800,585 字节，当前代码直接校验及迁移后分片加载均通过，不是坏档，禁止覆盖线上分片或重新迁移。
- day6 的 `ydl-team-1` 为 39 张活动卡、31 个球员家族、实际占用 19/33；线上报超限说明服务器实际加载的分片或 `s4-assets.js` 与本地版本不一致。
- `versus/s4-assets.js` 已增强超限错误，显示持有人、球员家族、活动卡和实际占用，便于下一次启动直接定位；尚未把该诊断改动作为生产修复发布。
- 商店/市场/开包性能包：`handoff/football-ydl-s4-shop-market-packs-performance-hotfix-20260803-1015.tar.gz`，SHA256 `15BCB3BDC469BEF154A82A9375A1016F36DBD2D22C20663F3F2E16F9A758B822`。
- DLC2 球员与 WebP 卡画包：`handoff/football-ydl-s4-dlc2-players-webp-hotfix-20260803-0422.tar.gz`，SHA256 `C7180F4957B99937B0B9E1A9A47DA627FCFE590A946E4A0B957793331A5C43BB`。
- 最新完整交接包：`D:\Project\game_test\handoff\football-ydl-s4-v2-handoff-20260803-1047.zip`；不包含运营存档、线上分片、模拟输出、原始 PNG 或临时目录。

## 2026-08-02 23:21 合并发布物

- 最新推荐部署包同时包含 `+4` 特性绑定、后台发卡轻量化和 V2 比赛详情复盘指标修复。
- 包名：`handoff/football-ydl-s4-card-admin-v2-review-combined-hotfix-20260802-2321.tar.gz`。
- SHA256：`5418C07DB94B129BB0138C182B63042CC000F64124843003D57DD2C8C95F6EF1`。
- 最新完整交接包：`D:\Project\game_test\handoff\football-ydl-s4-v2-handoff-20260802-2324.zip`。
- 仅覆盖 8 个生产代码文件，不包含存档、分片目录或迁移操作。

## 2026-08-02 23:19 最新状态（最高优先级）

- 修复比赛详情复盘“阵型与战术”全部显示 0：V2 阶段快照此前缺少 `structureIndex / positionFit / tacticalFit`。
- 新 V2 比赛直接保存真实指标；今天已经完成的旧 V2 比赛在读取时回填，无需重算或修改存档。
- 热图与逐区域控球链本身已经接入 V2，本次问题只影响顶部失利因素归因卡片。
- 最新热修：`handoff/football-ydl-s4-v2-review-metrics-hotfix-20260802-2319.tar.gz`。
- SHA256：`92B6520EE8DF754D09DD0A552EFCC7FC659E1D0BFF5CC2342EC8C48E578CD1E3`。
- 最新完整交接包：`D:\Project\game_test\handoff\football-ydl-s4-v2-handoff-20260802-2322.zip`。

## 2026-08-02 23:01 最新状态（最高优先级）

- 正式服性能热修后用户确认流畅很多；当前新增修复 `+4` 特性绑定卡住和后台指定球员卡发放无响应。
- 两个写接口均改为轻量响应，前端只合并本次卡片/发放记录，不再同步生成完整玩家视图或完整 `adminView()`。
- `+4` 庆祝层移除 620ms 人为等待，动画节点由 128 降至 48。
- 分片端到端场景“后台发两张 +3 卡、合成 +4、绑定特性、重载”通过；分片专项 4/4、原有相关回归 2/2。
- 最新热修：`handoff/football-ydl-s4-card-trait-admin-grant-hotfix-20260802-2301.tar.gz`。
- 热修 SHA256：`2A81B53A20B948CA2E4FD8E157B7F1B80DF86E42A89B50D5DCE2CA636025028C`。
- 最新完整交接包：`D:\Project\game_test\handoff\football-ydl-s4-v2-handoff-20260802-2305.zip`。

## 2026-08-02 22:07 最新状态（最高优先级）

- 唯一开发目录：`D:\Project\game_test\.worktrees\s4`；工作树有大量用户成果，禁止 `reset`、`clean`、`checkout` 或覆盖。
- 当前 V2：`match-engine-v2-alpha.15`。正式比赛继续统一使用 V2。
- 已完成强化合卡悬空特性修复、预测页轻量刷新、逐场直播检查点、联赛分片存储、电视台战术适配度、V2 抢断/X 球员任务和战术板可选羁绊增益显示。
- 正式服单 JSON 到分片目录的迁移已由用户执行成功：10 队、18 轮、123 场比赛、15103 条流水、6424 张卡；迁移报告全部检查为 `true`，`ok:true`。
- 首个 `football-ydl-s4-combined-hotfix-20260802-2145.tar.gz` 有前端启动缺陷：`versus/public/app.js` 跨目录导入 `/game/public/schema.js`，公网安全模式返回 404，页面只显示骨架。禁止再次部署该旧包。
- 紧急前端修复包：`handoff/football-ydl-s4-frontend-startup-hotfix-20260802-2156.tar.gz`，SHA256 `1A76CC4F4C191C44B1D7368544806B8EE52BDA190A8362D389CE3544153C944F`。
- 修正后的完整合并包：`handoff/football-ydl-s4-combined-hotfix-20260802-2145-fixed-v2.tar.gz`，SHA256 `9EB44412B091BE18A463C102F5237E8C2157067CDAB9E81447AB49432F8A9EE9`。
- 用户已收到紧急包部署指令，但当前对话尚未确认线上页面是否恢复。接手后先确认页面、`systemctl status`、最近日志及实际 `YELLOWDOGS_LEAGUE_PATH`。
- 最新交接包：`D:\Project\game_test\handoff\football-ydl-s4-v2-handoff-20260802-2207.zip`。

原始 `data/yellowdogs-league.json` 必须继续保留。分片启用后产生的新数据只存在分片目录；有玩家新进度后不得直接回滚到旧 JSON。

## 2026-08-02 10:38 最新状态（最高优先级）

- 当前 V2：`2.0.0-alpha.12` / `match-engine-v2-alpha.12`。
- alpha.10 已补齐真实加时赛与 IFAB 逐轮点球；修复角球主罚者接应自己传中、普通伤病偏高、雷暴伤病约占全部场次 8% 和旧 X 球员成长基准。
- alpha.11 将五场同时直播改为全局轮转小切片，读取直播列表/观战页不再触发模拟，并支持服务重启从控球链检查点续算。
- alpha.12 修复五场完赛时的短暂掉线：完赛存档使用紧凑 JSON、跳过同步 `.bak` 大文件复制；观战页最多自动重连 5 次。
- 服务器日志两次均为管理员 `systemctl stop` 导致的 `signal=TERM`，未发现 OOM 或 Node 崩溃证据。
- 最新热更新：`handoff/football-ydl-s4-v2-alpha12-postmatch-reconnect-hotfix-20260802-1037.tar.gz`。
- 热更新 SHA256：`6314AF7AFE83F04BFF8CC94B6872F02AF695D77224752D9877C78FA4ED8C2390`。
- 最新交接包：`D:\Project\game_test\handoff\football-ydl-s4-v2-handoff-20260802-1038.zip`。

服务器当前被用户停止，部署 alpha.12 后再启动。禁止覆盖服务器 `data`，不要手动重新模拟中断轮次；未完赛会从最后检查点继续，已结算结果保持不变。

## 2026-08-02 00:39 最新状态（优先阅读）

- 唯一开发目录：`D:\Project\game_test\.worktrees\s4`
- 分支与基线：`codex/s4-card-upgrade` / `dcc8049`（tag：`S4-August1st`）
- V2 当前版本：`2.0.0-alpha.8` / `match-engine-v2-alpha.8`，正式比赛尺度为 90 分钟、180 条控球链。
- V2 已完成联赛、杯赛、友谊赛统一接入；比赛预测仍使用 V1 快速模拟。服务器实际开关以 `/etc/football-s4.env` 为准。
- 最新 5000 场验证结果：`outputs/S4比赛引擎V1-V2-alpha8-5000-validation.json` 及对应 `-raw-samples.json`。
- 战术页已经加入阵型参考线、三阶段站位、八项连续滑杆、持球进攻/无球防守细节、V2 战术适配度与赛后复盘。
- 2026-08-02 完成手机端战术页优化：拖动逐帧合并、目标区域缓存、滑杆轻量同步、触屏悬浮逻辑关闭、替补席三列限高滚动、三阶段分页和横竖屏适配。
- 用户已完成手机端测试。前端回归 `test/s4-assets.test.js` 为 86/86，通过 `node --check` 与 `git diff --check`。
- 最新手机端增量热更新：`handoff/football-ydl-s4-mobile-tactics-hotfix-20260802.tar.gz`，SHA256：`C3CB495896A64DCFE03980B40BB9A2C72FF7F1C38FB2E10FC4AA7D7CDD340D9C`。
- 最新全赛事 V2 热更新：`handoff/football-ydl-s4-v2-all-events-hotfix-20260801-2341-r3.tar.gz`。
- 最新交接 ZIP：`D:\Project\game_test\handoff\football-ydl-s4-v2-handoff-20260802-0039.zip`。

部署包均不包含玩家账号、联赛存档、比赛存档、服务器密钥或本地测试数据。接手时不要以旧章节中的 alpha4/V1 状态覆盖本节；旧内容仅作为开发历史。

最新 V2 状态：`match-engine-v2-alpha.4` 已接入本地测试服 YDL 联赛。测试环境整轮 5 场同时进入电视台，正式环境仍默认 V1。V2 已覆盖动态战术、红牌、伤病后果、定位球、完整射门/门将流程、正式特性、整数分钟、裁判天气、中文多人播报、助攻归属和低 xG 校准。

更新时间：2026-08-01 13:05（Asia/Shanghai）

- 唯一开发目录：`D:\Project\game_test\.worktrees\s4`
- 当前分支：`codex/s4-card-upgrade`
- 当前基线：`dcc8049`（tag：`S4-August1st`）
- 最新交接包：`D:\Project\game_test\handoff\football-ydl-s4-v2-handoff-20260801-1305.zip`
- V2 尚未提交、推送、制作正式热修或部署正式服。
- 最新验证：V2 相关 35/35、联赛回归 78/78、`npm run build`、`git diff --check` 通过。

接手顺序：

1. 阅读 `CURRENT_STATE.md` 顶部最新章节。
2. 阅读 `NEW_CHAT_PROMPT.md`。
3. 在工作区只读执行 `git status --short` 与 `git log -1 --oneline --decorate`。
4. 使用 `CHANGED_FILES.txt` 与 `MANIFEST.md` 核对交接内容。

V1/V2 全量配置为 30,000 场、10 worker、逐场进度条；用户上一次 19 worker 运行已主动停止，alpha4 全量结果尚未生成。2 核 4GB 正式服务器建议改为“后台密封预演算 + 电视台按时间揭示”，该架构尚未实现。

不要用交接包覆盖现有工作区。继续开发必须直接使用上述 worktree。
