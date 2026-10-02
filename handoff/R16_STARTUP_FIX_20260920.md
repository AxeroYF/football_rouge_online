# R16 启动修复，前置 R15

修复 defence-notifications 在 store 初始为 null 时读取 pvpNotices 导致 app.js 中断。表现为顶部只显示基础菜单、地图文件下载完成仍无法进入。
仅更新 client/challenge/defence-notifications.js 和 index.html。无存档规则变化，无需重装客户端。R15 所有功能保留。
完整 Chrome 页面无账号启动和夹具账号登录后 Leaflet 地图 ready 验证通过；保证金通知浏览器回归通过；隔离 R15 安装与回滚验证通过。未宣称 CDN 链路修复，未在正式服务器执行。
上传 tar.gz 和 sha256 至 /home/admin 后执行：

```bash
cd /home/admin && sha256sum -c yellowdogs-hot-update-20260920-r16.tar.gz.sha256 && tar -xzf yellowdogs-hot-update-20260920-r16.tar.gz && cd yellowdogs-hot-update-20260920-r16 && sudo bash update.sh --check && sudo bash update.sh apply
```

成功标志 Installed: 20260920-r16。安装前服务保持运行，自动备份代码与存档，短暂停服后等待健康检查。回滚用执行输出中的具体命令；回滚恢复备份时的配套存档。
成功后刷新网页或在客户端菜单刷新页面，使新的 index.html 资源版本生效。

## 用户部署确认

本轮交接更新时，用户明确确认 R16 已部署。后续增量基线为 releases/20260920-r16；尚未收到刷新后地图恢复的确认。原包及包内文档保持交付字节不变。
