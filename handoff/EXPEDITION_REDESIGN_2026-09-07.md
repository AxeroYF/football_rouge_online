> v2 是历史造型，现已由 [v3 连续人体曲面与设施轮廓高亮](EXPEDITION_CONTINUITY_AND_FACILITY_HIGHLIGHT_2026-09-07.md) 替换。本文的面数和检查结果只对应 v2。

# 球星远征单位 v2 · 自然站姿与人物比例重制

2026-09-07，版本 `20260907-expedition-stars-v2`。用户要求减少大幅动作，并让体型、外观更接近梅西、C 罗、姆巴佩、亚马尔、哈兰德本人。已替换五款实际模型与游戏用图像；不新增球员能力。

## 完成内容

- 五人均为双脚着地的自然站立，双臂靠近躯干，足球停在脚侧。用轻微重心与站距区别人物。
- 分别雕刻紧凑体格、宽肩窄腰、厚实大腿、修长身形、高大骨架；重做收腰球衣、短裤、连续四肢、手掌、球鞋。
- 五套独立头部参数：颧骨、下颌、脸宽、眼距、鼻梁、嘴唇；眉眼缩小。短侧分／胡须、短背头、短寸、密卷、金色束发分别建模。
- 模型从各自“占地归一”改为共同米制比例，三档 LOD 均保持各自设定身高。图鉴相机及地图图标采用共同取景，保留高矮差异。
- 图鉴新增“面部”，缩放上限 8 倍；保留立体／正面／俯视、精度、线框、GLB 下载。此处缩放仅属人物图鉴，游戏地图仍为已实现的 30 倍。
- 亚马尔号码按官方当前球员页改为 10；其余保留原选定球衣主色。

## 参考与美术参数

这些是用于统一尺度的造型参考值，不是人体扫描。面部仍为策略游戏的风格化雕刻。

| 人物 | 造型身高 | 参考与辨识点 |
| --- | --- | --- |
| 梅西 | 1.70 m | [迈阿密官方档案](https://www.intermiamicf.com/players/lionel-messi/) 5′7″，取约 1.70 m；结实体型、短发与棕色胡须 |
| C 罗 | 1.89 m | [葡萄牙足协档案](https://www.fpf.pt/pt/Jogadores/Cristiano-Ronaldo/contextId/178)采用 1.89 m；宽肩窄腰、较长腿与短背头 |
| 姆巴佩 | 1.78 m | [皇马官方档案](https://www.realmadrid.com/en-US/football/first-team/players/kylian-mbappe)；胸肩和大腿较厚、圆阔脸型、短寸 |
| 亚马尔 | 1.78 m | [巴萨官方档案](https://www.fcbarcelona.com/en/football/first-team/players/129404/lamine-yamal-nasraoui-ebana)及 10 号；轻盈修长、细长下颌、密卷短发 |
| 哈兰德 | 1.95 m | [曼城官方体格介绍](https://www.mancity.com/news/mens/erling-haaland-10-things-factfile-63790703)强调高大体格；本批造型参数取 1.95 m，宽下颌、浅色眉眼、金色束发 |

## 资产与运行

- 共 15 GLB，4.67 MiB；五款近景面数分别为 25,887 / 27,555 / 22,643 / 40,323 / 25,747。远景为 4,491 / 4,507 / 4,007 / 5,199 / 4,303。
- 位置：`assets/expedition-units/models/`、`models/lod1/`、`models/lod2/`、`thumbnails/`、`icons/`。清单含 SHA-256 与尺寸、面数。
- 代码：`client/expedition-models/expedition-models.js`（身体），`athlete-heads.js`（五套脸部），`athlete-geometry.js`（连续曲面工具），`shared/config/expedition-art.mjs`（共享外观设定）。
- 预览：http://127.0.0.1:4392/expedition-preview.html?v=20260907-expedition-stars-v2 ，当前静态服务读取最新文件。刷新即可查看。
- 游戏仍通过左上俱乐部菜单“远征外观”选择并保存。实际地图使用 GLB 渲染出的透明 PNG，图鉴加载 GLB；本轮为静态造型，没有骨骼动画。
- 本轮没有后端逻辑改动。旧的外观 ID、默认映射、移动及保存逻辑沿用；前端入口已更新缓存版本。

## 验证与审阅图

- `npm run test:expedition`：15 项通过，覆盖 GLB 三档精度、米制高度、有限几何、版本与哈希，以及外观选择／保存／移动兼容。
- `npm run review:expedition`：7 项检查通过，五款全部 LOD 可加载，面部视角可用，统一图标取景无裁切，390px 无横向溢出；无页面错误或失败资源。
- `node scripts/review-expedition-game.mjs`：37 项通过，无运行错误。五款切换、地图立即显示、存档重载、保存失败重试、移动中换装与窄屏可达均已验证。使用隔离服务和临时账号。
- [整组对照](../outputs/expedition-unit-review/lineup.png)、[面部近景](../outputs/expedition-unit-review/portraits.png)、[选择窗口](../outputs/expedition-unit-review/appearance-window.png)、[地图实渲](../outputs/expedition-unit-review/game-selected-unit.png)。
- [图鉴报告](../outputs/expedition-unit-review/browser-report.json)、[游戏报告](../outputs/expedition-unit-review/game-browser-report.json)。v1 对照保留在 `outputs/expedition-unit-review/before-v1/`。本轮未重跑上一轮的全项目 724 次检查，不将历史结果当成本轮结果。

设施与球探 v2、三资源规则及后台奇观草稿均未修改。没有读取用户保存的奇观效果，继续等待明确通知后再接入。没有操作真实存档、启停用户服务、提交、推送、打包或部署。
