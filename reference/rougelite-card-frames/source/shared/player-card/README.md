# 黄狗风云标准球员卡

球员卡由本目录提供唯一的数据契约，并由 `client/player-card/player-card.js` 提供唯一的HTML渲染器。选秀、球队管理、球员详情、Admin、随机事件、奖励、卡包等业务都必须调用它，不能重新拼装卡面。

## 三层身份

- `playerId`：球员库稳定ID，永远不用姓名代替。
- `cardDefinitionId`：卡种定义ID；当前基础卡默认与 `playerId` 相同。
- `cardInstanceId`：玩家持有卡实例ID；库存系统上线前允许为空。

## 调用

```js
import { playerCardMarkup } from "./client/player-card/player-card.js";

const html = playerCardMarkup(player, {
  interactive: true,
  variant: "standard",
  action: "event-choice",
});
```

允许的规格只有 `mini`、`compact`、`standard`、`detail`、`art-only`。业务状态通过标准数据和覆盖层扩展，不新增业务专属卡面。

## 硬性约束

1. 业务代码不得直接拼接卡画路径或哈希文件名。
2. 业务代码不得手写 `.s4-player-card` 内部DOM。
3. Admin与游戏必须共用渲染器和卡画定位数据。
4. 卡画解析只在 `createPlayerCardViewModel` 中处理；它兼容旧的 `portrait/portraitPosition` 和Admin的 `profile.imageUrl`。
5. 新规格、新覆盖状态和视觉调整必须先进入公共组件并补测试。

服务端球员库返回的每名球员都包含标准 `card` 字段；Admin还可通过 `GET /api/admin/player-library/cards/:playerId` 获取单张标准卡数据。
