# GitHub 整理 · 2026-09-27

整理 R11 基线之后至 R39 的累计源码、测试、发布清单、Android v4、Windows 0.1.5 与本地交接。目标公开仓库 AxeroYF/football_rouge_online，分支 codex/rougelite。

账号存档、seed、缓存、安装器、热更新压缩包、密钥与一次性本机诊断均不入库。没有修改历史发布包，也没有部署服务器。GitHub 连接器创建 PR 返回 403，随后使用本机已有 Git 凭据调用 GitHub API 成功创建，凭据未落盘。

## 验证

- npm run check 通过：83 + 1177 + 161 项，共 1421 项（不同批次有少量重叠，不等于独立场景数）。
- Windows 客户端 16 项缓存/清单测试通过。
- 发布链检查通过，264 个浏览器模块、335 条内容版本映射检查通过。
- 主提交包含 501 个文件（含历史交接归档）；未发现令牌/私钥模式，未包含存档、seed、outputs、安装包或私钥路径。
- Git 暂存内容逐文件匹配 R39 全部 1233 个发布文件，无缺失、无字节差异。
- 保留原始运行文件字节，避免改变已发布包哈希；只清理八个辅助脚本末尾空行。
- 本次没有再次跑 90 场赛季或线上压测；此前 R35/R39 与客户端验证保留在历史报告。

## GitHub

2026-09-27 自动审批首次要求明确公开发布范围；用户随后明确回复“允许公开推送并创建 PR”，授权将已审查的 501 个文件推送至 AxeroYF/football_rouge_online 的 codex/rougelite 并创建 PR。已完成公开推送和 PR 创建；未合并 main，未部署服务器。

- 主提交：`d70e359` — `feat: consolidate R39 league releases and desktop 0.1.5`。
- 远端分支：`codex/rougelite`，以普通推送更新，无强推。
- PR：[整合 R39 每日联赛、性能修复及 Windows 0.1.5 #2](https://github.com/AxeroYF/football_rouge_online/pull/2)，目标 `main`，当前待审查。
- 初次直连 GitHub 超时；使用本机已配置代理的单次 Git 参数完成推送，没有修改全局代理配置。
- 后续文档提交回填本次结果，不修改运行代码及已交付包。
