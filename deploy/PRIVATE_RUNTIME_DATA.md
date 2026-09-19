# 私有运行数据

公开仓库不包含 `data/`、`seed/`、存档备份、账号导入种子、密码/私钥、真实玩家扣除清单和审计原件。

## 历史 R10 收益回收

原始 R10 包包含经用户批准的一次性名单，已发布包保持原样。源码整理版改为读取：

- 默认：`${DATA_DIR}/downtime-recovery-plan.json`，未设置 DATA_DIR 时使用项目 `data/`。
- 显式指定：环境变量 `DOWNTIME_RECOVERY_PLAN_PATH`。

默认文件不存在时，名单为空，不执行扣除。显式指定的文件不存在或内容不合法时直接报错，避免悄悄忽略管理员配置。使用已经批准的 JSON 清单，结构为 `{planId, players:[{accountId, teamName, proposed:{gold,oil,fans}}], ...}`，计划 ID 必须保持 `downtime-20260914-20260918-half-v1`。

世界及账号的旧执行回执继续阻止重复扣除。已经完成 R10 回收的服务器不需要再次上传或执行清单；禁止按当前余额重算、修改计划 ID 后重新执行。真实清单仅存于运维备份或 data 目录，不要加入 Git。

本地整理已将原始清单保留到被忽略的 `data/downtime-recovery-plan.json`。公开测试使用完全虚构的账号标识。

## 其他资源

`assets/player-profiles/` 和常规卡包美术为外部素材输入；18 张已发布的 `assets/player-packs/elite-*.webp` 豪门礼包封面纳入源码；可选高分辨率地形图像也不入库。默认地图所需的三份高度二进制已入库，以保证基本渲染能随源码复现。

生产管理员密码通过环境变量提供。`scripts/review-live-map-state.mjs` 是本机运维诊断，不属于公开测试，不提交；可复用的测试只使用隔离账号与内存/临时存档。

开发环境默认管理员密码为 `local-dev-admin`。正式服务器继续使用已有环境变量，不要将开发默认值用于生产。旧历史提交未重写；当前源码和页面已移除历史密码。
