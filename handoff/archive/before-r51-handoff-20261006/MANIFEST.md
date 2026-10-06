# 交接索引 · R49 · 2026-10-02

## 当前权威入口

- [README](README.md)：项目结构、构建与发布要求。
- [CURRENT_STATE](CURRENT_STATE.md)：最新状态在顶部，后续内容为历史。
- [NEW_CHAT_PROMPT](NEW_CHAT_PROMPT.md)：继续开发提示。
- [Git 同步记录](GITHUB_SYNC_20261002.md)、[本轮变更文件](CHANGED_FILES.txt)。
- [发布登记](../releases/CURRENT.json)、[发布流程](../releases/README.md)。

## 近期发布

- [R49 动画恢复与石油卡包](R49_UPDATE_20261001.md)；[冻结验证记录](../releases/20261001-r49/QA.json)。
- [R48 启动恢复](R48_STARTUP_RECOVERY_20260930.md)。
- [R47 开包增量](R47_UPDATE_20260930.md)：其简化动画策略已被 R49 替代。
- [R46 移动端三栏](R46_UPDATE_20260930.md)、[HUD 布局](MAP_HUD_LAYOUT_20260930.md)。
- [R45 商店、研究通知及联赛补员](R45_UPDATE_20260930.md)。
- [R44 动态比赛发布](R44_UPDATE_20260930.md)。

## 架构与维护

- [完整重构实现和边界](REFACTOR_IMPLEMENTATION_20260929.md)。
- [V2.2 联赛接入](V22_LEAGUE_INTEGRATION_20260929.md)、[动态引擎评估](V22_ROLLOUT_ASSESSMENT_20260929.md)。
- [浏览器构建器](../tools/browser-build/README.md)。

其余专题文档按原文件名保留；历史完整专题索引见 [旧 MANIFEST](archive/before-r49-handoff-20261002/MANIFEST.md)，其中部署状态按成文时间理解，不覆盖本次 R49 确认。

交接 ZIP 保留 handoff/、releases/ 和工具说明的相对目录；根目录 SOURCE_REVISION.txt 标识已推送源码提交，SHA256SUMS 校验每个内容文件。ZIP 本身由同名 .sha256 校验。
