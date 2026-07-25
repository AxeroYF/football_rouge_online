# 新对话启动提示词

请先完整读取：

- `D:\Project\game_test\handoff\README.md`
- `D:\Project\game_test\handoff\CURRENT_STATE.md`
- `D:\Project\game_test\handoff\MANIFEST.md`

然后只读检查：

```powershell
cd D:\Project\game_test
git status --short
```

当前重点是 YellowDogs League（YDL）与黄狗冠军杯。正式存档位于 `data/yellowdogs-league.json`，正在运行的 `npm run tunnel` 可能继续推进赛程。除非用户明确要求，禁止操作正式存档、启动模拟、重置赛季、停止或重启 tunnel。测试使用 `statePath:null` 或纯内存克隆。

2026-07-25发生并已修复一个紧急瑞士轮故障：第3轮后2队3胜、1队3负，剩余7队导致旧配对函数最后一队无对手并抛错，残留的 `liveCupRound` 阻塞联赛。修复后当时总排名第9名自动淘汰，排名3–8的6队进行第4轮3场种子赛，第4轮结束后才生成八强。收尾逻辑现在幂等，且被延误的联赛优先于后续杯赛重新排期。修复前备份：`data/yellowdogs-league-before-swiss-recovery-20260725-135117.json`。

交接打包时的只读快照：S3联赛第5轮完成、10支真人球队、杯赛瑞士轮第4轮完成并已进入八强、无残留联赛/杯赛直播。该状态可能已继续变化，接手后务必重新读取而不要依赖快照。

近期已完成：新赛季报名期和管理员手动开启联赛、杯赛、日程表、电视台、背包和收件箱、700人球员池和14名传奇特性、混池经济系统、后台条件卡包奖励、玩家当前赛季经济明细、杯赛时间跟随手动开启的联赛时间、体力红线自动轮换。

当前可信验证：`node --test test/league.test.js` 42/42通过，`npm run build`通过。不要宣称全项目所有测试通过，除非重新运行并确认。
