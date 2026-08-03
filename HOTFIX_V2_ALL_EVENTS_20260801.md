# S4 V2 全赛事热更新（2026-08-01）

## 更新内容

- 联赛、杯赛和友谊赛新创建的比赛默认统一使用 180 链 V2 引擎。
- 杯赛 V2 支持两回合总比分，并在决胜场总比分仍相同时执行点球决胜。
- 已经创建的旧比赛保留自身引擎版本，不强制迁移。
- 比赛预测仍显式使用 V1 快速模拟，不占用正式 V2 比赛的计算预算。
- 包含本轮战术板、细节战术、赛后复盘、邮件与后台等配套更新。

## 数据安全

本压缩包不包含线上联赛存档、玩家账号、内容覆盖文件和数据备份。唯一随包更新的 `data` 文件是赛后复盘 Demo：

`data/v2-review-demo-alpha7.json`

## 引擎开关

没有配置环境变量时，三类正式赛事默认均为 V2。也可以在 `/etc/football-s4.env` 中显式配置：

```text
YDL_MATCH_ENGINE=v2
YDL_LEAGUE_MATCH_ENGINE=v2
YDL_CUP_MATCH_ENGINE=v2
YDL_FRIENDLY_MATCH_ENGINE=v2
```

紧急回滚时可将全局值改为 `v1`，或者仅回滚某一赛事类型。修改只影响后续新建比赛，已有比赛继续使用其创建时记录的版本。

## 更新后检查

```bash
sudo systemctl restart football-s4
sudo systemctl status football-s4 --no-pager
sudo journalctl -u football-s4 -n 100 --no-pager
curl -fsS -I http://127.0.0.1:4318/versus/
```
