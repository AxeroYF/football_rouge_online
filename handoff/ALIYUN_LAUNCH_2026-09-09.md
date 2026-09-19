# 阿里云手动上线与正式资源

目标 8.210.0.104，私网 172.17.12.224，入口 https://yellowdogsleague.online/versus/。用户手动上传，不使用 SSH。保留 S4 账号密码、游戏进度清零；不连接远端、不执行服务器清理。安卓端继续暂停。

## 已落实的发放

- 初始金币 20,000（账号创建入账，建队后使用），首块普通中立征服 15,000，建队次日北京时间且累计 3 块不同普通中立征服后 15,000，共 50,000。
- 总初始球迷 8,000；完成 33 人选秀送稀有包 2、珍奇包 1；建立总部送 400 待分配建设补给，余量保留，不写生产力库存。
- launchRewards 只为新游戏账号建立资格，阶段标记、金币、卡包、补给同一次保存，失败回滚，重启防重复。普通征服成功回调登记去重地块，战争/豪门/失败不计数。
- 老开发存档不自动清零、不追发礼包。正式包排除开发 data、原始旧备份、安卓签名文件；按用户最新要求内置 YDL_backup 中 2026-08-25 最终备份的 11 个账号到 seed/campaign-accounts.json，只保留身份和密码哈希，丢弃资源、游戏进度和发奖记录。安装器自动使用包内账号，不再接收 --s4-accounts 参数。
- 每日普通中立征服 8；生产模式迷雾不可关闭，半径 9。没有新增交易资格或注册邀请机制，仍应朋友范围运营。

## 部署

说明：../deploy/DEPLOY_ALIYUN.md；配置 deploy/target.json；首次安装 deploy/aliyun/install.sh。独立服务 yellowdogs-rougelite、本机 4380、程序 /opt/yellowdogs-rougelite、数据 /var/lib/yellowdogs-rougelite。旧 S4 按实际路径手动归档隔离，不做猜测性清理。使用现有域名证书，安装器校验域名、有效期及密钥匹配。

新入口 /versus/ 支持相对资源和带前缀 API，同时保留绝对 /assets、/api；根路径跳转 /versus/，/game 保持兼容。新包仅含阿里云部署脚本，避免误运行旧腾讯云安装器。

打包：scripts/build-aliyun-release.py；运行时验收 scripts/verify-aliyun-runtime.mjs。最新输出 outputs/aliyun-release-20260909-s4accounts/；此前 outputs/aliyun-release-20260909/ 是不带账号的旧包，不再推荐上传。先 stage，再通过 QA.json 门禁 finalize。包含 Linux Node 24.20.0 和生产依赖，无需服务器 npm install。

## 验证记录

- 经济/资源相关 57 项通过：outputs/launch-audit/launch-economy-tests.log。
- 完整 npm test：80 项 pretest 通过；871 项主测试中 870 通过，剩余建造测试只因旧金币预期而失败；修正该断言后同组 4 项全部通过：aliyun-building-final.log。初次其余旧预期均已修正。
- 实际发布暂存包在 WSL Ubuntu 的 Linux Node v24.20.0 下通过：S4 凭据登录、剔除开发资源、新注册、78 次主要 HTTP 请求、完整 33 人选秀、总部领取、实际停启恢复；强制传 CAMPAIGN_DEV_TOOLS=1 仍被 NODE_ENV=production 禁用；开发迷雾 API 返回 403。
- 验证 /versus/ HTML、CSS、JS、模块、地图/球员资源、根路径跳转、私有路径 404；bash -n 安装/备份/只读检查通过。
- 远端 DNS、证书链、Nginx 生效配置、服务器系统/容量未实测，按部署说明在服务器验收。本地测试不等于已上线。

## S4 账号内置更新

用户明确指定使用工作区 S4backup；实际路径为 YDL_backup/ydl-s4-final-20260825-172250/ydl-s4-final-20260825-172250。已核对其 SHA256SUMS.txt 中数据归档校验和，取 archives/football-s4-data-20260825-172250.tar.gz 内 data/versus-accounts.json；共 11 个 scrypt 账号，无重复昵称。

账号来源锁定 deploy/s4-account-source.json。scripts/prepare-s4-account-seed.py 检查归档校验和、成员大小、账号数量，按白名单转换后逐个核对 ID/昵称/密码哈希，输出 seed 和不含凭据的 S4_ACCOUNT_IMPORT.json。密码兼容及资源初始化测试 16 项通过（outputs/launch-audit/aliyun-s4-account-tests.log）。不读取或猜测玩家原密码；兼容性依靠保留原哈希、原算法兼容测试和含空格的已知测试密码实际 HTTP 登录验证。

新包包含密码哈希，仅私下上传到服务器；seed 在静态站点目录之外，tar 内权限 0600，HTTP 访问返回 404。部署说明仅需证书和私钥两个参数。首次安装拒绝覆盖已存在的新服存档，不能当作线上重置工具。

最终新版包已生成：outputs/aliyun-release-20260909-s4accounts/yellowdogs-rougelite-aliyun-x64.tar.gz。Linux v24.20.0 已用内置 11 账号两次启动检查身份/哈希/初始资源不变，并通过已知测试密码 HTTP 登录、33 人建队、总部奖励和重启验收；报告 aliyun-s4-linux-runtime.log。最终归档逐文件校验全部通过，账号文件权限 0600，校验结果 aliyun-s4-archive-verification.json。
