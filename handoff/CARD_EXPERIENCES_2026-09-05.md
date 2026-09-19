> 已按用户要求回退。本文件仅保留历史记录；当前方案见 [CARD_EFFECTS_ROLLBACK_2026-09-05.md](CARD_EFFECTS_ROLLBACK_2026-09-05.md)。新版卡框、签约舞台和合卡 UI 已撤下。

# 开卡、合卡与球员卡框改版

版本：`20260905-card-experience-v1`。纯前端更新，Ctrl+F5 刷新即可。没有操作浏览器、4370 服务或真实账号存档。

## 已实现

- 背包三选一与球探三选一共用深绿、暖金的签约舞台：舞台环线、柔和聚光、12 枚有限时长光点、逐张展开、选中抬升、其他卡片退场。背包领取后有独立签约完成画面和继续按钮；球探领取后仍返回设施面板。
- 开卡领取请求和选中动画同时开始，点击即锁定重复提交。失败会恢复全部候选；关闭或切换账号后不显示过期结果、不覆盖其他账号状态。可关闭后继续待选卡包。
- 强化台重新设计灯光、槽位、成功率、金色圆形操作按钮、能量汇入和结果揭示。高级强化使用同一舞台语言，继续支持特性三选一、保卡、批量合卡、结果双击/拖回。增加结果卡 Enter/空格归仓。
- 槽位根据容器宽度预留固定高度，空、已放卡、合成中和结果状态不改变尺寸；结果提示始终预留空间。历史列表保持最新 50 条和独立滚动。已有结果在其他控件更新时不会重复播放揭示动画。
- S 暖金、A 翡翠绿、B 烟紫、C 银灰，采用新的矢量切角外框和分级饰线。X 保留单独的冰蓝识别。强化等级使用独立徽标，不覆盖评级颜色。
- 全部头像仍按完整 4:5 卡片的 `--profile-x/y/width` 定位；不改素材、目录数据或编辑器定位预设。文字和评级显示在头像上方。无头像球员使用矢量球衣剪影；目录当前 842 人中 386 人有头像，C 档当前均未配置头像。
- 常驻卡框不循环播放光效；舞台背景只在进入时播放有限动画。仅提交中的小范围扫描循环，退出状态即停止；揭幕和融合延迟遵循减少动态效果设置。三张候选头像使用 eager，仓库继续 lazy。
- 窄屏三选一采用原生横向滑动与滚动吸附，保持卡片和姓名可读；强化台按双列换行。

## 主要入口

- `client/player-card/player-card.js` / `card-frame.js`、`styles/player-card.css`：统一卡框和头像布局。
- `client/ui/card-stage.js` / `meteor-background.js`：公共舞台标题、序号、光效与动作延迟。
- `client/inventory/inventory-controller.js`、`client/buildings/scouting-controller.js`：开卡与球探三选一。
- `client/enhancement/enhancement-controller.js`：强化动作、固定结果与高级庆祝。
- `styles/card-experiences.css`：最后加载的本轮舞台及强化视觉层。基础小窗/历史/批量窗口仍使用已有组件规则。
- 已同步玩家、训练、搜索、建队及后台共享 renderer 的缓存版本，避免旧 markup 混用新 CSS。

## 备份与回退

用户本轮明确要求先备份，因此在修改之前保存了 **152 文件 / 1,348,228 字节**；每个文件复制后及收尾时均通过 SHA-256 校验：

`YDL_backup/card-experiences-before-20260905/manifest.json`

备份包括源文件、样式和既有测试，没有真实存档。现有源文件变更清单见 `outputs/card-experience-review/changed-files.json`；交接文档在最后更新。要回退本次改版，先保留后续新修改，再从备份取回本轮涉及的源文件及入口引用，不要直接覆盖整个 152 文件备份中的无关内容。

本轮新增文件（回退入口后可留作历史参考，不再被加载）：

- `client/player-card/card-frame.js`
- `client/ui/card-stage.js`
- `styles/card-experiences.css`
- `scripts/review-card-experiences.mjs`
- `scripts/check-card-experiences.py`
- 本交接文档及 `outputs/card-experience-review/` 离线产物。

本次特定备份不改变此前“常规开发不再每轮备份”的约定。`?ui=legacy` 只切换旧统一主题层，不能回退这次卡框与舞台；本次回退以文件备份为准。

## 验证与局限

- `npm run check`：57 + 287 + 69 = **413 项通过**。
- 最后等待提示和资源入口调整后，开卡 10 项、相关页面集成 59 项再次通过。
- 新增开卡并发/动画同步、失败恢复、关闭、跨账号回归。全部 842 名球员 × 5 个卡片 variant 保持定位参数和单头像节点。
- 离线真实组件的 360 / 560 / 1366 / 1920 / 2560 宽度级联检查通过：每档 31 张卡的比例/定位/层级、固定槽位、历史独立滚动、减少动画时特性卡可见。CSS 语法检查通过。
- `outputs/card-experience-review/components.html` 可离线手动查看实际 CSS/markup 样例，包含三选一、合卡演示与不同尺寸卡框。它不连接游戏 API。
- `frames-contact-sheet.png` 使用实际球员图片、保存坐标和新 SVG 渲染的 Canvas 拼图，只用于检查裁切和配色，**不是浏览器布局截图**。
- 遵守用户持续约定，浏览器、服务启停和实际动画帧率由用户验收。本轮没有做实机 FPS 测量。

复现离线检查：先运行 `node scripts/review-card-experiences.mjs`（Canvas 拼图需要 `CODEX_NODE_MODULES` 指向包含 `@napi-rs/canvas` 的工具运行时），再运行 `python scripts/check-card-experiences.py`。工具依赖不加入游戏运行时。
