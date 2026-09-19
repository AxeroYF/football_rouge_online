# 战术板静态盾形球员卡 · 2026-09-05

用户要求在战术板右上空位加入“磁贴／球员卡”显示切换，场上使用小型盾形卡，显示已有卡画并关闭动态效果。

- 已在原工具栏第二列、第一行加入分段切换，位于阵容方案开关上方。默认沿用磁贴；选择保存在本机 `ydl-tactics-piece-display`，刷新和重开战术板后保留。存储被禁用时会话内仍可切换。
- 新 `client/tactics/card-display-controller.js` 只给 `[data-league-magnet]` 增减静态卡面和显示类，不重建磁贴节点、不写战术数据、不触发网络请求、不停止落位预览。替补席继续使用现有磁贴。
- 盾形卡共用正式共享渲染器，保留卡画、原定位、真实能力／强化等级、旗帜／俱乐部和居中的姓名。S/X 仍以前景人物覆盖信息；没有卡画时显示评级圆章。
- 共享卡片新增 `animated:false` 选项：不创建粒子 Canvas，也不输出高光扫光层，静态卡不进行卡面动画。其他页面卡片继续默认动态。
- 场上卡宽随球场取 11.5%，限制 64–92px；保留中心坐标、实际位置标签、适配颜色、体力条、队长及训练标记。职责控件继续显示于下方；窄屏沿用原点击职责面板逻辑。
- 拖拽、首发替补互换、悬浮／焦点信息由原磁贴节点处理；场外拖拽副本适配盾形卡。进攻／防守落位预览仍显示原圆点，返回默认落位时恢复所选外观。
- 已避开旧 `.tactics-player-card` 的固定 110px 强制宽度，使用独立 `.tactics-shield-card` 类，样式位于 `styles/tactics-cards.css`。

验证：419 项完整项目检查通过（61＋289＋69）；类名隔离后 4 项显示模式专项再次通过。2,862 项 CSS 层叠检查覆盖 11 张真实模板场上卡、两种主题、1920／1366／560 宽度、普通／落位预览，以及原磁贴模式保持原样。静态卡专项覆盖 SABC 有图／无图、无画布／无扫光、持久偏好、节点／职责／坐标保留和存储失败兜底。

离线检查：`scripts/review-tactics-cards.mjs` 用真实控制器和内存阵容生成模板；`scripts/check-tactics-card-ui.py` 检查加载顺序与实际 CSS；`scripts/render-tactics-card-review.mjs` 合成小卡片排布图。产物位于 `outputs/tactics-card-review/`，已检查合成图，但不等同于浏览器截图。

前端版本 `20260905-tactics-cards-v1`。用户 Ctrl+F5 刷新即可，无需重启服务。未操作浏览器、服务或真实存档；按当前约定未额外备份、提交或推送。

## 卡片适度放大（tactics-cards v2）

按用户要求将场上卡片从 `clamp(64px,11.5cqw,92px)` 放大为 `clamp(72px,13.5cqw,110px)`，常规宽度约增加 17%–20%，卡片宽高保持原盾形比例。拖拽副本上限同步到 110px；不改坐标、职责或预览行为。

2,862 项既有样式检查通过；与电视台合计 8 项显示专项通过；更新离线渲染尺寸并查看 `outputs/tactics-card-review/pitch-cards.jpg`，排布与标签间距正常。未运行浏览器。仅 CSS 入口更新，Ctrl+F5 刷新即可。

## 拖动方框移除（2026-09-06，tactics-cards v3）

用户截图中的方框源自原磁贴 `role-swap-primary/secondary` 的 outline 与外层 filter，以及卡片 focus-visible 的矩形描边。卡片模式下拖动／换位／主副位置／键盘焦点统一清除外框、底影和外层滤镜，使用卡面透明轮廓的 drop-shadow；主位置绿色、副位置金色，焦点保留可见提示。旧磁贴模式保持原样。场外 ghost 同时覆盖旧磁贴的固定 64px 高度、max-height 与内边距，保持 110px 盾形比例和透明背景。

2,862 项既有 CSS 检查通过；额外离线查看 7 种状态的生效样式，方框均清除，盾形滤镜颜色正确。结果 `outputs/tactics-card-review/drag-style-review.json`。未运行浏览器或改拖动逻辑；Ctrl+F5 即可，无需重启。

## 悬浮方框修正（2026-09-06，tactics-cards v4）

补齐原 `.magnet[data-traits]:hover/:focus` 引入的青色矩形描边。卡片模式的 hover 和普通 focus 加入透明外层规则，只在卡面透明轮廓显示适配色光晕；拖动主副位置颜色优先级保留。tooltip 的 DOM、事件和样式未修改。2,862 项既有样式检查通过，另核对 club／legacy 的 8 组 hover／focus／副位置／拖动叠加状态；产物 `outputs/tactics-card-review/hover-style-review.json`。未运行浏览器，Ctrl+F5 刷新即可。
