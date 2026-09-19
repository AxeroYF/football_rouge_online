# 首批世界奇观实际模型 · 2026-09-07 · models v1

**最新材质状态：** 全部模型已完成 color v2 上色，当前资源大小、配色与验证以 [WONDER_COLORS_2026-09-07.md](WONDER_COLORS_2026-09-07.md) 为准。下文保留首次建模交付记录。

已按用户确认名单完成欧洲 16 座、南美洲 8 座共 24 座首版风格化三维模型，包含“伯纳乌球场”。本轮制作实际网格、GLB 文件、模型图鉴与渲染图片；没有设计或接入奇观的经济、技能、建设和争夺效果，也未将奇观放进玩家真实地图。

## 已交付

- 24 座近景 GLB、24 座中景 GLB、24 座远景 GLB，共 72 文件，全部自包含，无外部贴图或运行时 CDN。
- 24 张 512 像素透明 PNG 渲染图、24 张 WebP 图鉴图、24 张 256 像素 PNG 图标。
- [可交互模型图鉴](../wonder-preview.html)：直接加载已导出的 GLB，支持地区筛选、旋转缩放、立体／正面／俯视、三档精度、线框与下载。
- [全部 24 座模型总览](../outputs/wonder-model-review/contact-sheet.png)、[伯纳乌图鉴截图](../outputs/wonder-model-review/bernabeu-viewer.png)。
- [运行资产目录](../assets/wonders/catalog.json)记录每个文件的路径、大小、SHA-256、面数、边界和独立部件信息。

这些是实际三维模型，不是把图片贴到平面上的展示。模型采用程序生成的建筑网格，几何源可以继续修改后重新导出。造型属于适合地图的首版简化表达，不是测绘级建筑复原。

## 资产位置与使用

主 GLB 位于 assets/wonders/models/；中／远景分别位于其 lod1/ 和 lod2/ 子目录。例如：

- [伯纳乌近景 GLB](../assets/wonders/models/santiago-bernabeu.glb)
- [伯纳乌中景 GLB](../assets/wonders/models/lod1/santiago-bernabeu.glb)
- [伯纳乌远景 GLB](../assets/wonders/models/lod2/santiago-bernabeu.glb)
- [马拉卡纳近景 GLB](../assets/wonders/models/maracana.glb)

每个 GLB 只有一档可见模型，避免普通 glTF 查看器把三档网格叠在一起。实际导出因此采用每座三个文件，替代原美术规格“一个文件内部含三档”的建议。未来地图可按屏幕大小选择加载哪档。

模型统一 +Y 向上、正面约定 +Z、底面归零；地面占地按最大横向尺寸归一化为 1。不是现实米制大小。地形底座与主要建筑部件分组；归属染色、动画、碰撞与游戏落点仍由后续地图接入决定。

伯纳乌单独保留 shell、roof_north、roof_south、pitch_1 至 pitch_6 等节点，屋顶与草坪可继续接动画。本轮交付静态模型，没有声称动画已实现。

## 查看与构建

在 Rougelite 工作树运行：

    npm run preview:wonders

默认打开地址：

    http://127.0.0.1:4391/wonder-preview.html

该入口只启动本地静态模型预览，不启动游戏服务或读取账号存档；它复用项目静态文件白名单。也可指定端口：

    node scripts/serve-wonder-preview.mjs --port=4392

其他命令：

    npm run build:wonders
    npm run review:wonders
    npm run test:wonders

build:wonders 从建模源码导出 GLB；review:wonders 通过独立临时静态服务和无头浏览器读取 GLB，再生成图片与浏览器报告。图片不是构建时自动同步，改动几何后应依次运行这两个命令。review 脚本优先使用本地 Playwright／Sharp，缺少时使用当前 Codex 已配置的本机运行依赖。

源码：

- [几何工具](../client/wonders/model-kit.js)：实际网格、拱洞、环形开口、柱廊、屋顶、岩台与合并。
- [24 座模型](../client/wonders/wonder-models.js)：每座独立造型与三档精度。
- [GLB 构建](../scripts/build-wonder-models.mjs)。
- [浏览器复核与图片生成](../scripts/review-wonder-models.mjs)。

## 性能与验证

72 个 GLB 合计 5,239,808 字节，约 5.00 MiB。24 座全部相加的三角面统计：

| 精度 | 总三角面 | 单座最大值 |
| --- | ---: | ---: |
| 近景 LOD0 | 57,796 | 7,568 |
| 中景 LOD1 | 36,560 | 4,472 |
| 远景 LOD2 | 19,474 | 2,128 |

斗兽场和加尔桥等拱廊建筑超过原初稿中最严格的低精度面数目标，实际值已公开；远于识别距离还应切换为图标。本轮没有把几何统计当成真实大地图帧率。后续放入 atlas 后仍需验证多座同屏的调用数、遮挡、LOD 距离和设备性能。

验证结果：

- 完整 npm run check：70 + 482 + 97 = 649 次测试执行，0 失败。
- 新增 28 项模型检查包含 24 座的全部导出精度、GLB 二进制边界、文件哈希、重新导入、有限坐标与法线、索引、包围盒、独立部件、屋顶面朝向、静态文件白名单与非法标识。
- 无头 Chrome 实际加载 72 个 GLB，渲染全部 24 座；地区筛选、LOD、线框、三种视角和 390 像素布局合计 6 组交互检查通过，页面错误 0。
- 已查看总览与伯纳乌实际渲染，根据可见问题修正宫殿屋顶朝向、伯纳乌开口／草坪可见性和分段环形网格朝向。
- [构建报告](../outputs/wonder-model-review/build-report.json)、[浏览器报告](../outputs/wonder-model-review/browser-report.json)、[完整检查日志](../outputs/wonder-model-review/full-check.log)。

## 对现有项目的改动边界

新增模型资源、源码、独立图鉴与验证脚本；package.json 增加四个模型相关命令，并把模型检查纳入 test:three。固定版本 Three.js vendor 构建新增 GLTFLoader 和 SkeletonUtils；静态资源白名单增加 glb／gltf 类型。

没有接入游戏地图的领土状态，没有改变设施效果、联赛规则或任何余额，没有修改真实存档、启停用户原有服务、打包、提交、推送或部署。

完整原型参考 PDF 图板与矢量 SVG 图标尚未制作；本轮实际完成的是三维模型和由其渲染的图片。历史[名单与美术规格](WORLD_WONDERS_CANDIDATES_2026-09-07.md)保留为设计依据，本文件是模型交付进度的最新说明。
