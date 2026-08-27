# V2 增量交接包清单

## 2026-08-18 大名单清退与管理员定向礼包

- 最新状态：`handoff/LATEST_20260818.md`。
- 收录 33 人大名单上限、管理员手动清退、超限球员锁定与玩家端展示、扩容道具下架，以及三种管理员定向礼包和私有池最终校验。
- 收录生产热更新 `football-ydl-s4-roster-enforcement-designated-packs-hotfix-20260818.tar.gz`，SHA256 `1762d36291ec6838c592be2c36cf87ab09cd6747e8431861346f5e307a75f8f4`。
- 服务器只确认上传和校验成功，尚未确认部署后服务健康；交接包不替代生产热更新包。
- 排除生产数据、分片、账号、密钥、`node_modules`、大型输出和卡画资源。

## 2026-08-16 动态阵型、定位球与体力分析交接

- 最新状态：`handoff/LATEST_20260816.md`。
- 收录默认职责修复、动态阵型预览、定位球主罚人和相关测试源码。
- 收录修正版生产热更新 `football-ydl-s4-dynamic-tactics-setpiece-hotfix-20260815-223403.tar.gz` 及 SHA256；不收录已知缺陷的 `221900` 包。
- 记录线上 `league API not found` 根因为漏带 `versus/api.js`，以及部署时应使用逐文件 `install` 的权限注意事项。
- 记录 V2.1 体力机制量化分析；该部分没有代码修改。
- 本交接 ZIP 仅用于恢复开发上下文，不包含运行数据、分片、outputs、history、APK、账号或密钥，不可整体部署生产服务器。

## 2026-08-14 17:40 金球奖 V3、预测 V9 与完整对话交接

- 最新状态：`handoff/LATEST_20260814.md`。
- 本轮核心：`versus/league-service.js` 与 `test/league.test.js`，包含金球奖冠亚军新加分、一次性历史复核、金币只补不追和全员公示邮件。
- 同步收录预测市场 V9、并行模拟、后台监测、半全场和真实总评自动换人相关当前源码/测试。
- 战术方案覆盖问题只记录诊断结论，尚未修复；接手后不得误报为已完成。
- 交接 ZIP 仅用于恢复本地开发上下文，不是生产包；不包含运行存档、分片、outputs、history、工作台数据、账号密钥或旧 staging。

## 2026-08-13 18:49 近期合并热更新与对话交接

- 对话交接包：`football-ydl-s4-handoff-20260813-1849.zip`，只用于恢复开发上下文，不是生产部署包。
- 合并生产热更新：`football-ydl-s4-recent-batch-hotfix-20260813-183713.tar.gz`，SHA256 `649b46dd3a47f5c57ad74e244564cb60fd439495445e5e2cbf879ecfd3e29fc2`，尚未确认线上部署。
- 最新改动包括本队联赛+杯赛综合榜单、荣誉室三个独立 TOP3 与多金球得主、V2.1 点球大战逐条播报、战术方案并发保护、每日重启/延迟开赛/502 修复和休赛期友谊赛无正式伤停。
- 交接包包含当前核心源码、相关测试、运维/存储文档和最新生产热更新；排除运行存档、正式分片、账号密钥、outputs、卡画大资源、旧展开目录和本地工作台数据。
- 当前 Git 基线：`40e22d2` / `S4-0813`，之后仍有未提交改动，不得清理工作树。

## 2026-08-13 每日重启、战术板与预测模拟对话交接

- 压缩包：`football-ydl-s4-handoff-20260813-1747.zip`。
- 最新状态：`handoff/LATEST_20260813.md`。
- 核心新增：`devtool/simulate-prediction-market.js`，默认 18 赛季/1620 场，V1 赔率、V2 实赛，逐轮进度和 ETA。
- 核心修复：`versus/league-service.js`、`versus/league-shard-store.js`、`admin/public/app.js` 及对应三个定向测试。
- 包含当前 V2.1、战术板、刷新恢复和相关测试源码；排除运行存档、分片、outputs、大型卡画、旧展开目录和账号密钥。
- 本包用于对话与开发交接，不是生产服务器整体部署包。

## 2026-08-12 V2.1 平衡、SQL 评估与对话交接

