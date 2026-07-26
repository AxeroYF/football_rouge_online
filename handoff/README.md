# Football Simulator / YellowDogs League S4 交接包

更新时间：2026-07-27（Asia/Shanghai）
当前开发工作区：`D:\Project\game_test\.worktrees\s4`
当前分支：`codex/s4-card-upgrade`

## 阅读顺序

1. `NEW_CHAT_PROMPT.md`：新任务接手提示词。
2. `CURRENT_STATE.md`：S4 已完成内容、当前限制、数据与验证状态。
3. `MANIFEST.md`：交接包内容清单。

## 安全边界

- 当前工作区有大量未提交的 S4 代码、球员数据库和测试数据，禁止使用 `git reset --hard`、`git clean` 或覆盖用户文件。
- S4 测试服存档为 `data/yellowdogs-league.json`，账号为 `data/versus-accounts.json`。启动普通服务可能推进并写入该存档。
- 修改服务端 JavaScript 后必须重启 Node 服务；静态前端文件会实时读取。
- 交接包不包含账号密码、正式联赛存档、钱包或玩家隐私数据。

## 最近验证

- 最近一次完整功能回归：`node --test test/*.test.js`，193/193 通过。
- 最近一次针对性回归：`node --test test/ydl-bonds.test.js test/ydl-traits.test.js test/league.test.js`，60/60 通过。
- 用户明确要求不代替其进行浏览器验收；当前采用代码检查和自动回归测试。

压缩包：`football-ydl-s4-handoff-20260727.zip`
