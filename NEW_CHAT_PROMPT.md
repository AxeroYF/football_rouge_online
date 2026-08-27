# 新任务接手提示

> 最高优先级（2026-08-18）：先阅读 `handoff/LATEST_20260818.md`。确认服务器热更新是否完成，并要求用户提供 `systemctl is-active football-s4`、`curl -fsS http://127.0.0.1:4318/api/health` 和管理员预览结果；不要假设已上线。重点核验 33 人上限清退、商店扩容道具隐藏、背包超限锁定标记、三种管理员定向礼包及私有池最终所有权校验。生产包为 `handoff/football-ydl-s4-roster-enforcement-designated-packs-hotfix-20260818.tar.gz`，SHA256 `1762d36291ec6838c592be2c36cf87ab09cd6747e8431861346f5e307a75f8f4`。

> 最高优先级（2026-08-14 17:40）：完整阅读 `handoff/LATEST_20260814.md`。工作区 `D:\Project\game_test\.worktrees\s4` 基线为 `40e22d2`，存在大量未提交成果，禁止 reset/clean/整体 checkout。金球奖 V3 与一次性历史复核已经实现并通过 3 项定向测试，但尚未制作生产热更新；战术方案导入 revision 与离页保存问题仅完成诊断、尚未修复。最新对话交接 ZIP 不是服务器部署包。

> 最高优先级（2026-08-13 18:49）：继续在 `D:\Project\game_test\.worktrees\s4` 工作，保留 `40e22d2` / `S4-0813` 之后的全部未提交改动，禁止 reset/clean/整体 checkout。最新对话交接 ZIP 是 `handoff/football-ydl-s4-handoff-20260813-1849.zip`；最新生产候选是 `handoff/football-ydl-s4-recent-batch-hotfix-20260813-183713.tar.gz`，SHA256 `649b46dd3a47f5c57ad74e244564cb60fd439495445e5e2cbf879ecfd3e29fc2`，尚未确认服务器部署。新机制：休赛期友谊赛保留受伤/伤退过程但不形成正式伤停；赛季中友谊赛仍形成伤停。

> 第一优先级：阅读 `handoff/LATEST_20260813.md`，继续在 `D:\Project\game_test\.worktrees\s4` 保留当前未提交工作树，禁止 reset/clean/整体 checkout。当前重点是每日重启 OOM/延迟开赛修复与预测市场大样本脚本；预测必须保持 V1 赔率、V2 实赛。对话交接 ZIP 不是生产部署包，不得覆盖服务器运行数据。

> 第一优先级：完整阅读 `handoff/LATEST_20260812.md` 和 `docs/sql-storage-assessment-20260812.md`。继续在 `D:\Project\game_test\.worktrees\s4` 工作并保留脏工作树，禁止 reset/clean/checkout。最新 V2.1 平衡热更新是 `handoff/football-ydl-s4-v21-balance-hotfix-20260812-092423.tar.gz`，SHA256 `bda8ebe17ed57ab19522e4f98e2e7dc4c90647e3e32f0a3187eaaf6dda180f0c`，当前尚未确认线上部署。SQL 迁移建议 PostgreSQL + Repository/UnitOfWork + 关系表/JSONB 混合模型，先离线导入和影子写入，不要直接替换生产存储。

> 第一优先级：完整阅读 `handoff/LATEST_20260811.md`，以其中的当前工作树边界、已完成改动和最新发布物为准。

## 2026-08-11 18:12 接手提示（先读）

继续在 `D:\Project\game_test\.worktrees\s4` 开发，保留当前脏工作树，禁止 reset/clean/checkout。当前最新生产候选是 `handoff/football-ydl-s4-honor-mail-tactics-hotfix-20260811-161002-r3.tar.gz`，SHA256 `5d4bc2b3d9b90e1013f9d8f1b03384a78c2fe3c228142f080fc01f77c4667e44`。R2 没有推送，R3 是修复普通 A 级 `+8` 卡面遮挡后的版本；尚未确认服务器已经部署，接手后不要假设已上线。

R3 包含荣誉室、背包 YOOGLE 球员详情、邮件分类与 `+6` 以上全服强化邮件、具体让球显示、体力红线数字输入、磁贴体力变色、市场“附带所有权”、普通 A/B `+8` 专属框和收件箱字号等。不要再部署重叠旧包。

