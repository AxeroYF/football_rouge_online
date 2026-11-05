# Rougelite 开包效果参考源码

来源：同仓库 `AxeroYF/football_rouge_online` 的 `codex/rougelite` 分支，固定提交 `0bdeaa8b9d5e900eda205a7c83b3fc8f4e39db0d`（2026-10-09）。

`source/` 原样保存六个文件：背包控制器、流星背景、背包 CSS、选秀图片就绪控制器、选秀 CSS，以及取消矩形光效的交接说明。文件字节数和 Git blob SHA-1 见 `SOURCE-MANIFEST.json`；可据此与远端核对。这是效果参考快照，其原控制器依赖完整 Rougelite 应用，不能直接作为独立游戏运行。

YFFM1 的适配代码位于 `versus/public/pack-opening.js`、`pack-opening.css` 和 `app.js`，`pack-opening-meteors.js` 与原流星模块内容一致。保留原入场、选中、其他候选淡出和直接获卡动画的关键帧与时长，并采用原地确认和连续开包复用舞台的方式。

按用户要求，**卡包包装外观不变**，源码未包含的四张通用卡包 PNG 不再作为接入依赖。本快照负责开包效果，不导入 Rougelite 的礼包目录、等级权重或经济配置；球员盾形卡框及配色另由 `reference/rougelite-card-frames/` 的原始资源接入。

适配范围及验证见 [接入记录](../../docs/YFFM1-PACK-OPENING.md)。
