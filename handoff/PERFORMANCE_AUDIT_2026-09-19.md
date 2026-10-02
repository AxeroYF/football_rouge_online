# 游戏进行中性能排查与修复 · 2026-09-19

## 状态
本轮源码优化已完成并通过本地验证，尚未打包或部署。R12 已交付，用户随后反馈成功进入地图；不将这次本地优化视为线上已生效。原 R12 发布归档保持不变。

## 排查结果与处理
| 路径/功能 | 冗余或瓶颈 | 本轮处理 |
| --- | --- | --- |
| 世界状态轮询 → 地图 | applyCampaignWorldSnapshot 已刷新领地，调用方又重复刷新 | 删除轮询路径第二次领地刷新 |
| Three 地形可见区域查询 | 每次区域判断都生成完整迷雾几何键；地形构建会执行大量查询 | 每个状态快照更新一次可见模型，区域查询复用模型；几何未变化不触发 Three 可见性刷新 |
| 强化面板 | 单纯金币变化触发完整强化详情 GET | 金币单独更新本地显示；阵容、强化、战术等详情变化仍加载 |
| 多组件相同 GET | 请求进行中可能重复访问同一接口 | 同令牌、URL、超时的并发 GET 合并；每个使用者获得独立结果；结束后不缓存响应；写入前后及切换令牌清理共享记录 |
| 商店、精英挑战、突袭、社交互动 | 浏览器页面隐藏后仍按原周期发请求 | 隐藏时跳过刷新；回到前台后按原周期继续 |
| 体力与全局结算 | 只需要体力却计算完整属性展示和位置适配 | 新增等价体力专用计算路径，保留原特性水合逻辑 |
| 联军体力恢复 | 同一账号突袭、同一支联军挑战和恢复建筑被逐球员查询 | 每次 plans 调用内复用，不跨结算缓存 |
| 卡牌管理/市场 | 钱包变化可能触发详情刷新，但该刷新同时获取市场变化 | 保留；后续应引入独立市场版本/更新通知后再缩小刷新范围 |
| 建筑/奇观详情 | 状态同步时重新加载详情、条件和竞争结果 | 保留；需要包含全局奇观竞争状态的失效机制，不能只用本地金币或建筑列表缓存 |
| 背包、科研 | 背包已有变更检查，科研关闭时有定时器清理 | 未发现需要本轮粗暴调整的重复加载 |

## 最大地图路径
地图初次加载同时涉及大体积领地/海岸几何下载、解析、迷雾几何和 Three 地形构建。R12 已处理慢下载误超时重试和地图资源请求复用；本轮重点减少运行中的重复几何计算和地图刷新。没有简化边界或改变战争迷雾授权规则。
仍存在较大的原始地图文件及同步全局存档/结算开销；本轮不能保证冷启动在任意网络下快速完成，也不能证明正式服并发容量。未来地图拆块/分级几何与存储改造需单独设计，避免影响领地判定和结算一致性。

## 验证
- 专项测试 94/94：体力特性等价、GET 合并/失效/结果隔离、迷雾变化/撤销、强化交互、传输恢复等。输出 outputs/performance-20260919/tests.txt。
- 扩展测试 179/179：比赛、经济时钟、运营成本、联盟、精英、突袭、商店、地图与地形。输出 outputs/performance-20260919/extended-tests.txt。
- 真实 Chrome：4 个内存隔离联盟账号，真实地图数据；全部进入地图，共享视野与平移通过，无脚本错误和 API 错误。加载 5.9–6.6 秒，平移测量 28–32 毫秒（本地环境，非线上延迟或帧率承诺）。输出 outputs/performance-20260919/browser/browser-report.json。
- 同进程微基准：2000 次体力读取约 24.47 → 1.55 毫秒；10000 次区域可见查询约 19.48 → 1.12 毫秒；前后结果校验相同。这是局部函数，不是整个游戏加速倍数。
- 同一模拟容量脚本：60 账号完整存档平均约 201.17 → 84.68 毫秒；5 场比赛场景保存约 263 → 129.78 毫秒。前后不同时间运行，仅用于本地趋势比较。比赛调度切片均值约 24.04 → 23.27 毫秒，未见同等幅度改善。
- 模块哈希检查通过：252 modules / 323 mappings；差异空白检查通过。

## 主要源码
app.js、client/map/fog-area-visibility.js、client/core/campaign-api-client.js、client/enhancement/enhancement-controller.js、client/shop/shop-controller.js、client/elite/elite-controller.js、client/elite/raid-controller.js、client/social/interaction-controller.js、shared/config/player-trait-presentation.mjs、shared/football/fitness-lineup.mjs、server/application/expedition-fitness-service.mjs、index.html。
新增验证：test/performance-regressions.test.js；更新强化回归；scripts/measure-performance-20260919.mjs、scripts/audit-performance-capacity-20260919.mjs、scripts/review-performance-20260919.mjs。
