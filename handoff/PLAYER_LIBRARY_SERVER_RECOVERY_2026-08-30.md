# S4 服务器球员库与卡画恢复（2026-08-30）

> 历史恢复快照：本文记录恢复完成时的 377 条注册。随后又修复 9 名晚期 S4 传奇卡画，当前有效注册为 386 条；以 UPDATE_2026-08-31.md 为准。

## 结果

- 正式球员库：723 → 842（新增服务器 DLC4 已发布球员 119 名）
- 基础球员库：723 → 842
- 卡画注册表：245 → 377（恢复服务器 studio 映射 132 条）
- 132 条映射中：90 条属于 DLC4 新球员，42 条属于既有 S4 球员
- DLC4 另有 29 名已发布球员按内容计划不制作卡画，因此服务器 studio 快照中没有头像映射；这是正常内容状态，按原样保留为空，不计入缺图、恢复失败或待修复项
- 132 个哈希 WebP 文件全部存在于 `assets/player-profiles/s4-imported`

## 权威来源

服务器备份：

`YDL_backup/ydl-s4-final-20260825-172250/ydl-s4-final-20260825-172250`

映射和球员记录来自数据压缩包中的：

`data/ydl-player-card-studio.json`

卡画映射保留了 `playerId`、`optimizedFileName`、`sourceFileName`、`contentHash`、`xPercent`、`yPercent`、`widthPercent`。

## 恢复方式

可重复执行：

```powershell
node scripts/recover-s4-player-library.mjs "<studio.json、data 压缩包或服务器备份根目录>"
```

脚本在写入前校验所有映射的球员归属和哈希图片是否存在；重复执行不会重复添加球员。

写入目标：

- `assets/data/s4-player-base-catalog.json`
- `assets/data/s4-player-catalog.json`
- `assets/data/s4-player-profile-registry.json`
- `data/player-library-admin.json`

## 审计结果

- 正式/基础目录数量一致：842 / 842
- 重复 ID：0
- 缺失卡画文件：0
- 孤儿卡画映射：0
- 属性不完整球员：0
- 总评与属性计算不一致：0
- 当前有卡画球员：377，覆盖率 44.8%
- 162 份 `s4-imported` 非哈希图片是现有静态卡画的内容副本，未绑定且未删除

同名审计保留四组记录；它们拥有不同 ID/身份，不应按中文展示名自动合并：阿尔梅达、科克曲、米林科维奇、佩蒂特。

## 验证

- 恢复脚本隔离测试：2 / 2 通过
- 项目 `npm run check`：通过
- 项目自动化测试：74 / 74 通过
- 浏览器测试：按项目约定由用户执行
