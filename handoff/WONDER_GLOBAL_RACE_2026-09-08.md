# 奇观全服唯一与竞建补偿 · 2026-09-08

最新规则优先于旧文档的“每位玩家一座、其他玩家可独立完成”：同一奇观全地图仅能完成一座。允许同时施工；首个满足要求并完工者获得奇观，其余未完成项目自动中止、释放槽位。相同完工时刻按开工时间、建筑 ID 确定唯一胜者。

## 结算与生产力存储

- CampaignService.save 按真实完工时间分段结算。失败方只计算胜者完工时实际已投入的生产力，返还 50%，包含小数，不按总需求或之后的离线时间计算。
- 返还进入 pendingNeutralRewards，source 为 wonder-competition，是一次性生产力存储，不提高持续生产能力。可通过通知“使用生产力”或右下角待处理奖励指派到建设项目；项目需求小于存储时剩余部分继续保留。
- 自动取消与返还使用建筑 ID 生成幂等事件；保存失败恢复项目、槽位、分配、奖励与通知。主动中止仍不返还生产力。
- 已建成奇观阻止新开工，其他玩家的未完成项与进度依然隐藏。奇观实际效果只由胜者获得。

## 通知

右上角显示奇观名称、抢先完成者和返还数量，自动出现但不弹出资源分配窗口打断操作。通知提供“已读”按钮，点击即移除；服务端保存 readAt，刷新／重新登录不会再出现。已读不影响生产力存储。通知存在期间跟随状态同步，多个通知可滚动查看。

POST /api/campaign/wonders/notifications/read {noticeId} 仅允许当前账号操作自己的通知；重复已读幂等。保存失败保持未读可重试。

## 实现位置

server/application/wonder-service.mjs、campaign-service.mjs、server/http/campaign-api-handler.mjs、server/application/neutral-reward-service.mjs；client/buildings/construction-notifications.js、client/resources/neutral-reward-controller.js、neutral-reward-markup.js、styles/construction.css、app.js、index.html。

## 验证

- npm run check：861 次检查通过（78 + 639 + 144）。修正旧 building-panel-controller 测试的 closest 模拟，按选择器匹配以免误触新增中止按钮。
- 最后补充已读保存失败回滚测试后，80 项结算／通知／奖励／接口回归通过。
- scripts/review-wonder-race.mjs：20 项隔离真实浏览器检查通过；双账号抢建、隐私、自动中止、50% 实际投入、存储使用、已读持久化、越权拒绝、桌面及 390px 手机通知范围、无浏览器异常。
- 证据位于 outputs/wonder-race-20260908/，含日志、结果和桌面／手机截图。

真实存档只读检查：现有 3 个奇观均在建，无已完成重复奇观。本轮未改真实存档、未重启正在运行的服务、未提交或部署。用户需重启 Rougelite 游戏服务后 Ctrl+F5 生效。
