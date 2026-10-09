# 新对话继续提示 · R49 已部署

请先阅读 `handoff/README.md`、`handoff/CURRENT_STATE.md` 的最新节、`handoff/MANIFEST.md`、`handoff/GITHUB_SYNC_20261002.md` 和 `releases/CURRENT.json`。

项目为黄狗风云，工作树 `D:\Project\game_test\.worktrees\Rougelite`，Git 分支 `codex/rougelite`，远端 `https://github.com/AxeroYF/football_rouge_online.git`。不要误改根目录另一个游戏或第三部作品。

用户于 2026-10-02 确认 R49（20261001-r49）部署。下次服务器热更新以 R49 为基线。R46–R49 已覆盖 HUD 遮挡修复、开包增量、启动资源合并、动画恢复、石油购买卡包。完整重构和 V2.2 动态比赛已随更早 R44 部署，不要按旧 R43 文档当作待实施。

重要要求：
- 开包完整视觉效果要保留；优化重复重建、冗余请求/存档。R47 曾过度削减动画，已在 R49 修正。
- 正式入口是生成的 game.html 和 game-startup.js/css；前端改动后先执行 build-browser-module-versions.py，再执行 build-browser-startup.mjs，校验生成物并与源码一起提交。
- 商店石油卡包价为 2/6/16/40，金币价保留；支付验证、幂等、存档失败回滚由服务器负责。
- 低配服务器优先复用节点、增量响应、有界缓存；不要缓存含私有状态的全量响应，不能跳过结算或写盘失败处理。
- 发布前检查实际基线、运行依赖、生成资源、相关测试及升级回滚；原发布包和历史哈希不可改写。
- 用户要求热更新命令一行式；不要上传存档、账号、私有卡画和 outputs 到 Git。

R49 发布时 1690 项测试、381 个语法模块、32 项浏览器检查以及真实隔离服务验证通过。具体证据记录在 releases/20261001-r49/QA.json；旧 QA 仅代表对应发布时的验证，不等于之后开发自动通过。

当前任务已完成 Git 归档与 handoff 更新。后续按用户新请求继续，不自行重复部署或制作新版本。
