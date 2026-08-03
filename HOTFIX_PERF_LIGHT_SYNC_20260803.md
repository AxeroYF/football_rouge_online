# S4 frontend performance hotfix: light sync

## 问题

- 前端在联赛页面每 12 秒静默拉取完整联赛视图（约 1.2 MB，gzip 后约 105 KB）。
- `view()` 在 2 核 4GB 服务器上同步构建（球员目录、全部比赛摘要、榜单、卡牌等），多客户端叠加后 CPU 持续接近单核满载（实测 11 分钟运行消耗 10 分 34 秒 CPU），表现为整体卡顿。

## 改动

1. `versus/league-service.js`：新增 `leagueHead(account)`，只返回 `updatedAt / serverTime / seasonStatus / seasonCurrentRound / walletBalance / inboxUnreadCount`，约 150 字节。
2. `versus/api.js`：新增路由 `POST /api/versus/league/head`。
3. `versus/public/app.js`：`refreshLeagueSilently` 先请求 head；仅当 `updatedAt` 或赛季状态变化时才拉取完整视图并整页重绘；无变化时只更新 `serverTime`，零渲染。
4. `devtool/server.js`：静态 JS/CSS/HTML/JSON 启用 gzip 传输（原为不压缩），香港链路下页面加载显著加快。
5. `versus/league-service.js`：`view()` 内联的球队视图构建改用已有的 `ownTeamView()`，删除重复代码（行为不变）。

## 效果

- 静默同步流量从约 1.2 MB/12s 降至约 150 B/12s（约 8000 倍）。
- 服务端不再为每次轮询构建完整视图，CPU 占用显著下降。
- 数据变化时（比赛推进/结算）行为保持不变，仍会拉全量并刷新页面。
- 负载模拟（6 客户端、生产级 day6 数据）：修复前 45 秒 24 次全量视图请求平均 3.7s/最大 25s；修复后全量视图仅页面打开时 6 次，head 轮询平均 29ms。

> 注：曾尝试对 `view()` 子字段按 `updatedAt` 记忆化（热路径 22ms），但该方案与“直接修改状态后立即读 view()”的既有契约冲突（8 项测试失败、生产存在非 save 变更窗口），已回退；后续如需进一步优化应改为显式失效机制。

## 备份与部署

见包内 `DEPLOY.md`。
