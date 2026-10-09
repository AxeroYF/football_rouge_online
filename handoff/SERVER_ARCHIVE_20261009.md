# 停服与玩家数据封存 · 2026-10-09

用户准备停服。本文和脚本仅为操作交付，尚未连接生产服务器执行。最近确认部署为原版 R51，R52 已打包但是否安装未获确认；停服不需要先升级 R52，应保存服务器实际运行程序。

## 操作步骤

1. 提前通知玩家停服时间，关闭自己额外配置的自动发布、定时开服或外部守护任务。标准部署仅由本项目 systemd 服务管理；若改过 DATA_DIR、服务环境覆盖、资源软链接或部署路径，先人工核对备份范围。
2. 上传仓库中的 `deploy/aliyun/seal-server.sh` 到服务器 `/home/admin/seal-server.sh`，保留 LF 换行。在 SSH 中查看空间：

```bash
df -h /home/admin && sudo du -sh /var/lib/yellowdogs-rougelite /opt/yellowdogs-rougelite
```

为三个压缩包预留足够空间；建议空闲量大于以上两个目录总大小。执行：

```bash
sudo bash /home/admin/seal-server.sh
```

脚本发送正常停止信号，等待游戏保存内存状态到磁盘，关闭开机自启，检查停服结果和账号 JSON。成功后创建 `/home/admin/yellowdogs-final-日期-随机字符/`，检查压缩包完整性、主存档原文件与包内 SHA256 一致，服务保持停止。发生异常也不会自动开服，不要忽略错误。不要使用 `kill -9`。

3. 核对状态；`inactive`、`disabled` 为预期（这两条查询的退出码非零也可能表示正常的已停用状态）：

```bash
systemctl is-active yellowdogs-rougelite.service
systemctl is-enabled yellowdogs-rougelite.service
```

4. 使用 SFTP 下载**整个**输出目录到电脑，再复制到另一块硬盘或私有备份空间。文件夹权限仅对 admin 用户开放。下载后进入备份目录，在 Linux/macOS 验证：

```bash
shasum -a 256 -c SHA256SUMS
```

Windows PowerShell 验证所有文件：

```powershell
Get-Content .\SHA256SUMS | ForEach-Object {
  $expected, $relative = $_ -split '  ', 2
  if ((Get-FileHash -LiteralPath $relative -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) { throw "校验失败：$relative" }
  Write-Host "OK $relative"
}
```

**两份离线备份均校验通过，最好完成一次隔离恢复验证后，再考虑释放云服务器。** 仅停止游戏服务并不会停止云服务器计费。不要先删除实例或数据盘。需要保留 TLS 证书时，另外保存 Nginx 配置中实际引用的证书和私钥；证书不在脚本固定备份范围内，未来也可重新签发。

## 保存内容

- `data.tar.gz`：完整 `/var/lib/yellowdogs-rougelite`，包括账号、密码哈希、球员、资产、世界进度、管理配置及目录内历史备份；不是只导出昵称。
- `runtime.tar.gz`：完整 `/opt/yellowdogs-rougelite`，包括实际版本代码、Node、依赖、私有卡画等，避免 Git 源码不足以恢复。
- `config.tar.gz`：环境配置、服务 unit、可选 drop-in 和本站 Nginx 配置。
- `ACCOUNTS-CHECK.json`：存档版本及账号数量；不公开账号详情。
- `SERVER-STATE.txt`、`SAVE.sha256`、`SHA256SUMS`：状态、文件归属及完整性校验。

备份含密码哈希和管理员配置等秘密，请存到加密磁盘或私有加密备份空间；不要上传 Git、公开网盘或发给玩家。浏览器 localStorage 的偏好（例如默认购买保卡）不是服务器账号存档的一部分。

现有 `deploy/aliyun/backup.sh` 是日常备份工具：如果执行前服务正在运行，它会在结束时重新启动服务。停服封存请使用本次 `seal-server.sh`。脚本不停止整个 Nginx；停服后网站可能显示 502，如需保留访问入口应另设本站停服公告页。

## 将来恢复

先保留原始归档不动，复制到隔离的同架构 Linux 主机，校验 SHA256。检查三个 tar 的路径，在无玩家访问的空环境中恢复到原绝对路径；创建 `ydl-rougelite` 服务用户并按记录核对数据和 assets 的归属权限，安装系统 Nginx，检查环境配置、证书和 unit，执行 daemon-reload 后再人工启动。不要将这些备份直接覆盖其他运行中的游戏，也不要运行初始化账号/种子导入。

原账号密码哈希随存档保留，可继续验证原密码。当前实现会平移停服期间的经济时钟，但比赛、训练等其他定时流程不能一概视为冻结；首次启动可能按时间结算。应先在隔离环境检查账号数量、登录、资产与定时任务，再决定正式开放，不能仅凭压缩包校验通过就宣称已验证完整恢复。
