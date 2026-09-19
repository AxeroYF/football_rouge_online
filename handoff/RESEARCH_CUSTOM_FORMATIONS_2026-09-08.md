# 自定义阵型研究 · 2026-09-08

## 当前规则（覆盖旧预设阵型研究）

- 科技入口四张卡片仅保留图标、名称，去掉“最高 +5%”“每级 +0.5 个百分点”等入口小字。
- 阵型研究先显示三个自定义槽位。每个槽位有自己的名称、十个外场球员坐标、四条位置参考线、阴影开关、选中的研究方向及各方向的等级预览。
- 进入槽位后左侧为战术板，右侧为研究方向及等级详情。空槽位的 4-3-3 只是可自由修改的起始站位，不是研究预设；旧配置中的 11 个预设阵型课题已移除。
- 十个金色圆点可鼠标／触摸拖动，也支持方向键（Shift 为大步长）。固定 GK 标记只作门将参考，不是第十一个可拖动点。
- 自动识别、角色区域、参考线约束复用根目录 `formation-rules.js` 的 `analyzeElevenBoardFormation`、`formationRoleZones`、`sanitizeFormationLines`、`moveFormationLine`；使用成熟战术板同一套 pitch、reference-line、role-zone 样式并局部适配。
- 移动位置线会实时更新角色阴影与阵型名称；外场点限制在门将区域上方，位置线移动挤入门将区的点向上夹取，始终保持十名外场球员和一名固定门将。
- 三槽位、十二方向独立；Lv.1–5 分别预览对应方向能力累计 +1% 至 +5%。预览选择不是已研究等级，不累计叠加五次，也不是直接增加事件成功率的百分点。
- 保持深绿、米白、金色；入口与内容在高度允许时居中。桌面左右布局；小屏上下滚动。资源轮询只更新顶栏科技值，不重建编辑器。

## V2.1 引擎依据

检查的是当前内置引擎 `engine/s4-v2.1/versus/v2/`，不是旧 S4 副本。指标来自 `match-parameters-v2.json` 的 `metrics`，实际调用检查了 `spatial-model-v2.js`、`possession-chain-v2.js`、`match-engine-v2.js`、`team-snapshot-v2.js`。

| 分组 | 研究方向 | 引擎指标 | 主要作用环节 |
| --- | --- | --- | --- |
| 组织 | 组织出球 | buildUp | 后场组织、推进衔接 |
| 组织 | 向前推进 | progression | 推进、进入前场 |
| 组织 | 抗压控球 | pressResistance | 组织与推进中的受压执行 |
| 组织 | 机会创造 | chanceCreation | 前场组织、机会生成 |
| 进攻 | 无球跑动 | movement | 接应、机会形成、射手选择 |
| 进攻 | 射门终结 | finishing | 进攻空间、射门阶段与终结 |
| 进攻 | 头球进攻 | aerialFinishing | 长传衔接、争顶及空中终结 |
| 进攻 | 远射能力 | longShot | 禁区外射门决策与终结 |
| 防守 | 防守对抗 | defensiveDuel | 抢断、盯人与阶段对抗 |
| 防守 | 射门封锁 | shotPrevention | 限制机会与射门空间 |
| 防守 | 协同逼抢 | pressing | 防守端对组织／推进施压 |
| 防守 | 防守纪律 | discipline | 失利对抗后的犯规风险 |

`spatial-model-v2.js` 的 playerSpatialProfile 将参数权重乘位置适应／体能执行系数；位置距离和区域占位依旧影响结果。研究不能替代阵型几何、角色适应或球员属性。

**后续引擎接入注意**：不能仅乘 `profile.metrics` 就声称十二方向全部生效。正式射门在 `match-engine-v2.js` 使用 `effectiveMetric` 独立计算：longShotProfile 用远射／镇定／决断／停球权重，射门终结按普通／传中／远射等类型另有属性组合。未来需在对应情境评分入口统一应用研究，避免重复叠加；远射课题不应顺便强化直接任意球。`discipline` 当前通过低于阈值的纪律惩罚影响犯规概率，收益会受阈值限制，不能承诺犯规率固定减少 1%。`pressing` 也参与犯规压力，因此不承诺无代价全面提升战术。

## 当前完成边界

本轮继续是 UI 与自定义方案编辑，**未开放研究扣费、完成结算、正式比赛加成**。战术研究、强化研究保持原有 UI 规则；生物研究仍占位。

方案保存在当前浏览器，按账号隔离：`yellowdogs-custom-formation-research-v1:{playerId}`。名称／坐标／位置线／阴影／研究方向／预览等级自动保存，另保留显式“保存阵型”按钮。界面保存提示明确“当前浏览器”；写入失败会显示失败信息。未写真实服务器存档，尚无跨设备同步。

后续实际研究接入仍需确定：每级科技工作量、一个或多个研究队列、阵型应用到阵容的方法、匹配几何的容差、已研究阵型修改后等级如何处理。当前不伪造这些规则，也不把预览等级保存为完成等级。

## 文件与验收

26 项研究／阵型规则／战术板／标准窗口回归通过；52 项隔离浏览器检查通过，包括鼠标与真实触摸输入、拖动取消恢复、参考线与阴影、独立等级、轮询不重建、刷新恢复、账号隔离、存储失败提示、320–1600px 布局与战术／强化回归。

- `shared/config/formation-research.mjs`：三槽位模型、十二指标、校验与坐标约束。
- `client/research/formation-research-controller.js`：槽位、战术板、拖动生命周期、局部详情更新、账号隔离保存。
- `client/research/research-controller.js`：入口精简、阵型分支接入、返回与关闭清理。
- `shared/config/research-preview.mjs`：删除旧预设阵型课题和冗余入口文案。
- `styles/research.css`、`app.js`、`index.html`：布局及缓存版本 `20260908-custom-formation-v1`。
- `test/formation-research.test.js` 与相关研究、战术板、窗口测试。
- 最新浏览器脚本 `scripts/review-research-custom.mjs`，结果／截图 `outputs/research-custom-20260908/`。旧 club／subject 脚本对应历史页面，旧预设阵型断言已不适用于当前 UI。

只运行隔离临时存档和随机端口的验收服务；真实服务未重启，未提交或部署。Ctrl+F5 生效。
