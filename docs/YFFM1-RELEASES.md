# YFFM1 版本管理

## 当前版本

| 对象 | 值 |
| --- | --- |
| 项目 | YFFM1 0.3.0 |
| 开发及发布源码分支 | `codex/yffm1` |
| 版本标签 | `yffm1-v0.3.0`（annotated tag） |
| 开发基线 | S4 final，`887df1930e219f5b46f1e28c4e5853c9cd92b264` |
| 比赛引擎 | `3.0.0` / `v3.0-tactical-control.1` |
| 分片格式 | schema 2，兼容读取 schema 1 |
| 日期 | 2026-11-05 |

仓库的 `main` / `codex/rougelite` 属于另一游戏线。YFFM1 在自己的分支开发，更新不合并或覆盖那两条分支。

项目版本跟随 `package.json` 与根 `package-lock.json` 同步更新。版本标签使用 `yffm1-vMAJOR.MINOR.PATCH`，避免与同仓库其他游戏的标签混淆。项目版本与比赛引擎、存储格式版本各自管理。

0.3.0 将当前重置、引擎、界面和存储改动整理为首个 YFFM1 版本。此版本以前的本地开发过程未逐步提交，不补造历史提交或中间版本。

## 后续发布

1. 在 `codex/yffm1` 提交功能或修复，每个提交说明具体问题和结果。
2. 更新项目版本、锁文件根版本和 `CHANGELOG.md`，说明格式变更及迁移条件。
3. 执行相关测试和源码语法检查，保留验证范围。存储回归可用 `npm run test:storage`，或直接执行 README/P1 文档中的 Node 命令。
4. 发布提交以 `release:` 开头，推送至 `codex/yffm1` 后，由 GitHub Actions 在四组检查全部通过后创建带说明的 `yffm1-v...` 标签；普通提交不自动打标签。不用强制推送，不修改已经发布的标签。
5. 检查 GitHub 上的分支和标签均指向预期提交。发布到服务器另行处理。

## 获取指定版本

```sh
git fetch origin
git switch codex/yffm1
git pull --ff-only origin codex/yffm1
```

查看固定版本可执行 `git switch --detach yffm1-v0.3.0`。该操作仅切换源码，不能替代存档恢复。

## 存档与回滚

本地账户、分片、备份、`.env`、测试临时目录、输出文件不纳入版本库。升级前保留可恢复的数据副本；分片备份必须同时包含 manifest 和它引用的文件。

从 schema 2 回到旧程序，需停服恢复对应 schema 1 数据副本。迁移后的交易与比赛不能自动回灌至旧恢复点。详细转换与恢复操作见 [P1 存储记录](YFFM1-STORAGE-P1.md)。
