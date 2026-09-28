# 接续 Rougelite 工作

GitHub 整理见 [2026-09-28 同步记录](GITHUB_SYNC_20260928.md)，沿用 PR #2。

工作树 D:/Project/game_test/.worktrees/Rougelite，分支 codex/rougelite。

最新交付 R41（20260928-r41），用户已明确确认部署；最新部署基线为 R41。

修复历史活动与球探回执误锁交易地块；联赛注册筛选只作用左侧可选球员，两栏互斥；汰换正常成功后使用增量卡片与编队状态更新，保留筛选、滚动位置和已加载卡片，零追加全量读取。1478 项全量测试、专项测试、真实浏览器与隔离升级回滚通过。

先读 CURRENT_STATE.md、R41_UPDATE_20260928.md 和 releases/CURRENT.json。已封存 R40/R41 不覆盖重打；本轮按用户要求整理并同步 GitHub；服务器 R41 已由用户自行部署。
