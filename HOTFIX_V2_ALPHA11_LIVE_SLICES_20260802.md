# YDL S4 V2 alpha.11 五场直播性能热更新

本包完整覆盖 alpha.10，可直接部署；如果服务器已经安装 alpha.10，也可直接叠加本包。

## 更新内容

- 五场比赛仍然同时开播、同时显示进度；服务端改为全局轮转的小切片模拟，每 250 毫秒最多推进两场、每场一条控球链。
- 直播列表、观战页和轮询接口改为只读，不再因一次页面刷新或多个观众轮询而重复推进整轮比赛。
- 直播中间状态保存间隔由 5 秒调整为 30 秒，使用紧凑 JSON，并取消每次中间保存时复制大型 `.bak`；比赛结算仍执行完整持久化。
- 服务重启时恢复尚未完成的 V2 比赛运行态，从最后一次已保存的控球链继续，不重新模拟整场。
- 延续 alpha.10 的真实加时赛、逐轮点球直播、角球主罚者回避、伤病概率调整、雷暴伤病约占全部场次 8% 和旧 X 球员成长基准修复。
- V2 引擎版本更新为 `2.0.0-alpha.11` / `match-engine-v2-alpha.11`。

## 性能验证

- 本机 5 场同时直播、连续 30 个调度切片，共推进 60 条控球链。
- 五场各推进 12 条控球链，证明轮转公平且五场均持续直播。
- 单次服务端阻塞由优化前约 1040 ms 降至平均约 50 ms、最高约 74 ms。
- 中间存档由约 132.97 MiB 的格式化 JSON 降至约 66.93 MiB，体积下降约 49.7%。
- 重启测试在第 37 条控球链保存，重新加载后从 37 推进到 38，已发生事件和比分没有重算。

## 包含文件

- `devtool/server.js`
- `versus/league-service.js`
- `versus/v2/match-engine-v2.js`
- `versus/v2/match-parameters-v2.json`
- `versus/v2/ydl-league-engine-adapter.js`
- `HOTFIX_V2_ALPHA11_LIVE_SLICES_20260802.md`

本包不包含联赛存档、玩家数据、账号数据、环境配置或数据库备份。

## 服务器更新方法

以下命令假设项目目录是 `/opt/football-s4`，热更包上传到 `/home/admin/`。

```bash
sudo systemctl stop football-s4
sudo tar -czf /home/admin/football-s4-before-alpha11-$(date +%Y%m%d-%H%M%S).tar.gz \
  -C /opt/football-s4 \
  data devtool/server.js versus/league-service.js versus/v2/match-engine-v2.js \
  versus/v2/match-parameters-v2.json versus/v2/ydl-league-engine-adapter.js

sha256sum /home/admin/football-ydl-s4-v2-alpha11-live-slices-hotfix-20260802-1021.tar.gz
sudo tar -xzf /home/admin/football-ydl-s4-v2-alpha11-live-slices-hotfix-20260802-1021.tar.gz -C /opt/football-s4
sudo chown admin:admin \
  /opt/football-s4/devtool/server.js \
  /opt/football-s4/versus/league-service.js \
  /opt/football-s4/versus/v2/match-engine-v2.js \
  /opt/football-s4/versus/v2/match-parameters-v2.json \
  /opt/football-s4/versus/v2/ydl-league-engine-adapter.js \
  /opt/football-s4/HOTFIX_V2_ALPHA11_LIVE_SLICES_20260802.md

sudo systemctl start football-s4
sudo systemctl status football-s4 --no-pager
sudo journalctl -u football-s4 -n 100 --no-pager
curl -fsS -I http://127.0.0.1:4318/versus/
```

无需运行 `npm install`，也无需重新构建前端。可选环境变量 `YDL_LIVE_SLICE_INTERVAL_MS` 的默认值是 `250`，建议先使用默认值。

## 本次中断比赛的处理

服务器重新启动后，尚未结束的 V2 直播会从存档中最后一次成功写入的控球链继续模拟，不会整场重赛。此前已经写入存档的比分、红黄牌、伤病和直播事件都会保留。

因为中断时服务器运行的旧版每 5 秒保存一次直播状态，最多可能丢失断服前最后约 5 秒尚未来得及落盘的推进；这部分会从最后检查点重新生成。已经完成并成功结算的比赛结果不会改变。

## 回滚

停止服务，恢复更新前备份中的 `data` 和上述五个运行文件，再启动服务。回滚时必须让程序文件和对应时刻的 `data` 一起恢复，避免新旧运行态不兼容。
