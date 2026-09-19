# 黄狗风云 · 阿里云手动上线

目标公网 8.210.0.104，内网 172.17.12.224；游戏 https://yellowdogsleague.online/versus/ ，后台 https://yellowdogsleague.online/admin 。本说明替代旧腾讯云 /game 部署说明。安卓客户端继续暂停。

## 新服资源（已接入）

| 项目 | 发放方式 |
| --- | --- |
| 金币共 50,000 | 创建新游戏账号入账 20,000，建队后使用；首次成功征服普通中立地块 15,000；建队次日（北京时间）且累计征服 3 块不同普通中立地块后 15,000 |
| 球迷 | 初始总量 8,000，不是额外加 8,000；之后自然增长和游戏奖励正常计算 |
| 卡包 | 完成 33 人建队：稀有包 2、珍奇包 1，直接进入背包 |
| 建设补给 | 建队并建立总部后一次性 400，在待分配补给中使用；不足以用完的余量保留 |

每一阶段保存账号级发放记录。失败比赛、豪门挑战和玩家领土不计入开服征服阶段。重启、重复结算不会重复领取；不得手动删除 launchRewards。金币流水的 launch-* 原因可核对开服发放，总和最多 50,000。正常经营与征服奖励可能使钱包余额高于该值。

每日普通中立征服基础上限 8；迷雾半径 9（已扩大），正式版不显示开发迷雾开关。新服不带开发存档、金币 100 万或旧 S4 游戏进度。

## 上传前

使用 Linux x86_64（glibc >= 2.28），建议至少 2GB 内存；正式包内含 Node 24 Linux 运行时和生产依赖，不需要服务器执行 npm install。具体服务器容量仍需上线后实测。一个 Node 进程运行；不要开 PM2 cluster 或多个副本共同写同一个 JSON 存档。

将 tar.gz 和对应 sha256 文件上传服务器的私人目录，例如 /root/ydl-upload。不要放在网站公开目录。只需提供有效的域名完整证书链/私钥路径，安装命令通过参数指定。安装包已内置工作区 YDL_backup 的 2026-08-25 S4 最终备份中的 11 个账号，只含身份及原密码哈希。玩家使用该备份时的原昵称、原密码登录；没有重置密码。备份日期之后的改密或注册不在本包中。

在云控制台确认域名 A 记录指向 8.210.0.104；如有 AAAA，确认它也能到达本机，否则调整。安全组放行 TCP 80/443，4380 不对公网开放。现有管理端口按自己的管理方式保留。

解压前校验：

```bash
cd /root/ydl-upload
sha256sum -c yellowdogs-rougelite-aliyun-x64.tar.gz.sha256
tar -xzf yellowdogs-rougelite-aliyun-x64.tar.gz
cd yellowdogs-rougelite-aliyun
sudo bash deploy/aliyun/check-existing.sh
```

## 隔离旧 S4

1. 用上面的只读检查确认旧游戏的确切服务名、Nginx 域名配置文件、程序路径及最终账号 JSON 路径。备份已保存也要确认文件可读取。不要使用本地 Rougelite 的 data/campaign-accounts.json。
2. 在 /var/backups 下新建仅 root 可访问的带日期目录，把旧站程序、数据、对应配置和服务单元归档；下载一份到自己的电脑。账号哈希和后台密码不应出现在公共下载区。
3. 停止并禁用确认属于旧 S4 的服务。如果用 PM2，只操作旧游戏那一个进程，保留其他项目。无需删除程序目录，新服使用完全不同的目录。
4. 将仅属于 yellowdogsleague.online 的旧 Nginx 配置/启用链接移动至备份目录。若该文件还服务其他域名，只移除旧游戏的 server 块。保留 HTTPS 证书文件和续签任务；不要移动证书所在目录。
5. 执行 sudo nginx -t，确保旧配置已隔离且其余网站正常。安装器遇到旧域名配置、端口冲突或已有新服目录时会停止，避免误覆盖。

