> 本文件记录 v1 动作模型及首次选择功能接入。当前美术已由 [v2 自然站姿重制](EXPEDITION_REDESIGN_2026-09-07.md) 替换，v1 面数与 724 次完整检查是历史数据；选择／保存功能继续沿用。

# 五款球星远征单位 · 2026-09-07

本轮按用户要求，重新制作参考梅西、C 罗、姆巴佩、亚马尔、哈兰德的五款远征单位。版本 **20260907-expedition-stars-v1**。五款已有实际三维模型、游戏图像、独立图鉴，以及可保存的游戏内外观选择。

## 美术交付

| 单位 | 造型动作 | 主要识别符号 |
| --- | --- | --- |
| 梅西 · 盘带大师 | 沉肩、低重心左脚盘带 | 蓝白条纹、10 号、紧凑身形、短发与胡须 |
| C 罗 · 胜利领袖 | 双脚分开、张臂庆祝 | 红绿球衣、7 号、宽肩与短发发峰 |
| 姆巴佩 · 疾速先锋 | 前倾冲刺、摆臂、提膝 | 深蓝球衣、10 号、短寸发型和强烈前进方向 |
| 亚马尔 · 灵巧边锋 | 横向变向、展臂平衡 | 红蓝球衣、19 号、卷发、修长轮廓与粉色球鞋 |
| 哈兰德 · 强力前锋 | 大步出脚、反向摆臂 | 天蓝球衣、9 号、高大体格、金色束发与亮色球鞋 |

采用策略游戏可读性优先的风格化人物比例、简化面部、夸张动作和固定配色。移除厚棋座及整块地台，仅保留脚下少量草痕与足球。每款独立制作动作、体格和发型，不是同一网格换色。

- 五款 × 近／中／远三档＝**15 个 GLB**，共 **1,599,152 字节（1.53 MiB）**。
- 每款 768px 透明 PNG 与 WebP 缩略图、256×320 透明游戏图像；另有正面审阅图。
- [五款总览及 64×80 像素彩色／灰度对比](../outputs/expedition-unit-review/lineup.png)。
- 图鉴：http://127.0.0.1:4392/expedition-preview.html ，可旋转、缩放、切换视角／精度、下载 GLB。设施图鉴已加入入口。
- 主地图继续使用这些 GLB 渲染的透明图像；这批 GLB 是静态动作造型，未声明具有骨骼跑步动画。
- 七类设施 LV1～LV5 与球探保留已验收的 v2 外观。原三人远征模型保留为旧资产，不再作为默认地图单位。

参考资料：造型方法参考 [Firaxis《The Art of Civilization VI》](https://store.steampowered.com/news/posts/?appids=289070&enddate=1468936810) 对颜色、形体和远距离轮廓的强调；人物视觉参考包括 [梅西官方资料](https://www.intermiamicf.com/players/lionel-messi/)、[葡萄牙足协 C 罗资料](https://www.fpf.pt/pt/Jogadores/Cristiano-Ronaldo/contextId/178)、[法国足协姆巴佩资料](https://www.fff.fr/equipe-nationale/joueur/8566-mbappe-kylian/fiche.html)、[巴萨亚马尔比赛集锦图](https://www.fcbarcelona.fr/fr/football/equipe-premiere/actualites/4057910/le-bestof-de-lamine-yamal-en-202324)、[曼城哈兰德号码资料](https://live.mancity.com/news/mens/erling-haaland-squad-number-63792949)。网格全部由项目代码原创生成，未下载第三方游戏模型或球衣贴图。

## 游戏内选择

入口：**左上角俱乐部名称 → 远征外观 → 点击候选 → 使用此单位**。

- 选择前可比较五款，当前使用和待选状态分开显示。
- 保存成功后地图立即切换；失败保留原外观和待选项，可重试。
- 选择按账号保存。刷新、重新载入、行军、取消行军和占领新地块均保留。
- 行军中可以换外观，不重置起点、终点、开始时间或抵达时间。
- 旧 `default` 映射为梅西；旧未知 token 归一到默认外观。不存在主场／远征单位时不显示选择入口。
- 本轮是外观选择，不增加球星能力、价格、解锁或比赛属性。

窗口沿用小窗口和通用窗口管理器，支持 Esc、背景点击与焦点恢复。桌面五列、手机两列可滚动；外观窗口层级为 1200，已处理地图控件覆盖窗口的问题。

## 接口与实现

- `shared/config/expedition-art.mjs`：五款元数据、版本、合法 ID、`default` 别名及游戏图像路径。
- `client/expedition-models/expedition-models.js`：五款人物几何、姿态、球衣号码、发型、足球与三档精度。
- `assets/expedition-units/catalog.json`：尺寸、面数、哈希与资产文件；models/、thumbnails/、icons/。
- `client/map/expedition-appearance-controller.js`、`styles/expedition-appearance.css`：选择／保存与窗口。
- `server/domain/expedition-piece.mjs`：合法外观保留、公开图像、换装及征服后放置保留外观。
- `POST /api/campaign/expedition/appearance`，body `{tokenId: "messi" | "ronaldo" | "mbappe" | "yamal" | "haaland"}`；兼容 `default`。返回 `{state, expeditionPiece}`。接口使用认证账号，拒绝任意路径及未知 ID。
- `CampaignService.selectExpeditionAppearance` 在存储失败时恢复原远征对象；客户端只在服务端确认后更新实际使用状态。
- 地图控制器解析五款图像，保留服务器提供的非内置 token 图像回退。

复现：

    npm run build:expedition
    npm run review:expedition
    npm run test:expedition
    npm run check
    node scripts/review-expedition-game.mjs

预览仍使用现有 `npm run preview:facilities` 静态服务（4392），可直接访问新图鉴。包含服务端变更，用户原来运行的游戏服务需要自行重启后刷新才会出现可保存的选择入口；本轮没有启停用户服务。

## 验证

- 完整项目检查：**70 + 511 + 143＝724 次测试执行，0 失败**。[完整日志](../outputs/expedition-unit-review/full-check.log)。
- 新增模型和选择测试覆盖 15 GLB 的重新载入、哈希、有限坐标／法线、地面对齐、材质、三档精度递减、关键节点、PNG、合法 ID、默认迁移、移动／取消／征服保留、存储失败回滚、认证账号与错误转义。
- 图鉴浏览器：**5 组检查通过**，实际加载 15 GLB；五款选择、精度／线框、无虚构等级、390px 布局，页面错误与失败资源均为 0。[报告](../outputs/expedition-unit-review/browser-report.json)。
- 隔离游戏服务／临时账号浏览器：**37 项检查通过，0 页面运行错误**。最终检查见 [报告](../outputs/expedition-unit-review/game-browser-report.json)，涵盖五款保存与地图立即更新、保存失败重试、移动中换装、刷新和磁盘持久化、非法 ID 与未认证拒绝、移动取消和窄屏交互。
- [桌面选择窗口](../outputs/expedition-unit-review/appearance-window.png)、[手机选择窗口](../outputs/expedition-unit-review/appearance-mobile.png)、[实际地图单位](../outputs/expedition-unit-review/game-selected-unit.png)。

| 精度 | 五款总面数 | 单模型最大 |
| --- | ---: | ---: |
| 近景 | 21,352 | 5,728 |
| 中景 | 11,336 | 2,672 |
| 远景 | 6,864 | 1,536 |

没有操作用户真实账号／存档，没有读取或接入用户后台奇观草稿，也没有提交、推送、打包或部署。模型图鉴和隔离浏览器验收不等于公网发布。
