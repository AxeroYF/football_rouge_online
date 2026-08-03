# YDL S4 V2 alpha.13 逐场直播缓存热更新

本包完整覆盖 alpha.12，只包含程序与测试文件，不包含联赛存档、账号、备份或服务器配置。

## 性能修复

- 直播检查点由每 30 秒同步写入整份联赛状态，改为每场比赛独立缓存。
- 每个 250ms 调度切片只可能保存本次实际推进的比赛，不再同时序列化五场直播和完整联赛数据。
- 单场检查点默认最多每 10 秒写入一次，目录为主联赛存档旁的 `yellowdogs-league.json.live/`。
- 服务重启时按直播 code 合并逐场检查点，并从各场最后保存的控球链继续。
- 友谊赛、杯赛和联赛完赛后延迟 1.5 秒合并主存档，避开加时赛、点球大战、赛后报告和直播归档所在的结束切片。
- 主存档成功写入后自动清理已完成比赛的逐场检查点；写入失败则保留检查点并输出错误日志。
- 保留 alpha.12 的紧凑 JSON、原子写入、直播轮转切片、只读查询和前端自动重连。

## 验证

- 五场轮转、重启续算、逐场检查点和友谊赛结算针对性回归：4/4 通过。
- V2 参数、加时赛和 IFAB 点球专项：13/13 通过。
- JavaScript 语法与 `git diff --check` 通过。

## 部署

部署前必须停止服务并额外备份 `/opt/football-s4/data`。不要删除或覆盖服务器现有数据目录。

```bash
sudo systemctl stop football-s4
sudo tar -czf /home/admin/football-s4-data-before-alpha13.tar.gz -C /opt/football-s4 data
sudo tar -xzf /home/admin/football-ydl-s4-v2-alpha13-per-match-checkpoints-hotfix-20260802.tar.gz -C /opt/football-s4
sudo chown -R admin:admin /opt/football-s4
sudo systemctl start football-s4
sudo systemctl status football-s4 --no-pager -l
```

部署后确认：

```bash
grep -n '2.0.0-alpha.13' /opt/football-s4/versus/v2/match-parameters-v2.json
grep -n 'match-engine-v2-alpha.13' /opt/football-s4/versus/v2/match-engine-v2.js
grep -n 'LIVE_MATCH_PERSIST_INTERVAL_MS' /opt/football-s4/versus/league-service.js
```
