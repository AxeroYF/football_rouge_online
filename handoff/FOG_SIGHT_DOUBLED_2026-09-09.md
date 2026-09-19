# 迷雾视野扩大一倍 · 2026-09-09

用户要求：玩家迷雾视野太小，调大一倍。

已将 shared/config/fog.mjs 中普通地理视野半径由 4.5 改为 9，海岸临时预览半径由 2.8 改为 5.6。按可见距离翻倍，不是承诺可见地块数量或面积正好翻倍。渐隐宽度、预览有效期和正式服隐藏开发开关的规则保持原配置。

当前地图有完整地理几何，服务端 FogService、前端 FogSpatialIndex、迷雾栅格与地形按视野加载共用此配置；无几何旧世界的兼容邻接环逻辑不变。需要重启后端并刷新页面，替换服务端当前账号的视野缓存；index.html 前端入口版本已更新。

验证：continuous-fog、fog-service、campaign-fog、neutral-rewards、diplomacy、conquest 六组测试通过。新增测试覆盖原本不可见的新距离带、前后端可见地块一致、遇见玩家记录以及远处地块仍隐藏；旧边缘测试改为相对于实际视距放置，仍验证圆角和渐隐边界。日志 outputs/launch-audit/double-sight-tests.log。

未部署服务器。安卓端按用户要求继续暂停，本轮没有继续安卓构建、安装或发布。

改动：shared/config/fog.mjs、index.html、test/continuous-fog.test.js。
