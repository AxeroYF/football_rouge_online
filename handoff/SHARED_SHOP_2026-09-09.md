# 全服共享商店与赞助商紧凑窗口 · 2026-09-09

## 当前实现

- 顶部导航增加“商店”，全服账号共用 `world.shop` 库存。使用现有窗口管理器、金币组件、盾形球员卡及四款卡包素材。
- 赞助商窗口随内容收缩、居中，最高 620px；内容多时内部滚动，保留 Esc、关闭及焦点管理。验收空合同场景高 433px。按用户要求调整该窗口尺寸，没有全局改动窗口标准。
- 四种卡包常驻、不限全服库存；购买 1 次发放 1 包到背包，沿用既有抽取概率和选卡流程，不自动开包。
- 普通/稀有/珍奇/传奇卡包分别 1,000 / 3,000 / 8,000 / 20,000 金币；+3 传奇球员每张 100,000 金币，均为用户明确确认的价格。
- 每 3 小时全服统一刷新三张互不重复的随机 S 级、非 X 球员，直接应用既有强化服务生成实际 +3 属性和独立卡实例。
- 刷新时间以 Unix 时间的 3 小时边界计算，不随玩家打开页面重置。到期首次访问生成当轮库存并持久化；离线跨多轮直接进入当前轮，不补发过期商品。
- 每张特殊卡全服仅 1 份，先购买者获得。售出卡仍保留在原位置，卡画灰显、禁用按钮，三张售罄后提示等待刷新，不立即补货。
- 商店打开时每 5 秒同步，倒计时每秒更新，到达刷新时间立即请求；服务器验证刷新周期及库存，过期画面不能抢购旧商品。
- 球员加入球队并标记为留守归属，卡定义与卡实例分离，可用于既有强化/编队流程，不自动增加远征队容量。
- 购买使用服务端定价、鉴权、UUID 幂等标识；同一请求重试不重复扣款/发货。同步保存账户与全服库存，保存失败回滚。世界迁移保留库存，球员实例迁移保留强化属性。局域网 HTTP 缺少 randomUUID 时使用 getRandomValues 生成 UUID。

## 文件入口

- `shared/config/shop.mjs`：价格、周期、数量、等级、卡包素材。
- `server/application/shop-service.mjs`：轮换、共享库存、交易和幂等回执。
- `campaign-service.mjs`、`server/http/campaign-api-handler.mjs`：GET `/api/campaign/shop`、POST `/api/campaign/shop/buy`。
- `server/infrastructure/campaign-save-migrations.mjs`：保留 `world.shop`。
- `client/shop/shop-controller.js`、`styles/shop.css`、`app.js`、`index.html`：商店交互和导航。
- `styles/sponsorship.css`：窗口限高与内容自适应。

## 验证

- 全项目 1,027 项通过：78 预检 + 801 主测试 + 148 Three；使用 package.json 的相同检查阶段，测试并发设为 1 规避已有 Windows 临时 admin-state 重命名竞争。
- 最后新增局域网 UUID 兼容测试，商店最终 11 项专项测试全部通过。此前卡包、强化、赞助商及商店相关 51 项通过。
- `scripts/review-shared-shop.mjs` 使用独立临时存档和本地随机端口。两个账号看到相同三张卡，并发抢购实际 HTTP 返回 200/409；购买卡包进入背包；售出灰显、全部售罄、跨账号自动同步、桌面和手机布局、金币图标尺寸、Esc 均通过，无页面错误。
- 输出：`outputs/shared-shop-20260909/` 截图和 report.json；`outputs/shared-shop-full-check.txt`；`outputs/shop-final-tests.txt`。

## 加载与限制

重启 Rougelite 工作树服务，再 Ctrl+F5。没有重启用户服务、没有修改用户正式存档、没有提交或部署。

事务依托现有单 Node 进程与同步 JSON 仓库，所有本服账号共享；若未来部署多进程/多副本，需改为数据库事务或统一库存锁，不能让多个进程独立写同一 JSON 文件。
