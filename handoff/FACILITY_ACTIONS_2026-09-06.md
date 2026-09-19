# 球探／训练中心底部操作 · 2026-09-06

## 本轮范围
用户要求在球探中心、训练中心底部添加上下排列的升级和拆除按钮，随后明确：**升级只做 UI 占位，升级规则还未决定；拆除先可用。**

- 两个中心的固定底栏：上方“升级 · 待开放”置灰，下方“拆除”可点；不放冗余说明小字。
- 升级不显示旧配置价作为已确认价格，不弹升级确认框，不发送升级请求、不扣金币。原 BUILDING_RULES.upgradesEnabled=false 保持不变；以后确定规则再接费用、效果和工期。
- 拆除使用统一居中确认窗口，显示设施图标、名称、等级、释放槽位、返还金币及必要后果。
- 首版拆除立即完成、免费、不返还建造金币，释放一个建筑槽位。确认前只读取预览。
- 不增加其他设施操作；主体育场、港口等接口不接受拆除。

## 任务与数据
- 已招募球探是独立单位。拆除原招募中心后，球探、跨海行程、已付费发掘、旧固定中心发掘任务全部保留；原任务 ID 可以继续领取。
- 重建球探中心仍计入玩家现有球探数量，不能借拆除突破当前两名上限；新招募依旧从新中心生成。
- 训练中心有正在训练的球员时拒绝拆除；先完成或取消训练。服务端提交时重新检查，预览后新开训练也无法绕过。
- 到时的训练由服务端先结算成长，再拆除；已完成结果只收起，不扣回成长。其他中心训练不动。
- 拆除清除建筑记录、增加地块版本和世界 revision，客户端同步移除地图设施图标及施工通知，关闭已失效中心。
- POST 拆除请求使用 requestId；重复提交返回原结果，避免网络重试误操作。账号内 buildingDemolitions 最多保存 20 条。不同建筑不能复用同一编号。
- 服务端校验建队状态、地块归属、具体建筑 ID 和允许类型；保存失败恢复账号、地块及 revision。
- 拆除没有真实运行在用户存档中；所有修改数据的验证使用独立测试对象。

## 接口及文件
- GET /api/campaign/territory/buildings/demolish-preview?territoryId=...&buildingId=...
- POST /api/campaign/territory/buildings/demolish：{territoryId, buildingId, requestId}
- server/application/building-service.mjs：预览、校验、拆除、存档回滚和有界幂等记录。
- campaign-service.mjs、server/http/campaign-api-handler.mjs：训练结算、认证路由和状态回传。
- client/buildings/facility-actions-controller.js：共用按钮、原生模态确认窗口、防重复及失败重试、账号切换保护。
- client/buildings/scouting-controller.js、training-controller.js：固定底栏、精确目标回调、设施删除后关闭。
- styles/facility-actions.css、index.html、app.js：底栏与确认窗口、状态同步和新资源版本号。
- test/facility-demolition.test.js、test/facility-actions-controller.test.js 及相关控制器／HTTP 测试。
- scripts/review-facility-actions.mjs、scripts/check-facility-actions.py：离线预览和样式检查；球探预览脚本已同步底栏。

## 验证与使用
- npm run check：617 项通过（68 预检 + 480 主测试 + 69 Three），0 失败。
- 396 项设施样式检查，390／820／1600 宽度、club／legacy 两种主题。
- 606 项已有球探样式检查通过。
- 新增拆除后继续发掘／领取、移动、重建容量、成长不重复、阻止训练中拆除、持久化失败回滚、幂等重试、账号切换及中心入口测试。
- 离线 HTML 位于 outputs/facility-actions-review/ 和 outputs/scout-units-review/，不是浏览器实机截图；未操作用户浏览器或服务。
- **有后端变更，需要用户重启本地 4370 服务，再 Ctrl+F5。**
- 未打包热更新、未部署、未连接服务器、未改真实存档、未提交 Git。
