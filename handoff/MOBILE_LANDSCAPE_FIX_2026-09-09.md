# 手机横屏 UI 优化落地 · 2026-09-09

用户批准“开始优化”后，本轮完成网页层适配。安卓开发继续暂停，没有操作手机或修改 APK；未部署远程服务器。

## 布局与操作

- 适用宽度 ≤1100px、高度 ≤600px 的横屏。修正全局 560px 最低高度，使用实际视口高度；顶部栏压到 44px。
- 顶部菜单收纳全部原功能；玩家、通知、地图工具初始折叠，展开互斥，保护地图操作空间。通知接受/拒绝仍走已有互动接口。
- 窗口打开与焦点恢复使用 preventScroll，避免根页面位移、顶栏消失。短屏窗口限制在可视区域，内容在窗口内滚动。
- 登录改横向布局；编队简化列表、收起高级筛选；商店、豪门、设施、玩家互动、背包等调整高度和间距。
- 战术板分“阵容 / 站位与羁绊 / 比赛战术”；首发和替补同屏，全场预览按容器高度计算缩放，可切到放大编辑。默认/领先/落后战术使用原有切换与保存逻辑。
- 三选一卡片和领取结果页适应短屏；桌面宽屏隐藏新增的移动控制。

## 源码范围

1. index.html：追加独立样式/模块，增加菜单和地图工具按钮。
2. styles/mobile-landscape.css：横屏断点样式，移动主题选择器覆盖。
3. client/ui/mobile-landscape.js：视口、菜单、工作区和折叠状态；无游戏数值逻辑。
4. client/ui/stage-window-manager.js、client/ui/small-window.js：焦点防止页面滚动。
5. scripts/review-mobile-landscape.mjs：隔离本地账号、服务器、浏览器回归脚本。

## 验证

- scripts/review-mobile-landscape.mjs：780×360 / 740×320 CSS 像素，DPR 3、触屏模拟；桌面 1440×900 对照。38 个状态，浏览器 pageerror 为 0。
- 菜单实际点击进入各功能；根容器 y=0 且不超出视口；登录按钮可见；完整战术球场预览、分区与领先方案切换、筛选开合、地图工具开合、关闭战术返回地图。
- 通知接受后核对服务端友谊关系；未拥有的球员三选一后成功展示领取页。测试数据均位于临时目录，与生产无关。
- node --test test/window-standards.test.js test/tactics-card-display.test.js test/tactics-lineup-rules.test.js test/position-inheritance.test.js：22/22 通过。
- node --check client/ui/mobile-landscape.js 与本次已有文件 diff --check 通过。
- 截图与报告：outputs/mobile-landscape-fix-20260909/，已人工目视检查主要页面。

测试账号阵容是用于压力展示的混合球员，不是合理比赛阵型。真实手机触摸拖动、双指缩放、输入法与 WebGL 性能尚需实际手机浏览器验收；本轮没有宣称安卓 APK 已修复，也未覆盖每种比赛/交易状态。

## 手动上线

更新包：outputs/mobile-landscape-release-20260909/yellowdogs-mobile-ui-20260909.tar.gz。

附 .sha256 与解包后的 README.md。包内严格限制为 5 个前端文件、SHA256SUMS、apply-ui.sh、README.md；不含账号、存档、私钥、APK、后端业务代码。源文件与归档内容逐字节核验通过，脚本 bash -n 通过。

用户上传 /home/admin/ydl-upload 后校验、解压、sudo bash apply-ui.sh。脚本备份原文件，先复制依赖最后替换 index.html；失败尝试恢复。无需重启、不重跑安装、不重新发资源。浏览器需刷新。只有真实服务器执行后才算线上完成。