这里有意不提供自动批量清理旧服务的命令：服务器实际目录和服务名尚未读取。新服安装不会删除 S4 文件。

## 安装

把以下两个证书路径替换为服务器上的真实绝对路径。安装器自动使用包内 seed/campaign-accounts.json，保留 11 名玩家的 ID、昵称和密码哈希；旧会话、金币、球员、地块和奖励记录全部不迁移。不要替换成开发存档。

```bash
sudo bash deploy/aliyun/install.sh \
  --tls-cert /你的证书目录/fullchain.pem \
  --tls-key /你的证书目录/privkey.pem
```

安装器首次运行会建立：

- 服务 yellowdogs-rougelite；本机监听 127.0.0.1:4380。
- 程序 /opt/yellowdogs-rougelite/app，运行时 /opt/yellowdogs-rougelite/node。
- 存档 /var/lib/yellowdogs-rougelite/campaign-accounts.json。
- 私有配置 /etc/yellowdogs-rougelite.env；后台账号 admin，随机密码在其中的 ADMIN_BOOTSTRAP_PASSWORD。
- Nginx /etc/nginx/conf.d/yellowdogs-rougelite.conf。

已有目标目录时拒绝覆盖。中途失败应先看报错和日志，不要删除新服存档来强行重装。若服务器已经使用宝塔等面板自带 Nginx，先确认其 nginx 命令、systemd 服务和 conf.d include 是否是实际生效位置；本包按系统 Nginx 部署，不能让两套 Nginx 抢占端口。

SELinux Enforcing 的机器如出现 502，先看审计日志和 Nginx 错误日志，按本机策略允许 Nginx 访问回环 4380；不要直接关闭 SELinux。

## 上线验收

```bash
sudo systemctl status yellowdogs-rougelite --no-pager
curl --fail http://127.0.0.1:4380/healthz
curl --fail -I https://yellowdogsleague.online/versus/
sudo journalctl -u yellowdogs-rougelite -n 60 --no-pager
```

用原 S4 昵称密码登录：应重新建队选地。核对初始 20,000 金币、8,000 球迷，建队后背包 2 稀有包/1 珍奇包，总部建立后 400 补给。检查地图、卡面、战术板、训练收费/取消退款、两玩家互动、征服奖励、豪门三选一。刷新、退出重登、维护窗口重启后核对不重复发礼包，开发迷雾开关不可见。真实首场征服另有地块随机奖励，核对金币流水，不只看余额。

本地验收不能代替服务器上的 DNS、证书链、Nginx 生效配置及实际性能验收。内存限制当前 MemoryHigh=1100M、MemoryMax=1400M、Node heap=768MB；先小范围邀请朋友，观察内存、CPU、保存耗时和磁盘余量再扩大人数。

## 备份及后续更新

```bash
sudo bash deploy/aliyun/backup.sh
```

备份会短暂停服后恢复原运行状态，文件存入 /var/backups/yellowdogs-rougelite/，包含程序、存档、私有配置和 Nginx 配置，须私下保存。脚本不清理旧备份，定期下载并检查磁盘空间。现有证书由原证书管理流程另行备份和续签。

更新时先备份，维护窗口停服，只更新程序与所需资源，保留 /var/lib/yellowdogs-rougelite、环境配置和后台上传资源，再启动验收。首次安装脚本不是升级脚本，不要重复导入 S4 账号文件覆盖新服。不要把任何开发 data 目录上传到正式数据目录。

本版压缩包含账号密码哈希，仅私下上传，不要放在公开网站目录或公开分享。seed 位于 app 之外，安装后不复制到静态资源目录；Linux 压缩包内账号文件权限为 0600。

首周按朋友邀请制运营，先不叠加大额签到、排行榜金币和强化传奇赠送。故障补偿只对实际受影响名单、附原因发放。公开注册、交易防多号和聚合经济监测需要另行接入，当前仍沿用现有注册与交易规则。
