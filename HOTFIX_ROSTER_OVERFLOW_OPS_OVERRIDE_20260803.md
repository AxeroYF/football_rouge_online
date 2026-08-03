# YDL S4 roster overflow ops-override hotfix

## 根因

- 生产分片 977 的 `ydl-team-1` 有 48 个活动球员家族，按静态评级占用 36/33 名单名额，启动严格断言崩溃（systemd 重启循环）。
- 运营评级覆盖（`data/ydl-content-overrides.json`，63 条）把 40 名退役/FC26 名宿从 A/B 升级为 S（传奇），他们本不应占名单名额；覆盖只在 admin/devtool 路径生效，游戏进程启动时联赛单例先于覆盖加载完成构造，名单校验使用了静态评级。
- 附加问题：被升级为传奇的球员若已登记唯一所有权，启动断言会抛“传奇球员不能登记唯一所有权”。

## 改动

1. `devtool/server.js`：在 `api.js`/`league-service.js` 之前同步加载 `versus/ydl-content-store.js`，保证运营覆盖先于联赛单例构造生效。
2. `versus/ydl-content-store.js`：初始覆盖加载改为同步（`readFileSync`），消除顶层 `await` 导致兄弟模块先求值的竞态。
3. `versus/s4-assets.js`：`ensureS4Assets` 加载既有状态时自动清除“已被判为传奇但登记了唯一所有权”的失效登记并写日志；卡片、名单、钱包、比赛数据不受影响。保留启动超限容忍与详细诊断。
4. `data/ydl-content-overrides.json`：完整运营覆盖（63 条，其中 40 条 A/B→S），与运营名单工作簿一致。

## 部署后行为

- 覆盖先于名单校验生效：S 由 27 增至 67（含 DLC2 3 人），`ydl-team-1` 占用由 36/33 降至 ≤33/33。
- 首次启动会清除传奇球员的失效所有权登记并输出日志。
- 写入保护保持严格：`save()` 仍执行 33 人上限断言。
- 本包取代 `football-ydl-s4-roster-overflow-startup-hotfix-20260803-1053.tar.gz`，不要叠加部署旧包。

## 备份与部署

见包内 `DEPLOY.md`（停服 → 备份 `data`/`versus`/`devtool` → 解包 → `node --check` → 核对覆盖文件 → 启动 → 看日志）。
