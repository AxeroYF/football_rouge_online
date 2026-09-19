**球场居中与小地图右移（2026-09-08）**：赞助商不再通过单侧内边距把草坪推向右侧；左右看台对称，品牌标识适配左侧可用空间。小地图、迷雾按钮及全部显示选项整体移到游戏右下角，窄屏位于底部导航上方。33 项相关测试、68 项赞助商／球场浏览器检查和 23 项小地图浏览器检查通过。纯样式，Ctrl+F5。见 [STADIUM_MINIMAP_LAYOUT_2026-09-08.md](STADIUM_MINIMAP_LAYOUT_2026-09-08.md)。

# 赞助商左侧看台与透明标识 · 2026-09-08

**赞助商品牌色纠正（2026-09-08，优先于下方单色记录）**：用户明确“透明背景”只指去除标识外围的矩形底板，不能去掉品牌自身颜色或内部底色。已撤掉管理界面、图鉴、奖励及看台广告的全部改色滤镜；微软保持原色，杰士邦恢复原PNG色彩，宝马保留蓝色路径并补齐圆形徽标内部白色区域，徽标外部仍透明。不再因深色界面而擅自把品牌变白。S4 左侧广告位置保留。29 项专项、51 项浏览器检查通过；Ctrl+F5。

用户要求完整参照 S4 球场边赞助商摆放，并补充赞助商管理界面也使用透明背景。已完成，仅 Rougelite 工作树前端修改。

## S4 依据

读取 `S4_source_snapshot/S4-final-887df19-20260827/source/versus/public/app.js` 的 `broadcastSponsorBoardsMarkup` 与 `broadcastV2MatchLayoutMarkup`，以及 `broadcast-venue-fix.css` 最后的 sponsor-stack / transparent overrides。没有只引用旧的顶边 ribbon 样式。

- 广告层是 stadium 的内部绝对定位子层，固定左侧看台。
- 最多三个普通合同，顶部位置 10% / 26% / 42%；宽屏 left 14px、width clamp(72px,14%,118px)，1180px 以下 left 7px、width 64px。
- 容器透明、无边框、无底板阴影；看台标识沿用 S4 白色轮廓，object-fit:contain。
- 按原 S4 规则，560px 及以下隐藏看台广告，不再改放到底部；管理界面仍能查看全部品牌和合同。

## 变更

- `campaign-broadcast.js`：移除右侧外置广告列 wrapper，广告移入球场看台。
- `styles/sponsorship.css`：恢复 S4 的左侧三位置规则；预留左侧看台空间，草坪仍为 16:25，广告不会覆盖边路球员。无广告时释放预留空间。
- 管理界面、品牌图鉴、奖励的 `.sponsor-logo` 容器统一透明，包含原 is-dark 分支；移除白色底板、边框和圆角。原素材文件没有修改。黑色／深蓝及深色字标使用浅色轮廓以适配深色界面，其余保留品牌色。
- 仍然只展示本场主场所属玩家的生效普通赞助；换主场即换品牌，冠名不混入广告。
- `styles/resources.css`：回归检查发现金币净增长新增宽度后，1600px 的搜索入口会盖住末尾“赞助商”导航。将资源栏紧凑布局扩至 1600px，桌面导航不足时允许横向滚动，恢复真实点击。
- `app.js` / `index.html` 更新前端缓存版本；无需重启服务，Ctrl+F5 生效。

## 验证

- `node --test test/sponsorship.test.js test/campaign-broadcast.test.js`：29 项通过。
- `node scripts/review-sponsorship.mjs`：50 项真实隔离服务器／浏览器检查通过，覆盖合同窗口操作与透明容器、18 标识加载、6 档屏宽、左侧 10/26/42 位置、广告不压草坪、16:25、主客场替换与无合同空态。
- 实际截图复核：`outputs/sponsor-stands-review/tv-honda-left.png`、`tv-1600.png`、`brands-desktop.png`、`sponsor-logos.png`；结果 `browser-results.json`，专项日志 `outputs/sponsor-stands-tests.txt`。
- 测试用 49690 独立端口及临时 DATA_DIR；测试服务已退出。真实用户账号、合同、存档、原服务均未修改，未提交／推送／部署。

本记录优先于 `SPONSORSHIP_2026-09-08.md` 中旧的“右侧列／小屏放底部／白色展示底板”描述。

追加实现：`scripts/prepare-sponsor-logos.mjs` 为宝马展示衍生 SVG 添加白色内圆以保留白色象限，原始素材不改动；manifest 记录 displayTreatment / 新展示校验值。所有标识 filter:none，透明容器不变。`scripts/review-sponsorship.mjs` 验证管理和看台均不改色；最终 51 项通过。
