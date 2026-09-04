# Handoff Manifest

更新时间：2026-09-03

## 当前核心文件

- `README.md`：入口、阅读顺序和权威结论。
- `UPDATE_2026-09-03.md`：深浅海、细节地形、P0/P1 地图性能优化与验证结果。
- `MAP_RELIEF_EXPANSION_PLAN_2026-09-03.md`：南美洲与斯瓦尔巴地形坐标、资源生成及运行时接入记录。
- `UPDATE_2026-09-02.md`：本轮产品与实现变化。
- `CURRENT_STATE.md`：当前运行、架构、约束和测试基线。
- `NEW_CHAT_PROMPT.md`：下一对话启动提示。
- `CHANGED_FILES.txt`：工作区变更范围。
- `PACKAGE_CONTENTS_2026-09-02.md`：压缩包包含/排除规则。

## 历史参考文件

- `UPDATE_2026-08-28.md`
- `UPDATE_2026-08-29.md`
- `UPDATE_2026-08-31.md`
- `ROADMAP_2026-08-31.md`
- `ROADMAP_ADMIN_2026-08-29.md`
- `REFACTOR_2026-08-29.md`
- `PLAYER_LIBRARY_ADMIN_2026-08-30.md`
- `PLAYER_LIBRARY_SERVER_RECOVERY_2026-08-30.md`
- `TEAM_PLAYER_DETAIL_26_ATTRIBUTES_2026-08-30.md`
- `YDL_PLAYER_LIBRARY_UNIFICATION_2026-08-30.md`
- 各日期的 `PACKAGE_CONTENTS` 与 `README_UPDATE.md`

历史文档用于追溯，不应覆盖 2026-09-03 与 2026-09-02 文档中的最新结论。

## 工作区外部事实

- 分支：`codex/rougelite`
- HEAD：`ef67992`
- 当前源码状态：未提交改动较多。
- 最近验证：`npm run check` 通过，预检 47 项、主测试 133 项。
- 浏览器测试：由用户执行。

## 归档规则

新 zip 只打包本目录中的 `.md` 和 `.txt` 文件，排除所有 `.zip` 和 `.sha256`，也不复制项目源码或任何图片资源。
