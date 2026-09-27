# R31 安装器修正版

游戏负载与原 R31 的 16 个文件完全相同，基于 R30 升级。仅修正部署检查，不是 R32。

原安装器在旧服务在线时 readFileSync 哈希文件，并完整 JSON.parse 大存档，增加并行内存压力；没有进度显示。修正版使用 256KiB 共用缓冲，显示阶段和每100文件进度。--check 仅验证更新包、基线、依赖和存档文件存在且非空；完整 JSON 语法验证在 apply 停止服务后由独立进程执行，进程退出才备份、替换和启动游戏，避免验证内存与新服务启动叠加。JSON 失败不替换代码并尝试重启原服务。systemctl show/start 等限时15秒，stop限时60秒。原子备份与健康失败自动回滚保持。

9项安装器/健康测试及完整R30升级、重试、损坏拒绝、显式/自动回滚演练通过；服务钩子隔离模拟，没有在远端执行。未证实用户卡住的具体系统调用，已消除确定的内存风险并补充定位进度。

先 Ctrl+C 中断旧的 --check（只读检查不修改存档或代码）。上传本修正版 tar.gz 和 .sha256 到 /home/admin，然后逐行执行，任何一步失败都停止：

```bash
cd /home/admin
sha256sum -c yellowdogs-hot-update-20260920-r31-installer-fix.tar.gz.sha256
tar -xzf yellowdogs-hot-update-20260920-r31-installer-fix.tar.gz
cd yellowdogs-hot-update-20260920-r31-installer-fix
sudo bash update.sh --check
sudo bash update.sh apply
```

成功仍显示 Installed: 20260920-r31。无需先手动停止服务，apply 会控制停止、校验、备份和启动。若仍停住，保留最后一行进度用于定位，不要重复开启多个安装器。

R31游戏修复及首次旧存档解析内存边界见 GAME_R31.md。旧版本回退必须使用更新器恢复匹配的代码和存档。
