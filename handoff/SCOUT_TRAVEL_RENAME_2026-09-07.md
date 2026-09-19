# 球探行程与改名、首发体力 · 2026-09-07

## 当前用户决定与实现

- 第一条原话重复写“远征队”，已向用户说明按“球探像远征队一样线性移动”实施；用户未修正，后续补充体力只显示当前数值。
- 远征与球探共用整段起止时间比例，并在地图投影平面内插值，地图位置沿直线前进。球探显示起点到终点的直线路径，地图位置与进度条同一时间轴。
- 移动费用、范围、实际耗时和终点均未调整。旧多段行程仍保留服务端驻扎／取消兼容，显示统一按整段起终点时间轴。
- 球探右上角卡片与远征卡片的尺寸、间距、边框、标题色、路线、进度条、倒计时和“中止”按钮统一。移除移动通知和详情的可见百分比；发掘概率图的百分比保留。点击“球探移动中 · 姓名”可查看详情。
- 首次地图加载完成后主动刷新球探通知地名，不依赖下一次账号轮询。
- 球探详情姓名旁新增“改名”；中文／英文均可，去首尾空白后 1～24 个 Unicode 字符，拒绝控制字符。沿用已有 name 字段；不收费、不限制待命／移动／发掘状态。
- 保存同步详情、地图名称、中心列表和未领取发掘任务的姓名。已领取历史快照保留；不改变球探 ID、行程、候选球员或其他球探。
- 失败显示行内错误并保留输入；轮询不清空草稿或焦点。Esc 先取消编辑，再次 Esc 关闭详情。账号切换时丢弃旧请求界面结果；后端按登录账号查找球探并事务保存，失败回滚。
- 远征队首发名单在总评旁显示当前体力，最终只显示整数，如 73，不显示 /100。读取出战首发／训练替补的 state.fitness，兼容旧 fitness 与默认值，保留 0；随状态更新。

## 主要文件

- shared/map/unit-travel.mjs：整段进度、起终点与地图投影插值。
- client/map/expedition-piece-controller.js、client/map/scout-unit-controller.js：两类单位采用同一计算。
- client/buildings/scouting-controller.js、styles/scouting.css：统一行程、改名表单、焦点／草稿保持、窄屏图例最小高度。
- shared/scouting/scout-units.mjs：名称验证；旧多段服务端结算函数保留。
- server/application/scouting-service.mjs、campaign-service.mjs、server/http/campaign-api-handler.mjs：POST /api/campaign/scouting/rename，登录账号所属球探、名称验证和事务保存。
- client/map/expedition-panel-controller.js、styles/expedition-panel.css：首发总评／体力两列。
- app.js、index.html：地名刷新及缓存标记 20260907-scout-travel-v4。

## 验证

- npm run check：70 + 522 + 144，共 736 次测试执行，0 失败。
- 地名刷新补充后，88 项球探／远征／地图／API／持久化相关回归通过。
- npm run review:scout-travel：最终 28 项隔离完整游戏浏览器检查通过，0 浏览器错误。实测 25%、50%、75% 显示位置和进度一致；卡片布局一致；改名失败重试、持久化、重载、移动／发掘任务保持、无权限拒绝、中心同步，以及移动／待命两种手机改名布局。
- npm run review:expedition-panel：29 项浏览器检查通过，含当前体力与零体力同步、手机布局及原移动交互。
- 测试使用自建临时服务和测试账号；已清理临时账号与服务，没有修改真实账号存档。
- 证据：outputs/scout-travel-review/（browser-report.json、npm-check.log、related-tests.log、unified-journeys.png、rename-mobile.png、rename-idle-mobile.png）；outputs/expedition-panel-review/（体力列截图和报告）。

## 使用

本次改名包含后端接口，重启本地游戏服务后 Ctrl+F5。点击球探／通知标题 → 姓名旁“改名” → 输入 → 保存。体力列在实际游戏地图的远征队面板中。

未启停用户服务、未提交／推送、未打包／部署。奇观后台草稿及未确认玩法仍待用户明确通知，不读取或接入。
