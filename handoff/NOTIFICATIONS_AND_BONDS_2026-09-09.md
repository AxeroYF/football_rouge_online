# 通知中心与战术板羁绊 · 2026-09-09

## 已完成

- 所有任务通知共用一个滚动区域：桌面最高 min(460px,48dvh)，手机最高 min(330px,39dvh)。支持触摸惯性滚动、卡片吸附、任务计数、收起/展开；滚轮不会缩放地图。刷新卡片和折叠后保留滚动位置。
- 阵型研究采用独立青蓝色 #68cbe4，覆盖侧边、标题、进度和按钮；设施仍为金色。
- 战术板原有“默契连线”“羁绊增益”只是占位提示，现已接入实际计算。显示当前最高两项羁绊、成员人数、增益、球员徽标与属性悬浮说明；默契连线按当前站位和特性实时计算，拖动/换人/切换方案会重新评估。开关仅控制显示，不影响比赛效果。
- 战术板与比赛共用 team-player-effects.js，依次处理特性、附近默契与羁绊。预览使用当前战术方案的分钟/比分上下文与默认晴天；比赛仍依实际天气、时间、比分和场上球员重新计算。
- 原来黄狗风云比赛席位未传递全局羁绊目录，国家队/俱乐部类羁绊无法完整生效。已从完整非 X 球员库生成目录并接入远征、留守和 AI 防守席位，以及前端状态。存量进行中挑战恢复时补目录，已结束回合不改写。
- 修复 activeBonds 未排序却截取前两项、导致显示与实际最高两项不一致；修复身高特性在结构羁绊判定时被重复计算。
- 修复新增羁绊摘要后战术板工具栏网格行高不足造成的控件裁切。

## 规则

沿用 S4 V2.1：全局至少 10 个独立非 X 卡定义才建立身份羁绊；首发至少 5 人激活，5/6/7/8/9/10/11 人分别为 2/2.5/3/3.5/4/5/6%。同类取最强组，所有羁绊取最高两项；只对对应成员加成。替补不参与，万能身份特性按引擎规则计入。结构羁绊要求完整 11 人，特性“都是哥们”默契按 28 距离计算。

## 验证与复现

- 完整项目检查通过 1,016 项（78 预检 + 790 主测试 + 148 Three）；使用 package.json 相同检查阶段，将测试并发设为 1，避免已有 Windows admin-state 文件重命名竞争。
- 之后补充旧存档恢复测试，并重跑相关 39 项全部通过。最终 campaign-bonds.test.js 为 9 项。
- scripts/review-notifications-bonds.mjs 使用临时 DATA_DIR、独立端口和浏览器；以明确的页面阵容测试夹具检查实际战术板、生产通知卡片及真实通知控制器。未改用户存档。
- 浏览器验证：两项身份羁绊/徽标、默契连线、开关不改变增益、12 条通知滚动、滚轮不缩放地图、折叠及 DOM 重建保留位置、手机限高和无横向页面溢出、无页面异常。
- 输出：outputs/notifications-bonds-20260909/（report.json 与桌面/手机/战术截图）；outputs/notifications-bonds-full-check.txt；outputs/notifications-bonds-final-targeted.txt。

## 关键文件与加载

client/buildings/notification-center.js、styles/construction.css、index.html、app.js；tactics-page.js、styles/tactics-cards.css；shared/football/campaign-bonds.mjs、account-match-seat.mjs；campaign-service.mjs、server/application/challenge-service.mjs、engine/campaign-match-engine.mjs；engine/s4-v2.1/versus/v2/team-player-effects.js、team-snapshot-v2.js 与 public/bond-rules.js。

重启此工作树服务以加载后端羁绊目录/存档恢复逻辑，浏览器 Ctrl+F5 加载新版前端。未提交、未部署、未操作用户正在运行的服务。保留工作树此前所有修改。
