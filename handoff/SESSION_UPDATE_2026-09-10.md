# 对话交接更新 · 2026-09-10

## 当前结论

主版本已由用户手动部署到阿里云，并反馈运行正常。本轮手机横屏网页优化已在本地完成、验证并打包；尚无用户确认上传该补丁的消息。安卓开发按用户最后指令暂停。

本次 9 月 10 日操作仅更新交接文档和文档压缩包，不改游戏源码、不操作服务器、不重新运行游戏测试。以下测试结果引用上一轮已保存的报告，已核对报告与补丁校验和。

## 当前工作树与阅读顺序

- 工作树：`D:\Project\game_test\.worktrees\Rougelite`
- 分支：`codex/rougelite`，HEAD：`66ce9f6`；大量成果未提交，以当前工作树为准，不要重置、清理或用主仓库覆盖。
- 接续阅读：本文件 → [CURRENT_STATE.md](CURRENT_STATE.md) → [横屏修复详情](MOBILE_LANDSCAPE_FIX_2026-09-09.md)。
- 前序 [横屏审计](MOBILE_LANDSCAPE_AUDIT_2026-09-09.md) 是修复前状态，不表示问题仍未处理。

## 本轮已完成

1. 780×360 / 740×320 CSS 像素横屏适配，顶栏 44px，移除全局 560px 最低高度造成的裁切。
2. 顶部功能收进菜单；玩家、通知和地图工具默认折叠，展开互斥。
3. 窗口激活/恢复焦点使用 preventScroll，避免顶栏消失和地图整体偏移；短屏内容在窗口内部滚动。
4. 战术区分阵容、站位与羁绊、比赛战术，支持全场预览/放大编辑，复用原保存与方案逻辑。
5. 登录、编队筛选、商店、豪门、玩家互动、设施、三选一与获得卡片等短屏调整。

变更文件：`index.html`、`styles/mobile-landscape.css`、`client/ui/mobile-landscape.js`、`client/ui/stage-window-manager.js`、`client/ui/small-window.js`。

验证：隔离浏览器 38 个页面/交互状态，pageerror 为 0；780×360、740×320，DPR 3、触屏模拟，另有 1440×900 桌面对照；22 项相关测试通过。实测菜单点击、通知接受后的服务端友谊关系、未拥有球员的三选一领取、战术分区/领先方案切换、筛选开合、返回地图、登录按钮可见。报告与截图在 `outputs/mobile-landscape-fix-20260909/`，测试脚本为 `scripts/review-mobile-landscape.mjs`。

这些不等于真实手机验收：后续重点看手势拖动/双指缩放、输入法遮挡、浏览器高度变化、长名单/复杂状态和 WebGL 性能；未覆盖每一种交易及比赛状态。测试账号的混合阵容不是正式合理阵型示例。

## 更新包与服务器

- 正式地址：`https://yellowdogsleague.online/versus/`
- 公网 IP：`8.210.0.104`；私网：`172.17.12.224`。
- 用户使用 admin 及 `/home/admin/ydl-upload` 手动上传；不用 SSH 自动部署。
- 安装目录：`/opt/yellowdogs-rougelite/app`；服务：`yellowdogs-rougelite`。
- 存档：`/var/lib/yellowdogs-rougelite`；环境文件：`/etc/yellowdogs-rougelite.env`。不要把配置内容或账号秘密复制进交接包。
- 网页补丁：`outputs/mobile-landscape-release-20260909/yellowdogs-mobile-ui-20260909.tar.gz`，旁边有 `.sha256`。
- 上传说明：`outputs/mobile-landscape-release-20260909/yellowdogs-mobile-ui-20260909/README.md`。
- 补丁仅含五个前端文件及校验、备份安装脚本和说明；无需重启服务、不重导账号、不重新发资源。手动上传、校验、解压后 `sudo bash apply-ui.sh`，刷新浏览器。
- 正式主版本的安装已由用户完成；旧文档中的“未执行远端部署”指当时代理没有执行，不能误读成游戏仍未上线。

补丁 SHA-256：`475117fab8e9626bb6a48b95ac50a2bed273980f1bb155799beea8c27282ea82`。

## 用户已确定的约束

- 安卓客户端继续暂停，优先修网页；不要擅自装 APK、操作手机或恢复安卓构建。
- 手机以横屏为主，登录也横屏；Chrome 模拟使用 CSS 视口，截图中的 200% 是预览缩放，不是手机 CSS 分辨率。
- 正式版取消开发迷雾开关；每日普通征服基数 8；不要恢复开发资源数量。
- S4 账号沿用工作区 S4backup 的账号密码，游戏进度重新开始；已上线后不可因 UI 更新再次导入/重置。
- 已落地开服资源见 [阿里云交接](ALIYUN_LAUNCH_2026-09-09.md)，不要把测试截图中高额金币/球迷当作正式初始资源。

## 下一步

等待用户真实手机浏览器反馈。根据具体页面、视口和复现操作继续修复网页；若反馈仍是旧布局，先确认是否已上传横屏补丁并刷新。不要因为进入新对话而重复开服、清理服务器或重新制作安卓包。
