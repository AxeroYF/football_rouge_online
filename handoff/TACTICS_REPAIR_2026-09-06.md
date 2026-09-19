# 战术阵型空位补位 — 2026-09-06

用户要求：球员离开远征／留守阵型时，优先保留原有位置，并在后台自动补位。

## 原因

- tactics-page.js 原来过滤失效首发后，只要不是完整 11 人便 defaultStarterIds，重新选整队；新入选球员使用默认分线坐标。
- assignPlayerSquad 只保存归属，没有同步修复阵型。
- 比赛入口同样在无效首发时退回整队默认首发。
- 已建立双编队仍自动从留守补充远征，可能再次改变刚刚调整的归属。

## 实现

- 新增 shared/config/tactics-repair.mjs：现有球员固定在原槽位，只让空位参与最优匹配。根据默认站位实际角色选本编队替补，依次考虑主位置、副位置、同线、能力，门将与外场分开；训练、伤停替补不参与，已经首发的训练球员保留原状态。
- 替补继承所有已保存坐标和职责，原队长离队时继承队长。坐标映射仅处理 positions／positionPresets，保留 formationLinePresets 中参考线；不重排战术维度和计划。
- 无合适替补时，vacantSlots 保存空位索引及坐标／职责引用数据，清理失效球员引用。补充合适球员后自动补回；不会拿外场球员补门将，也不会临时重建整套阵型。前端显示剩余首发并提示阵容不足；比赛入口拒绝缺员阵容。
- repairTacticsLineups 按代表卡规则处理重复卡，只在对应编队中补位，并同步已有远征顶层兼容字段。
- CampaignService 在编队改变时立即保存修复，state 读取旧失效阵型时修复并按变化持久化，saveTactics 处理旧页面提交的失效首发。保存验证通过后才提交新编队归属。
- EnhancementService 合卡副卡消耗复用同一规则；比赛 buildAccountMatchSeat 使用修复后的副本，保留已在运行比赛的快照。
- player-squads 的 allowTransfers 仅在未建立双编队时启用；已有双编队不会因打开战术板、保存或参赛被跨编队自动抽人。
- tactics-page 前端使用同一补位器，不再因已保存首发不足 11 人整队回退。新增 vacantSlots 随内嵌战术状态保留。
- app.js／index.html 前端入口版本：20260906-tactics-repair-v1。

## 验证

新增 test/tactics-repair.test.js，共 11 项行为回归：双编队转队及持久化、多空位全局匹配、门将不足及延后补位、多空位索引保留、旧状态后台修复、双编队比赛坐标和快照隔离、旧战术提交、训练及替补离队、另一编队更强同名代表卡。

完整 npm run check 通过：预检 61、主测试 304、Three 69，总计 434 项。结果 outputs/tactics-repair-full-check.log。

按既有协作约定，没有启停服务、打开浏览器或修改真实账号存档。用户重启 4370 后 Ctrl+F5 验收。
