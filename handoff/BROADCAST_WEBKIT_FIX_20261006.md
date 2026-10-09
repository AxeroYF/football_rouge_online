# 比赛球员卡 WebKit 布局修复 · 2026-10-06

状态：本地修复及正式启动资源已更新，尚未打包或部署；已部署基线仍为原版 R51。此前新增的“默认购买保卡”设置保留。

## 复现与根因

用户反馈 Mac Safari 比赛画面出现巨大红蓝折线，卡面消失。使用项目真实 `combinedPitchMarkup`、球员卡及全套页面样式，在 Windows Playwright WebKit 26.5 复现同样画面；相同视口下 Chrome 正常。

1440×900、设备像素比 2 时，球员按钮约 48.45×65.22 CSS 像素，但 WebKit 内部卡面、卡片及 SVG 视口均为 0×0，SVG path 却以 466×685 绘制。红蓝折线来自队色盾形边框，不是比赛轨迹或比赛状态错误。

## 修复范围

在 `styles/campaign-broadcast.css` 将比赛卡片按钮改为单列 Grid，并使用 `minmax(0,1fr)` 明确内部列尺寸，避免 WebKit 按尺寸包含的卡片内容计算出零宽度。卡面、边框恢复同尺寸缩放，保持原卡片比例、位置、体力条、评分、队长与事件标记。不修改比赛引擎或结算。

同步重建 `index.html`、`game.html` 和 `game-startup.css` 的内容版本；原发布包及发布登记保持不变。

## 验证

- 修复前 WebKit 五种视口均复现；Chrome 对照正常。
- 修复后用正式 `game-startup.css` 检查 WebKit 和 Chrome，覆盖 1280×800、1440×900、1512×982、1728×1117、390×844、844×390，共 12 组；每组 22 张卡面和边框尺寸正确，无页面脚本异常。
- 比赛播报及每日联赛动态模块的 12 项相关测试通过。
- 模块版本与启动生成物检查通过。
- 截图与布局报告保存在 `outputs/broadcast-webkit-review/`，不进入 Git。

复验命令：`node scripts/review-broadcast-webkit.mjs --bundle`。需要 Playwright、Chrome 和 Playwright WebKit；`--diagnose` 用于记录诊断结果而不在布局断言失败时退出。此验证使用 Windows WebKit，未声称在用户的 Mac Safari 实机上测试。
