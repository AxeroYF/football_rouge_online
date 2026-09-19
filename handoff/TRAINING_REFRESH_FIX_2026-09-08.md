# 训练场球员列表自动刷新跳顶修复 · 2026-09-08

用户反馈训练中心选择球员时自动刷新使滚轮回到顶部。createTrainingController 的 campaignStore 订阅在每轮状态同步中 render()，直接替换 pickerContent.innerHTML，重建真正滚动的 .training-card-list；因此只保留外层容器 scrollTop 无法解决。

本轮处理：

- 用最近生成的 HTML 比较是否需要更新球员列表。不能直接比较 DOM innerHTML，因为懒加载卡片会填充、释放卡面内容。
- 同一训练场／位置／席位／筛选／结果类型中数据变化需重绘时，保存并恢复 .training-card-list 或 .training-result-body 的 scrollTop，以及外层位置、球员按钮焦点。
- 选择新位置、切换编队筛选或关闭后重新打开时从顶部开始，避免串用旧列表位置。训练中心主面板重绘也保留自身滚动。
- 继续同步球员训练状态和可选资格；同步最新 training.rules，计算可提升空间时使用奇观加成后的点数需求，避免普通 5 点规则覆盖斗兽场 6 点要求。
- app.js 的 training-controller 导入及 index.html 的应用入口缓存版本更新为 20260908-training-refresh-v1。

验证：

- node --test test/training-controller.test.js test/training-service.test.js test/wonders-runtime.test.js test/app-map-regression.test.js：66 项通过，含新增 3 项滚动／DOM 保留、训练结果滚动、动态点数门槛回归。
- scripts/review-training-refresh.mjs：真实游戏、独立临时 DATA_DIR，60 名前锋与训练中心夹具；15 项 Chrome 检查通过。连续至少两次实际世界轮询后保持桌面滚动和同一列表 DOM；实际 API 开始一名球员训练后按钮变为不可选而滚动保持；390px 窄屏、筛选切换与后续同步、可见卡片懒加载均通过，浏览器异常 0。
- outputs/training-refresh-20260908/ 保存测试日志、浏览器报告和桌面／窄屏截图。

未修改真实存档或后端训练规则，未启停用户服务。Ctrl+F5 刷新游戏即可。
