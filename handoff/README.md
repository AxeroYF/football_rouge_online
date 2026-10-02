# 黄狗风云 Rougelite 交接 · 2026-10-02

**R49 已部署，用户已确认。** 最新发布/部署版本：`20261001-r49`。工作树：`D:\Project\game_test\.worktrees\Rougelite`；分支：`codex/rougelite`；远端：`https://github.com/AxeroYF/football_rouge_online.git`。

## 阅读入口

1. [当前状态](CURRENT_STATE.md)：以开头的最新结论为准，后续段落为历史。
2. [新对话提示](NEW_CHAT_PROMPT.md)：可直接用于继续开发。
3. [交接索引](MANIFEST.md)：项目结构与近期功能文档。
4. [R49 更新](R49_UPDATE_20261001.md)、[Git 同步](GITHUB_SYNC_20261002.md)、[发布基线](../releases/CURRENT.json)。

## 最近累计更新

- 界面：R46 统一每日联赛、服务器玩家、通知栏入口，修复手机/电脑网页模式遮挡。
- 加载与开包：R47 增量响应、归队一次存档、去除成功后的冗余全量读取；R48 将冷启动代码请求从 250 个降到 4 个，使用有界压缩缓存。用户确认 R48 恢复进入游戏。
- 开包体验：R49 恢复流星、扫光、对应传奇 Canvas、原有逐张翻转；选卡保留原节点，下一包复用舞台，不再重复展示获得卡。**不能通过取消动画来做性能优化。**
- 商店：金币与石油均可购买相同卡包；普通/稀有/珍奇/传奇为 2/6/16/40 石油，服务端定价、幂等和失败回滚。

## 项目结构

```text
app.js / index.html       前端编排与可编辑入口
client/                  领域 UI、地图、球员卡、背包、商店、战术、回放
styles/                  页面与领域样式
game.html                正式游戏入口（生成）
game-startup.js / .css    正式启动资源（生成，与源码一起提交）
server.mjs               Node HTTP 启动
campaign-service.mjs     游戏业务协调入口
server/application/      领域应用服务、状态与提交协调
server/http/             分域路由、静态资源与协议处理
shared/                  共享规则、配置、视图与几何计算
engine/                  比赛引擎与动态模拟
assets/                  公共资源；私有卡画不入 Git
test/ / scripts/         自动测试、验证、构建与热更新工具
tools/browser-build/     固定版本的开发用启动构建器
windows-client/          Windows 客户端
android-client/          Android 客户端
deploy/ / releases/      部署工具、不可变发布清单及有效基线
handoff/                 当前入口、专题说明与历史交接
```

## 构建与发布

首次准备开发依赖：`npm ci`；启动构建器：`npm ci --prefix tools/browser-build`。开发入口 `npm run dev`，测试 `npm test`。构建器仅用于开发机器，无需生产服务器安装。

前端改动后依次执行：

```powershell
python scripts/build-browser-module-versions.py
node scripts/build-browser-startup.mjs
python scripts/build-browser-module-versions.py --check
node scripts/build-browser-startup.mjs --check
node scripts/check-release-baseline.mjs --workspace
```

最后一项列出源码相对发布基线的差异；未修改运行文件时应为空，有开发变更时应与预期一致。正式 `/versus/` 与 `/game` 路由加载 `game.html`，只修改 index.html 或模块而不重建会让正式页停留旧代码。增量打包器已拒绝陈旧生成物。详细步骤见 [发布说明](../releases/README.md)。

R49 原包在 `outputs/hot-update-20261001-r49/`；午夜前 `outputs/hot-update-20260930-r49/` 是未交付暂存目录。不要修改原包或历史清单，不要把 outputs、存档、账号、私有卡画、node_modules 放入 Git。后续热更新以已部署 R49 为基线；提供一行式部署命令。

本 handoff 包是交接文档与发布记录，不含游戏运行载荷或生产存档，不能作为热更新包执行。早期入口已归档到 `archive/before-r49-handoff-20261002/`。
