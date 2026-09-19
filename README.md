# 黄狗风云 · Rougelite

基于 S4 V2.1 比赛引擎的联机足球战略游戏，包含欧洲与南美洲地图、俱乐部经营、球员培养、外交战争、联军与豪门远征活动。

## 当前基线

- 最新已发布热更新：**20260918-r11**，其服务器前置版本是 **20260918-r10**。
- 用户最后确认部署：**R10**。R11 已交付，尚未收到部署确认；GitHub 合并不等于服务器部署。
- 本次 Git 整理基于 R11，另将真实玩家扣除清单从源码提取为私有运行配置。已有 R9/R10/R11 压缩包保持原样。
- 发布链、逐文件哈希和包校验值统一在 [releases/](releases/README.md)；当前工作说明在 [handoff/](handoff/README.md)。

## 本地运行

使用 Node.js 22 或更新版本（当前验证为 Node.js 22.17），安装依赖并启动：

```sh
npm ci
npm run dev
```

游戏：http://127.0.0.1:4370/versus/ 。后台：http://127.0.0.1:4370/admin 。
`HOST`、`PORT`、`DATA_DIR`、`ADMIN_BOOTSTRAP_PASSWORD` 通过环境变量传入。生产环境必须设置至少 16 字符的管理员初始密码，详见 [部署说明](deploy/DEPLOY_ALIYUN.md)。

运行存档在 `data/`，不进入 Git。默认地图所需地形高度数据、模型和球员目录已纳入源码；本地卡画/肖像库和可选高分辨率地形贴图不在 Git 中，完整美术效果需要从自己的素材备份恢复，缺图使用现有占位图。已有服务器更新必须使用增量包，不能用新检出目录覆盖整个数据目录。

## 检查与打包

```sh
npm run check
node --test test/map-loading.test.js test/elite-raids.test.js test/airport-service.test.js test/downtime-recovery-apply.test.js test/server-economy-clock.test.js
node scripts/check-release-baseline.mjs
python scripts/build-browser-module-versions.py --check
```

后续增量包可直接读取 `releases/<版本>/BASELINE.json`，不再依赖开发机器上的历史 `outputs/`。明确服务器已安装的版本后再选择基线，详见 [发布流程](releases/README.md)。

## 目录

- `client/`、`styles/`：地图、球队、战术及管理界面。
- `server/`、`campaign-service.mjs`：权威状态、经济、外交、活动与持久化。
- `shared/`：前后端共用规则；`engine/s4-v2.1/`：比赛引擎。
- `assets/`：可版本化素材；`scripts/`、`test/`：构建、排查及测试。
- `deploy/`：部署与备份工具；`releases/`：不可变发布记录；`handoff/`：当前状态及历史专题。

运行存档、账号种子、私钥、真实玩家迁移清单和审计报告不会随仓库提交。历史 R10 收益回收的公开源码默认不包含任何玩家，私有配置说明见 [运行数据边界](deploy/PRIVATE_RUNTIME_DATA.md)。

地图边界来源：Natural Earth；地图交互：Leaflet 1.9.4 / Three.js；俱乐部徽章沿用项目 S4 素材。Android 客户端仍处于暂停阶段。

公开源码已移除历史开发管理员密码及页面密码提示。本地开发默认值为 `local-dev-admin`，生产环境仍必须通过 `ADMIN_BOOTSTRAP_PASSWORD` 配置；这属于 R11 之后的源码整理，不改变已发布热更新包。
