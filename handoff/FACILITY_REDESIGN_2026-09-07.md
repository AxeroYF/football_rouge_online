# 设施与单位辨识度重设计 · 2026-09-07 · facilities v2

> 后续远征单位已更新为五款可选球星原型，见 [EXPEDITION_UNITS_2026-09-07.md](EXPEDITION_UNITS_2026-09-07.md)。本文的设施和球探仍有效，三人远征模型仅为旧资产记录。

用户指出第一版低等级设施在布局和配色上不易区分，本轮已重建整批 37 个实际模型。当前资产版本为 **20260907-facilities-v2**，覆盖第一版 GLB、缩略图及游戏图像；第一版说明保留在 FACILITY_MODELS_2026-09-07.md 作为历史。

## 已交付

- 七类现有设施 × LV1～LV5＝35 个设施；远征战棋和球探各一个，共 37 个模型。
- 近、中、远三档共 **111 个自包含 GLB，11,827,680 字节（11.28 MiB）**。
- 同步更新 37 张透明 PNG 缩略图、37 张 WebP 缩略图、37 张透明游戏图标。
- 游戏继续按实际设施等级选用 GLB 渲染图像；独立图鉴加载真实 GLB，支持旋转、俯视、正面、精度切换与下载。
- 图鉴新增 **LV1 / LV2** 筛选，一次比较 14 个低等级设施；支持 `?filter=basic&model=scout-center-lv1`。
- [低等级新旧、64px 彩色与灰度对比](../outputs/facility-model-review/low-level-comparison.png)；[全部等级总览](../outputs/facility-model-review/contact-sheet.png)；[图鉴截图](../outputs/facility-model-review/facility-basic-viewer.png)。

## 本轮造型规范

第一版共同问题是方形草地占地过大、建筑过小，多类 LV1 都是同样的坡顶小屋。本轮改为按设施功能塑造地基与建筑轮廓，把可识别建筑放在 LV1，而不是只在高等级添加地标。

| 设施 | 固定主色 | LV1 的轮廓和布局 | LV2～LV5 的扩建方向 |
| --- | --- | --- | --- |
| 主体育场 | 宝蓝、象牙白 | 紧凑椭圆场碗，马蹄形看台与双塔入口 | 闭合看台、二层环廊、局部悬棚、完整冠棚 |
| 球探中心 | 紫、金、米白 | 八角观测所，放大的双筒镜、罗盘和地图台 | 前侧档案翼、观测阳台、通讯翼、地球仪总部 |
| 港口 | 深蓝、金黄、海蓝 | U 形码头与大泊船，LV1 即有黄白灯塔 | 第二泊位、岸吊、石码头、客运厅和港口门架 |
| 训练中心 | 赭橙、白、草绿 | 橙色完整跑道，侧置拱形训练馆 | 计时门、器械区、体测楼、观察塔和连桥 |
| 医疗中心 | 深绿、白 | 十字形诊所楼体和屋顶，独立急救车道 | 救护车、双翼病房、诊疗圆厅、高层塔与停机坪 |
| 体能恢复中心 | 青蓝、浅水蓝、米白 | 大圆池、新月形水疗馆和柱廊 | 侧池、阶梯池、圆顶、玻璃康复翼和双弧遮棚 |
| 俱乐部商店 | 金黄、酒红、白 | L 形连排商街、黄白棚、放大球衣招牌 | 街边摊位、二层商业街、展销厅、旗舰穹顶 |

远征战棋改为深红盾形底座、金边队旗，保留三名球员和足球。球探改为砂金罗盘圆座、绿色旅行披肩与宽檐帽，放大地图和双筒镜。两类单位没有虚构 LV1～LV5。

低精度模型保留类别主色和关键轮廓，减少窗格、曲面分段、栏杆与装饰。没有用统一放大或仅换色冒充五级独立模型。

参考 [Firaxis《The Art of Civilization VI》访谈](https://store.steampowered.com/news/posts/?appids=289070&enddate=1468936810)：用颜色和形体加强远距离识别，以不同轮廓表现单位及建筑。这里只参考其美术原则；本批网格为项目自有程序生成，没有导入文明 6 资产。

## 代码与复现

- shared/config/facility-art.mjs：固定类别主色、五级描述、图像地址和 v2 缓存版本；catalog 使用各类真实色板。
- client/facility-models/facility-kit.js：自定义多边形／椭圆地基、罗盘、专用材质与单位棋座。
- client/facility-models/facility-models.js：七类五级几何；unit-models.js：两类单位。
- scripts/build-facility-models.mjs：导出 GLB 与哈希目录。
- scripts/review-facility-models.mjs：全部渲染及图鉴交互；facility-recognition-board.mjs：原生 64px 彩色／灰度对比与旧版对照。
- scripts/review-facility-game.mjs：临时独立游戏服务／账号检查，不操作真实存档。

运行顺序：

    npm run build:facilities
    npm run review:facilities
    npm run check
    node scripts/review-facility-game.mjs
    npm run preview:facilities

低等级对比的第一版图像位于 outputs/facility-model-review/before-v1/。在没有历史输出的全新环境里，对比生成器会标记旧版未存档，仍可生成新版及灰度栏。

## 验证结果

- 完整 `npm run check`：70 + 505 + 137＝**712 次测试执行，0 失败**。其中 40 项模型／图像接入检查验证全部 111 GLB 的边界、哈希、重新载入、坐标／法线／索引、地面对齐、材质、三档精度递减、单位关键部件及按等级选图。[日志](../outputs/facility-model-review/full-check.log)。
- 图鉴：实际加载 111 个 GLB，渲染 37 个模型，**9 组交互检查通过**；包括新增低等级筛选、全部／设施／单位筛选、等级／LOD／线框、三视角、390px 布局；页面错误与失败资源为 0。[报告](../outputs/facility-model-review/browser-report.json)。
- 独立游戏浏览器：**12 项检查通过，0 运行错误**，覆盖当前等级图像、设施地图、战棋／球探、球探及训练窗口、升级禁用状态。[报告](../outputs/facility-model-review/game-browser-report.json)。
- 已目视检查全部模型总览、低等级新旧对比、64px 彩色／灰度，以及游戏地图；这是美术审阅，不是用户可识别率实验。

| 精度 | 37 个模型总三角面 | 单模型最大 |
| --- | ---: | ---: |
| 近景 | 100,742 | 5,504 |
| 中景 | 71,302 | 3,528 |
| 远景 | 43,622 | 2,328 |

## 运行与范围

当前独立图鉴服务地址为 http://127.0.0.1:4392/facility-preview.html ，已核对其 catalog 返回 v2。预览页面刷新即可载入新版；旧游戏服务若仍在内存中持有上一轮配置，需用户自行重启后 Ctrl+F5。

本轮只调整美术与图鉴。地图仍使用透明模型图像标记，不声称已经在主地图实时加载三维建筑。**升级仍未开放**，设施费用、资源收益、球探规则、战斗与奇观效果不变。没有读取后台奇观效果草稿、修改真实存档、启停用户游戏服务、提交／推送、打包或部署。