- 最新状态：`handoff/LATEST_20260812.md`。
- SQL 迁移评估：`docs/sql-storage-assessment-20260812.md`。
- 最新 V2.1 平衡热更新：`football-ydl-s4-v21-balance-hotfix-20260812-092423.tar.gz`，SHA256 `bda8ebe17ed57ab19522e4f98e2e7dc4c90647e3e32f0a3187eaaf6dda180f0c`。
- 新交接 ZIP 仅用于恢复开发上下文，不得直接覆盖生产服务；不包含运行存档、账号、分片、模拟输出或卡画大资源。


> 2026-08-11 18:12 最新交接包说明与文件边界见 `handoff/LATEST_20260811.md`。

## 2026-08-11 18:12 荣誉室/邮件/战术 UI R3 与对话交接

- 生产包：`football-ydl-s4-honor-mail-tactics-hotfix-20260811-161002-r3.tar.gz`。
- SHA256：`5d4bc2b3d9b90e1013f9d8f1b03384a78c2fe3c228142f080fc01f77c4667e44`。
- 运行文件：`versus/api.js`、`versus/league-service.js`、`versus/honor-room-seed.js`、`versus/public/index.html`、`versus/public/app.js`、`versus/public/styles.css`、`versus/public/s4-player-card.css`、`versus/public/honor-room.css` 与四张 `versus/public/honor_assets/*-v2.webp`。
- R3 取代同日 R2/R1 和重叠的 003616 包；不包含存档、分片、账号、工作台数据、依赖或原始卡画。
- 对话交接包：`football-ydl-s4-handoff-20260811-1812.zip`，包含 R3 归档、当前相关源码/测试、交接文档及 0811 分析 HTML/PNG；原始 31MB 赛季存档明确排除。
- 服务器清理只删除非活动旧快照；活动 revision 绝大多数仍被 manifest 引用，禁止把手工删除命令写入部署流程。

## 2026-08-11 00:37 开包/市场/传奇概率/新特性热更新与对话交接

- 生产包：`football-ydl-s4-pack-market-legend-trait-hotfix-20260811-003616.tar.gz`。
- SHA256：`b709afee062d2c1617f195ddb990cf739710fea53fe409fbc3b6f2b09b03ae8d`。
- 生产文件：`versus/league-service.js`、`versus/s4-balance.js`、`versus/trait-pool.js`、`versus/v2/match-engine-v2.js`、`versus/public/app.js`、`versus/public/styles.css`。
- 新卡“别打我大哥”为全位置正式特性；持卡人在场时承接其他队友伤病，伤退、换人、播报和赛后伤停使用转移后的真实球员。
- 本包包含并取代 `football-ydl-s4-pack-market-legend-hotfix-20260811-000707.tar.gz`。
- 对话交接包：`football-ydl-s4-handoff-20260811-0037.zip`，仅用于恢复本地开发上下文，不可整体覆盖生产服。
- 定向测试 32/32；按用户要求未运行完整测试集。

## 2026-08-05 22:00 V2 alpha.17 + 圆圈比赛完整交接包

- 压缩包：`football-ydl-s4-v2-circle-demo-handoff-20260805-2200.zip`
- 基础：继承 `football-ydl-s4-world-cup-handoff-20260804-1327.zip`，再以当前工作树覆盖 8 月 4 日之后的全部受控开发成果。
- 新增圆圈 Demo：`devtool/generate-v2-circle-demo.js`、`versus/public/v2-circle-demo.html`、`versus/public/v2-circle-demo.css`、`versus/public/v2-circle-demo.js`、`versus/public/v2-circle-demo-data.json`。
- 追加当前 V2/世界杯/AI 对战/友谊赛/伤停计时/球员卡源文件及相应测试；包内 `handoff/` 五份文档均为本次最新版。
- 明确排除：`data/yellowdogs-league*`、线上分片、`Cloud_league_data/`、`outputs/`、历史压缩包、`.git/`、`node_modules/`、账号、密钥、备份及 `x_profile` 临时图片。
- 验证：Demo 生成、JavaScript 语法、差异检查及桌面/手机浏览器检查通过；未运行完整测试。

## 2026-08-04 13:27 黄狗世界杯完整交接包

