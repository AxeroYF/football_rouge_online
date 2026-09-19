# 黄狗风云 V0.1 服务器发行记录

用户要求打包给 Ubuntu 2 核 / 2GB / 40GB 测试机，IP 106.54.12.175，先用 HTTP，自己手动上传，不使用 SSH 代传或自动部署。

## 发行物
- `D:/Project/game_test/releases/v0.1-20260906-r2/yellowdogs-v0.1-ubuntu-x64.tar.gz`
- 同目录 `.tar.gz.sha256`
- 同目录 `黄狗风云V0.1-上传部署说明.md`
- 未压缩目录 `yellowdogs-v0.1/`，内含 `RELEASE.json`、`QA.json`、`QA-linux.json` 和逐文件 `SHA256SUMS`。

服务器部署：文件管理器进入 /home/ubuntu 上传；终端校验、解压，执行 `sudo bash deploy/install.sh`。程序在 /opt/yellowdogs/app，运行数据在 /var/lib/yellowdogs，配置和后台密码在 /etc/yellowdogs.env。使用 Nginx 80 → 127.0.0.1:4370，单进程、Node 堆 768MB、systemd MemoryMax 1400MB。后台密码首次随机生成，脚本拒绝覆盖已有安装。

## 账号来源
用户确认来自工作树里的 S4final 服务器备份，实际目录为：
`YDL_backup/ydl-s4-final-20260825-172250/ydl-s4-final-20260825-172250/archives/football-s4-data-20260825-172250.tar.gz`

只读取其中 data/versus-accounts.json，11 个账号均有 scrypt 密码。全部 ID、昵称、密码哈希逐条一致；原始登录 token、S4 阵容、资产、比赛记录不进入运行包。种子为新黄狗风云进度，首次启动走已有经济和背包默认迁移，登录后选择 33 人（仅 GK 至少 3 人）。

不使用此前发现的主目录 15 个本地测试账号或 S4 工作树 4 个账号，不改源备份或当前开发存档。

## 为公网运行完成的兼容
- account-password.mjs 同时验证 S4 二进制盐的 base64url scrypt 格式与黄狗风云现有十六进制文本盐格式，使用恒定时间比较；S4 密码按原始文本验证。
- 登录输入兼容旧昵称与密码长度；无冗余登录说明小字。
- createRequestId 使用 randomUUID，纯 HTTP 无该接口时以 getRandomValues 生成 UUID，接入强化、球探、训练、球员管理与后台代办。
- 原服务器能任意读取根下数据文件，改为明确公共目录和类型白名单，数据、后台服务端代码、备份、依赖目录与种子不能通过 HTTP 下载。
- 静态文件流式发送，支持 HEAD、ETag；加入地图地形 .bin 类型，处理 /game/ 与 /admin/ 的规范跳转。
- DATA_DIR 独立保存玩家、后台和球员库编辑状态；已有账号文件解析失败时停止加载，防止空世界覆盖。
- 生产模式要求足够长的后台初始密码；systemd 停机时保存并关闭调度器。
- Turf 从开发依赖移到运行依赖，包内带生产 node_modules；Node 官方 Linux x64 24.20.0 运行时已验证发行 SHA256。

## 验证
完整 npm run check：565 项（68 + 428 + 69）通过。新增测试覆盖 S4 导入及登录、错误口令/旧 token、HTTP UUID、静态访问边界、流式与缓存、损坏存档。

本地 Ubuntu WSL 使用包内 Linux Node 执行隔离验收：43 次 HTTP 请求，含启动、合成 S4 凭据登录、后台登录、初始选人、资源读取、数据目录拒绝与重启持久化，全部通过。仅使用临时测试账号，未使用真实玩家密码；没有读写真实在线存档。采样内存约 259MB，轻量状态读取四并发延迟仅记录在 QA-linux.json，**不能当作目标云服务器的在线承载量**。

安装和备份脚本通过 Ubuntu bash -n。没有在目标机器安装 Nginx/systemd，也未实测目标公网连通性，等待用户手动部署。

## 后续 HTTPS
本版使用根路径。目标 https://yellowdogsleague.online/versus/ 需要配套统一 /versus/ 子路径、API 和素材引用，并协调现有 S4 路由；不能只新增一个代理 location 就宣称完成迁移。

## 构建入口
scripts/build-v01-release.py --output OUTPUT 生成隔离 staging。
通过 smoke-v01.mjs 与测试后写入 QA.json，再添加 --finalize 生成 tar.gz 与校验。
已存在 staging 或发行压缩包时拒绝覆盖，重做发行应使用新的输出目录。

部署详细说明以 deploy/DEPLOY_UBUNTU_V0.1.md 为准。

最终包补充已有服务排查：部署文档第 0 节说明端口、PID、systemd/PM2/Docker 与手工进程的定位和停止。新增只读 check-existing.sh，安装前拒绝端口冲突与重复 IP 站点，不自行停止旧服务。最终交付使用 -r2 输出目录。
