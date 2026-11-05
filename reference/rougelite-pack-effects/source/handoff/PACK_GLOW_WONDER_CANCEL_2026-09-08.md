# 获卡光效修复与奇观中止 · 2026-09-08

## 获卡方框

用户指出开包后单张球员卡外有不合理的黑色方框。通过实际领取贝克汉姆、暂停获卡动画到 45% 验证：外层和卡片背景本身透明，但 inventory-acquired-card 的关键帧 box-shadow 生成矩形光晕并挖空矩形内部，因此出现硬边方框。

styles/inventory.css 将 45% 关键帧的 box-shadow:0 0 70px 改为 filter 中的 drop-shadow(0 0 35px rgba(223,184,91,.38))，保留亮度、缩放与流星背景，光晕跟随卡片 alpha。没有编辑任何卡片素材。index.html 更新 inventory.css 缓存 20260908-card-glow-v1。

scripts/review-pack-reveal.mjs：临时账号真实选择卡片，10 项浏览器检查通过，覆盖透明容器／卡片、动画 0/200/472.5/600/1050ms 无矩形阴影、轮廓光效及手机宽度。已查看中段截图，证据 outputs/pack-reveal-20260908/。

## 奇观中止建造

用户要求奇观建造可主动中止，生产力不返还。

- 地块建筑列表自己的在建奇观增加“中止建造”。点击展开“中止后，已投入的生产力不返还。”以及“继续建造”“确认中止”。确认内容与键盘焦点跨 1 秒重绘和状态同步保留；切换地块清除确认。
- POST /api/campaign/wonders/cancel，body 为 territoryId 和 buildingId，按现有 bearer 认证，服务端再次要求自有领地和真实的在建奇观。
- WonderService.cancel 先结算到当前时刻，再检查状态，避免已经完工的奇观被当作施工删除。清除目标项目、释放槽位和同种奇观占用、更新领地版本与世界版本；投入 work 直接丢弃，refundProduction 恒为 0，其他项目历史 work 不变，之后重新分配产能。
- 重复请求对已不存在的 id 返回 404，不会删掉重新开工的新项目；对手领地 403，普通设施／已完成奇观 409。保存异常回滚目标领地与版本。
- UI 同步地图、建筑面板、资源、施工通知；顶部奇观图鉴后续同步去掉取消项目。没有改变已建奇观效果。
- 文件：server/application/wonder-service.mjs、campaign-service.mjs、server/http/campaign-api-handler.mjs、client/buildings/building-panel-controller.js、styles/buildings.css、app.js、index.html。新增入口和样式缓存 20260908-wonder-cancel-v1。

60 项相关回归通过，覆盖无退款、其他项目 work、槽位释放／重建零进度、权限／状态／完工竞争、失败回滚、UI 条件及 API 认证。scripts/review-wonder-cancel.mjs：18 项隔离浏览器检查通过，包含未认证／越权／已完成拒绝，取消确认跨自动更新保留及键盘焦点，继续建造，实际中止无退款，释放槽位与 UI 删除，重复操作，图鉴更新和刷新持久化。证据 outputs/wonder-cancel-20260908/，已查看确认截图。

全部测试用临时 DATA_DIR 和随机端口；未中止任何真实玩家项目、未改真实卡包或存档、未重启原服务、未提交或部署。

奇观新增后端接口，需重启 Rougelite 服务并 Ctrl+F5。获卡光效本身只需 Ctrl+F5。
