# +4 特性绑定与后台发卡轻量响应热修

## 修复

- `POST /api/versus/league/card/enhancement-trait` 改为轻量响应，只返回本次绑定结果、卡片、钱包和强化历史，不再生成完整玩家联赛视图。
- `POST /api/admin/league/s4-cards/grant` 改为轻量响应，只返回发放记录和新增卡片，不再生成完整后台联赛视图。
- 前端局部合并绑定结果与后台发放记录，移除特性选择前的 620ms 人为等待。
- 强化庆祝层动画节点由 128 个降至 48 个，降低 `+4` 特性选择界面的渲染压力。

## 验证

- JavaScript 语法检查：5/5 通过。
- 分片存储回归：4/4 通过。
- 新增“后台发两张 +3 卡、合成 +4、绑定特性、重载分片”链路通过。
- 原有 +4/+7 特性与强化页局部刷新：2/2 通过。

## 部署

SHA256：`2A81B53A20B948CA2E4FD8E157B7F1B80DF86E42A89B50D5DCE2CA636025028C`

热更新前备份代码；不要覆盖或迁移 `data`。覆盖文件后重启服务：

```bash
cd /opt/football-s4
sudo systemctl stop football-s4
tar -xzf /tmp/football-ydl-s4-card-trait-admin-grant-hotfix-20260802-2301.tar.gz -C /opt/football-s4
node --check versus/league-service.js
node --check versus/api.js
node --check versus/admin-api.js
node --check versus/public/app.js
node --check admin/public/app.js
sudo systemctl start football-s4
sudo systemctl status football-s4 --no-pager -l
```
