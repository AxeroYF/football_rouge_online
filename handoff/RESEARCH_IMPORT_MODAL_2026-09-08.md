# 研究阵型导入弹窗 · 2026-09-08

## 修复

原 research-import-overlay/dialog 完全缺少样式，被正常排版到战术页底部，压缩战术板高度。现在采用原生 dialog 的模态顶层和独立 styles/research-import.css，居中、深绿／米白／金色、背景遮罩，不参与战术页网格布局。

- client/research/formation-import-markup.js 独立渲染已确认研究阵型；每项展示 11 人点位缩略图、名称、自动识别阵型和已完成方向的实际 +x% 加成。
- 标题注明导入目的（远征／留守、默认／领先／落后）；当前使用方案有标识，空列表有空状态。
- 关闭按钮、遮罩外点击和 Esc 均只关闭导入弹窗。Tab 与 Shift+Tab 在弹窗内循环，关闭后焦点返回入口。
- 打开／关闭只挂载或移除对话框，不重新渲染底层战术板，保留 DOM 和各列滚动位置；移除旧球员浮层。
- 手机端对话框限制在视口内，长名称自动换行，多成果和多方案在列表内滚动。
- 入口按钮占原工具栏完整一行，避免被按三列站位按钮压窄。
- 现有导入、站位锁定、职责可编辑、当前阶段独立保存规则保留。

## 验证

- scripts/review-research-import.mjs：37 项隔离浏览器检查通过，包括居中／模态顶层、3 方案、33 个缩略图点位、12 方向成果、键盘循环、三种关闭方式、底层 DOM／滚动保留、1280／768／390／320 适配、当前站位导入保存和空态。
- 24 项 test/tactics-lineup-rules.test.js 与 test/formation-research-runtime.test.js 回归通过。
- 截图和结果 outputs/research-import-20260908/，已人工检查 desktop.png。
- 纯前端改动，Ctrl+F5 即可；没有重启服务或修改真实玩家数据。