服务器磁盘已从约 98% 清理到 70%，服务健康；只删除了核对为非活动的旧快照。活动分片的 3850 个 revision 中 3845 个仍被 manifest 引用，严禁手动删除 `revisions/*` 或历史 manifest。若继续处理空间，先在本地实现并测试离线 forceFull 压缩/原子切换工具。

0811 赛季分析源在 `Cloud_league_data\0811\ydl-season-2026-08-11.json`，只分析 116 场真人对真人。摘要和图表见最新交接包的 `analysis/`，原始 31MB 存档不在 ZIP 内。最新交接 ZIP 为 `handoff/football-ydl-s4-handoff-20260811-1812.zip`，不是生产部署包。

## 2026-08-11 00:37 接手提示（先读）

继续在 `D:\Project\game_test\.worktrees\s4` 开发，保留脏工作树，禁止 reset/clean/checkout。最新新增全位置正式特性“别打我大哥”，其 V2.1 伤病转移链路已经覆盖真实伤退、自动换人、比赛播报和赛后伤停；原队友保持在场。正式特性池现为 19 张。

最新生产包是 `handoff/football-ydl-s4-pack-market-legend-trait-hotfix-20260811-003616.tar.gz`，SHA256 `b709afee062d2c1617f195ddb990cf739710fea53fe409fbc3b6f2b09b03ae8d`。它取代同日 000707 包，并合并私有池/市场性能、全位置私有池 1.5% 随机传奇 S、传奇包 10000 金币和新特性。不要安装依赖，不覆盖任何数据目录。新特性定向测试 32/32 通过，按用户要求不要运行完整测试集。

最新本地对话交接 ZIP 为 `handoff/football-ydl-s4-handoff-20260811-0037.zip`，只用于恢复上下文，不是服务器部署包。浏览器测试由用户自行完成。

## 2026-08-05 22:00 接手提示（先读）

继续在 `D:\Project\game_test\.worktrees\s4` 开发，保留当前脏工作树，禁止 reset/checkout 清理。先阅读 `handoff/CURRENT_STATE.md` 顶部，再执行只读 `git status --short`。

最新成果包括世界杯完善、休赛期友谊赛和玩家阵容镜像、战术板 AI 对战、V2 alpha.17 平衡与详细播报、自动伤病换人、伤停计时热修、两张 A 卡，以及 `/versus/v2-circle-demo.html`。圆圈 Demo 的固定回放数据由 `node devtool/generate-v2-circle-demo.js` 生成，不要用手写随机事件替代真实 V2 控球链。

最新完整开发交接包为 `D:\Project\game_test\handoff\football-ydl-s4-v2-circle-demo-handoff-20260805-2200.zip`。它用于恢复开发上下文，不是生产部署包。禁止打包或覆盖运行存档、线上分片、`Cloud_league_data/`、`outputs/`、账号、密钥和临时素材。本轮按用户要求未运行完整测试。

## 2026-08-04 13:27 接手提示（先读）

继续在 `D:\Project\game_test\.worktrees\s4` 开发，不要重置或清理脏工作树。当前未提交成果是“黄狗世界杯”及同期后台性能修改。先阅读 `handoff/CURRENT_STATE.md` 顶部权威状态，再只读检查 `git status --short`。

世界杯当前为 12 队、三组、每组 3 真人 + 1 AI、三轮小组赛和八强单淘汰；淘汰赛已有加时点球。今日概览的今日赛程只显示当前玩家比赛，完整“世界杯赛程”页显示所有已确定双方的对阵；未赛不可点，完赛可打开既有比赛详情。国家队战术入口在共享阵容战术页，世界杯结束后 30 分钟关闭。临时球员禁止参与普通轮询重建，并在当日赛事关闭后清理。

不要打包、覆盖或迁移 `data/yellowdogs-league.json.live/`、`day6-tactical-results.json`、`Cloud_league_data/`、线上分片、账号、密钥或任何运行存档。用户自行管理 4312 本地测试服务器，不要擅自启动或停止。当前验证为 `test/world-cup.test.js` 5/5、`test/s4-assets.test.js` 98/98、构建与差异检查通过。最新完整交接包是 `D:\Project\game_test\handoff\football-ydl-s4-world-cup-handoff-20260804-1327.zip`。

## 2026-08-03 13:20 最新接手指令

