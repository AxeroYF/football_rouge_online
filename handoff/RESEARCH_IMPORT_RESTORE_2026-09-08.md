# 研究阵型解除恢复与工具栏（2026-09-08）

## 本轮修复
- 导入研究前按远征／留守、默认／领先／落后站位独立保留 positions 和 formation lines 的备份；首次导入保存，切换研究槽与重复导入均不覆盖最初备份。
- 备份作为 __s4V2.researchFormationBackups 随已有战术自动保存，normalizeSquadState 保留，重新打开／刷新后可恢复。
- 解除使用恢复坐标、位置线并删除绑定及当前备份，保留研究期间的职责调整。随后重新导入会采集新的原始站位。
- 主替补交换和自动替换会同步映射备份中的球员引用，服务端已有 tactics-repair 对 positions 引用同样适用。
- 旧版本已经覆盖且没有备份的导入无法精确恢复；解除会改为当前球员的基础站位，显示“旧阵型没有导入前备份，已恢复基础站位”。不把研究坐标继续当作普通站位。
- 工具栏将站位三按钮和导入／解除统一为紧凑单行，移除两按钮整行跨列样式。阵容方案开关放入同一工具栏，空间不足时自然换行；按钮组内部小屏可横向滚动，不再各占一行。

## 文件
client/research/formation-import-state.js；tactics-page.js；styles/research-import.css；app.js；index.html。
纯前端逻辑，后端已有透传存储可用，Ctrl+F5，无需服务重启。

## 验证
39 项相关测试通过（formation-import-state、tactics-lineup-rules、tactics-repair、formation-research-runtime）。
53 项隔离浏览器检查通过，含导入、换研究槽、刷新、解除、坐标／位置线恢复及真实 API 保存；2514/1600/1280/768/390 宽度按钮同一行与紧凑尺寸；原弹窗交互回归、无浏览器异常。
脚本 scripts/review-research-restore.mjs；证据 outputs/research-restore-20260908/、outputs/research-restore-tests.txt。
未改实际玩家存档，未提交或回退工作树其他改动。
