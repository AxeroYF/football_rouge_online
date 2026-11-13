# YFFM1

基于原 S4 的足球经营游戏：组建球队、安排战术、培养与交易球员，参加联赛、杯赛、赛季总决赛和好友比赛。

当前工作分支为 `codex/yffm1`，从 `codex/s4-final-updates-20260826` 的 `887df19` 继续开发。原始交接入口保存在 `docs/archive/S4-README.md`。当前默认分支所属的 Rougelite 是另一条游戏线，不作为本项目的开发基线。

项目版本 **0.3.0**，版本标签 `yffm1-v0.3.0`；比赛引擎版本 **3.3.0**、分片存储格式 **2** 分别管理。发布内容见 [变更日志](CHANGELOG.md)，分支、标签和回滚约定见 [版本管理记录](docs/YFFM1-RELEASES.md)。

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

后台联赛页使用“赛季与重置”统一管理重赛、换季和完全重置。只有完全重置清空原有金币；其余操作保留余额和玩家资产，操作前展示影响并校验确认，完成后回到报名阶段。规则与验证见 [后台修复及重置说明](docs/YFFM1-ADMIN-P1-AND-RESETS.md)。

可复制 `.env.example` 为 `.env`。生产或非本机监听必须设置至少 16 字符的 `YFFM_ADMIN_PASSWORD`（兼容 `VERSUS_ADMIN_PASSWORD`）。`.env` 不进入版本库。默认仅监听本机。

`server.mjs` 启动主体联赛和后台；`npm start`、`npm run dev`、`npm run demo` 与 `npm run devtool` 均使用此入口。首页自动进入 `/versus/`。七人制 Roguelite、旧场边实验室及其模拟接口已移除，详见 [模式清理记录](docs/YFFM1-MODE-CLEANUP.md)。新比赛默认使用 **V3.3**（`engineVersion:3.3.0`、`v3.3-tactical-execution.1`），新增压迫触发与分工、指定出球、角球套路、针对性防守、时间条件与主动轮换，并提供战术执行复盘；沿用连续足球时间、完整随机状态和锁定配置。旧比赛保留其已保存版本。可显式设置 `YFFM_MATCH_ENGINE=v2` 使用 V2.1 对照；旧 `YDL_MATCH_ENGINE` 及各赛事覆盖变量继续兼容。操作及验证见 [V3.3 升级记录及与 V3.0 对比](docs/YFFM1-V33.md)，连续时间基础见 [V3.2 升级记录](docs/YFFM1-V32.md)，可靠性基础见 [V3.1 记录](docs/YFFM1-V31.md)，历史抽样与战术验证见 [V3.0 记录](docs/YFFM1-V3.md)。

`npm run build` 构建当前游戏和后台至 `versus/dist/`、`admin/dist/`。

顶部“游戏设置”集中管理电脑端主题、开包动画、卡片显示和战术板辅助；“场上球员显示方式”可在磁贴与缩小版盾形球员卡之间切换。设置自动保存在当前浏览器；系统关闭动画时，可将开包动画改为“开启”播放流星和卡片演出。详见 [游戏设置](docs/YFFM1-SETTINGS.md)。

全游戏视觉重建的四套候选方案、模块范围和实施顺序见 [整体视觉重建评估](docs/YFFM1-FULL-VISUAL-REBUILD.md)；该文档为规划，实际界面按当前实现运行。

赛事直播加入限时置顶重点事件、持续滚动的事件列表、当前战术原则与预案切换说明，并支持过期观赛会话恢复及完整状态刷新。操作和验收方法见 [直播改进记录](docs/YFFM1-LIVE-IMPROVEMENTS.md)。

“阵容战术 → 球队战术原则”顶部常驻“AI 对战”和“玩家镜像”两个入口，无需展开工具。保留单次系统 AI、休赛期基础镜像和完整战术镜像；批量模拟、服务器运行节点及计算节点管理暂不显示。镜像入口会优先选中可用镜像，赛季进行中或名单为空时显示原因。对应实现、后端接口和历史结果保留，批量功能的前台开关位于 `versus/public/app.js` 的 `LEAGUE_AI_BATCH_UI_ENABLED`。

