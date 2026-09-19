# 远征载具五模型 · 2026-09-08

取代 EXPEDITION_REDESIGN_2026-09-07.md 的球员形象方案。当前可选外观仅飞机、挖掘机、大巴车、跑车、坦克。

## 资产与外观

- airplane：蓝白双涡扇客机，后掠翼、翼尖、尾翼、驾驶舱、舷窗和起落架。
- excavator：工程黄履带挖掘机，驾驶舱、动臂、斗杆、铰链、液压缸和铲斗。
- bus：绿白长轴客车，车窗、车门、后视镜、轮毂、空调机组。
- sports-car：红色宽体跑车，黑色车窗、双道拉花、灯组、尾翼、扩散器。
- tank：橄榄绿履带坦克，倾斜装甲、炮塔、炮管、舱盖、潜望镜、履带轮组。

使用原生 Three.js 几何与 PBR 材质，无贴图依赖。模型源 client/expedition-models/expedition-models.js；15 个 GLB（每款 3 档 LOD）共约 2.58 MiB。LOD0 各 3668–8928 三角面。所有模型落地归零、最大平面跨度统一为 2.4 战略单位。

assets/expedition-units/catalog.json 只登记五种新载具。对应 models/、models/lod1/、models/lod2/、icons/ 与 thumbnails/ 已生成；图标 320×320 透明 PNG，缩略 WebP 也保留透明背景。旧球员文件为历史闲置资产，不再由当前模型清单或地图外观引用。

## 接入与存档

- 设置里的远征外观改为载具选择，图像区域适配横向车辆。地图、远征详情使用新图标。
- default→airplane；旧 messi→airplane，ronaldo→excavator，mbappe→bus，yamal→sports-car，haaland→tank。
- 旧 ID 兼容读取与迁移，规范化后保存新的 ID；不改变所在地、行军任务、路线或到达时间。新选择仍通过已有鉴权 appearance 接口保存。
- 版本 20260908-expedition-vehicles-v1。实际服务未重启、真实存档未手动更改；需重启服务后 Ctrl+F5。

## 制作与验证

- npm run build:expedition：导出 15 GLB 与报告。
- npm run review:expedition 已指向 scripts/review-expedition-vehicles.mjs：实载 GLB，四视角截图、透明度与裁切检查、全部 LOD、预览选择与 390px 布局。
- npm run test:expedition：21 项通过，覆盖模型有效性与部件、LOD 递减、材质、旧外观迁移、旅行、取消、保存失败回滚和 API 鉴权。
- scripts/review-expedition-vehicle-game.mjs：27 项隔离游戏浏览器检查通过，覆盖五款实际切换与地图图标、移动时换装、刷新与磁盘保存、手机端、失败重试及非法请求。
- 预览和证据：outputs/expedition-vehicles-20260908/，lineup.png 为五款并列图及 80×80 地图尺寸对比；appearance-window.png 为游戏选择界面。已人工查看。
