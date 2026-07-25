# Football Simulator / YellowDogs League 交接包

更新时间：2026-07-25（Asia/Shanghai）  
项目目录：`D:\Project\game_test`

## 阅读顺序

1. `NEW_CHAT_PROMPT.md`：复制到新对话，要求接手者先核对实时状态。
2. `CURRENT_STATE.md`：当前功能、正式赛季快照、紧急修复、验证结果和风险。
3. `MANIFEST.md`：交接包文件清单。

## 关键原则

- 当前主开发重点是 `versus/` 下的 YellowDogs League（YDL）、黄狗冠军杯和11人制模拟内核。
- 工作区包含大量未提交改动及正式运行数据；禁止 `git reset --hard`、`git clean` 或覆盖用户文件。
- 正式联赛存档是 `data/yellowdogs-league.json`。读取可以，未经用户明确要求不要模拟、重置或编辑。
- `npm run tunnel` 使用正式存档并会推进联赛；测试必须用 `statePath:null` 或独立副本，不能影响 tunnel。
- 服务端代码修改后必须重启 `npm run demo` 或 `npm run tunnel` 才会加载；静态前端文件会即时读取，可能出现前端新、服务端旧的不一致。
- 本交接包不包含账号、钱包、联赛存档或密码等敏感数据。

## 最新验证

- `node --test test/league.test.js`：42/42通过。
- `npm run build`：通过。
- 体力红线机制已用纯内存正式存档副本预演，未写入正式数据。

压缩包：`football-ydl-handoff-20260725.zip`
