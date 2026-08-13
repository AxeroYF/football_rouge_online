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
  },
  "ydl-x-player-3": {
    "playerId": "ydl-x-player-3",
    "profileKey": "黄威",
    "fileName": "huangwei.png",
    "imageUrl": "/versus/x_profile/webp/huangwei.webp?v=28556d1ab85a",
    "xPercent": 41.9,
    "yPercent": 63.9,
    "widthPercent": 144,
    "optimizedFileName": "huangwei.webp"
  },
  "ydl-x-player-10": {
    "playerId": "ydl-x-player-10",
    "profileKey": "金典",
    "fileName": "jindian.png",
    "imageUrl": "/versus/x_profile/webp/jindian.webp?v=03e0a421859a",
    "xPercent": 53.2,
    "yPercent": 44.1,
    "widthPercent": 104,
    "optimizedFileName": "jindian.webp"
  },
  "ydl-x-player-7": {
    "playerId": "ydl-x-player-7",
    "profileKey": "李彬",
    "fileName": "libin.png",
    "imageUrl": "/versus/x_profile/webp/libin.webp?v=3f66b39075e2",
    "xPercent": 59.1,
    "yPercent": 64.1,
    "widthPercent": 128,
    "optimizedFileName": "libin.webp"
  },
  "ydl-x-player-9": {
    "playerId": "ydl-x-player-9",
    "profileKey": "刘祖豪",
    "fileName": "liuzuhao.png",
    "imageUrl": "/versus/x_profile/webp/liuzuhao.webp?v=a2f6f5c11b52",
    "xPercent": 47.9,
    "yPercent": 56.6,
    "widthPercent": 188,
    "optimizedFileName": "liuzuhao.webp"
  }
});

export function xPlayerProfileForPlayer(player) {
  return player?.id ? X_PLAYER_PROFILE_BY_PLAYER_ID[player.id] ?? null : null;
}
