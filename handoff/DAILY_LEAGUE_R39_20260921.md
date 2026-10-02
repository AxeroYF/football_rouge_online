# R39 联赛主场门票修复 · 2026-09-21

根因：联赛票房只查总部地块的 main-stadium，而正式比赛场地从全部己方领地查找已启用球场。用户确认 AuI 的体育场和总部不在同一地块，匹配该缺陷。

修复：直接使用 sponsorMatchVenue 返回的 seatingCapacity，保证票房和实际比赛场地一致；保持 50% 球迷需求、容量上限、0.1 金币单价及伯纳乌加成。总部失守后不再误用敌方球场。升级中的已启用球场仍按当前已完成等级计算。

效果从更新后新开赛的比赛生效。已经开赛的票房在开赛时锁定，已结算比赛不自动补发：旧数据未保存准确的开赛球迷数，不能用当前值反推欠款。若需补偿须另核对历史数据。不会重置当前联赛、比分或奖励。

验证：两个回归场景修复前均失败，修复后通过；联赛、赞助和奇观共 71 项测试通过。模拟总部外球场、10000 球迷，正确得到 5000 观众和 500 金币。R37、R38 安装与回滚通过。未操作线上账号或存档。

本包以 R37 为基线，包含 R38 AI 标志，支持 R37/R38 升级；无需更新 Windows 客户端。0.1.5 客户端启动修复为此前独立交付，详情见 WINDOWS_CLIENT_015_STARTUP_FIX_20260921.md。

## 一行部署

上传 tar.gz 与同名 .sha256 至 /home/admin 后执行：

```bash
cd /home/admin && sha256sum -c yellowdogs-hot-update-20260921-r39.tar.gz.sha256 && tar -xzf yellowdogs-hot-update-20260921-r39.tar.gz && cd yellowdogs-hot-update-20260921-r39 && sudo bash update.sh --check && sudo bash update.sh apply
```

看到 Installed: 20260921-r39 后刷新游戏。保留更新器生成的代码/存档匹配备份。