国家队与俱乐部装饰已对所有新老玩家免费开放（当前 34 + 51 款），在“背包 → 道具”直接佩戴。相关礼包已从商店及后台新发放目录下架，装饰不再交易；旧挂牌在服务加载存档时备份并自动撤下，返还托管装饰，保留原佩戴、金币和历史交易。已有旧礼包仍可兼容开启。

分片存储使用文件级引用回收：保留当前存档、备份引用及最近两个 revision，账本分段达到 64 段后合并。普通及每日重置前备份保留 7 天，迁移/管理备份保留 30 天。针对 2 核、2GB 内存、80GB 磁盘的评估、实测及恢复要求见 [存储与服务器性能记录](docs/YFFM1-STORAGE-PERFORMANCE.md)。`node scripts/audit-league-storage.mjs <分片目录>` 只读统计空间与引用，不执行清理。

P1 已加入总决赛独立分片、完整战报/归档 gzip、战报按需读取与有界缓存、玩家分片增量比较。旧存档兼容、离线完整转换、回滚要求及测试指令见 [P1 存储优化记录](docs/YFFM1-STORAGE-P1.md)。

球员开包已复用 Rougelite 的流星背景、候选卡入场、选中高亮和获卡展示；连续开包保留舞台节点。球员卡统一使用 Rougelite 的盾形卡框及 S/X 蓝金、A 青绿银、B 梅紫铜、C 松绿灰配色。卡包包装外观和抽取规则不变，详见 [开包效果接入记录](docs/YFFM1-PACK-OPENING.md)。

## 首批球员建队（2026-11-13）

新建队先选 8 种阵型之一和 7 种战术风格之一，再点击三次，分别批量揭晓前场、中场、后场及门将。每套 22 人（11 名首发及其替补），按位置补齐，结合风格所需能力加权抽取；并非保证抽到高评级球员。确认后同步首发站位与三套战术预案，原战术板和替补席操作保持一致。

每个待建球队总共可开 5 套，首批揭晓时计一次；完整揭晓后可以加入候选或再开。收藏不会额外消耗机会，第五套结束后仍可确认任一候选。候选和当前整套名单由服务端占位，只有确认时才发卡；其他玩家不会获得这些被占用球员。未收藏且已放弃的阵容释放占位，新一套允许重复球员但会降低上一套球员的抽取权重。进度、候选和次数可在刷新或服务器重启后恢复。旧版未完成的选人会提示切换到新流程。

每批盾形卡自动逐张翻开，已揭晓批次始终展开。85 分以上球员翻开时附带青色光晕与粒子，传奇球员（不受能力值门槛限制）及 90 分以上球员使用金色闪光。高光复用盾形卡框遮罩，随卡面翻转，扫光限制在盾形卡面内。完整揭晓后，从 22 人中按能力、风格和位置匹配推荐首发，在侧边战术板预览；确认建队应用同一套首发。动画沿用“游戏设置 → 开包动画”。选择“跟随系统”时遵守减弱动画偏好；选择“开启”时播放完整演出。桌面左右布局，完整名单在自己的区域内滚动；手机为纵向布局。

X 新获取、巨星之路、加点购买及后台点数发放已暂停；现有 X 球员、强化等级、特性和成长点保留，继续可上场。成长任务不再发点，X 强化和新增强化特性也暂停。历史成长规则的 12 项测试明确标记跳过，旧 X 存档、上场、交易与资产保护仍进行回归。

本机体验：`npm run build` 后重启 `npm run dev`，用没有球队的新账号进入“YFFM1 联赛”，选择阵型和风格，完成三批揭晓、收藏、再开和确认。无需清空现有球队。运行 `npm run test:draft` 可验证新建队及资产兼容。改造前备份在 `outputs/backups/team-draft-before-20261113-121309/`，界面截图在 `outputs/team-draft/`。

## 当前代码入口

| 路径 | 用途 |
| --- | --- |
| `server.mjs`、`devtool/server.js` | 配置加载、HTTP 服务及调度 |
| `versus/league-service.js`、`versus/api.js` | 联赛状态与业务接口 |
| `versus/room-service.js`、`versus/infrastructure/` | 账号、房间与持久化 |
| `versus/v3/`、`versus/v2/`、`versus/public/` | V3 配置与抽样、共享计算及 V2 对照、游戏界面 |
| `src/runtime-config.js`、`devtool/static-asset-cache.js` | 共享配置和静态资源缓存 |
| `shared/football/` | 当前引擎共用的球员属性、特性运行规则、环境配置及传奇资料 |
| `test/`、`scripts/` | 当前测试、检查与审阅工具 |
| `offline/`、`apps/yellowdogs-tv-android/` | 离线构建及电视台客户端 |

