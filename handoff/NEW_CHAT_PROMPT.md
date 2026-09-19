继续 Rougelite 项目。先阅读 handoff/CURRENT_STATE.md、releases/CURRENT.json 和 releases/README.md。

服务器最后由用户确认部署 R10；R11 已交付，但部署未确认。不要把 GitHub 最新代码当作已上线版本，也不要重打覆盖历史 R9/R10/R11 包。增量基线须按用户确认的已安装版本明确选择。

当前源码包含 R11 地图加载恢复与豪门活跃玩家路线筛选。本次 Git 整理另把真实玩家停服扣除名单从源码外置到被忽略的 data/downtime-recovery-plan.json，公开仓库不含真实存档或名单。已执行的 R10 回执仍然防重。

地图问题：账号状态独立渲染成功；R11 修复兼容链接和卡死恢复，但用户原浏览器的具体失败尚未复现。不要删除玩家存档、重置账号或再次扣除收益。

发布基线已纳入 releases/<版本>/BASELINE.json；后续打包直接读取，不依赖机器上的旧 outputs。操作前检查 Git 状态，保护并行工作树和本地运行数据。手机视觉及 Android 暂缓，卡包必须保留流星雨、翻牌与三选一展示。
