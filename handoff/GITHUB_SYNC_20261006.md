# R50–R51 Git 管理与交接 · 2026-10-06

## 已推送源码

仓库：https://github.com/AxeroYF/football_rouge_online.git ，分支 `codex/rougelite`。
上次基线：`194e835ac851a3bb5a65ca04e2c49800eda4bae8`。
本次源码提交：`37591c4304cca35159b24ab2fe595b5b9b4ec83c`，标题 `feat: archive deployed R50-R51 enhancement and shop updates`。源码已推送，交接文件另作后续文档提交。

包含 +10 强化和四特性、+9／+10 审阅卡框及传奇动效兼容、对应交易和研究筛选、两小时商店轮换、测试与发布记录。未合并 main，未重新部署服务器；账号、私有卡画、输出包与运行数据未进入 Git。

用户确认部署原版 R51。fix1 暂停并撤回，试改和测试副本留在本地 outputs，发布元数据保存在 releases/withdrawn。正式运行文件与原版 R51 精确匹配，差异／缺失均为 0。

## 验证

- 156 项相关测试通过，381 个运行模块语法检查通过。
- 发布链、1299 个运行文件和原 R50／R51 压缩包哈希校验通过。
- 298 个模块版本、369 个 import 映射，222 个启动模块和 52 个样式生成检查通过。
- 冻结的 R50／R51 QA 保存当时完整验证范围；本轮未重新执行完整测试集。

## 交接包

`handoff/yellowdogs-rougelite-handoff-20261006-r51.zip`，附同名 `.sha256`。包内为 handoff 文档、发布记录、构建器说明、SOURCE_REVISION.txt 和逐文件 SHA256SUMS，不含运行代码或生产存档。源码版本指向上述已推送提交，交接文档为其后的本次整理快照。

独立请求：AxeroYF/YFFM3 已从 Private 改为 Public 并复核；未变更第三部作品源码。
