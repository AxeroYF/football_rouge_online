# 资源来源悬浮与地块单位统一 · 2026-09-07

本轮承接资源产能机制，按用户新要求调整查看方式与文案。

## 当前界面

- 右上三个资源仍放在同一个框内，鼠标分别移到金币、生产力、科技值，显示对应的来源明细。
- 移除原点击打开的五词条弹窗及说明小字；悬浮面板只保留资源标题、合计、来源地块和贡献数值。
- 金币列出每小时增长的地块来源；生产力／科技值列出当前能力贡献，继续不累积。
- 来源按贡献从高到低排列，零贡献地块不列入该项；多来源时在面板内滚动，滚轮不缩放地图。
- 鼠标可以从资源栏移入面板；离开资源与面板后收起。Escape 关闭，键盘焦点／Enter 可查看；触屏点按使用同一份简洁明细，点外部关闭。
- 面板不加遮罩、不模糊地图，不抢占现有标准窗口。
- 地块悬浮与点击详情不再显示“/小时”，三项统一显示图标、数值及原有资源名称。这里只改变显示，金币实际结算周期保持原样，具体结算时间由用户说明。

## 来源数据

服务端 TerritoryProductionService.publicState 新增 sources，只返回当前账号真实拥有的地块。每项包含稳定来源 ID、地块 ID、国家／地块名称及三项贡献，来自与结算一致的资源配置。客户端按选中的资源过滤并汇总核对。

征服奖励、球员出售等一次性到账不伪装为小时收入。尚未接入的赞助与奇观也不生成虚构来源。旧服务尚未提供新字段时显示“来源明细暂不可用”，重启新版服务后显示实际明细。

未调整生产力建设、科技能力、金币结算、地形配置或用户真实存档。

## 实现与验证

主要修改：
- client/resources/resource-controller.js：逐项悬浮、明细渲染、滚动、键盘与触屏行为。
- server/application/territory-production-service.mjs：当前账号来源明细。
- index.html、app.js、styles/resources.css：统一框内的三个触发区与浮动布局。
- client/resources/resource-markup.js、client/map/territory-presentation.js、client/territory/territory-controller.js：地块移除时间单位及刷新版本。
- scripts/review-territory-resources.mjs：隔离服务的实际浏览器验收。

相关 51 项检查通过，覆盖资源来源所有权、三资源来源合计、换主、输出转义、金币与能力区分、地块单位与既有地图／窗口回归。见 [focused.log](../outputs/resource-hover-review/focused.log)。

最终浏览器结果及截图：
- [浏览器检查](../outputs/resource-hover-review/browser-results.json)
- [金币来源](../outputs/resource-hover-review/hover-gold-desktop.png)
- [生产力来源](../outputs/resource-hover-review/hover-production-desktop.png)
- [科技值来源](../outputs/resource-hover-review/hover-science-desktop.png)
- [触屏来源面板](../outputs/resource-hover-review/resources-touch.png)
- [三产地块](../outputs/resource-hover-review/territory-3-resources.png)

所有游戏验收均使用临时数据目录、动态端口、隔离账号，未启停用户原服务。需要自行重启游戏服务后 Ctrl+F5；未提交、推送、打包或部署。