- 正式服已恢复在线（阿里云香港 2核2G，systemd `football-s4`）。已部署 1141（运营覆盖+传奇所有权清理，team1 27/33）与 1320（轻量同步+静态 gzip+诊断工具）。
- 当前第一任务：在服务器运行 `node devtool/profile-live.mjs $(pgrep -f "devtool/public-server.js" | head -1) 60` 抓 60 秒 CPU 火焰（无需停服），确认持续 ~75% 单核占用来源（疑直播快照 `publicMatch`/比赛推进 `runV2Chain`/`advanceVersusMatch`）。
- 随后按优先级：view() 按页签瘦身（playerDirectory 441KB/inbox 135KB/强化历史 123KB 改按需）、每日重置与归档异步化、直播快照降频/增量。
- 环境提醒：`/etc/football-s4.env` 第 2 行 bash source 报错，读配置用 `sudo grep '^KEY=' /etc/football-s4.env`；不要用 `nohup node --cpu-prof`（残留进程占 4318 端口造成 EADDRINUSE 崩溃循环，教训见 CURRENT_STATE）。
- 压测工具：`devtool/loadtest-http.mjs`（head/broadcasts/league/static；league 端点压测会真实吃 CPU，并发 2-3、30s 内）。

## 2026-08-03 10:47 最新接手指令

正式服在部署 10:15 商店/市场/开包性能包后无法启动，错误为 `球队超过33人大名单额度：ydl-team-1`，systemd 曾重启 163 次。先确认服务保持停止，不要启动、重新迁移或覆盖分片。用户提供的 day6 最新单 JSON 已由当前代码验证通过：84,800,585 字节、10 队、6424 张总卡、579 张活动卡；team1 为 39 张活动卡、31 个家族、正确名单占用 19/33，因此不是坏档。

当前第一任务是获取用户执行线上只读诊断后的输出，核对 `/etc/football-s4.env` 的 `YELLOWDOGS_LEAGUE_PATH`、manifest revision、team1 活动卡/家族/占用明细和线上 `s4-assets.js`。若线上分片确实超过 33，再定位具体家族来源；若线上计数与 day6 一致，则同步正确代码。禁止先修改存档规避断言。

最新性能发布物为 `handoff/football-ydl-s4-shop-market-packs-performance-hotfix-20260803-1015.tar.gz`，SHA256 `15BCB3BDC469BEF154A82A9375A1016F36DBD2D22C20663F3F2E16F9A758B822`。最新 DLC2 发布物为 `handoff/football-ydl-s4-dlc2-players-webp-hotfix-20260803-0422.tar.gz`，SHA256 `C7180F4957B99937B0B9E1A9A47DA627FCFE590A946E4A0B957793331A5C43BB`。最新完整交接包为 `D:\Project\game_test\handoff\football-ydl-s4-v2-handoff-20260803-1047.zip`。

## 2026-08-02 23:21 推荐部署包

服务器下一次只需部署 `handoff/football-ydl-s4-card-admin-v2-review-combined-hotfix-20260802-2321.tar.gz`。它合并了 23:01 的 `+4` 特性绑定/后台发卡轻量化和 23:19 的 V2 复盘指标修复，SHA256 为 `5418C07DB94B129BB0138C182B63042CC000F64124843003D57DD2C8C95F6EF1`。不要再叠加部署两个独立包；不要覆盖或迁移 `data`。最新完整交接包是 `D:\Project\game_test\handoff\football-ydl-s4-v2-handoff-20260802-2324.zip`。

## 2026-08-02 23:19 最新接手指令

比赛详情顶部失利因素分析曾显示阵型结构、位置和战术全部为 0。根因是 V2 `analysisTimeline` 没有写入旧复盘算法读取的三个兼容指标。新比赛现保存真实阶段指标，已完成的旧 V2 比赛在 `history-detail.js` 读取时回填，不重算、不写回存档。热修为 `handoff/football-ydl-s4-v2-review-metrics-hotfix-20260802-2319.tar.gz`，SHA256 `92B6520EE8DF754D09DD0A552EFCC7FC659E1D0BFF5CC2342EC8C48E578CD1E3`；完整交接包为 `D:\Project\game_test\handoff\football-ydl-s4-v2-handoff-20260802-2322.zip`。

## 2026-08-02 23:01 最新接手指令

