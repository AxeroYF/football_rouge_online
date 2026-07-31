// 此文件由 devtool/sync-x-player-profiles.js 根据 x_profile/x-player-profile-positions.json 生成。
export const X_PLAYER_PROFILE_BY_PLAYER_ID = Object.freeze({
  "ydl-x-player-2": {
    "playerId": "ydl-x-player-2",
    "profileKey": "李俊良",
    "fileName": "李俊良.png",
    "imageUrl": "/versus/x_profile/webp/%E6%9D%8E%E4%BF%8A%E8%89%AF.webp?v=b285a86937e6",
    "xPercent": 51.1,
    "yPercent": 55.4,
    "widthPercent": 128,
    "optimizedFileName": "李俊良.webp"
  }
});

export function xPlayerProfileForPlayer(player) {
  return player?.id ? X_PLAYER_PROFILE_BY_PLAYER_ID[player.id] ?? null : null;
}
