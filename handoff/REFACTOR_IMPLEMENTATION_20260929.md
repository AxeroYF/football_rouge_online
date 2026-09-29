# R43 基线后的兼容性重构

## 范围与交付边界

基线提交 `9553b2e`，用户已确认 R43 部署。本轮实施覆盖测试入口、共享计算、前端导航与名单模型、服务端状态与提交边界、HTTP 分域、比赛回放。保留原生 ES Modules、Node 单体服务、JSON v4 存档及现有玩法；未生成新热更新包、安装包，也未修改已发布版本记录。

这是可独立验证的结构重构版本，不等于评估报告中所有后续专项都已完成。状态中的领域 view 仍可能处理到期任务，不能将新的 compose 函数宣称为纯只读投影；全量状态差量哈希、持久化后端、全站窗口生命周期和比赛主推进器还有进一步优化空间。数据库迁移、异步写盘和按模块缓存需要容量与故障证据，本轮没有直接替换。

## 已落地结构

| 区域 | 实现 | 保留的契约 |
|---|---|---|
| 自动验证 | `scripts/run-tests.mjs` 自动发现全部 test 目录测试；`check-source.mjs` 检查所有运行模块；GitHub Actions Node 22 回归 | 新增测试无需维护长名单；原重复测试不重复执行 |
| 地图计算 | `shared/geo` 包含几何、投影、地形参数；server 与 shared/地图迷雾改用共享入口 | 原 client 路径兼容导出，地理数值不变 |
| 导航 | `client/core/feature-navigation.js` 使用稳定 ID，并提供监听解绑与 dispose | 菜单排列不决定功能；原开关窗口回调顺序保留 |
| 球员筛选 | `client/player-card/player-filter.js` 统一姓名、位置、副位置、俱乐部、国家、真实总评与强化等级条件 | 代表卡、归属、锁定与提交验证仍由各领域控制；联赛只筛选可选区 |
| 战术草稿 | `client/tactics/tactics-state.js` 独立默认计划、阵容归一化与位置继承 | 页面原有 normalizeTacticsSquads 导出保留；不改变阵型或联赛体力规则 |
| 状态入口 | `campaign-state-maintenance.mjs` 与 `campaign-state-view.mjs` 分离显式维护和响应组装 | 不删到期结算，保留原保存边界和私有可见性；领域 view 不是缓存边界 |
| 草稿投影 | `draft-view.mjs` 复用公开卡片、人数和位置统计 | 全量响应与合卡增量响应继续使用同一口径 |
| 结算/提交 | `campaign-settlement.mjs` 与 `campaign-persistence.mjs` 独立结算协调和提交元数据回滚 | 同步写盘；原准备顺序、时间边界和逆序回滚；写盘成功才算命令成功 |
| HTTP | JSON 编解码、训练、球探、联赛、玩家互动、球员卡/求购分别独立 | 旧路径、鉴权、状态码、compact 响应和路由优先级保留；UNHANDLED 区别未匹配与已发送响应 |
| 比赛回放 | `dot-replay-v2.js` 承担球与球员的回放帧生成 | 比赛推进、随机数调用和数值规则不变；固定输入逐场指纹对照 R43 |

迁移后的旧入口保持存在，兼容当前热更新流程不能直接删除旧文件的限制。更新包制作时必须包含新增模块与新的 import map，不能只替换旧入口文件。

## 验证证据

环境 Node v22.17.1，Windows 本地隔离夹具。未访问生产存档或生产账号。

- 默认测试：367 个运行模块语法检查通过，162 个测试文件、1622 项测试全部通过。记录 `outputs/refactor-complete-tests.log`。
- 后续仅收窄战术模块导出、清理未用常量，再跑相关 21 项测试通过；浏览器模块内容哈希已重新生成。
- 确定性：先确认比赛引擎相对 R43 未修改，再记录 20 组输入，覆盖五种天气与强制乌龙/冲突/黑哨场景。比赛对象含 RNG 数值状态、逐事件、球员后果、战术快照、回放全部 JSON 的 SHA256 一致；夹具文件记录输入指纹，禁止通过随意重录掩盖规则改变。
- 结算专项 78 项通过；持久化/联赛/球探专项 28 项通过；卡片与求购专项 74 项通过。均与默认测试有交叠，不累计为额外测试总数。
- 浏览器：1440×1000、390×844、768×1024、780×360；20 个训练席位、筛选、24→48 张分批显示、旧 DOM 保留、成功训练不额外重读，训练详情请求总计 1 次；无页面脚本错误。
- 导航与编队：菜单打开地图/编队/战术/强化正常；批量筛选恢复正常；联赛筛选不改变右侧名单，左右没有重复卡；移动端无页面横向溢出。记录 `outputs/refactor-browser-review/report.json`，同目录有实际截图。
- 真服务：`server.mjs` 使用随机本地端口、临时 DATA_DIR 两次启动；健康检查、注册立即写盘、终止进程后重新登录、钱包与身份保持、新静态模块可访问。记录 `outputs/refactor-runtime-report.json`。
- Windows 壳 24 项单测通过；不代表制作了新的安装包。
- 285 个浏览器模块、356 个 import map 映射校验通过；历史发布链校验通过，R43 发布记录保持原样。

这些证据说明兼容性和已验收场景未回退，不用于声称线上 CPU 降低某个百分比或服务器容量提升。本轮没有线上负载采样。

## 后续开发约定

1. 服务端和共享层禁止反向导入 client；`test/refactor-boundaries.test.js` 会检查直接静态/字面量导入。
2. 新菜单使用固定 ID；注册监听后持有解绑函数。页面入口保留原有未保存草稿确认，不能用通用 close-all 绕过。
3. 纯筛选只负责展示；卡实例 ID、代表卡、联赛锁定及跨玩家资产必须继续在服务器校验。
4. 不通过 world.revision 缓存整个状态响应，时间、账号私有修改和可见性也会改变响应。
5. JSON repository 保持同步持久化；未来异步化应先建立不可变快照、写入队列、失败确认与恢复协议。
6. 比赛平衡调整与结构重构分开提交；先检查固定种子差异来源再考虑更新 golden。

## 复验命令

```powershell
npm test
npm --prefix windows-client test
python scripts/build-browser-module-versions.py --check
node scripts/check-release-baseline.mjs
node scripts/verify-refactor-runtime.mjs
node scripts/review-training-capacity.mjs --refactor
```

最后一条需本机可用的 Playwright 与 Chrome；可通过 `PLAYWRIGHT_REQUIRE_FROM` 指向已安装依赖。浏览器截图、运行日志、临时账号与压缩包不进入公开 Git。GitHub Actions 配置已添加，本地通过不等于远端 CI 已执行通过。
