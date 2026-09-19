# 首批世界奇观三维资产 · color v2

欧洲 16 座 + 南美洲 8 座，合计 24 座。每座实际提供三个独立 GLB 精度版本，使用 catalog.json 中的 files 和 levels 字段选择。

- models/*.glb：近景；models/lod1/*.glb：中景；models/lod2/*.glb：远景。
- thumbnails/*.png：512px 透明渲染图；thumbnails/*.webp：图鉴预览。
- icons/*.png：256px 透明图标。
- catalog.json：当前导出清单与校验值。
- art-catalog.json：已确认的原型与初稿美术输入，不是游戏效果配置。

当前 24 座已经完成上色。颜色、粗糙度和金属度写入 GLB；配色源为 client/wonders/wonder-materials.js，玻璃与水面采用有色不透明材质。

GLB 自包含、+Y 向上、正面 +Z、底部归零，水平占地归一化。默认材质为不透明风格化材质，模型不附带游戏逻辑。伯纳乌保留两半屋顶和六块草坪节点，供以后做动画。

运行 npm run preview:wonders 打开本地交互图鉴。修改几何或配色后运行 npm run build:wonders 和 npm run review:wonders，分别更新模型与渲染图片。

最新上色、统计与验证见 [WONDER_COLORS_2026-09-07.md](../../handoff/WONDER_COLORS_2026-09-07.md)。首次建模记录见 [WONDER_MODELS_2026-09-07.md](../../handoff/WONDER_MODELS_2026-09-07.md)。

