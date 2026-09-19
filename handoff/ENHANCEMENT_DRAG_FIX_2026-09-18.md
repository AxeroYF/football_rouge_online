# 强化卡牌拖拽与刷新修复 · 2026-09-18

本地修复与验证已完成，未打包、未部署。线上基线仍是用户已确认安装的 r8。本工作树还包含前一轮已验证但未上线的四人同盟加载修复，见 ALLIANCE_LOADING_FIX_2026-09-18.md；后续打包应明确包含两轮修改。

## 已复现与修复

- 后台状态变化会重新获取强化库存并替换整个卡牌区域，拖动中的源节点被移除。修复为拖动期间推迟请求及重绘，拖动结束后合并刷新；开始拖动前已在途的响应也不会重建源节点。
- 主卡拖入副卡槽被当作重复使用同一张卡拒绝。现在支持空槽之间移动和占用槽位之间原子交换，交换前校验两张卡的新角色限制，拒绝时不改变任一槽位。
- 开始强化前发出的库存 GET 可能晚于强化结果返回，从而重新显示已消耗的材料或旧等级。写操作开始和成功返回时递增读取序号，丢弃旧响应。
- 增加拖动中透明度与目标槽位提示，取消或关闭后清理状态。等待请求时键盘操作也遵守禁用状态。
- 相关存档回归发现无 world 的初始化路径访问 world.coalitions 会报错；CoalitionService.prepare 增加无 world 时的空事务处理，不改变正常世界中的联军规则。

## 文件

运行文件：
- client/enhancement/enhancement-controller.js
- styles/enhancement.css
- server/application/coalition-service.mjs（无世界初始化保护，一行）
- index.html（内容哈希与样式版本更新）

测试：test/enhancement-controller.test.js 新增槽位交换、角色限制原子拒绝、拖动期间在途响应/轮询、旧库存响应不能复活材料的用例。
浏览器工具：scripts/review-enhancement-drag.mjs。

## 验证

59 项测试通过：
node --test test/enhancement-controller.test.js test/enhancement-service.test.js test/deferred-card.test.js test/coalition.test.js

日志 outputs/enhancement-drag-20260918/tests.txt。

真实 Chrome 原生鼠标拖放 6 项通过：仓库到主卡、主卡到副卡、拖动中轮询保留源节点、滚动仓库后正确落卡并保留滚动位置、已占用槽位互换、取消拖动后状态清理。浏览器异常为 0。

before.json 和 before.png 保存修复前复现：主到副失败，刷新后源节点 isConnected=false。该次浏览器中移除源节点后最终仍成功投放，因此证据仅说明 DOM 被替换，并非声称每次都必定丢失拖放。
after.json 和 after.png 保存修复后结果。浏览器使用真实控制器/卡牌/CSS，内存库存请求，不修改真实账号。扣卡、重试、存档恢复由服务端和控制器测试覆盖；此次浏览器不向生产服务提交强化。

保留原有成功/失败和特性选择展示机制、概率及收费规则。玩家未提供更具体的其他 bug 表现，本次结论限于已复现和测试覆盖的问题。
