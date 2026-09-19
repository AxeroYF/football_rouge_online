# 后台指定球员发放 · 2026-09-05

- 后台“玩家运营 → 球员发放”新增独立入口，搜索球队名称/昵称/账号 ID，搜索球员中文/英文名、俱乐部或目录 ID；填写数量、强化等级、原因并预览卡牌。只向选中的一个已建队账号发放。
- GET /api/admin/player-grants：经过管理员认证返回安全球队摘要、已上线球员目录和发放限制。POST 同路径：{accountId,playerId,count,upgradeLevel,reason,requestId}。
- 仅 operator/superadmin 可发放。数量为 1～999 整数，等级为 +0～+8 整数；拒绝未建队、未知球队、未知/暂存球员、错误范围和类型。
- 用独立 UUID 创建每张卡，保留 cardDefinitionId 供同名强化识别。复用 EnhancementService.applyLevel 应用完整 S4 能力曲线；高强化卡生成待绑定特性，+7/+8 绑定第一个后继续选择第二个。
- 新卡 acquisitionSource=admin、加入留守，保留原有球员、训练任务及保存的战术/首发。不扣金币、不消耗卡包。
- 通过现有账号事务保存并在保存失败时回滚；account.adminPlayerGrants 持久化请求签名和结果，重试不重复发卡。前端正在提交时锁定再次提交，不确定失败复用 requestId。审计 action=player.card.grant，包含接收账号、球员、数量、强化等级、原因和实例 ID。
- 文件：server/application/admin-service.mjs、server/http/admin-api-handler.mjs、admin-v2.js/html/css。后台缓存版本 20260905-player-grants-v1。
- 验证：后台服务/API/UI 及强化服务专项 23/23；JS 语法、后台 CSS 递归解析通过。日志 .admin-player-grants-check.log。
- 没有修改真实账号，没有操作浏览器，没有启停服务。新增后端接口需要用户重启 4370 服务并刷新后台后使用，视觉待用户验收。
