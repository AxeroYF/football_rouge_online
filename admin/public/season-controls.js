// Shared by the admin page and service so names, confirmations and asset policy agree.
export const ADMIN_SEASON_ACTIONS = Object.freeze([
  Object.freeze({ id:"replay", label:"重赛当前赛季", confirmation:"重赛当前赛季", coins:"保留当前余额", description:"归档现有赛果，清零赛事进度及伤停，保留球队、阵容、金币、卡牌、背包与交易资产，返回报名阶段。操作本身不补发旧赛季奖励；需要保留的排名奖励应先完成结算。" }),
  Object.freeze({ id:"next", label:"开启下一赛季", confirmation:"开启下一赛季", coins:"保留当前余额", description:"归档现有赛季，赛季编号加一，重建赛程及伤停，保留全部玩家资产，返回报名阶段。" }),
  Object.freeze({ id:"full", label:"完全重置", confirmation:"完全重置YFFM1", coins:"清空全部玩家金币", description:"清空球队、选秀、原有金币、卡牌、背包、交易及比赛数据，重建 S1 报名阶段。保留账号、纪律记录和正式内容库；重新建队按初始规则建立钱包。" }),
]);
