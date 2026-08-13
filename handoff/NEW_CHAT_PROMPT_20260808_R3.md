# 新对话接手提示

请先完整阅读 `handoff/LATEST_20260808_R3.md`，然后只读执行 `git status --short`。唯一工作树是 `D:\Project\game_test\.worktrees\s4`，其中有大量用户未提交改动，禁止 reset、clean、checkout 或整体覆盖。

生产使用稳定 V2，V2.5 仍是本地实验。最新服务器部署包是 `D:\Project\game_test\handoff\football-ydl-s4-dlc3-tactics-gk-hotfix-20260808-224833-r3.tar.gz`，SHA256 为 `531e7c4065b4ab5a96c5926621723fa580137c660cee4c3a00c801d9e1e5743e`。最后已知状态是服务器已备份并停服，包已上传，但尚未收到最终解压、启动及 `health status=200` 的确认；先根据用户下一条终端输出继续，不要假定部署成功或重复打包。

赛事适配 bug 已在本地最终修复并经用户浏览器确认：原方案设为杯赛，切换新方案后再切回，原方案仍显示杯赛。根因是前端 change 回调引用局部变量 `assignmentValue` 导致请求未发出，修复位于 `versus/public/app.js` 的 `lineupSchemeCompetitionValue()` 及赛事下拉框监听器。

本轮还包括 DLC3 47 人及卡画映射、最多三套阵容和赛事专用设置、战术板区域阴影与布局、主页最近五场懒加载、金球奖具体球员卡评选/前三名邮件/10000 奖励、严格裁判约 20%、黑哨随机分钟、门将红牌应急换人。只做与用户下一项请求相关的定向检查，不运行完整联赛长回归。
