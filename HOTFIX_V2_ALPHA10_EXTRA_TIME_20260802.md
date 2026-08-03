# YDL S4 V2 alpha.10 加时赛与点球热更新

本包替代 `football-ydl-s4-v2-alpha9-hotfix-20260802-0848.tar.gz`。尚未部署旧包时，直接部署本包即可。

## 更新内容

- V2 杯赛在单场或两回合总比分打平后，先进行上下半场各 15 分钟的加时赛。
- 加时赛使用 60 条真实 V2 控球链，继续计算进球、战术、体力、伤病、犯规和红黄牌；105 分钟记录加时赛中场，120 分钟结束。
- 加时仍平后进入逐轮点球大战直播，记录每名主罚球员、对方门将、命中、扑出或射偏以及每球后的实时比分。
- 点球大战遵循 IFAB Law 10：两次掷币、双方交替、各罚五球、可提前结束、同轮后突然死亡；全部合资格球员（含门将）轮完前不得重复主罚；人数不等时人数较多一方先减员。
- 比赛报告新增常规时间比分、加时赛比分、加时赛标记和完整逐球点球数据。
- 延续 alpha.9 中的角球主罚者不得接应自己传中、普通伤病下调、全体比赛约 8.03% 雷击伤病，以及旧 X 球员成长基准修复。
- V2 引擎版本更新为 `2.0.0-alpha.10` / `match-engine-v2-alpha.10`。

规则依据：<https://www.theifab.com/laws/latest/determining-the-outcome-of-a-match/>

## 包含文件

- `versus/league-service.js`
- `versus/v2/match-engine-v2.js`
- `versus/v2/match-parameters-v2.json`
- `versus/v2/ydl-league-engine-adapter.js`
- `HOTFIX_V2_ALPHA10_EXTRA_TIME_20260802.md`

本包不包含联赛存档、玩家数据、账号数据、环境配置或数据库备份。

## 更新方法

必须选择没有正在直播比赛的时间窗口，并先备份线上程序目录与联赛存档。

```bash
sudo systemctl stop football-s4
sudo tar -czf /home/admin/football-s4-before-alpha10-$(date +%Y%m%d-%H%M%S).tar.gz -C /opt/football-s4 data versus/league-service.js versus/v2/match-engine-v2.js versus/v2/match-parameters-v2.json versus/v2/ydl-league-engine-adapter.js
sudo tar -xzf /home/admin/football-ydl-s4-v2-alpha10-extra-time-hotfix-20260802-0926.tar.gz -C /opt/football-s4
sudo chown admin:admin /opt/football-s4/versus/league-service.js /opt/football-s4/versus/v2/match-engine-v2.js /opt/football-s4/versus/v2/match-parameters-v2.json /opt/football-s4/versus/v2/ydl-league-engine-adapter.js /opt/football-s4/HOTFIX_V2_ALPHA10_EXTRA_TIME_20260802.md
sudo systemctl start football-s4
sudo systemctl status football-s4 --no-pager
sudo journalctl -u football-s4 -n 100 --no-pager
curl -fsS -I http://127.0.0.1:4318/versus/
```

不需要运行 `npm install`，也不需要构建前端。X 球员旧档兼容修复在服务加载存档时自动生效；已有赛果不会被重算。

## 回滚

停止服务，恢复更新前备份的 `data` 和上述四个运行文件，再启动服务。不要用程序包覆盖联赛存档。
