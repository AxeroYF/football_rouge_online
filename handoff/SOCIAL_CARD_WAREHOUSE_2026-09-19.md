# 玩家交易与联军卡片仓库 · 2026-09-19

状态：功能接入与验证完成。用户明确要求本轮不打包、不部署；未执行服务器操作。

## 接入范围
- 玩家交易/赠送选择球员：双方独立卡片仓库，保留金币、石油、选卡与报价提交。筛选隐藏的已选卡仍保留，已选数量显示总数；筛选状态不混入交易请求。
- 普通联军组队：联军阵容和个人可借调球员改为卡仓，保留提供方、首发/替补、借调、归队/申请归队状态。
- 豪门活动联军：活动阵容与个人球员同样接入，保留活动开放、队伍忙碌、提供方归队等权限校验。

## 复用与性能
client/cards/social-card-warehouse.js 复用 playerCardMarkup 的原盾形卡面、强化等级、图片和延迟渲染。支持名称/俱乐部/国家/提供方搜索，以及评级、位置、强化等级、国家、仅可操作筛选和重置。每个面板独立保存筛选及加载数量，每批24张，点击加载更多。
保留 patchMarkup 局部更新和卡片稳定ID，避免选卡/借调重建全窗。新增滚动容器接入 deferred-card-controller。账号切换清理面板筛选。仅可操作同时考虑阵容、忙碌、活动开放和提供方权限。
普通/活动联军 myCards 返回原卡片视图模型，以提供评级、国家、俱乐部、强化等级与原卡面资料。

## 验证
- 168项单元/业务/界面测试通过（social-card-warehouse、diplomacy、coalition、elite-raids、card-management-ui、enhancement-controller）。
- 真实Chrome：交易双方独立筛选、筛选外选卡保留、48张分页、报价包含正确球员ID/金额；普通联军筛选保持、滚动200保持、借调/归队；活动联军门将和仅可操作筛选、借调/归队；700px窄屏无页面横向溢出。
- 前序问题浏览器回归通过：强化单卡显示、强化/汰换原卡片节点保留、联军无冗余详情请求、豪门路线不遮挡领地点击。
- 已查看交易与窄屏截图；空仓库提示调整为占满网格行，避免挤在单个卡槽。
- 模块哈希检查254 modules / 325 mappings通过；差异检查通过。
输出：outputs/performance-20260919/social-warehouse-tests.txt、social-warehouse-browser.json、trade-warehouse.png、coalition-warehouse.png、raid-warehouse.png、raid-warehouse-mobile.png。
