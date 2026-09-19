# 资源栏、当前产能与平均分配建设 · 2026-09-07

本轮按用户最新资源定义实施；同时确认了“所有在建项目平均分配”。本说明优先于首轮三资源文档中累计生产力／科技值的旧描述。

## 当前有效规则

| 项目 | 游戏中的含义 | 当前实现 |
| --- | --- | --- |
| 金币 | 可累计、可支出的资金存量 | 顶栏余额；领地金币按小时结算，支持离线与换主分段 |
| 生产力 | 当前建设能力，不累计为余额 | 由当前持有地块合计，所有在建设施平均分配 |
| 科技值 | 当前研究能力，不累计为余额 | 由当前持有地块合计并显示；研究推进系统尚未实现 |
| 一次性生产力 | 部分地块的特殊征服奖励 | 已确认获得后立即指派给建设项目；具体奖励与指派流程未开放 |

生产力没有“存量用完”的概念。当前总生产力为 P、同时施工 N 个项目，每个项目分配 P/N；任何项目完工，其份额立即重新分配到剩余项目。新增、拆除项目同样改变分配。零生产力时项目暂停，保留此前进度；空闲期间和离线空闲期间均不囤积生产力或科技值。

后续建造规则已更新，见 [BUILDING_METHODS_2026-09-08.md](BUILDING_METHODS_2026-09-08.md)：金币瞬建或生产力建造二选一，后者不扣金币。每点产能每分钟完成一点需求；港口需 500，其余设施独立配置。本文旧 60 秒基准仅对既有项目迁移保留，新的建造不再使用该需求。升级仍未开放。

## 界面与图标

最新交互见 [RESOURCE_HOVER_2026-09-07.md](RESOURCE_HOVER_2026-09-07.md)：旧点击弹窗已被来源悬浮替代。

- 顶部同一框内包含三项独立悬浮触发区；金币继续显示千分位存量，两项能力直接显示当前数值。
- 悬浮只列实际来源及数值：金币小时增长、生产力／科技值当前贡献；已移除说明小字。
- 地块悬浮和详情仍展示同一份 1,470 块配置；三资源统一不标记时间单位；生产力与科技值表示该地对当前能力的贡献。
- 建设区显示总生产力和正在平分的项目数；新建列表移除预计时间小字，已开工项目的倒计时、进度条、提示使用当前项目数据；没有产能时显示“等待生产力”。
- 生产力为赭金色齿轮，科技值为蓝色烧瓶；两枚 SVG 为本地矢量资产，适配顶栏小尺寸和资源详情大尺寸。参考了《文明6》资源标记的视觉词汇，可见 [资源符号参考图](https://www.redbubble.com/i/sticker/Civilization-6-Yields-by-Involtino/64004382.EJUG5)。

截图（均来自隔离测试账号）：

- [合并资源栏](../outputs/resource-capacity-review/resource-strip.png)
- [资源详情桌面](../outputs/resource-capacity-review/resources-desktop.png)
- [资源详情手机](../outputs/resource-capacity-review/resources-mobile.png)
- [两项建设同时平分生产力](../outputs/resource-capacity-review/shared-construction-desktop.png)
- [全图产出审阅表](../outputs/territory-resources-20260907/territory-resource-atlas.html)

## 存档与计时

- 资源结算版本升为 2，仅金币产生小时收入与余数；公开状态的 balances 只保留球迷，current 提供生产力／科技值，hourly 提供金币。
- 旧生产力、科技值余额及余数移入账号 retiredResourceStockpiles 历史记录，保留审计数据；不转成可用奖励，也不再继续累计。重复启动不重复迁移。
- 施工保留 productionWork 工作总量、已完成量、所属玩家和结算时刻。constructionEconomy 保存前一段产能，领地换主前按原玩家产能推进，换主后更新。
- 离线按项目的开工／完工事件推进；中途完工后立即重分配，避免把整段离线时间错误地按初始项目数平分。
- 旧固定工期项目在首次采用新规则时保留已完成比例；旧截止时刻已经到达的照常完工，不反向按新产能重算过去。
- 前端按服务端工作进度与未来分配阶段显示，避免新增项目后把整条进度条重新拉伸。
- 资源、施工、金币及检查点提交失败可一起回滚；新建失败恢复扣款和建筑槽位。

没有读写真实用户存档或账号；迁移代码将在用户自行重启新服务时执行。验证服务使用系统临时目录、动态端口和隔离账号，结束后只清理自身创建的目录。

## 实现位置

- shared/config/resources.mjs、client/resources/resource-controller.js、resource-markup.js：定义、合并显示与地块说明。
- assets/ui/resources/production.svg、science.svg：重绘图标。
- server/application/territory-production-service.mjs：金币结算与两项旧余额退役。
- shared/buildings/construction-production.mjs、server/application/construction-production-service.mjs：按事件推进、平均分配、工期预测与回滚。
- server/application/building-service.mjs、campaign-service.mjs：实际建设与保存流程。
- client/buildings/building-panel-controller.js、construction-notifications.js：工期、暂停与通知。
- index.html、app.js、styles/resources.css：资源入口、缓存版本与响应布局。

## 验证

完整 npm run check 通过 751 项（70 + 537 + 144），0 失败。最后修正开工提示并补零产能界面检查后，相关 24 项通过。浏览器结果见 [browser-results.json](../outputs/resource-capacity-review/browser-results.json)，包括实际登录、两次点击建造、相同总产能的平分、资源不累积、单／双／三产地块、320～1600px 布局和无运行时错误。

测试文件为 test/territory-production.test.js、test/construction-production.test.js、test/territory-resources.test.js、test/building-panel-controller.test.js；浏览器脚本为 scripts/review-territory-resources.mjs。完整日志见 [check.log](../outputs/resource-capacity-review/check.log)，最终相关日志见 [final-focused.log](../outputs/resource-capacity-review/final-focused.log)。

## 尚未落地的机制

1. 一次性生产力：领取后立即指派已经确认；具体哪些地块、数额、没有在建项目、超出剩余工作量、取消、目标换主等边界待决定，当前不生成或发放这种奖励。
2. 科技研究：科技值决定速度已经确认；研究工作量、并行研究与分配、各阶段加成仍待定，阵型／战术／强化尚没有科研加成。
3. 原“科技点余额奖励”与新规则冲突，已在设定／路线 v4 明确标为形式待重新确认；不能默认保留研究点钱包，也不能自行改成永久能力加成。
4. 球迷奖励、赞助合同、每日联赛和奇观效果沿用各自的待接入状态；奇观仍等用户明确通知后才读取并接入其最新效果草稿。

本轮含服务端改动，需要用户自行重启游戏服务后 Ctrl+F5。没有启停用户原服务、提交／推送、打包或部署。
