# YDL S4 V2 alpha.12 赛后掉线热更新

本包完整覆盖 alpha.11，可直接部署到当前服务器程序目录，不包含也不会覆盖联赛存档和账号数据。

## 问题结论

- systemd 日志中的 `code=killed, signal=TERM` 来自管理员执行 `systemctl stop`，没有进程崩溃或 OOM 证据。
- alpha.11 已解决五场模拟时的大块计算，但整轮完赛结算仍会同步复制旧联赛存档，并以带缩进格式重新写入整份状态。
- Day4 存档格式化后约 132.97 MiB；五场集中结算时，这段同步磁盘工作可能阻塞 Node 请求，观战页一次 10 秒轮询失败便会退出直播。

## alpha.12 修复

- 所有联赛状态保存默认改为紧凑 JSON；Day4 同等内容约 66.93 MiB，下降约 49.7%。
- 联赛、杯赛、友谊赛的直播开始、直播检查点和完赛结算均跳过同步 `.bak` 大文件复制。
- 主存档仍采用临时文件写入、`fsync`、原子重命名，避免写到一半覆盖主文件。
- 每日独立备份机制保持不变；部署前仍必须额外备份服务器 `data`。
- 观战轮询遇到暂时性请求失败时不再立刻关闭直播，最多进行 5 次指数退避重连；成功后自动恢复，只有连续失败才退出。
- 保留 alpha.11 的五场轮转小切片、只读查询接口和服务重启断点续算。
- V2 版本更新为 `2.0.0-alpha.12` / `match-engine-v2-alpha.12`。

## 验证

- JavaScript 语法检查通过：服务端、联赛服务、观战前端和 V2 引擎。
- 五场轮转、查询不推进比赛、重启断点续算、友谊赛完赛结算：4/4 通过。
- V2 参数、正式比赛适配、加时赛和 IFAB 逐轮点球：13/13 通过。
- 归档包内文件与工作区源文件逐项 SHA256 一致。

## 包含文件

- `devtool/server.js`
- `versus/league-service.js`
- `versus/public/app.js`
- `versus/v2/match-engine-v2.js`
- `versus/v2/match-parameters-v2.json`
- `versus/v2/ydl-league-engine-adapter.js`
- `HOTFIX_V2_ALPHA12_POSTMATCH_RECONNECT_20260802.md`

## 服务器部署

服务已停止时，执行：

```bash
sudo tar -czf /home/admin/football-s4-before-alpha12-$(date +%Y%m%d-%H%M%S).tar.gz \
  -C /opt/football-s4 \
  data devtool/server.js versus/league-service.js versus/public/app.js \
  versus/v2/match-engine-v2.js versus/v2/match-parameters-v2.json \
  versus/v2/ydl-league-engine-adapter.js

sha256sum /home/admin/football-ydl-s4-v2-alpha12-postmatch-reconnect-hotfix-20260802-1037.tar.gz
sudo tar -xzf /home/admin/football-ydl-s4-v2-alpha12-postmatch-reconnect-hotfix-20260802-1037.tar.gz -C /opt/football-s4
sudo chown admin:admin \
  /opt/football-s4/devtool/server.js \
  /opt/football-s4/versus/league-service.js \
  /opt/football-s4/versus/public/app.js \
  /opt/football-s4/versus/v2/match-engine-v2.js \
  /opt/football-s4/versus/v2/match-parameters-v2.json \
  /opt/football-s4/versus/v2/ydl-league-engine-adapter.js \
  /opt/football-s4/HOTFIX_V2_ALPHA12_POSTMATCH_RECONNECT_20260802.md

sudo systemctl start football-s4
sudo systemctl status football-s4 --no-pager
sudo journalctl -u football-s4 -n 100 --no-pager
curl -fsS -I http://127.0.0.1:4318/versus/
```

无需执行 `npm install` 或前端构建。浏览器可能缓存旧的 `app.js`，部署后让玩家强制刷新一次页面。

## 中断比赛恢复

- 若最后一个成功保存的检查点仍显示未完赛，服务启动后从该控球链继续。
- 若比赛已成功结算并写盘，保留既有结果，不重新模拟。
- 不要在后台手动触发“重新模拟本轮”。
