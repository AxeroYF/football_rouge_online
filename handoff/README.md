# Football Simulator / YellowDogs League S4 交接包

更新时间：2026-07-27 22:20（Asia/Shanghai）
开发工作区：`D:\Project\game_test\.worktrees\s4`
分支：`codex/s4-card-upgrade`
HEAD：`1d4c6b0`

## 阅读顺序

1. `NEW_CHAT_PROMPT.md`：粘贴到新窗口的接手提示。
2. `CURRENT_STATE.md`：当前完整产品与代码状态。
3. `CHANGED_FILES.txt`：工作区全部未提交文件清单。
4. `MANIFEST.md`：压缩包内容及安全边界。

## 关键提醒

- 当前工作区有 31 个未提交或未跟踪文件，包含本轮全部 S4 功能，严禁 `git reset --hard`、`git clean`、覆盖或回滚无关改动。
- 开发只关注 YDL 模式，不需要兼容旧好友对战，也不需要兼容旧赛季存档。
- 用户将开启全新赛季；不要用旧测试服存档判断新赛季能否启动。
- X 级球员第一阶段已经完成；成长任务、技能点与属性加点尚未设计，不要自行扩展。
- 交接包不包含账号、钱包、玩家背包或真实联赛存档。

## 最近验证

使用全新临时赛季状态运行：

```powershell
node --test test/admin.test.js test/league.test.js test/s4-assets.test.js test/ydl-content-store.test.js test/ydl-traits.test.js test/ydl-bonds.test.js
```

结果：117/117 通过。相关 JavaScript 语法检查和 `git diff --check` 通过。
