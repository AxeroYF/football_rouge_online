# YFFM1

基于原 S4 的足球经营游戏：组建球队、安排战术、培养与交易球员，参加联赛、杯赛、赛季总决赛和好友比赛。

当前工作分支为 `codex/yffm1`，从 `codex/s4-final-updates-20260826` 的 `887df19` 继续开发。原始交接入口保存在 `docs/archive/S4-README.md`。当前默认分支所属的 Rougelite 是另一条游戏线，不作为本项目的开发基线。

项目版本 **0.3.0**，版本标签 `yffm1-v0.3.0`；比赛引擎版本 **3.0.0**、分片存储格式 **2** 分别管理。发布内容见 [变更日志](CHANGELOG.md)，分支、标签和回滚约定见 [版本管理记录](docs/YFFM1-RELEASES.md)。

## 本地运行

需要 Node.js 22 或更新版本。首次运行：

```sh
npm ci
npm run dev
```

已经安装依赖时，也可直接运行 `node server.mjs`。

- 游戏：[http://127.0.0.1:4310/versus/](http://127.0.0.1:4310/versus/)
- 后台：[http://127.0.0.1:4310/admin/](http://127.0.0.1:4310/admin/)
- 本地开发后台密码：`local-dev-admin`。

可复制 `.env.example` 为 `.env`。生产或非本机监听必须设置至少 16 字符的 `YFFM_ADMIN_PASSWORD`（兼容 `VERSUS_ADMIN_PASSWORD`）。`.env` 不进入版本库。默认仅监听本机。

`server.mjs` 启动主体联赛和后台；`npm run devtool` 保留原开发工具入口；七人制历史原型仍在 `game/`。新比赛默认使用 **V3.0**（`engineVersion:3.0.0`、`v3.0-tactical-control.1`）。可显式设置 `YFFM_MATCH_ENGINE=v2` 使用 V2.1 对照；旧 `YDL_MATCH_ENGINE` 及各赛事覆盖变量继续兼容。V3 实施、抽样与战术验证见 [V3.0 记录](docs/YFFM1-V3.md)。

AI 对战前台当前保留单次系统 AI、休赛期基础镜像和完整战术镜像；批量模拟、服务器运行节点及计算节点管理暂不显示。对应实现、后端接口和历史结果保留，前台开关位于 `versus/public/app.js` 的 `LEAGUE_AI_BATCH_UI_ENABLED`。

国家队与俱乐部装饰已对所有新老玩家免费开放（当前 34 + 51 款），在“背包 → 道具”直接佩戴。相关礼包已从商店及后台新发放目录下架，装饰不再交易；旧挂牌在服务加载存档时备份并自动撤下，返还托管装饰，保留原佩戴、金币和历史交易。已有旧礼包仍可兼容开启。

分片存储使用文件级引用回收：保留当前存档、备份引用及最近两个 revision，账本分段达到 64 段后合并。普通及每日重置前备份保留 7 天，迁移/管理备份保留 30 天。针对 2 核、2GB 内存、80GB 磁盘的评估、实测及恢复要求见 [存储与服务器性能记录](docs/YFFM1-STORAGE-PERFORMANCE.md)。`node scripts/audit-league-storage.mjs <分片目录>` 只读统计空间与引用，不执行清理。

P1 已加入总决赛独立分片、完整战报/归档 gzip、战报按需读取与有界缓存、玩家分片增量比较。旧存档兼容、离线完整转换、回滚要求及测试指令见 [P1 存储优化记录](docs/YFFM1-STORAGE-P1.md)。

球员开包已复用 Rougelite 的流星背景、候选卡入场、选中高亮和获卡展示；连续开包保留舞台节点。球员卡统一使用 Rougelite 的盾形卡框及 S/X 蓝金、A 青绿银、B 梅紫铜、C 松绿灰配色。卡包包装外观和抽取规则不变，详见 [开包效果接入记录](docs/YFFM1-PACK-OPENING.md)。

## 当前代码入口

| 路径 | 用途 |
| --- | --- |
| `server.mjs`、`devtool/server.js` | 配置加载、HTTP 服务及调度 |
| `versus/league-service.js`、`versus/api.js` | 联赛状态与业务接口 |
| `versus/room-service.js`、`versus/infrastructure/` | 账号、房间与持久化 |
| `versus/v3/`、`versus/v2/`、`versus/public/` | V3 配置与抽样、共享计算及 V2 对照、游戏界面 |
| `src/runtime-config.js`、`devtool/static-asset-cache.js` | 共享配置和静态资源缓存 |
| `test/`、`scripts/` | 当前测试、检查与审阅工具 |
| `offline/`、`apps/yellowdogs-tv-android/` | 离线构建及电视台客户端 |

根目录同名 `league-service.js`、`app.js` 等是 S4 归档副本。运行入口使用 `versus/` 中的代码，修改前应检查 import 路径。历史发布/交接资料保留其原名称。

## 检查

```sh
node scripts/check-source.mjs
npm run test:quick
npm test
npm run benchmark:static
```

快速测试覆盖当前 64 个文件；完整测试另含 7 个长跑文件，当前仍有历史失败及超时，详见 [优化交付记录](docs/YFFM1-IMPLEMENTATION.md)。每次运行的逐文件日志和 JSON 结果保存在 `outputs/tests/`，该目录不提交 Git。可定向运行 `node scripts/run-tests.mjs test/account-persistence.test.js`。

浏览器审阅工具为 `node scripts/review-yffm1.mjs`，需本机安装 Playwright 和浏览器；`BROWSER_CHANNEL=chrome` 可使用系统 Chrome。`PLAYWRIGHT_REQUIRE_FROM` 可指向已有的依赖目录。当前项目的运行依赖没有因此增加。

前端流畅度优化及原版显示对照见 [性能记录](docs/YFFM1-PERFORMANCE.md)。`npm run benchmark:render` 使用本地基线文件比较两种尺寸下的节点复用、表单值和直播截图；依赖及运行方式见该记录。

比赛模型的阵型、战术操作与随机性评估见 [引擎评估](docs/YFFM1-ENGINE-ASSESSMENT.md)，包含离线对照工具和已确认的问题；该评估没有更改比赛规则或参数。

## 存档与兼容性

账号和联赛继续使用原 `data/versus-accounts.json`、`data/yellowdogs-league.json` 或环境变量指定的分片路径。新名称不会自动创建一套空存档，也不会清除现有进度。浏览器原登录键、API 路径、卡片 ID 及离线应用标识继续保留。

离线启动器显示名为 YFFM1 Offline，存档目录沿用旧 `YDL S4 Offline` 路径；详见 `offline/`。本轮没有发布新安装包或操作生产服务器。

当前 34 个功能系统及模式的完整度、优化方向和验证缺口，见 [功能系统评估报告（2026-11-04）](docs/YFFM1-FUNCTIONAL-ASSESSMENT.md)。本次隔离完整测试为 68 个文件中 64 个通过、3 个失败、1 个超时。世界杯和主教练已永久废弃，不再进入开发计划，也不计为活跃玩法的完整度缺口；付费名单扩容已下架。

俱乐部的经营循环、现行收益与分期建设建议见 [俱乐部深化评估](docs/YFFM1-CLUB-ASSESSMENT.md)。盾形卡框来自同仓库 `codex/rougelite`，原始源码已固定提交保存在 `reference/rougelite-card-frames/`，已接入正式游戏的统一卡面渲染器；详见 [卡框接入记录](docs/YFFM1-ROUGELITE-CARD-FRAMES.md)。`node scripts/preview-rougelite-card-frames.mjs` 仍可生成原始卡框的独立参考预览。

原始评估见 [整体评估](docs/YFFM1-ASSESSMENT.md)，本轮实施与验证边界见 [交付记录](docs/YFFM1-IMPLEMENTATION.md)。
