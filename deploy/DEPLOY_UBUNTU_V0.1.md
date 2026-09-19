# 黄狗风云 V0.1 · Ubuntu 公网测试部署

正式服迷雾规则：保留正常迷雾，隐藏开发用“迷雾：开/关”按钮。环境必须为 `NODE_ENV=production`、`CAMPAIGN_DEV_TOOLS=0`；生产模式即使误传开发参数或沿用关闭迷雾的测试账号标记，也不会允许关闭迷雾，直接调用开发接口返回 403。

本包面向服务器 **106.54.12.175，2 核 CPU / 2GB 内存 / 40GB 磁盘**，使用 HTTP。
游戏地址：**http://106.54.12.175/game**
后台地址：**http://106.54.12.175/admin**

## 0. 先排查并处理已有服务

先在云控制台终端执行以下只读命令，暂时不安装：

```bash
sudo ss -lntp
sudo systemctl list-units --type=service --state=running --no-pager
ps -eo pid,ppid,user,args | grep -E '[n]ode|[n]pm|[P]M2|[f]ootball|[y]ellowdogs'
```

重点找 **80** 和 **4370** 的监听进程。80 是网页入口，4370 是新游戏的内部端口；其他端口也可能运行旧版 S4。

**定位进程所属服务**：假设 ss 输出里显示 `pid=1234`，把下面的 1234 换成实际 PID：

```bash
sudo systemctl status 1234 --no-pager
ps -p 1234 -o pid,ppid,user,args
```

如果显示出服务名，比如 `football-s4.service`，再查看它的启动命令和目录：

```bash
sudo systemctl show football-s4.service -p FragmentPath -p WorkingDirectory -p ExecStart
```

先下载备份旧项目的账号数据与配置，再停止确定不用的旧游戏服务。下面的服务名是示例，必须替换为刚查到的实际名称：

```bash
sudo systemctl stop football-s4.service
sudo systemctl disable football-s4.service
sudo systemctl is-active football-s4.service
```

预期最后输出 `inactive`；停止服务不会删除它的数据。disable 是取消开机自启，防止重启后重新占用端口。不要停止 ssh、sshd 或腾讯云的管理代理。

**如果旧 Node 程序不是 systemd 管理**：
- 查看进程与父进程。如果由 PM2 管理，使用该进程所属的同一系统账号执行 `pm2 list`，再对确认的应用执行 `pm2 stop 应用名`；确定移除自启动记录时执行 `pm2 delete 应用名`、`pm2 save`。
- 如果由 Docker 运行，先 `sudo docker ps --format 'table {{.Names}}\t{{.Ports}}'`，对确认的旧容器执行 `sudo docker update --restart=no 容器名`、`sudo docker stop 容器名`。若容器由 Compose 或另一个服务启动，还需停掉对应的启动服务。
- 如果确认只是手工/nohup 启动且没有管理器，执行 `sudo kill -TERM 实际PID`，几秒后重新查看端口。若进程又出现，继续找它的管理器，不反复强杀。只停止识别出的旧游戏进程。

**如果 80 端口是 Nginx**，通常保留 Nginx运行，让新游戏复用它。检查是否已有指向同一 IP 的旧站点：

```bash
sudo nginx -T 2>&1 | grep -n -B 4 -A 6 'server_name.*106\.54\.12\.175'
ls -l /etc/nginx/sites-enabled/
```

如果确认某个旧站点不再使用，移除它在 sites-enabled 中的启用链接，保留 sites-available 原配置：

```bash
sudo unlink /etc/nginx/sites-enabled/旧站点链接名
sudo nginx -t
sudo systemctl reload nginx
```

先用 ls -l 确认那是旧站点的链接，不要删除仍服务其他域名的配置。若 Nginx 检查失败，先恢复原链接，不继续安装。

如果 80 端口属于 Apache 或其他程序，先判断是否仍在提供需要保留的网站；确认不用后，再按它实际所属的 service 停止并取消自启动。若它仍要使用 80，就需要调整反向代理方案，不直接运行本包安装。

处理后再次检查：

```bash
sudo ss -lntp 'sport = :4370'
sudo ss -lntp 'sport = :80'
```

4370 应没有监听进程；80 可以空闲，也可以由要继续使用的 Nginx 监听。安装脚本发现 4370 被占用、80 被其他程序占用或 Nginx 已有同 IP 站点时会停止，不会自行杀进程。

上传解压后，还可以运行包内只读诊断脚本：

```bash
sudo bash deploy/check-existing.sh
```


## 1. 这份运行包包含什么

