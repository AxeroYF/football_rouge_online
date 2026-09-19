# 羁绊显示恢复 S4 逻辑 · 2026-09-10

用户要求恢复 S4 原版显示逻辑。已对照 `.worktrees/s4/versus/public/app.js` 中 leagueBondDisplayLineup、leagueBoardMagnet、leaguePlayerTooltip 和羁绊摘要渲染。

## 当前行为

- 羁绊增益默认关闭；开关仅切换首发的属性及总评预览。
- 开启时从原始 effectiveAttributes / attributes 生成展示副本，只应用最高两项羁绊，按球员本职核心属性重新计算总评；关闭恢复原显示。
- 磁贴、球员卡、悬浮提示共用展示数据。移除 Rougelite 特有的 +百分比磁贴徽标，以及悬浮提示中始终启用的比赛效果属性。
- 顶部列出所有满足条件的羁绊，不受增益开关影响；没有羁绊时不显示摘要。列出超过两项不代表全部参与加成。
- 默契连线保持现有计算，比赛引擎、最高两项实际生效规则、原始阵容和存档均不修改。

## 文件

- tactics-page.js：展示状态、摘要、磁贴和悬浮提示。
- client/tactics/bond-display.js：S4 展示副本计算，角色限定按当前站位，正常属性上限 99。
- app.js、index.html：更新模块缓存版本 20260910-s4-bonds-v1。
- test/campaign-bonds.test.js：补充展示回归。
- scripts/review-s4-bond-display.mjs：临时 DATA_DIR、独立服务和无头浏览器验收。

## 验证

34 项相关测试通过：campaign-bonds、tactics-card-display、tactics-lineup-rules、player-trait-integration、position-inheritance。语法检查及已有修改文件 diff --check 通过。

隔离浏览器通过默认关闭、三项羁绊常显、最高两项应用、磁贴/卡面/悬浮一致、反复切换不叠加、阵容数据不变、无写请求及横屏展示检查；pageerror 为 0。证据：outputs/s4-bond-display-20260910/report.json 和四张截图。手机横屏为桌面浏览器视口模拟。

本轮只在本地完成，未部署服务器、未重启用户服务。前端更新后刷新浏览器即可；若手动发布，需同时包含上述四个前端文件（包含新增模块），不能只上传旧横屏 UI 包。安卓开发继续暂停。

本记录覆盖旧 NOTIFICATIONS_AND_BONDS / TACTICS_SETTINGS_INHERITANCE 文档关于“顶部只显示最高两项”和“开关隐藏摘要/百分比徽标”的旧显示说明。历史测试数量不累加为本轮全量验收。
