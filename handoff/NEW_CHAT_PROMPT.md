# 新任务接手提示词

请先完整读取：

- `D:\Project\game_test\.worktrees\s4\handoff\README.md`
- `D:\Project\game_test\.worktrees\s4\handoff\CURRENT_STATE.md`
- `D:\Project\game_test\.worktrees\s4\handoff\MANIFEST.md`

然后只读检查：

```powershell
cd D:\Project\game_test\.worktrees\s4
git status --short
```

当前开发重点是 YellowDogs League S4。不要把旧 S1/S3 handoff 当成当前实现，不要丢弃工作区中的未提交修改，也不要擅自重置或模拟正式/测试服存档。

S4 已经完成正式球员池接入、球员所有权模型、新卡包与背包批量开包、新卡牌和卡包视觉、三套站位战术板、模拟核心站位结构反应、强化页面、+5/+8 特性绑定流程、强化公告、后台指定球员卡发放、14 张 YDL 特性的比赛核心接入，以及国家队/俱乐部羁绊。

YDL 只保留用户指定的 14 张特性，后台和强化候选池均已限制。代表强化卡的全部 `traitIds` 会进入比赛阵容，+8 的两张特性可以同时生效，并且不会覆盖传奇球员原生 `legendAbility`。正式球员池不少于 10 人的 10 个国家队和 20 家俱乐部已经建立羁绊，场上 5–11 人提供 1%–5%成员加成，国家队与俱乐部可同时生效；“变色龙”已作为两个类别各自的通配球员。具体规则、名单和回归结果见 `CURRENT_STATE.md`。

用户通常自行进行浏览器验收。实现后应运行与改动相称的代码检查和自动回归，不要主动进行浏览器测试，除非用户重新明确要求。