- 压缩包：`football-ydl-s4-world-cup-handoff-20260804-1327.zip`
- 基础：继承 `football-ydl-s4-v2-handoff-20260803-1047.zip` 的 V2 源码、测试与历史发布说明，并以当前工作树覆盖所有本轮修改文件。
- 新增：`test/world-cup.test.js`、`versus/public/world-cup-flags/*.svg`、世界杯前后端与后台管理逻辑、更新后的五份 handoff 文档和后台性能热修说明/归档。
- 包内不包含 `data/yellowdogs-league.json.live/`、`day6-tactical-results.json`、`Cloud_league_data/`、`outputs/`、账号、密钥、证书、运行存档或线上分片。
- 交接 ZIP 仅用于审阅和恢复开发上下文，不是可直接覆盖生产服的部署包。
- 校验：世界杯 5/5、前端资源 98/98、语法、构建、`git diff --check` 均通过。

## 2026-08-03 13:20 前端性能热修 + 诊断工具（取代 1229）

- 发布物：`handoff/football-ydl-s4-frontend-perf-light-sync-tools-hotfix-20260803-1320.tar.gz`
- SHA256：`C07CBC5AFA3645E58C20997496A516C0EF1D4745025396D768D7DECE02C23153`
- 内容：`league/head` 轻量同步（api.js + app.js + league-service.js）、`server.js` 静态 gzip、`view()` 复用 `ownTeamView` 去重；新增诊断工具 `devtool/loadtest-http.mjs`、`analyze-cpuprofile.mjs`、`profile-attach.mjs`、`profile-live.mjs`。
- 背景：2核2G 服务器 CPU 打满（实测 view 全量轮询 6 客户端 avg 3.7s/max 25s），分片增量保存实测 46ms 非瓶颈；持续 CPU 源待火焰数据定位（疑直播快照/比赛推进）。
- 取代 `football-ydl-s4-frontend-perf-light-sync-hotfix-20260803-1229.tar.gz`。

## 2026-08-03 12:29 前端性能热修（轻量同步 + 静态 gzip，取代 1205）

- 发布物：`handoff/football-ydl-s4-frontend-perf-light-sync-hotfix-20260803-1229.tar.gz`
- SHA256：`A04609E767BD5271933B743D17A88C56FD11BF8827F1001AF576818DDA411225`
- 改动：`versus/api.js` + `/api/versus/league/head`；`versus/public/app.js` 静默刷新改为 head 优先；`versus/league-service.js` 新增 `leagueHead` + `ownTeamView` 去重；`devtool/server.js` 静态文本资源 gzip。
- 实测（6 客户端、day6 数据）：全量视图请求 45s 从 24 次降到仅页面打开 6 次，head 平均 29ms；修复前平均 3.7s/最大 25s。
- 取代 `football-ydl-s4-frontend-perf-light-sync-hotfix-20260803-1205.tar.gz`，部署本包即可。

## 2026-08-03 12:05 前端性能热修（轻量同步）

- 发布物：`handoff/football-ydl-s4-frontend-perf-light-sync-hotfix-20260803-1205.tar.gz`
- SHA256：`371F8BA366D118D399D540945B9CFEB4D85EB0258AF28701FFF297876848A413`
- 根因：联赛页每 12 秒静默拉取完整视图（约 1.2 MB），`view()` 同步构建在 2 核服务器上把 CPU 打到接近单核满载（11 分钟跑 10m34s CPU）。
- 改动：新增 `POST /api/versus/league/head`（约 150 字节）；`refreshLeagueSilently` 先查 head，仅 `updatedAt`/赛季状态变化时再拉全量并重绘。涉及 `versus/league-service.js`、`versus/api.js`、`versus/public/app.js`。
- 验证：48/48 前端测试通过，head 149 字节；部署后客户端需刷新一次页面。

## 2026-08-03 11:41 roster overflow 运营覆盖热修

- 发布物：`handoff/football-ydl-s4-roster-overflow-ops-override-hotfix-20260803-1141.tar.gz`
- SHA256：`8F1BAA560FFA60416C37C7B1A8244987C977E97FBC013E43FCE0AA800CD072DE`
- 根因：运营评级覆盖（63 条，40 条 A/B→S）只在 admin/devtool 路径生效；游戏进程启动时联赛单例先于覆盖加载完成构造，名单校验用了静态评级，team1 按静态评级 36/33 超限崩溃。
- 改动：`devtool/server.js` 在 api/league-service 之前同步加载覆盖；`versus/ydl-content-store.js` 初始加载改同步；`versus/s4-assets.js` 加载时清除“升级为传奇但登记唯一所有权”的失效登记；附带 `data/ydl-content-overrides.json` 完整运营覆盖。
- 本包取代 `football-ydl-s4-roster-overflow-startup-hotfix-20260803-1053.tar.gz`，不要叠加部署旧包。备份与部署步骤见包内 `DEPLOY.md`。

