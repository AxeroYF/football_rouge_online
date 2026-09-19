# 翼卫识别与边后卫熟练度（2026-09-08）

## 规则与修复
- LB/LWB、RB/RWB 分别属于同侧位置熟练度族。主位置为左后卫的球员在左翼卫保留主位置熟练度，右后卫同理；副位置为边后卫则同侧翼卫获得副位置熟练度。不覆盖原有 secondaryRole，不增加反侧位置熟练度。
- V2.1 原有 positionFitScore 已通过 normalizePosition 把同侧翼卫视作边后卫；本轮提取 positionFamilyRoles / positionFamiliarity，统一战术板 roleFit、熟练度统计、战术契合、自动替换、研究阵型导入分配、拖拽匹配高亮和后台缺员补位，消除 UI 将翼卫当不熟练但引擎按熟练的差异。
- 球员战术提示“主位置”同时显示同侧边后卫 / 翼卫，原有副位置保留。
- formation-rules 的中场与后场等距离交界线归入后场，翼卫阴影起点与实际识别一致。前后端两份规则同步；门将分界保持原规则，研究点极限位置仍只有一名门将。
- 未修改球员卡定义、角色主位置数据或反侧惩罚；原左右脚影响保留。

## 文件
engine/s4-v2.1/game/public/schema.js、tactics-page.js、shared/config/tactics-repair.mjs、formation-rules.js、engine/s4-v2.1/versus/public/formation-rules.js、app.js、index.html。
需重启服务后 Ctrl+F5 以更新比赛引擎规则与前端。没有改实际玩家存档或重启正在使用的服务。

## 验证
53 项测试通过：wingback-familiarity、tactics-lineup-rules、tactics-repair、formation-research、formation-research-runtime、campaign-match-engine。
包括同侧主/副熟练度、反侧不提升、惯用脚影响、阴影与边界、实际 V2.1 空间引擎翼卫分配及熟练度、原门将边界。
12 项真实隔离浏览器检查通过：左右翼卫标签、主位置熟练度颜色、研究阵型优先分配同侧边后卫、保存刷新仍一致、零运行时异常。
脚本 scripts/review-wingbacks.mjs；证据 outputs/wingbacks-20260908/ 和 outputs/wingback-tests.txt。
