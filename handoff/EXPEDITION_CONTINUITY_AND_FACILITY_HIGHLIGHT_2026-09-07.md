# 连续人体曲面与设施轮廓高亮

2026-09-07。用户要求五款球星遵循真实人体比例、去掉节肢般的硬接缝，并将地图设施方形选中背景改为沿设施外形的高亮。当前艺术版本为 `20260907-expedition-stars-v3`。

## 人物

- 原分段上臂、前臂、大腿、小腿及肘膝球体已替换为跨关节的连续曲面；肤色与袜子分材质但共享边界位置及平滑法线。
- 球衣肩袖、胸背和短裤髋部使用平滑融合表面，避免封口部件相交形成暗缝；已修正肩头鼓包、袖口肌肤穿插与短裤下摆穿插。
- 头部缩至 v2 的 88%，同时抬高肩线、调整颈部、按身高分配上下臂长度，保留五位球星的共同尺度及体格差异。沿用原先面部、发型及球衣配色。
- 五款 × 三档精度 = 15 GLB，11.23 MiB；近景面数 72,437 / 74,551 / 69,003 / 84,807 / 76,923。人物轮廓优先于 v2 的较低面数；实际地图仍使用渲染后的透明 PNG。
- 新增 `client/expedition-models/athlete-surfaces.js`，包含连续截面、隐式平滑融合与保留法线的材质划分。导出入口及角色 ID 不变。
- [五款整组图](../outputs/expedition-unit-review/lineup.png)、[面部图](../outputs/expedition-unit-review/portraits.png)。v2 对照保留在 `outputs/expedition-unit-review/before-v2/`。

## 设施高亮

- `styles.css` 原 `.building-map-item:hover / :focus-visible` 的半透明矩形背景与 outline 已移除。
- 高亮应用在设施透明图像上，用暖金色轮廓描边与柔光跟随屋顶、墙体和底座边缘；等级牌及原提示框保留。悬浮、按下和键盘焦点均有效。
- `#campaign-map` 限定的规则覆盖全局主题焦点 outline，避免仅键盘操作时方框重新出现。无图像的备用文字保留下划线焦点提示。
- 没有新增持久化选择状态；沿用现有点击查看设施及建造／球探／训练交互。
- [鼠标悬浮实机截图](../outputs/expedition-unit-review/facility-contour-hover.png)、[键盘焦点实机截图](../outputs/expedition-unit-review/facility-contour-focus.png)。

## 验证

- `npm run test:expedition`：16 项通过。新增拓扑检查验证每位球星每档精度都是两条连续手臂与两条连续腿，关节处不再分成独立网格。
- `node --test test/building-marker-controller.test.js test/app-map-regression.test.js`：31 项通过。
- `npm run review:expedition`：7 项通过；三档 GLB、统一图标裁切、面部查看及 390px 布局正常，无页面错误／失败资源。
- `node scripts/review-expedition-game.mjs`：40 项最终检查通过；包含设施鼠标及键盘轮廓高亮、实际 LV1／LV3／LV4／LV5 图像、五款外观保存、移动兼容及手机交互，无运行错误。初次键盘检查发现全局主题 outline 覆盖，修正后最终通过。
- [图鉴报告](../outputs/expedition-unit-review/browser-report.json)、[游戏报告](../outputs/expedition-unit-review/game-browser-report.json)。本轮没有重跑全项目完整测试，不复用历史 724 次检查作本轮结果。

## 查看与边界

图鉴：http://127.0.0.1:4392/expedition-preview.html?v=20260907-expedition-stars-v3 。游戏前端入口、外观资源及 styles.css 缓存版本均已更新，刷新页面可加载。

仍为静态 GLB 造型及 PNG 地图单位，没有骨骼动画。设施与球探模型主体、升级开关、三资源规则、用户账号和真实存档未改；未读取或接入后台奇观效果，继续等待用户明确通知。验证使用隔离服务与临时账号。没有启停用户服务、提交、推送、打包或部署。
