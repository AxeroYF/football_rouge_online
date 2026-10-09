# 球探与系统回收调价 · 2026-09-19

用户确认：球探每轮基础发掘费用 700→1200 金币；系统回收倍率 20%→10%，每级强化加成仍为 10%。本地完成，未打包、未部署。

- shared/config/scouting.mjs：costGold=1200；facility-levels.mjs 的所有等级球探中心统一引用该价格，避免服务端设施效果覆盖价格。既有奇观费用折扣规则保留。
- 20 轮基础预付费用 14000→24000。已付费任务保留 costGold/候选结果记录，领取不追加扣款。
- card-management.mjs：recycleRatioBps=1000。未强化卡基础回收额：C 40、B 200、A 1000、S/X 5000。强化每级按新基础回收额加 10%，+8 为基础的 1.8 倍。估值与玩家市场最低挂牌规则未改。
- campaign-save-migrations.mjs：一次性 20260919-recycle-10 迁移，将存档的回收倍率设为1000，保留其它设置和历史；记录在 world.cardManagement.balanceVersion，后续后台调价不被重启覆盖。旧20%回收报价会失效并要求重新预览，避免按旧价结算。
- 160 项专项回归通过：球探单轮/20轮扣款、老任务领取、旧报价失效、迁移重复执行、回收/市场与持久化。输出 outputs/performance-20260919/balance-tests.txt。
- 模块版本检查通过，253 modules / 324 mappings。
