# YDL S4 V2 alpha.9 热更新

## 更新内容

- 修复角球或前场定位球主罚者接应自己传中并完成头球的问题。
- 降低普通随机伤病和犯规致伤概率。
- 保留雷暴的高风险机制：雷暴天气权重为 10%，单条控球链雷击伤病概率为 0.009；按每场 180 条控球链计算，全体比赛约有 8.03% 至少发生一次雷击伤病。
- 修复部分旧 X 球员存档使用错误初始能力基准的问题。旧档存在 `baseAttributes` 时，将以实际初始能力重新计算成长总评。唐昊当前成长基础总评将由 67 校正为约 78，强化 +6 后约为 87。
- V2 引擎版本更新为 `2.0.0-alpha.9` / `match-engine-v2-alpha.9`。

## 包含文件

- `versus/league-service.js`
- `versus/v2/match-engine-v2.js`
- `versus/v2/match-parameters-v2.json`
- `HOTFIX_V2_ALPHA9_20260802.md`

本包不包含联赛存档、玩家数据、账号数据、环境配置或数据库备份。

## 更新方法

建议选择没有正在直播比赛的时间窗口，并先备份线上程序目录与联赛存档。

```bash
tar -xzf football-ydl-s4-v2-alpha9-hotfix-20260802-0848.tar.gz -C /path/to/football-s4
sudo systemctl restart football-s4
sudo systemctl status football-s4 --no-pager
sudo journalctl -u football-s4 -n 100 --no-pager
curl -fsS -I http://127.0.0.1:4318/versus/
```

X 球员总评兼容修复会在服务加载存档时自动生效，不需要手工修改线上 JSON。已有赛果不会被重算。

## 回滚

恢复更新前备份的上述三个运行文件并重启服务。不要用旧程序包覆盖联赛存档。