## 2026-08-03 10:47 完整交接包

- 压缩包：`football-ydl-s4-v2-handoff-20260803-1047.zip`
- 在 2026-08-02 23:24 完整交接内容上补充 DLC2 正式球员池、仅 WebP 卡画、商店/市场/开包性能热修及 day6 启动事故诊断。
- 包含最新生产源码、相关定向测试、发布说明和可部署 tar.gz；交接 ZIP 用于恢复开发上下文，不直接整体覆盖生产服务器。
- 明确排除 `Cloud_league_data/`、`outputs/`、`player_dlc2/` 原始 PNG、工作簿、`.tmp-*`、运行中 `data/yellowdogs-league.json`、线上分片、账号、备份、密钥和证书。
- day6 存档不在包内；结论是本地校验通过，线上需先核对实际路径、manifest 和代码版本。

## 2026-08-02 23:21 合并热修

- 推荐发布物：`football-ydl-s4-card-admin-v2-review-combined-hotfix-20260802-2321.tar.gz`
- SHA256：`5418C07DB94B129BB0138C182B63042CC000F64124843003D57DD2C8C95F6EF1`
- 完整交接包：`football-ydl-s4-v2-handoff-20260802-2324.zip`
- 合并包含 23:01 卡片/后台修复与 23:19 V2 复盘指标修复。
- 不包含存档、分片目录、测试数据或凭据。

## 2026-08-02 23:19 V2 复盘指标热修

- 发布物：`football-ydl-s4-v2-review-metrics-hotfix-20260802-2319.tar.gz`
- SHA256：`92B6520EE8DF754D09DD0A552EFCC7FC659E1D0BFF5CC2342EC8C48E578CD1E3`
- 生产文件：`versus/history-detail.js`、`versus/public/v2-tactical-fit.js`、`versus/v2/match-engine-v2.js`
- 完整交接包：`football-ydl-s4-v2-handoff-20260802-2322.zip`

## 2026-08-02 23:01 增量热修

发布物：`football-ydl-s4-card-trait-admin-grant-hotfix-20260802-2301.tar.gz`

SHA256：`2A81B53A20B948CA2E4FD8E157B7F1B80DF86E42A89B50D5DCE2CA636025028C`

完整交接包：`football-ydl-s4-v2-handoff-20260802-2305.zip`

包含 5 个生产文件：`admin/public/app.js`、`versus/admin-api.js`、`versus/api.js`、`versus/league-service.js`、`versus/public/app.js`。不包含存档、分片目录、测试数据或凭据。

## 2026-08-02 22:07 alpha.15 + 分片存储完整交接包

压缩包：`football-ydl-s4-v2-handoff-20260802-2207.zip`

本包以 10:38 交接包为基础，追加 alpha.13-alpha.15、预测页优化、强化悬空特性修复、目录分片存储、迁移工具、电视台真实战术适配度、V2 抢断/X 任务、战术板羁绊增益和前端启动事故修正。

可部署发布物：

- `handoff/football-ydl-s4-frontend-startup-hotfix-20260802-2156.tar.gz`
- `handoff/football-ydl-s4-combined-hotfix-20260802-2145-fixed-v2.tar.gz`

禁止部署或收录无 `-fixed-v2` 后缀的旧合并包。旧包含公网不可访问的跨目录浏览器 import，第一版修正版的说明文件名也不准确。

交接包明确排除正式 `yellowdogs-league.json`、生成后的分片目录、`Cloud_league_data/`、`outputs/`、账号、备份、凭据、`.tmp-*` 和旧 handoff ZIP。交接 ZIP 用于恢复开发上下文，不直接作为服务器发布包。

## 2026-08-02 10:38 alpha.12 完整增量交接包

压缩包：`football-ydl-s4-v2-handoff-20260802-1038.zip`

本包在 00:39 alpha8 交接内容基础上，追加 alpha9-alpha12 的正式服热修：角球/伤病/X 球员修复、真实加时赛与 IFAB 逐轮点球、五场直播轮转切片、查询接口只读、重启断点续算、紧凑完赛保存和观战自动重连。

最新可部署包：`handoff/football-ydl-s4-v2-alpha12-postmatch-reconnect-hotfix-20260802-1037.tar.gz`，SHA256：`6314AF7AFE83F04BFF8CC94B6872F02AF695D77224752D9877C78FA4ED8C2390`。

