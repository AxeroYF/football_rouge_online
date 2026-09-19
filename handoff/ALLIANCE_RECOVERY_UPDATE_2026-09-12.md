# 同盟、恢复范围与球探费用更新 · 2026-09-12

状态：Rougelite 工作树本地实现完成，尚未部署。用户反馈当前版本已在服务器运行一段时间；本轮没有访问、重启实际服务器，没有读写真实服务器存档。

## 已实现规则

- 玩家关系新增同盟。发起双方必须先宣布友谊并接受，然后再发同盟邀请，由另一方接受。
- 同盟按完整成员组处理；已有同盟的代表之间接受邀请会合并两个成员组。邀请列出全部成员，成员变化后旧邀请作废。为避免未经说明带入现有战争，任一拟加入成员仍处于战争时禁止建立或扩展同盟。
- 对同盟一人宣战，双方同盟全体成员之间同时进入战争。取消交战双方未完成的外交申请，保留各自内部同盟。不能直接谴责或宣战盟友，须先退出；求和仍沿用双方单独确认。
- 同盟共享当前领土地块视野、远征队与球探通行权；球探可在盟友领土发掘，费用及升级收益取自己的球探中心。设施建设、升级、拆除和领土收益仍归原领主。
- 远征队可从盟友地块按原有规则发起陆路行动或海岸测绘；敌方目标依然需要战争关系。
- 退出同盟后，与原盟友恢复友谊；其他成员保持同盟。撤回通行、共享视野及恢复权限，在失去权限的领土或途中单位返回自己的领土。已有战争不会因退出而结束。已付费发掘任务保留原位置、候选与完成时间，可正常领取。

## 用户确认的数值

恢复范围随等级扩大，恢复速度保留原值；采用以下半径（可在 shared/config/facility-levels.mjs 调整）：

| 等级 | 恢复半径 | 每分钟恢复体力 | 球探单次发掘费用 |
|---|---:|---:|---:|
| LV1 | 150 公里 | 1 | 700 金币 |
| LV2 | 225 公里 | 1.25 | 700 金币 |
| LV3 | 300 公里 | 1.5 | 700 金币 |
| LV4 | 375 公里 | 1.75 | 700 金币 |
| LV5 | 450 公里 | 2 | 700 金币 |

恢复中心覆盖自己与盟友的远征队，驻扎地块中心在半径内即可生效。使用真实经纬度球面距离，地图圈使用相同算法与地区坐标变换；行军沿用原有抵达后开始恢复规则，比赛仍暂停场外恢复。多个中心重叠时取最高恢复速度，不叠加。驻防球员继续使用基础恢复。

点击自己或盟友的体能中心会显示虚线范围圈、向外扩散动画和范围/速度标签；10 秒后自动关闭，Escape 可提前关闭。自己的设施面板另有“显示恢复范围”按钮。尊重减少动态效果设置。手机横屏标签已避开左侧地块面板。

取消球探中心升级引起的发掘涨价，基础价格仍为 700 金币；球探容量和其他升级收益保留。历史已支付任务不重算、不退款。

## 代码入口

- shared/config/diplomacy.mjs、server/application/diplomacy-service.mjs：同盟成员、邀请、宣战、退出与原子存档回滚。
- shared/config/facility-levels.mjs、shared/map/recovery-aura.mjs、server/application/expedition-fitness-service.mjs：等级数值、范围计算、恢复结算。
- server/domain/expedition-piece.mjs、shared/scouting/scout-units.mjs、server/application/scouting-service.mjs：通行、发掘及权限撤销。
- server/application/fog-service.mjs、campaign-service.mjs、territory-model.js、maritime-routes.mjs：地图授权、公共状态和行动。
- client/social/interaction-controller.js、client/map/recovery-range-controller.js、client/map/expedition-piece-controller.js、client/map/scout-unit-controller.js、client/maritime/maritime-controller.js、client/territory/territory-controller.js：交互与地图操作。
- client/buildings/building-panel-controller.js、client/buildings/wonder-hover-controller.js、app.js、index.html、styles/buildings.css、styles/interactions.css：范围入口、说明与缓存版本。

## 验证

- npm run check：1,113 项通过（80 项前置、885 项主测试、148 项地图/模型），0 失败。日志：outputs/alliance-full-check.log。
- 新增同盟多组战争、旧邀请失效、存档失败回滚、退出遣返、临时视野、盟友发掘、半径边界、升级、恢复暂停与海岸测绘撤销回归。
- scripts/review-alliance-update.mjs：独立临时存档和临时 localhost 服务，双账号真实 HTTP/UI 验收 9 项通过，无浏览器异常。
- 截图与报告：outputs/alliance-review-20260912/（alliance-desktop.png、recovery-radius-desktop.png、recovery-radius-mobile.png、report.json）。
- 补齐远征外观测试的真实地块归属字段；旧顶部导航断言允许 nav 的 id 属性，保留现有移动菜单。

## 更新注意

本轮未生成新的部署包，也未上传服务器。部署应使用现有手动更新流程，包含上述新增模块及其修改文件，先备份运行中的存档，再重启后端并刷新浏览器。保留服务器现有账号、赛季、领土与任务数据，无需清档或手动迁移。不要用开发存档覆盖线上数据。
