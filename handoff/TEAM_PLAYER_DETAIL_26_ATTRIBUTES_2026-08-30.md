# 球队管理球员详情与 26 项数值（2026-08-30）

## 功能

- 球队管理中的每张球员卡现在都是详情入口
- 点击后在球队管理窗口内打开球员详情面板
- 展示当前/基础综合能力、强化等级、评级、主副位置、身高、惯用脚、俱乐部、国家队、体能、状态、可用性和特性
- 按固定 YDL/S4 成熟口径展示全部 26 项能力值
- 优先显示 `effectiveAttributes` / `effectiveOverall`，缺少时逐项回退 `attributes` / `overall`
- 按位置高亮核心属性：门将、后卫、中场、前锋四套规则与 S4 一致
- 支持关闭按钮、点击遮罩和 Esc 关闭
- 桌面为五列数值网格，移动端收窄为两列

## 文件

- `client/team/team-controller-ydl.js`
- `styles/team-player-detail.css`
- `test/team-player-detail.test.js`
- `test/team-player-detail-wiring.test.js`

入口由 `app.js` 加载新球队控制器，`index.html` 加载详情样式。

## 验证

- 球员详情专项测试：5 / 5 通过
- 项目自动化测试：74 / 74 通过
- `npm run check`：通过
- 浏览器测试按约定由用户执行