主模式使用 `versus/` 中的代码。根目录重复的 S4 源码副本已清除，历史版本可从 Git 记录查看。历史发布/交接资料保留其原名称。

## 检查

```sh
node scripts/check-source.mjs
npm run test:quick
npm test
npm run benchmark:static
```

快速测试自动发现当前测试并排除 6 个长跑文件；七人制专属测试已随模式删除，共用模块及当前游戏的测试继续保留。完整测试仍有历史失败及超时，详见 [优化交付记录](docs/YFFM1-IMPLEMENTATION.md)。每次运行的逐文件日志和 JSON 结果保存在 `outputs/tests/`，该目录不提交 Git。可定向运行 `node scripts/run-tests.mjs test/account-persistence.test.js`。

浏览器审阅工具为 `node scripts/review-yffm1.mjs`，需本机安装 Playwright 和浏览器；`BROWSER_CHANNEL=chrome` 可使用系统 Chrome。`PLAYWRIGHT_REQUIRE_FROM` 可指向已有的依赖目录。当前项目的运行依赖没有因此增加。

前端流畅度优化及原版显示对照见 [性能记录](docs/YFFM1-PERFORMANCE.md)。`npm run benchmark:render` 使用本地基线文件比较两种尺寸下的节点复用、表单值和直播截图；依赖及运行方式见该记录。

比赛模型的阵型、战术操作与随机性评估见 [引擎评估](docs/YFFM1-ENGINE-ASSESSMENT.md)，包含离线对照工具和已确认的问题；该评估没有更改比赛规则或参数。

战术界面在电脑端左右排布大阵型板、原替补席和战术配置区，保留原有拖拽、换人和职责操作；右侧集中管理比赛心态、四类战术原则与六方向预期打法图。战术板顶部整理为三行，完整球场无内部滚动，手机自然纵向排布。旧位置/阵容适配度和战术适配度展示已移除；雷达为当前首发的静态侧重估计。备份、兼容规则及验证结果见 [战术界面落地记录](docs/YFFM1-TACTICS-IMPLEMENTATION.md)，设计依据见 [界面改造方案](docs/YFFM1-TACTICS-INTERFACE-DESIGN.md)。

## 存档与兼容性

账号和联赛继续使用原 `data/versus-accounts.json`、`data/yellowdogs-league.json` 或环境变量指定的分片路径。新名称不会自动创建一套空存档，也不会清除现有进度。浏览器原登录键、API 路径、卡片 ID 及离线应用标识继续保留。

离线启动器显示名为 YFFM1 Offline，存档目录沿用旧 `YDL S4 Offline` 路径；详见 `offline/`。本轮没有发布新安装包或操作生产服务器。

当前 34 个功能系统及模式的完整度、优化方向和验证缺口，见 [功能系统评估报告（2026-11-04）](docs/YFFM1-FUNCTIONAL-ASSESSMENT.md)。本次隔离完整测试为 68 个文件中 64 个通过、3 个失败、1 个超时。世界杯和主教练已永久废弃，不再进入开发计划，也不计为活跃玩法的完整度缺口；付费名单扩容已下架。

俱乐部的经营循环、现行收益与分期建设建议见 [俱乐部深化评估](docs/YFFM1-CLUB-ASSESSMENT.md)。盾形卡框来自同仓库 `codex/rougelite`，原始源码已固定提交保存在 `reference/rougelite-card-frames/`，已接入正式游戏的统一卡面渲染器；详见 [卡框接入记录](docs/YFFM1-ROUGELITE-CARD-FRAMES.md)。`node scripts/preview-rougelite-card-frames.mjs` 仍可生成原始卡框的独立参考预览。

原始评估见 [整体评估](docs/YFFM1-ASSESSMENT.md)，本轮实施与验证边界见 [交付记录](docs/YFFM1-IMPLEMENTATION.md)。
