# Football Test 1 UI 重构方案 v2

## 备份

- 重构前完整项目快照：`backups/football-test1-ui-before-redesign-20260716-000131.zip`
- SHA-256：`84AB92A176075CF1947369ED369DECCCF1D80FC11EE7CDBB6D56F68206AFC42B`
- 备份包含游戏、开发后台、模拟模型、测试、数据与设计文档。

## 参考模式

### Football Manager

- 以阵型图为阵容管理的中心，而不是先展示表格。
- 选择位置后，就近展示该位置的可用球员、适配程度和备选顺序。
- 战术变化立即反映在球员位置与球队画像上。
- 参考：https://www.footballmanager.com/features/recruitment-revamp
- 参考：https://www.footballmanager.com/fm26/features/possession-out-possession-fm26s-new-tactical-evolution

### EA SPORTS FC Ultimate Team

- 球员与资产使用稳定的卡片层级，综合评分、位置和稀有度可以快速扫读。
- 阵容、俱乐部资产和补强入口互相连通，减少页面往返。
- 参考：https://www.ea.com/en/games/ea-sports-fc/fc-25/features/ultimate-team

### Balatro / Slay the Spire

- 先通过卡面识别稀有度、类别与协同，再在详情区阅读完整规则。
- 持有物、当前构筑和可装备目标分离显示，避免每张卡重复放置操作控件。
- 参考：https://www.playbalatro.com/
- 参考：https://store.steampowered.com/app/646570

## 本轮落地

- 增加比赛日、阵容、球员、特性仓库、商店五个常驻功能入口。
- 阵容工作台以大型可拖动战术板为核心，右侧集中显示阵型、球队画像和战术。
- 球员中心采用“名单—球员档案—职责摘要”三栏结构。
- 特性仓库采用“筛选卡池—卡牌详情—装备对象”结构。
- 保留原有本地存档格式与比赛模型，现有征程无需重开。
