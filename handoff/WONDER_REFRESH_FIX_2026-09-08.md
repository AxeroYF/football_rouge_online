**奇观可建列表与右侧说明（2026-09-08）**：只显示当前地块满足全部建造要求的奇观；名称与生产力按钮同行，鼠标悬停右侧显示要求和效果，替代原 24 项折叠列表。无可建项目时显示空状态。窄屏点击名称查看；自动刷新保留说明，关闭后不自动重开，开工后移除不可建选项。49 项相关回归、23 项隔离浏览器检查通过。纯前端，Ctrl+F5。见 [WONDER_HOVER_2026-09-08.md](WONDER_HOVER_2026-09-08.md)。

# 奇观列表自动刷新关闭修复 · 2026-09-08

用户报告地块建筑中的奇观页面自动关闭。根因有两处：世界每 5 秒同步的数据为精简 territoryView，刻意不包含 availableWonders，但客户端用其整体覆盖当前完整视图，导致奇观区域消失；施工中的每秒倒计时以及完整读取会重写 innerHTML，导致原生 details 展开状态丢失。

## 修复

- 同一地块世界同步时保留完整奇观列表，同时合并最新普通设施状态、发起合并去重的完整条件读取。完整响应更新最新条件；不关闭定时同步或冻结施工进度。
- 重绘前记录以 wonderId 标识的展开项、实际滚动容器 territory-inspector 的 scrollTop 和奇观标题焦点，重绘后恢复。用户主动收起也会正确保持。
- 切换地块从新地块视图开始并清空展开，不把旧地块条件带入新地块。非自有地块立即移除建造选项。原有 selectionVersion 防迟到响应机制保留。
- 后台短暂读取失败不清空已加载的列表，后续自动同步可以恢复；首次加载失败仍展示错误。
- app.js 和 index.html 的对应前端缓存版本改为 20260908-wonder-refresh-v1。

## 验证

- node --test test/building-panel-controller.test.js test/wonders-runtime.test.js test/app-map-regression.test.js：48 项通过。新增 3 项回归验证精简数据合并、完整条件更新／请求合并、临时失败恢复、切换地块和所有权变化。
- scripts/review-wonder-refresh.mjs：临时 DATA_DIR 与独立真实服务，Chrome 14 项通过。在实际施工中展开两座奇观，等待 11.5 秒，覆盖至少两轮世界同步及每秒施工重绘；校验 24 张卡片、展开状态、滚动位置、焦点与继续变化的倒计时。手动收起一项后切 390px，等待 6.5 秒复核展开／收起与滚动。切地块后恢复默认折叠。
- 输出 outputs/wonder-refresh-20260908/：tests.log、browser.log、browser-results.json、expanded-desktop.png、expanded-mobile.png。
- 未修改后端规则或真实存档，未启停用户现有服务。此次纯前端修改，用户 Ctrl+F5 刷新即可。