继续明确排除 `Cloud_league_data/`、`outputs/`、运行中 `data/yellowdogs-league.json`、账号、备份、密钥、临时目录和旧 handoff ZIP。交接 ZIP 仅用于审阅/恢复开发上下文，服务器只部署上述 tar.gz 热更新包。

## 2026-08-02 完整增量交接包

压缩包：`football-ydl-s4-v2-handoff-20260802-0039.zip`

本包基于 `dcc8049`（tag：`S4-August1st`），包含当前未提交的 V2 alpha8、全赛事接入、战术/复盘/后台功能、手机端战术优化及对应测试。它是供下一任务审阅和恢复工作的增量包，不应直接覆盖一个包含更新进度的工作树。

重点内容：

- 五份 `handoff/` 状态文档。
- `HOTFIX_V2_ALL_EVENTS_20260801.md`、`HOTFIX_MOBILE_TACTICS_20260802.md`。
- 最新可部署热更新包：全赛事 V2 r3 与手机端战术增量包。
- `versus/v2/` 的 alpha8 引擎、参数、空间模型、控球链、联赛适配器、压力测试和比较器。
- `versus/public/` 的阵型参考线、V2 战术配置、赛后复盘和移动端优化。
- 联赛服务、API、后台、规则、平衡、特性与内容存储改动。
- `admin/public/`、`game/public/trait-runtime.js`、`devtool/`、部署环境示例和 `package.json`。
- 当前相关测试文件与 `docs/match-engine-v2-parameters.md`。
- 赛后复盘 demo 和内容覆盖 JSON；不包含运行中的玩家/联赛存档。

明确排除：

- `.tmp-browser-formation-lines/`
- `data/s4-test/`
- `outputs/`（包括体积较大的 5000 场核心结果和原始样本）
- `Cloud_league_data/`
- `node_modules/`、`.git/`、历史 handoff ZIP、旧版热更新 tar
- 账号、密码、证书、私钥、Cloudflare/Origin CA 凭据和服务器正式数据

alpha8 5000 场结果继续保留在本机：

- `D:\Project\game_test\.worktrees\s4\outputs\S4比赛引擎V1-V2-alpha8-5000-validation.json`
- `D:\Project\game_test\.worktrees\s4\outputs\S4比赛引擎V1-V2-alpha8-5000-validation-raw-samples.json`

以下旧清单为 alpha4 历史记录，不再代表当前版本。

alpha4 增量包包含 YDL V2 完整执行器、本地测试服整轮路由、整数分钟、裁判天气、中文多人播报、助攻详情、低 xG 校准和十核心全量比较器。包内继续排除 `outputs/`。

压缩包：`football-ydl-s4-v2-handoff-20260801-1305.zip`

基线：`dcc8049`（tag：`S4-August1st`）

包内包含：

- 五份 `handoff/` 交接文档。
- `docs/match-engine-v2-parameters.md`。
- `versus/v2/` 全部参数、空间、控球链、完整比赛执行器、联赛适配器和对照模拟源码。
- `versus/league-service.js`、`versus/public/app.js`、`devtool/test-environment.js` 和 `devtool/server.js` 的测试服接入及连接修复。
- 七个 V2 专项测试文件，以及特性和内容存储测试。
- `package.json` 中 V1/V2 对照模拟命令。
- `versus/s4-balance-report.js` 的确定性阵容生成器导出。
- `game/public/trait-runtime.js`、`versus/trait-pool.js`、`versus/ydl-content-store.js` 的正式特性接入。
- 当前 `data/ydl-content-overrides.json`，用于保留后台特性草稿。
- “极限一换一”仅作为该草稿文件中的 draft，未进入正式特性池。

包内不包含：

- `outputs/` 中所有全量、诊断和冒烟结果。
- `Cloud_league_data/`、正式联赛存档、账号和备份。
- WebP/PNG 球员卡美术与历史发行源码；这些已在 `S4-August1st` 基线中。
- `node_modules/`、`.git/`、构建产物、旧 `SOURCE_SNAPSHOT/`。
- 密码、Cloudflare、Origin CA 或服务器私钥。

这是基于 `S4-August1st` 的增量审阅与跨任务恢复包。正式服仍默认 V1；2 核 4GB 服务器的后台预演算播放架构尚未实现。不要用它覆盖当前工作区。
