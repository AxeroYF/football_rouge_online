# 首批奇观上色与材质 · 2026-09-07 · color v2

**后续设计：** 24 座的玩法效果已另成 [效果草案](WONDER_EFFECTS_2026-09-07.md)，仍未接入运行时。

用户要求给整批模型上色。本轮已完成欧洲 16 座、南美 8 座共 24 座的风格化配色与材质，并更新全部 72 个 GLB、24 套渲染图／图鉴图／图标。当前版本为 20260907-color-v2，优先于 models v1 的资产状态。

## 查看

- [交互图鉴](../wonder-preview.html)：npm run preview:wonders；地址 http://127.0.0.1:4391/wonder-preview.html?v=20260907-color-v2 。
- [全部 24 座彩色模型总览](../outputs/wonder-model-review/contact-sheet.png)。
- [六座上色前后对比图](../outputs/wonder-model-review/color-comparison.png)；[可独立打开的对比页面](../outputs/wonder-model-review/color-comparison.html)。
- [伯纳乌彩色 GLB](../assets/wonders/models/santiago-bernabeu.glb)与[渲染图](../assets/wonders/thumbnails/santiago-bernabeu.png)。

在已打开的旧图鉴中刷新页面即可看到新材质。模型请求与下载地址附带文件 SHA-256，缩略图附带当前资产版本，避免一小时图片／GLB 缓存继续展示旧颜色。

## 实际改动

每座地标单独制定颜色映射，石墙、装饰、屋顶、金属、玻璃、水面和植被使用不同材质参数。全部使用 glTF 标准 metallic／roughness 材质，颜色、粗糙度、金属度和材质类别随 GLB 导出；不是仅在浏览器中临时染色。

| 代表资产 | 本轮处理 |
| --- | --- |
| 伯纳乌球场 | 银灰金属外壳、深色环带、蓝色看台、交替绿色草坪、浅色场线 |
| 原子球塔、埃菲尔铁塔 | 铬质反射球体与金属连接杆；棕铜色铁塔与绿色底座 |
| 阿尔罕布拉宫、拉莫内达宫 | 赤陶墙体／瓦顶、暖石装饰、青蓝水池、绿色庭院 |
| 凡尔赛宫、卢浮宫、新天鹅堡 | 暖石墙与深蓝屋顶、金色装饰、蓝色玻璃及绿地分色 |
| 马丘比丘、里约基督像 | 山体植被、梯田草坪、石砌结构分层，雕像保留浅色石材 |
| 科隆剧院、萨尔沃宫、马拉卡纳 | 铜绿屋顶与暖石墙；球场蓝黄看台、绿色草坪与浅色膜顶 |

其余地标同样已逐座处理，保持既有微缩造型和现实原型的主要色系。白色建筑、石像、浅色石材仍保留本身的浅色特征。

预览降低曝光与环境散射光，并加入本地生成的环境反射，改善金属质感和色彩泛白。玻璃、水面采用有色不透明近似，适合地图小尺寸展示；本轮没有制作照片贴图、法线贴图或透明折射。

## 代码与资源

- [wonder-materials.js](../client/wonders/wonder-materials.js)：24 座逐色映射、表面参数、版本和图鉴色板。
- [model-kit.js](../client/wonders/model-kit.js)：使用资产专属材质。
- [wonder-models.js](../client/wonders/wonder-models.js)：模型构建传入资产标识；移除旧的少量颜色硬编码金属修补。
- [build-wonder-models.mjs](../scripts/build-wonder-models.mjs)：实际配色与版本进入 catalog。
- [wonder-preview.js](../client/wonders/wonder-preview.js)：曝光、环境反射、缓存版本；图鉴增加本地图标引用。
- 固定 Three.js 0.185.1 的 vendor 构建增加 RoomEnvironment.js；无新增 npm 依赖或运行时 CDN。

模型数量、几何、各档三角面与包围盒保持不变。72 个 GLB 的内容哈希全部更新，总大小 5,314,280 字节，约 5.07 MiB。

## 验证

- npm run build:wonders 成功导出 72 个彩色 GLB。
- 28 项模型检查通过，覆盖全部 72 份导出，新增核对重新载入后的颜色、粗糙度、金属度与材质类别与建模源一致。
- npm run review:wonders：72 个实际 GLB 载入、24 座渲染、6 组图鉴交互检查通过，页面错误 0、失败资源 0。
- 完整 npm run check 通过，649 次测试执行、0 失败；日志见 [full-check-color-v2.log](../outputs/wonder-model-review/full-check-color-v2.log)。
- 已查看 24 座彩色总览；另外制作六座前后对比，保留本轮前的图像用于比较。对比图同时反映材质和预览灯光变化。
- [浏览器报告](../outputs/wonder-model-review/browser-report.json)、[构建报告](../outputs/wonder-model-review/build-report.json)。

本轮仅完善奇观美术资产及预览。正式地图接入、奇观效果、建造和争夺仍未实施。SVG 图标、完整参考 PDF 图板仍是原美术规划中的后续项。本轮未打包、未提交、未推送、未部署；未修改真实存档或启停用户游戏服务。


