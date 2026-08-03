# 特性绑定、后台发卡与 V2 复盘合并热修

SHA256：`5418C07DB94B129BB0138C182B63042CC000F64124843003D57DD2C8C95F6EF1`

## 包含修复

- `+4/+7` 强化特性绑定使用轻量响应，前端局部合并卡片结果。
- 移除特性选择的 620ms 人为等待，庆祝动画节点从 128 降至 48。
- 后台指定球员卡发放使用轻量响应，不再生成完整 `adminView()`。
- V2 新比赛阶段快照保存真实结构、位置与战术适配指标。
- 已完成的旧 V2 比赛在读取详情时回填复盘指标，无需重算或写回存档。

## 生产文件

- `admin/public/app.js`
- `versus/admin-api.js`
- `versus/api.js`
- `versus/league-service.js`
- `versus/public/app.js`
- `versus/history-detail.js`
- `versus/public/v2-tactical-fit.js`
- `versus/v2/match-engine-v2.js`

部署时只覆盖代码文件，不迁移、不删除、不覆盖 `data` 或现有分片目录。
