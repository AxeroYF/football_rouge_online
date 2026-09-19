继续 Rougelite 项目。工作树 D:/Project/game_test/.worktrees/Rougelite，分支 codex/rougelite。先读 handoff/CURRENT_STATE.md、handoff/GITHUB_BASELINE_2026-09-19.md、releases/CURRENT.json 和 releases/README.md。

上一轮基线整理及 GitHub 合并已经完成：仓库 AxeroYF/football_rouge_online，main 代码基线提交 1511faddb61f39b7d5d62070c204dbfdedec62b7，整理提交 8cc795b。GitHub 连接器没有创建 PR 权限，因此未创建 PR，通过已有 Git 凭据直接推送 main 并 fetch 核实。不要重新做一遍项目合并；后续纯交接提交以 Git 日志为准。

服务器用户最后确认部署 R10；R11 已交付但未确认部署。本轮仅更新 GitHub 和交接，没有部署服务器，也没有生成新热更新包。已发布的 R9/R10/R11 包及 SHA 不得覆盖重打。增量基线以用户实际安装版本为准，正式服上传目录 /home/admin。

当前源码包含 R11 地图加载恢复、豪门仅选择近72小时活跃玩家并在出发和抵达时复查。另有仓库整理：真实停服收益扣除名单外置为 DATA_DIR/downtime-recovery-plan.json（本地 data/，被 Git 忽略）；缺省为空，旧 R10 回执继续防重；移除历史开发管理员密码提示，生产通过 ADMIN_BOOTSTRAP_PASSWORD 配置；补齐三个默认地图高度文件和18张豪门活动礼包封面。上述源码整理不是已发布 R11 包内容，未来打包会单独列为差异。

验证已完成：npm run check 前置81、主测试1040、地图/模型161项通过；发布专项56及战术/管理员专项13项通过。干净 Git 检出安装依赖成功；正常地图、WebGL失败后的兼容切换、主模块失败后的恢复入口三项浏览器验证通过。日志在 outputs/repository-sync/；不因接续对话而重复全量测试。

用户地图问题：账号状态在独立浏览器正常渲染；原浏览器的具体故障尚未复现，不能声称用户已恢复。不要删除存档、重置账号或再次扣除收益。

发布基线已纳入 releases/<版本>/BASELINE.json；后续打包不依赖本机旧 outputs。保留 .gitattributes 的原始字节规则，避免换行破坏哈希。真实存档、账号种子、私有回收清单、审计报告和本机运维诊断不能上传公开仓库。

当前没有新增功能待实现，按用户下一条请求继续。操作前检查 Git 状态并保护并行工作树。手机视觉及 Android 暂缓；卡包必须保留流星雨、翻牌和三选一展示。
