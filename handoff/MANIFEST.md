# V2 增量交接包清单

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