用户确认分片性能热修后流畅很多。随后修复了 `+4` 特性绑定卡住和后台指定球员卡发放无响应：两个接口已改为 compact mutation，前端局部合并结果；特性选择移除 620ms 等待并减少动画节点。分片端到端发卡、合成、绑定、重载测试通过。最新发布物为 `handoff/football-ydl-s4-card-trait-admin-grant-hotfix-20260802-2301.tar.gz`，SHA256 `2A81B53A20B948CA2E4FD8E157B7F1B80DF86E42A89B50D5DCE2CA636025028C`；最新完整交接包为 `D:\Project\game_test\handoff\football-ydl-s4-v2-handoff-20260802-2305.zip`。继续保留正式服原始 JSON 和现有分片目录，部署本包只覆盖代码文件。

## 2026-08-02 22:07 最新接手指令

当前代码为 `match-engine-v2-alpha.15`，正式服刚完成单 JSON 到分片存储的迁移，迁移报告 `ok:true`。首个 21:45 合并包造成前端空骨架，因为 `versus/public/app.js` 在公网安全模式下导入了不可访问的 `/game/public/schema.js`。当前工作树已经修复；只使用 `football-ydl-s4-frontend-startup-hotfix-20260802-2156.tar.gz` 或 `football-ydl-s4-combined-hotfix-20260802-2145-fixed-v2.tar.gz`，禁止部署无 `-fixed-v2` 后缀的旧合并包。

接手后的第一件事是向用户确认紧急前端包是否已经覆盖以及线上页面是否恢复，然后检查：

```bash
sudo systemctl status football-s4 --no-pager -l
sudo journalctl -u football-s4 -n 100 --no-pager
grep '^YELLOWDOGS_LEAGUE_PATH=' /etc/football-s4.env
grep -n 'game/public/schema' /opt/football-s4/versus/public/app.js
```

最后一条应无输出。不要重新迁移、删除原始 JSON、重算比赛或在已有分片新写入后回滚到旧 JSON。继续开发只能使用 `D:\Project\game_test\.worktrees\s4`，禁止清理或回退现有工作树。

## 2026-08-02 10:38 最新接手指令

当前版本是 alpha.12，不是下方 alpha8/alpha4。最新工作已完成五场直播小切片、读取接口去副作用、重启断点续算、真实加时赛/IFAB 点球，以及完赛存档阻塞和观战自动重连修复。

正式服务器当前由用户停止。最新部署包为 `handoff/football-ydl-s4-v2-alpha12-postmatch-reconnect-hotfix-20260802-1037.tar.gz`，SHA256 为 `6314AF7AFE83F04BFF8CC94B6872F02AF695D77224752D9877C78FA4ED8C2390`。部署时必须先备份且保留 `/opt/football-s4/data`，不要手动重新模拟中断轮次。未完赛从存档检查点续算，已结算比赛不重算。

故障判断必须区分“客户端请求超时”和“进程崩溃”：现有日志只有管理员 `signal=TERM`，无 OOM。若 alpha.12 后仍超时，应收集超时准确时间前后 `journalctl`、CPU/内存/磁盘延迟和具体接口，不要凭超时提示断言服务退出。

## 2026-08-02 最新接手指令

继续开发时以 `D:\Project\game_test\.worktrees\s4` 为唯一工作目录。先阅读本文件顶部、`handoff/README.md` 顶部和 `handoff/CURRENT_STATE.md` 的“2026-08-02 00:39 权威状态”，再只读执行：

```powershell
git status --short --untracked-files=all
git log -1 --oneline --decorate
```

当前引擎是 alpha8，不是下方历史段落中的 alpha4。联赛、杯赛和友谊赛已完成 V2 接入；预测仍走 V1。战术板、三阶段详细战术、V2 战术适配度和赛后复盘已经实现。

手机端战术页刚完成性能与响应式优化：滑杆轻量同步、球员拖动合帧和矩形缓存、触屏悬浮关闭、替补席三列独立滚动、三阶段分页以及横竖屏适配。用户已经完成真机测试。对应代码集中在 `versus/public/app.js`、`versus/public/styles.css`，回归位于 `test/s4-assets.test.js`。

最新发布物：

- `handoff/football-ydl-s4-v2-all-events-hotfix-20260801-2341-r3.tar.gz`
- `handoff/football-ydl-s4-mobile-tactics-hotfix-20260802.tar.gz`
- `D:\Project\game_test\handoff\football-ydl-s4-v2-handoff-20260802-0039.zip`

服务器最后一次部署状态必须现场检查，不能因本地存在热更新包就假定已经上线。禁止 reset、clean、checkout、擅自提交、推送、打 tag 或覆盖用户数据。`.tmp-browser-formation-lines/`、测试账号数据、`outputs/` 和正式联赛数据都不得打包或部署。

