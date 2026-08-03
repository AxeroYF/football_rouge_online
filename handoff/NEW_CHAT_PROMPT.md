# 新任务接手提示

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
