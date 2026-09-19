# 战术设置、S4 羁绊栏与站位继承 · 2026-09-09

## 完成

- 磁贴/球员卡切换移至顶部「设置 → 战术板球员显示」。沿用 ydl-tactics-piece-display 本地偏好，切换不写战术、不重建球员节点。设置菜单打开时提升层级，避免被战术窗口遮挡。
- 战术板右上角采用 S4 league-bond-ready 的紧凑羁绊标签：名称、人数/11、加成百分比；保留最高两项实际生效羁绊及显示开关，移除旧的大块说明栏。修复工具栏列宽及窄屏球场/替补席布局。
- __s4V2.customPositionPresets.position2/position3 记录是否独立设置。未自定义时跟随默认坐标、阵线、研究阵型及研究备份；成功拖动、自动重排、导入/解除研究阵型时，当前非默认站位转为自定义。仅切换标签、调整打法和职责不会断开坐标继承。
- 前端渲染/序列化、服务端保存和 buildAccountMatchSeat 共用 shared/config/position-inheritance.mjs。默认变化不会覆盖已自定义站位；两支编队各自独立。
- 旧存档无标记时，将相同副本和原始自动生成网格识别为继承；无法确定来源的不同布局以及明确绑定研究的站位保留独立，避免覆盖已有定制。
- 登录与地图加载背景切换 assets/screen-r4.png。

## 验证

59 项战术/羁绊/研究专项通过（outputs/tactics-settings-regression.log）；49 项服务/API/比赛/预览/导入集成通过（outputs/tactics-settings-integration.log），共 108 项。

scripts/review-tactics-settings.mjs 使用隔离服务器和存档，验证设置菜单点击、卡面偏好刷新恢复、羁绊开关、默认拖拽继承、领先单独拖拽、保存刷新、比赛阵容一致、手机球场边界及替补席不重叠、r4 资源加载。截图和报告位于 outputs/tactics-settings-20260909/。

## 加载

本轮修改包含服务端保存和比赛阵容生成，需重启后端并 Ctrl+F5。未重启正式服务、未改动正式玩家存档。本轮新标记会在正常战术保存时落盘；比赛构造对旧存档兼容处理。
