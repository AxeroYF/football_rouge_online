# 训练收费与总评成长 · 2026-09-09

用户要求训练收费随总评递增，并检查能力提升的保存、总评和比赛计算。已确认价格与未完成取消全额退款规则。

## 收费规则

- 公式：`max(250, ceil(500 * 2^((当前总评 - 70) / 10) / 50) * 50)`。按 50 金币向上取整。
- 70 / 80 / 90 / 100 分分别 500 / 1,000 / 2,000 / 4,000 金币；当前总评包含强化和训练成长。
- 服务器根据球员记录计价，任务保存实付 `costGold`。开训扣费与任务一起保存；请求重试不重复扣款，金币不足不创建任务，存盘失败整体回滚。
- 未完成取消按原实付全退、仅退一次。完成时间到达后先结算，不能再取消退款。旧免费训练不补扣，取消不凭空返金币。
- 沿用训练中球员可用作强化素材的既有行为；作为素材被消耗，未完成任务自动取消并退还实付费用，处于强化事务内。
- 主卡训练期间仍可强化。如果预定训练属性因此触及 99，上限外的点数不计入成长，按未生效点数比例退还费用。

## 属性与总评

发现旧代码只增加 attributes / effectiveAttributes / trainingBonuses，没有更新 overall。未标记独立实例的旧卡加载时还会被球员库总评覆盖。

- 新增 `shared/football/training-growth.mjs`，以不含强化、训练的基础属性快照 + 累计 trainingBonuses 重建属性，总评沿用 S4 的 `playerOverallFromAttributes`。
- 前锋核心：射门、无球、速度、盘带、冷静；中场核心：传球、视野、决策、停球、耐力；后卫核心：抢断、盯人、站位、力量、速度；门将核心：门将、反应、站位、冷静。
- 基础总评为上述本职核心属性均值四舍五入，再加既有强化等级的平值加成。保留各属性上限 99 与强化总评可超过 99 的既有规则。
- 每次从累计属性重新计算，不按单次已取整的增量累加，避免丢失未满一分的成长。不是能力总计 +5 就总评 +5；非核心能力也会进入比赛计算。
- 保留 `baseOverall` 为已计入训练、未叠加强化的总评，强化升降级不抹除成长，不重复加成。
- 成长卡标记独立实例（保留原 ID 与阵容引用）并删除旧卡面缓存。迁移会修复已有 trainingBonuses 的旧卡，反复加载不重复加点。缺失核心属性的稀疏旧记录不使用虚构默认值重估总评。
- 训练结算记录 `overallBefore` / `overallAfter` 与真实生效 gains，结果界面展示“总评 70 → 71（+1）”或“本次未升档”。

## 界面

- 选择球员的卡面下方显示本次费用，金币不足时禁用并说明。
- 通知按钮显示“取消并退款”，完成/取消提示跟随服务端结果。
- 实时轮询更新费用和支付能力，也保留治疗中球员不可训练的限制。
- 价格行预留独立空间；保留大名单滚动位置、编队筛选和卡面延迟加载。

## 验证与运行

- 训练、强化、拆除专项 62 项通过，覆盖重复扣费/退款、失败回滚、四位置成长门槛、强化顺序与降级、99 上限、旧卡迁移、离线完成、重复重启、卡面和 V2.1 比赛快照。
- 完整回归 1,058 项通过：pretest 78 + 主测试 832 + Three 148；语法/地图资源检查通过。Windows 串行运行避免既有管理配置测试并发写入冲突。
- `scripts/check-training-regression.mjs`，报告 `outputs/training-growth-20260909/regression.log`。
- `scripts/review-training-growth.mjs` 16 项浏览器检查通过：桌面/手机结果、实际收费、取消全退、账本去重、刷新后保留属性和总评；报告/截图位于 `outputs/training-growth-20260909/`。
- `scripts/review-training-refresh.mjs` 15 项既有大名单、两次世界轮询、编队筛选、桌面/手机滚动检查通过，输出 `outputs/training-refresh-20260908/`。
- 使用独立临时存档和独立端口验收。未修改正式玩家存档，未重启正式进程。后端重启自动迁移旧训练成长，客户端 Ctrl+F5；入口版本 `20260909-training-growth-v1`。

关键文件：`shared/config/training.mjs`、`shared/football/training-growth.mjs`、`server/application/training-service.mjs`、`server/application/enhancement-service.mjs`、`server/infrastructure/campaign-save-migrations.mjs`、`campaign-service.mjs`、`client/buildings/training-controller.js`、`styles/training.css`、`app.js`、`index.html`。
