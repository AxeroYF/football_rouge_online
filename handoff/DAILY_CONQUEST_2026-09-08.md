# 每日中立征服额度与战败休整（2026-09-08）

已接入游戏，需重启服务后 Ctrl+F5。没有操作实际玩家存档或重启正在使用的服务。

## 规则
- 每名玩家基础每天可成功征服 5 个普通中立地块（ownerType=neutral）。勃兰登堡门已有的每日 +1 加成生效，上限为 6；移除该奇观的待开放提示。
- 成功占领才扣次数；败战不扣。豪门（club）和其他玩家领地不消耗普通中立征服额度，永久主场选择不扣。
- 以北京时间零点划分日期，成功占领计入实际结算日。跨日不累积剩余次数。
- 两回合挑战最终失败后，远征队所有下一次攻击（包括跨海、豪门、玩家领地）均休整 20 分钟；移动和测绘仍可进行。休整跨日保留。
- 账号 conquest 保存 day/used/cooldownUntil。旧账号首次使用从保留的战报恢复当日普通中立成功占领数及最近失败冷却，之后持久化独立计数，不依赖战报长度。
- begin 与 HTTP 入口均检查，结算还检查剩余额度，避免旧存档多场未完挑战突破上限。结算重复请求幂等，磁盘写入失败恢复额度、冷却、领地与挑战。

## 前端
顶部 YOOGLE 搜索左侧显示“可征服 剩余/上限”，无框金色数字，耗尽改提示色。休整期间第二行显示分钟:秒，使用服务器时钟加本地经过时间更新，不重绘页面。
地块挑战按钮按额度和冷却禁用并显示原因；战败结果提示休整。每 5 秒既有状态同步更新地块按钮，零点及冷却结束无需重新登录。

## 文件
- shared/config/conquest.mjs：统一规则、北京时间日期、公共状态与拦截消息。
- server/application/challenge-service.mjs、campaign-service.mjs：入口检查、事务结算、持久化及状态返回。
- shared/config/wonders.mjs：勃兰登堡门依赖标记移除，已有 modifier 参与上限。
- client/challenge/conquest-hud.js、styles/conquest.css、index.html、app.js：顶部显示。
- client/territory/territory-controller.js、client/challenge/challenge-controller.js：禁用反馈、结算提示。

## 验证
- 33 项 node 测试通过：test/conquest.test.js、campaign-service、territory-controller、challenge-controller。
- 23 项隔离游戏浏览器检查通过：scripts/review-conquest.mjs。含真实 API 冷却／额度耗尽拒绝、服务重载后存档保留、倒计时、地块禁用、刷新、2514/1600/1000/680/390/320 宽度布局、零浏览器异常。
- 证据：outputs/conquest-tests.txt、outputs/conquest-20260908/browser-results.json 及截图。
- 相关文件 git diff --check、JavaScript 语法检查通过。
