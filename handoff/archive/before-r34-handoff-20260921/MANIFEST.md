> 最新：R34 战术板打开、渲染与自动保存优化，包含 R32/R33，基于 R31 的累积包。本地验证通过，未部署。见 [R34 说明](TACTICS_R34_20260921.md)。

> 最新：R33 球员卡强化标记下显示特性，包含 R32 卡顿修复，基于 R31 的累积包。本地验证通过，未部署。见 [R33 说明](CARD_TRAITS_R33_20260920.md)。

> 最新状态（2026-09-20）：现场日志确认 R31 已运行，存档已缩小；新卡顿伴随持续约 42MB/s 写盘。R32 修复建筑轮询、远征等待、压制治疗的重复保存，并增加保存次数统计。5 文件、基于 R31，本地验证通过，尚未部署。详见 [R32 修复与部署](SAVE_STORM_R32_20260920.md)。以下保留此前记录。

> R31 部署检查卡住：新增低内存安装器修正版，游戏负载不变，未确认部署成功。使用 [修正版说明](R31_INSTALLER_FIX_20260920.md) 中的新包和指令，避免重试旧安装器。

> 最新状态（2026-09-20）：用户线上运行 R30 后报告 504；日志确认 OOM 和长时间主线程阻塞。R31 无损历史压缩、分块原子保存和独立卡顿诊断已本地验证打包，尚未部署。长阻塞精确触发点尚未复现，不能声称完全修复 504。详情：[R31 内存修复](MEMORY_R31_20260920.md)。

> 最新状态（2026-09-20）：用户确认 R29 已部署；R30 已完成本地打包，尚未部署。包含 P0/P1 优化、联军取消保证金退款及强化同名卡排序修复。共 26 个文件，基于完整 R29 升级；部署后刷新页面或重启客户端，无需重装客户端。详情：[R30 说明](OPTIMIZATION_R30_20260920.md)。

> 最新状态（2026-09-20）：R28 已部署；R29 普通建筑地块交易、开包持有提示、单位中止移动优化已完成待部署。详见 [R29交接](TRADE_PACK_MOVEMENT_R29_20260920.md)。

> 最新状态（2026-09-20）：用户已确认 R27 部署。R28 通知栏轻量关闭已完成，待部署。详见 [R28 交接](NOTIFICATION_PERFORMANCE_R28_20260920.md)。刷新或重开客户端生效，无需重装。

> 最新状态（2026-09-20）：用户已确认 R26 部署。R27 已完成顶部栏横向拖动与强化结果自动归仓，待用户部署。详见 [R27 交接](NAVIGATION_ENHANCEMENT_R27_20260920.md)。安卓版仍为已交付 v4，本次无需重装客户端。

# 文档索引 · 2026-09-20

## 必读入口
- [当前状态](CURRENT_STATE.md)
- [新对话提示](NEW_CHAT_PROMPT.md)
- [发布状态](../releases/CURRENT.json) 与 [基线流程](../releases/README.md)

## 最新交付与故障
- [R17地图拖动与Windows0.1.4](R17_MAP_DRAG_AND_CLIENT_014_20260920.md)
- [Windows0.1.3本地素材与脚本缓存](WINDOWS_CLIENT_013_LOCAL_RESOURCES_20260920.md)
- [R16完整页面启动修复](R16_STARTUP_FIX_20260920.md)
- [CDN地图传输事故与缓存规则](CDN_MAP_INCIDENT_20260920.md)
- [R15累计更新部署说明](R15_DEPLOYMENT_20260920.md)
- [R13恢复安装器](R13_RECOVERY_DEPLOYMENT_20260919.md)
- [Windows原始实现](WINDOWS_CLIENT_AND_COALITION_20260920.md)
- [Windows0.1.1交付记录](WINDOWS_CLIENT_011_20260920.md)；0.1.2以CURRENT_STATE及outputs/windows-client-0.1.2/QA.json为准

## R15主要玩法及性能
- [联军管理与球探性能、战术板](COALITION_SCOUTING_PERFORMANCE_20260920.md)
- [主场搬迁与淘汰重建](HEADQUARTERS_DEFEAT_20260920.md)
- [玩家地块限额与保证金](PVP_CONQUEST_BONDS_20260920.md)

## R13与历史实现
- [地块解放与同盟联军](COALITION_AND_LIBERATION_2026-09-19.md)
- [交易筛选、属性与研究等五项](FIVE_FEATURES_2026-09-19.md)
- [交互性能与防守战报](INTERACTION_AND_DEFENCE_FIX_2026-09-19.md)
- [交易与联军卡片仓库](SOCIAL_CARD_WAREHOUSE_2026-09-19.md)
- [强化特性及仓库](ENHANCEMENT_TRAIT_POSITION_FIX_2026-09-19.md)
- [经济数值](ECONOMY_BALANCE_2026-09-19.md)
- [四项已知问题](KNOWN_ISSUES_FIX_2026-09-19.md)
- [性能排查](PERFORMANCE_AUDIT_2026-09-19.md)
- [早期地图下载恢复](MAP_LOADING_FIX_2026-09-19.md)
- [早期访问事故](ACCESS_INCIDENT_AUDIT_2026-09-19.md)
- [历史GitHub整理](GITHUB_BASELINE_2026-09-19.md)
- [私有数据边界](../deploy/PRIVATE_RUNTIME_DATA.md)
- [阿里云部署](../deploy/DEPLOY_ALIYUN.md)

历史入口副本：[本轮更新前](archive/before-r16-handoff-20260920/)；[早期整理前](archive/pre-github-r11-20260918/)。
原始验证日志和截图在本地outputs；不发布真实账号数据。当前文件差异以git status/diff为准。

- [Android v3/0.2.0 横屏与R18](ANDROID_V3_LANDSCAPE_20260920.md)

- [R20确认弹窗与奇观次数修复](R20_PVP_AND_WONDER_QUOTA_20260920.md)

- [R21机场距离](R21_AIRPORT_DISTANCE_20260920.md)

- [R22强化、联军体能、通知](R22_ENHANCEMENT_FITNESS_NEWS_20260920.md)

- [R23 联军通知、防守和免油修复](R23_COALITION_NOTIFICATIONS_20260920.md)

- [R24 从已部署 R17 升级](R24_FROM_R17_20260920.md)

- [R25 战报通知清除](R25_BATTLE_REPORT_DISMISS_20260920.md)

- [R26 统一通知已读排查](R26_NOTIFICATION_ACK_20260920.md)

- [安卓v4本地美术资源版](ANDROID_V4_LOCAL_ART_20260920.md)