- 当前黄狗风云代码、地图、球员图片和全部运行资源。
- 官方 Linux x64 Node.js **24.20.0**、锁定的运行依赖；不需要在服务器执行 npm install 或构建。
- S4final 服务器备份中的 **11 个账号**，保留原玩家 ID、昵称、密码哈希。玩家使用 **S4 原昵称和原密码** 登录。
- 黄狗风云从新建队开始：选 33 名球员，仅门将至少 3 名。S4 球员、金币、联赛进度与旧登录令牌未迁入。
- systemd 服务、Nginx HTTP 配置、首次安装脚本、备份脚本及完整校验清单。

账号来源是本地 `YDL_backup/ydl-s4-final-20260825-172250/ydl-s4-final-20260825-172250/archives/football-s4-data-20260825-172250.tar.gz` 中的 `data/versus-accounts.json`。这代表 2026-08-25 的最终备份，不会自动同步之后旧站发生的改密或注册。

本包包含密码哈希，请只上传到自己的服务器文件目录，不要放进公开下载目录或转发给测试玩家。HTTP 下登录密码和会话通过明文网络传输；本轮按你的测试安排使用 HTTP，正式开放时迁移 HTTPS。

Node 24 是 LTS 版本线，[官方说明](https://nodejs.org/en/blog/migrations/v22-to-v24)。运行时来自 [Node 官方发行目录](https://nodejs.org/dist/v24.20.0/)，打包时已验证官方 SHA256。

## 2. 在当前文件管理器中上传

你截图停留在 `/home`，里面有 `ubuntu` 和 `lighthouse` 两个文件夹。

1. 双击 **ubuntu**，进入 **/home/ubuntu**。
2. 点击右上角的上传图标，上传以下两个文件：
   - `yellowdogs-v0.1-ubuntu-x64.tar.gz`
   - `yellowdogs-v0.1-ubuntu-x64.tar.gz.sha256`
3. 等上传完成，再打开云控制台提供的终端执行下列命令。这不需要用 SSH 传文件，也不需要让我连接服务器。

## 3. 放行公网端口

在腾讯云该实例的“防火墙”或“安全组”入站规则中新增 **TCP 80，来源 0.0.0.0/0**，保留现有管理端口规则。

**4370 不对公网开放**：它只供 Nginx 在本机转发。暂时不需要配置域名、证书或 443。

安装脚本在 Ubuntu 的 UFW 已启用时添加 80 端口规则，不会自行启用 UFW 或变更管理端口。[Ubuntu 防火墙说明](https://ubuntu.com/server/docs/security-firewall/)。

## 4. 校验、解压、安装

本包要求 **Ubuntu 20.04 或更新版本，x86_64 / amd64 架构**。脚本会先检查。安装需要服务器能访问 Ubuntu 软件源以安装 Nginx、curl 和 xz；Node 与游戏依赖已带齐。

在终端完整执行：

```bash
cd /home/ubuntu
sha256sum -c yellowdogs-v0.1-ubuntu-x64.tar.gz.sha256
tar -xzf yellowdogs-v0.1-ubuntu-x64.tar.gz
cd yellowdogs-v0.1
sudo bash deploy/install.sh
```

第一条校验应输出 `OK`。如果失败，重新上传，不继续解压安装。

安装脚本会：
- 检查包内文件校验和，安装 Nginx。
- 将程序安装到 `/opt/yellowdogs/app`，Node 安装到 `/opt/yellowdogs/node`。
- 创建权限受限的 `yellowdogs` 运行用户。
- 将账号种子首次放入 `/var/lib/yellowdogs/campaign-accounts.json`。
- 生成独立后台密码并保存到 `/etc/yellowdogs.env`，不使用开发环境默认密码。
- 配置开机自启、异常重启、HTTP 转发；启动后检查 `/healthz`。

脚本**仅用于首次安装**。如果发现已有安装或存档，它会停止，不覆盖。若中途失败，先看报错、保留现有文件，不要删除账号文件来强行重跑。

Nginx 使用独立的 `yellowdogs-v01` 站点配置，不删除其他站点。[Ubuntu Nginx 安装说明](https://ubuntu.com/server/docs/how-to/web-services/install-nginx/)。

## 5. 登录和验收

浏览器访问 **http://106.54.12.175/game**，使用 S4 原昵称、原密码登录。普通玩家也可以注册新账号。

后台访问 **http://106.54.12.175/admin**，用户名为 **admin**。在服务器终端查看本次生成的密码：

```bash
sudo cat /etc/yellowdogs.env
```

其中 `ADMIN_BOOTSTRAP_PASSWORD=` 后面就是后台密码，不要发给测试玩家。该配置文件权限为 600；保留它，服务重启时使用同一密码。

服务检查命令：

```bash
sudo systemctl status yellowdogs --no-pager
curl http://127.0.0.1:4370/healthz
curl -I -H 'Host: 106.54.12.175' http://127.0.0.1/game
sudo journalctl -u yellowdogs -n 80 --no-pager
```

健康检查预期返回 `{"status":"ok","version":"0.1.0"}`。

建议实际点验：旧账号登录 → 完成 33 人建队 → 地图 → 强化、训练、回收、挂牌、汰换。HTTP 请求编号已适配，避免非 HTTPS 环境缺少 randomUUID 导致按钮报错。

## 6. 运行和压力观察

本版以**一个 Node 进程**运行，共享世界与 JSON 存档均由它维护。不要启用 PM2 cluster、多副本或同时启动第二个实例写同一份数据。

- Node 堆内存上限 768MB，服务 MemoryHigh 1100MB、MemoryMax 1400MB，给系统与 Nginx 留空间。
- 静态文件使用流式发送、ETag；可变 JSON 重新验证，Nginx 压缩文本响应。
- 登录接口有每 IP 每秒 3 次、突发 12 次的限制；压测登录触发 429 时是限流，不是游戏吞吐量上限。
- 比赛计算仍按当前引擎推进。当前 JSON 存档和同步密码验证会影响高并发，本包没有承诺在线人数上限；需要根据这台机器实测判断。

常用命令：

```bash
sudo systemctl restart yellowdogs
sudo systemctl stop yellowdogs
sudo systemctl start yellowdogs
sudo journalctl -u yellowdogs -f
free -h
df -h
top
```

关闭终端不会停止游戏。服务重启会保存状态；不要以删除存档的方式排查故障。

如果访问超时，先确认腾讯云 TCP 80 已放行、`nginx -t` 通过、两个服务都在运行。如果出现 502，检查 yellowdogs 日志和本机健康接口。如果首页是 Nginx 欢迎页，确认访问的是给定 IP，并检查站点配置是否有重复的 server_name。

## 7. 数据位置、备份与后续更新

| 路径 | 用途 |
| --- | --- |
| /opt/yellowdogs/app | 程序、前端、运行依赖及资源 |
| /opt/yellowdogs/node | 随包 Node 运行时 |
| /var/lib/yellowdogs/campaign-accounts.json | 玩家账号、球队、金币、世界和比赛存档 |
| /var/lib/yellowdogs/admin-state.json | 后台账号、会话及操作记录 |
| /var/lib/yellowdogs/player-library-admin.json | 后台球员库编辑状态 |
| /opt/yellowdogs/app/assets | 地图、球员卡与后台发布的球员内容 |
| /etc/yellowdogs.env | 环境变量与后台密码 |
| /etc/nginx/sites-available/yellowdogs-v01 | HTTP 站点配置 |

更新前先执行：

```bash
cd /home/ubuntu/yellowdogs-v0.1
sudo bash deploy/backup.sh
```

脚本短暂停止游戏，打包程序、资源、存档与配置到 `/var/backups/yellowdogs/`，结束后恢复原运行状态。备份含账号密码哈希和后台密码，不公开下载。备份脚本不会自行删除旧备份；定期下载并整理，避免 40GB 磁盘被占满。

**后续更新原则**：上传新版包 → 完整备份 → 停服 → 替换新版程序与必要资源 → 保留 /var/lib/yellowdogs 和 /etc/yellowdogs.env → 启动与验收。不要再次把本包的 seed 覆盖到在线存档；不要直接用新 assets 覆盖后台新增的头像和球员内容，需按新版更新说明合并。

**回退**：停服，从刚才完整备份恢复配套的程序、资源、存档、环境和服务配置，再 `systemctl daemon-reload`、`nginx -t` 并启动。不要混用不同版本的程序与存档。发生存档解析错误时服务会停止加载，避免以空世界覆盖旧文件。

## 8. 后续迁移 yellowdogsleague.online/versus/

V0.1 本次按 IP 的根路径部署，没有接管现有 S4 网站或域名。

正式迁移时保留黄狗风云运行数据，配置 HTTPS、域名反向代理，并统一适配 `/versus/` 子路径。当前前端有根路径 `/api/`、`/assets/` 引用，因此**不能只把 /versus/ 代理到 4370 就宣告迁移完成**；届时需要配套路径适配和原 S4 路由切换，再统一验收。这里先保留清楚的升级边界，避免影响已经运行成熟的站点。

## 打包验收记录

完整检查 565 项通过（68 + 428 + 69）。在本地 Ubuntu WSL 中用包内 Linux Node 24.20.0 执行隔离启动、43 次 HTTP 验收请求及重启持久化检查，通过；安装与备份脚本通过 bash 语法检查。账号种子与 S4final 的 11 个账号逐个比较 ID、昵称和密码哈希，完全一致；未携带旧令牌。没有在目标服务器安装或压测，在线容量须以 106.54.12.175 实测为准。
