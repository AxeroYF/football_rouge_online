# R20 弹窗与奇观次数修复

用户明确 R19 未部署。最后确认服务器 R16，推荐新累计 R20，含此前地图、安卓及战术修复。尚未部署。

确认框由 body section 改为 showModal() 的原生 dialog，浏览器顶层隔离地图点击；新增关闭幂等、cancel 处理与完整视口样式。普通征服确认从账户 conquest 读取上限；联军说明按受益人奇观加成。

conquestState 原先忽略 bonus，将总上限写死 8，恢复基础 8 + 有效非负整数奇观加成。WonderService 已提供勃兰登堡门 neutralAttacksBonus=1，玩家上限仍 4；使用次数保留，08:00 刷新。另修复旧快照的 playerRemaining 跨 reset 阻止进攻，以及豪门失败丢失 schemaVersion/playerUsed 导致迁移重复计数。未推测性改写历史玩家存档。

78 项 Node 测试通过；44 项浏览器检查通过（确认与取消真实点击、顶层遮罩、桌面/手机、嵌套返回等）；本地安装/回滚演练通过。APK 仍 v3/0.2.0，未真机验收；不需重新安装 APK 来获得网页修复。

交付：outputs/hot-update-20260920-r20/yellowdogs-hot-update-20260920-r20.tar.gz 及 .sha256。部署说明在同名目录 DEPLOY.md；测试 releases/20260920-r20/QA.json、outputs/conquest-r20-tests.log、outputs/pvp-confirmation-r20-review/report.json。
