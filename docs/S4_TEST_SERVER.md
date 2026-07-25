# S4 测试服

S4 开发使用独立 Git worktree 和独立运行数据。不要直接在正式服目录中开发前端，因为服务会实时读取静态文件。

## 隔离边界

| 项目 | 正式服 | S4 测试服 |
|---|---|---|
| 源码目录 | `D:\Project\game_test` | `D:\Project\game_test_s4` |
| Git 分支 | `codex/versus-baseline-20260723` | `codex/s4-card-upgrade` |
| 本地端口 | `4318` | `4328` |
| 账号数据 | `data/versus-accounts.json` | `data/s4-test/versus-accounts.json` |
| 联赛数据 | `data/yellowdogs-league.json` | `data/s4-test/yellowdogs-league.json` |
| 启动命令 | `npm run tunnel` | `npm run test-tunnel` |

测试服不会读取或写入正式账号、球队、金币、背包、市场、比赛和联赛进度。测试服需要重新注册测试账号。

## 首次建立开发目录

先提交测试服基础设施，再从该提交建立 S4 worktree：

```powershell
cd D:\Project\game_test
git add .gitignore package.json devtool/server.js devtool/test-environment.js devtool/test-server.js devtool/test-tunnel.js versus/public/app.js versus/public/styles.css admin/public/app.js docs/S4_TEST_SERVER.md
git commit -m "chore: add isolated S4 test server"
git worktree add D:\Project\game_test_s4 -b codex/s4-card-upgrade HEAD
```

## 日常启动

正式服继续在原目录运行：

```powershell
cd D:\Project\game_test
npm run tunnel
```

测试服在 S4 worktree 中运行：

```powershell
cd D:\Project\game_test_s4
npm run test-tunnel
```

只在本机验证时运行 `npm run test-server`，访问 `http://127.0.0.1:4328/versus/`。测试服页面会显示 `S4 测试服` 标记。

## 上线流程

1. 所有合卡开发提交到 `codex/s4-card-upgrade`。
2. 在测试服完成自动测试、多人流程和经济数据验证。
3. 停止正式服 tunnel，并备份正式账号与联赛数据。
4. 将通过验证的 S4 分支合并到正式分支。
5. 重启正式服并进行健康检查；不要复制 `data/s4-test/` 中的测试数据。
