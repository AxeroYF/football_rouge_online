# YDL S4 V2 alpha.14 比赛预测页面性能热更新

本包完整覆盖 alpha.13，只包含程序、前端和测试文件，不包含联赛存档、账号、备份或服务器配置。

## 性能优化

- 新增 `/api/versus/league/predictions` 轻量接口，只返回金币、待预测比赛、预测收益榜和更新时间。
- 比赛预测页的 12 秒静默刷新不再请求完整联赛视图，不再组装阵容、球员卡、市场、邮件、历史比赛和完整排行榜。
- 预测刷新按比赛 ID 对比，只新增、移除或替换发生变化的比赛卡片。
- 金币、待预测场数和收益榜使用独立容器更新，不再重建整个联赛页面。
- 提交预测后只返回预测相关轻量快照，不再返回完整联赛数据。
- 保留 alpha.13 的逐场直播检查点、重启恢复和完赛延迟合并主存档。
- V2 版本更新为 `2.0.0-alpha.14` / `match-engine-v2-alpha.14`。

## 验证

- 服务端、API、前端 JavaScript 语法检查通过。
- 预测页轻量接口和局部更新前端回归通过。
- 逐场缓存与直播回归 4/4 通过。
- V2 参数、加时赛和 IFAB 点球专项 13/13 通过。
- `git diff --check` 通过。

## 部署

部署前必须停止服务并额外备份 `/opt/football-s4/data`。不要删除或覆盖服务器现有数据目录。

```bash
sudo systemctl stop football-s4
sudo tar -czf /home/admin/football-s4-data-before-alpha14.tar.gz -C /opt/football-s4 data
sudo tar -xzf /home/admin/football-ydl-s4-v2-alpha14-prediction-page-hotfix-20260802.tar.gz -C /opt/football-s4
sudo chown -R admin:admin /opt/football-s4
sudo systemctl start football-s4
sudo systemctl status football-s4 --no-pager -l
```

部署后确认：

```bash
grep -n '2.0.0-alpha.14' /opt/football-s4/versus/v2/match-parameters-v2.json
grep -n '/api/versus/league/predictions' /opt/football-s4/versus/public/app.js
grep -n 'predictionView(account)' /opt/football-s4/versus/league-service.js
```
