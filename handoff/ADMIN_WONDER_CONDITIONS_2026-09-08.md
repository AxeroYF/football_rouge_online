**最新奇观运行时（2026-09-08，优先于下方“仅草稿／未接入”记录）**：24 座奇观已开放生产力建造；后台建设条件即时用于新开工，已有项目锁定原条件；效果按本轮批准快照运行，后续改效果文本仍需修改后端。现有系统加成已接入，5 座依赖未开放系统的奇观按用户确认可建造、待系统开放生效。839 次完整检查、25 项最终回归及 18 项隔离浏览器检查通过。见 [WONDERS_RUNTIME_2026-09-08.md](WONDERS_RUNTIME_2026-09-08.md)。**需自行重启游戏服务后 Ctrl+F5。**

# 奇观效果草稿与后台建设条件 · 2026-09-08

用户本轮授权：读取后台已填效果，按已有资源和俱乐部发展思路补拟空白效果，为全部奇观拟定四类建设要求；随后要求把各类条件做成后台可编辑项。此授权覆盖此前“只让用户手填、不补拟”的限制，但不等于批准奇观游戏效果生效。

## 交付

- 24 座完整草稿：保留后台 5 段效果原文，补拟 19 座；全部生产力、相邻设施、地形、球员收集门槛已拟定。基础需求 14,000–40,000，每分钟产能 40 时独建约 5.8–16.7 小时，尚未经过长期平衡。
- 已核对 598 地块、842 条球员定义的静态可达性；秘鲁与希腊仅各 1 名球员，避开不可达的本国十人条件。静态候选不等于当前玩家已拥有。
- 后台 `/admin` → 内容工作室 → 奇观管理：生产力数字输入，相邻设施多选，地形任选组与必需组，球员收集开关、不同球员人数、不同国籍数、国籍／俱乐部多值、位置多选。
- 相邻设施多选为全部需要；地形为 anyOf 与 allOf 同时满足；球员各维度同时满足，同维度多值任选。不消耗球员。收藏仍是设计条件，尚未接入施工验证。
- 可选条件清空为不限，生产力可留空暂存为待定；空效果但有条件显示“条件草稿”。

## 数据与兼容

`shared/config/wonder-design-drafts.json` 存本轮参考方案；不会在启动或读取时写入真实后台文件。原 5 段效果只读取实际 `data/admin-state.json::wonderDrafts`，没有复制进默认效果、没有改写用户原文。19 段新效果仅为无保存记录的条目提供参考；已保存的空文本也优先保留。

`server.mjs` 将方案和当前球员目录传给 AdminService。旧记录没有 construction 时在界面提供参考条件；用户保存后进入 `wonderDrafts[assetId].construction`。已清空的结构化对象永不被默认方案填回。参考说明和依赖仍在折叠区，明确为本轮设计参考，不能当实时判定。

POST `/api/admin/wonders/:assetId`：

```json
{
  "effectText": "可留空的效果原文",
  "revision": 0,
  "construction": {
    "totalProduction": 20000,
    "adjacentBuildings": ["port"],
    "terrain": {"anyOf": ["coastal"], "allOf": []},
    "playerCollection": {"minDistinctPlayers": 10, "nationalities": ["葡萄牙"]}
  }
}
```

playerCollection 可 null；国籍 nationalities、俱乐部 clubs、位置 pools 可省略或空数组；minNationalities 可省略；位置为 GK／DEF／MID／ATT。生产力为 null 或 1–1,000,000,000 整数，人数为 1–10,000 整数。后端拒绝非法枚举、错误类型、不合理国籍数；它不把设计时高门槛强行按当前卡池上限截断。旧客户端不传 construction 时保留现有条件。

效果与条件共享 revision，条件单独修改也会触发冲突保护。完全相同的旧版本重试幂等；不同内容不覆盖。表单切换、失败重试、已存/当前冲突比较包含条件；仅 content/superadmin 可编辑，readonly/operator 只查看。草稿和审计原子写入，失败不推进版本。

## 验证与边界

- `npm run check`：74 + 608 + 144 = 826 次测试执行，0 失败。
- 奇观及后台专项 25 项通过，包含条件保存/清空/重新加载、旧客户端兼容、非法参数、条件冲突、读写权限、写入故障回滚。
- 隔离完整服务 + Chrome，32 项浏览器检查通过，包含所有条件实际保存、列表切换、刷新恢复、非法国籍纠正、条件单独冲突与选择已存版本、清空后不回填、只读、桌面/390px 布局。
- 设计审阅页 11 项检查通过，24 张缩略图和筛选可用。
- 原真实 wonderDrafts 的散列、5 段效果原文均核对未变。未操作真实 campaign 存档，未启停用户服务、打包或部署。
- 需要用户自行重启现有服务，再 Ctrl+F5 刷新后台。缓存版本 `20260908-wonder-conditions-v1`。
- 只是后台可管理的设计草稿。奇观施工、资源结算、竞建规则、每日中立进攻额度、正式主场赛事、研究、工资维护的相关接入仍未完成。原大本钟 50% 钱包奖励无上限，原文保留，数值风险在审阅稿标明。

## 文件

- `outputs/wonder-planning-20260908/奇观效果与建设条件草稿.md`：完整总表与逐座口径。
- 同目录 `奇观草稿审阅.html`、`wonders-draft.json`、`validation.json`：静态审阅稿和可达性记录。
- `shared/config/wonder-design-drafts.json`：后台参考方案；不从旧 20260907 废弃方案填充。
- `shared/config/wonder-construction.mjs`：条件字典与严格校验。
- `client/wonders/admin-wonder-conditions.js`：条件表单与人类可读冲突摘要。
- `client/wonders/admin-wonder-management.js`、`server/application/admin-service.mjs`：整合编辑和持久化。
- `scripts/review-admin-wonders.mjs`：最新隔离后台浏览器验收。
- `outputs/admin-wonder-conditions-20260908/`：完整检查、浏览器结果、桌面/手机截图。
