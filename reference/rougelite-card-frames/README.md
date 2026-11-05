# Rougelite 球员卡框参考源码

来源为同一远端仓库 `AxeroYF/football_rouge_online` 的 `codex/rougelite` 分支，固定提交：

`0bdeaa8b9d5e900eda205a7c83b3fc8f4e39db0d`（2026-10-09）。

不是 YFFM3，也没有将当前 YFFM1 工作区切换到 Rougelite 分支。

## 文件与真实性

`source/` 保留原目录结构，共 37 个原始文件：盾形 SVG 资源、卡牌渲染与延迟/动效控制器、共享数据契约、相关 CSS，以及原测试和审阅脚本。所有文件在写入前都与远端 Git blob SHA-1 和字节数核对，结果见 `SOURCE-MANIFEST.json`。

这是卡框组件的参考快照，不是完整 Rougelite 游戏。原 `player-card.js` 的共享契约依赖 Rougelite 的引擎特性库；资料窗及原测试还依赖配置、完整球员目录、队徽/国旗和游戏界面，因此不能把这里的全部原测试视为可独立运行的完整套件。

原始快照保持不变。正式适配已放在 YFFM1 的 `versus/public/player-card-shield.js`、`card-identities.js`、`player-card-shield.css`，资源位于 `versus/public/assets/card-frames/shield-v1/`；统一 `s4PlayerCardMarkup()` 已调用适配后的盾形生成器。

## 主要入口

- `source/assets/card-frames/shield-v1/`：S/A/B/C 背景、铭牌、边框；+9/+10 边框及遮罩、传奇高强化背景。
- `source/client/player-card/card-shield-markup.js`：分层卡面生成，无需主游戏即可按卡牌视图数据调用。
- `source/client/player-card/player-card.js`：统一卡牌渲染、交互/静态/延迟变体。
- `source/client/player-card/card-motion-controller.js`：单一 RAF、可见性、减弱动画、位图尺寸控制。
- `source/client/player-card/deferred-card-controller.js`：按可见范围挂载卡面、分批渲染和离屏释放。
- `source/styles/player-card-shield.css`：`26/35` 卡面比例、盾形裁切、人物穿层、信息与强化效果。
- `source/shared/player-card/player-card-contract.js`：只读视图契约；接入时应替换其业务依赖，不导入 Rougelite 的比赛引擎。

接入记录见 `docs/YFFM1-ROUGELITE-CARD-FRAMES.md`。原始参考预览仍由 `scripts/preview-rougelite-card-frames.mjs` 生成到 `outputs/rougelite-card-frames/`；正式游戏的截图与浏览器核验报告在 `outputs/pack-opening-effects/`。