下方内容为历史交接提示；与本节冲突时以本节为准。

最新状态：V2 已升级为 `match-engine-v2-alpha.4` 并接入本地测试服 YDL 联赛；测试服整轮 5 场同时直播，正式环境仍默认 V1。整数分钟、裁判天气、中文多人播报、助攻详情和低 xG 校准已完成。下一步优先运行十核心 30,000 场 V1/V2 全量对照并分析；正式服务器为 2 核 4GB，建议随后实现“后台密封预演算 + 电视台定时揭示”。

工作目录：`D:\Project\game_test\.worktrees\s4`

请依次完整阅读：

- `handoff/README.md`
- `handoff/CURRENT_STATE.md`
- `handoff/CHANGED_FILES.txt`
- `handoff/MANIFEST.md`
- `docs/match-engine-v2-parameters.md`

然后只读执行：

```powershell
git status --short
git log -1 --oneline --decorate
```

核心状态：

- Git 基线为 `dcc8049`，tag 为 `S4-August1st`。
- `versus/match-engine.js` 与 `versus/rules.js` 保持未修改；`versus/league-service.js` 已增加测试服 V1/V2 路由，禁止回退。
- V2 核心位于 `versus/v2/`，已完成参数规范、20 区域空间模型、六阶段控球链和完整 90 分钟执行器。
- 完整执行器支持 180 条控球链、比分驱动动态战术、红牌/二黄、伤病离场与赛后后果、任意球/角球/点球执行链、扑救/脱手/补射/进球和全场播报。
- YDL 正式特性池为 18 张，新增“顺风战士”“赖着不死”“大巴司机”；“极限一换一”仅保留在后台草稿，不进入正式池。
- 对照配置为 30,000 场、10 worker、100 场分片、逐场进度条和 ETA；结果增加 xG 分桶与完整进球样本。旧 19 worker 运行已停止，alpha4 全量尚未完成。
- 唯一未接入项是换人计划，但 YDL 比赛中明确不可换人；传奇特殊能力按规则移除，不作为待办。
- 本地测试服 YDL 使用 V2；正式环境仍默认 V1。用户验收、全量平衡和服务器预演算架构完成前不要制作正式 V2 热修、提交、推送、打 tag 或部署。
- 工作树中的 `data/ydl-content-overrides.json` 含后台特性草稿，必须保留，禁止重置或覆盖。

运行全量模拟：`npm run compare:engine:v1-v2`。完成后分析主 JSON 与 `-raw-samples.json`，重点检查整体进球/xG、低 xG 分桶、阵型与战术方向、牌、伤病、定位球和助攻率。

禁止擅自提交、推送、打 tag、部署或将 V2 接入正式比赛。
# 新对话必须先阅读 `handoff/LATEST_20260816.md`

当前唯一开发目录是 `D:\Project\game_test\.worktrees\s4`，分支 `codex/v2.1-dynamic`，基线 `40e22d2`。工作树有大量未提交成果，禁止 reset、clean、整体 checkout、覆盖、擅自提交或推送。

最近完成三项功能：默认职责不再错误继承专项职责；战术板使用 `dynamic-shape-v2.1-stable.9` 显示默认/进攻/防守动态落位；V2 定位球由场上最高 `setPieces` 球员主罚、点球由最高 `finishing` 球员主罚。动态预览接口为 `POST /api/versus/league/team/tactical-shape-preview`，必须同时部署 `versus/api.js`。

正确生产包是 `handoff/football-ydl-s4-dynamic-tactics-setpiece-hotfix-20260815-223403.tar.gz`，SHA256 `7a1afb319f91b64d45d87d3d059491317ecfa52239de188c8ad922544f3cf15e`。旧 `221900` 包漏 API 路由，线上会显示 `league API not found`，禁止再次部署。用户已开始安装修正版，但尚未确认最终线上恢复；部署时不要用会保留时间属性的普通用户 `cp -a`，应使用 `sudo install -D -m 0644` 逐文件安装。

最近还分析了体力：空间模型用 `0.72 + fitness / 357` 缩放能力，每条控球链按战术、耐力和职责消耗体力；但最终终结层体力修正不完整、耐力差异较弱、没有常规实时体力换人、伤病基本不读取体力。本轮没有修改体力代码。

按用户安排，浏览器和真机测试由用户执行，不要主动运行。
