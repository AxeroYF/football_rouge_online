export const WONDER_VERSION = "wonders-live-20260908-v1";
export const WONDERS = [
  {
    "id": "W01",
    "assetId": "eiffel-tower",
    "name": "埃菲尔铁塔",
    "region": "欧洲",
    "thumbnail": "./assets/wonders/thumbnails/eiffel-tower.webp",
    "effectText": "附近所有地块上的球探进行发掘的时间-40%",
    "construction": {
      "totalProduction": 18000,
      "adjacentBuildings": [
        "scout-center"
      ],
      "terrain": {
        "anyOf": [],
        "allOf": []
      },
      "playerCollection": {
        "minDistinctPlayers": 6,
        "nationalities": [
          "法国"
        ]
      }
    },
    "dependency": null
  },
  {
    "id": "W02",
    "assetId": "colosseum",
    "name": "罗马斗兽场",
    "region": "欧洲",
    "thumbnail": "./assets/wonders/thumbnails/colosseum.webp",
    "effectText": "该玩家的训练场训练获得随机点数+1",
    "construction": {
      "totalProduction": 22000,
      "adjacentBuildings": [
        "training-center"
      ],
      "terrain": {
        "anyOf": [
          "plains"
        ],
        "allOf": []
      },
      "playerCollection": {
        "minDistinctPlayers": 8,
        "nationalities": [
          "意大利"
        ]
      }
    },
    "dependency": null
  },
  {
    "id": "W03",
    "assetId": "sagrada-familia",
    "name": "圣家堂",
    "region": "欧洲",
    "thumbnail": "./assets/wonders/thumbnails/sagrada-familia.webp",
    "effectText": "玩家所有开包结果从三选一变为四选一",
    "construction": {
      "totalProduction": 40000,
      "adjacentBuildings": [],
      "terrain": {
        "anyOf": [],
        "allOf": []
      },
      "playerCollection": {
        "minDistinctPlayers": 12,
        "nationalities": [
          "西班牙"
        ]
      }
    },
    "dependency": null
  },
  {
    "id": "W04",
    "assetId": "elizabeth-tower",
    "name": "大本钟／伊丽莎白塔",
    "region": "欧洲",
    "thumbnail": "./assets/wonders/thumbnails/elizabeth-tower.webp",
    "effectText": "大本钟建成的时候，玩家获得当前已有金币数量50%的奖励；大本钟所在地块的金币获取数量+100%",
    "construction": {
      "totalProduction": 32000,
      "adjacentBuildings": [
        "club-shop"
      ],
      "terrain": {
        "anyOf": [
          "plains"
        ],
        "allOf": []
      },
      "playerCollection": null
    },
    "dependency": null
  },
  {
    "id": "W05",
    "assetId": "brandenburg-gate",
    "name": "勃兰登堡门",
    "region": "欧洲",
    "thumbnail": "./assets/wonders/thumbnails/brandenburg-gate.webp",
    "effectText": "远征队每日可进攻的中立地块数量+1",
    "construction": {
      "totalProduction": 26000,
      "adjacentBuildings": [
        "recovery-center"
      ],
      "terrain": {
        "anyOf": [],
        "allOf": []
      },
      "playerCollection": {
        "minDistinctPlayers": 10,
        "nationalities": [
          "德国"
        ]
      }
    },
    "dependency": null
  },
  {
    "id": "W06",
    "assetId": "versailles-palace",
    "name": "凡尔赛宫",
    "region": "欧洲",
    "thumbnail": "./assets/wonders/thumbnails/versailles-palace.webp",
    "effectText": "生效期间签订的新赞助合同，持续时间延长 50%，每小时金币不变。普通合同由 1 天变为 1.5 天，球场／球队冠名由 2 天变为 3 天。",
    "construction": {
      "totalProduction": 20000,
      "adjacentBuildings": [
        "club-shop"
      ],
      "terrain": {
        "anyOf": [
          "plains"
        ],
        "allOf": []
      },
      "playerCollection": null
    },
    "dependency": null
  },
  {
    "id": "W07",
    "assetId": "louvre",
    "name": "卢浮宫",
    "region": "欧洲",
    "thumbnail": "./assets/wonders/thumbnails/louvre.webp",
    "effectText": "俱乐部每拥有一种不同国籍的球员，奇观提供 +2 科技值，最多 +30 科技值。",
    "construction": {
      "totalProduction": 24000,
      "adjacentBuildings": [],
      "terrain": {
        "anyOf": [
          "plains"
        ],
        "allOf": []
      },
      "playerCollection": {
        "minDistinctPlayers": 12,
        "minNationalities": 12
      }
    },
    "dependency": null
  },
  {
    "id": "W08",
    "assetId": "british-museum",
    "name": "大英博物馆",
    "region": "欧洲",
    "thumbnail": "./assets/wonders/thumbnails/british-museum.webp",
    "effectText": "球探每次完成发掘后，候选球员由三选一变为四选一，最终仍只签下一名。",
    "construction": {
      "totalProduction": 24000,
      "adjacentBuildings": [
        "scout-center"
      ],
      "terrain": {
        "anyOf": [],
        "allOf": []
      },
      "playerCollection": {
        "minDistinctPlayers": 8,
        "nationalities": [
          "英格兰"
        ]
      }
    },
    "dependency": null
  },
  {
    "id": "W09",
    "assetId": "alhambra",
    "name": "阿尔罕布拉宫",
    "region": "欧洲",
    "thumbnail": "./assets/wonders/thumbnails/alhambra.webp",
    "effectText": "每次训练可指定一个属性获得 1 点，其余训练点数继续随机分配。",
    "construction": {
      "totalProduction": 20000,
      "adjacentBuildings": [
        "training-center"
      ],
      "terrain": {
        "anyOf": [
          "hills"
        ],
        "allOf": []
      },
      "playerCollection": null
    },
    "dependency": null
  },
  {
    "id": "W10",
    "assetId": "acropolis",
    "name": "雅典卫城",
    "region": "欧洲",
    "thumbnail": "./assets/wonders/thumbnails/acropolis.webp",
    "effectText": "阵型研究与战术研究的科技工作量需求降低 20%；强化成功率研究不享受此减免。",
    "construction": {
      "totalProduction": 24000,
      "adjacentBuildings": [],
      "terrain": {
        "anyOf": [
          "hills"
        ],
        "allOf": []
      },
      "playerCollection": {
        "minDistinctPlayers": 8,
        "pools": [
          "MID"
        ]
      }
    },
    "dependency": "阵型／战术研究"
  },
  {
    "id": "W11",
    "assetId": "belem-tower",
    "name": "贝伦塔",
    "region": "欧洲",
    "thumbnail": "./assets/wonders/thumbnails/belem-tower.webp",
    "effectText": "远征队海上移动耗时降低 30%，海上移动造成的体力消耗降低 30%。",
    "construction": {
      "totalProduction": 20000,
      "adjacentBuildings": [
        "port"
      ],
      "terrain": {
        "anyOf": [
          "coastal"
        ],
        "allOf": []
      },
      "playerCollection": {
        "minDistinctPlayers": 10,
        "nationalities": [
          "葡萄牙"
        ]
      }
    },
    "dependency": null
  },
  {
    "id": "W12",
    "assetId": "neuschwanstein",
    "name": "新天鹅堡",
    "region": "欧洲",
    "thumbnail": "./assets/wonders/thumbnails/neuschwanstein.webp",
    "effectText": "奇观所在地及一圈陆地相邻己方地块，每块只需 800 球迷即可获得完整地块收益。",
    "construction": {
      "totalProduction": 26000,
      "adjacentBuildings": [],
      "terrain": {
        "anyOf": [
          "hills",
          "mountain"
        ],
        "allOf": [
          "forest"
        ]
      },
      "playerCollection": {
        "minDistinctPlayers": 8,
        "nationalities": [
          "德国"
        ]
      }
    },
    "dependency": null
  },
  {
    "id": "W13",
    "assetId": "atomium",
    "name": "布鲁塞尔原子球塔",
    "region": "欧洲",
    "thumbnail": "./assets/wonders/thumbnails/atomium.webp",
    "effectText": "玩家所有原本产科技值的地块，每块完整产出的科技值额外 +2。",
    "construction": {
      "totalProduction": 22000,
      "adjacentBuildings": [],
      "terrain": {
        "anyOf": [
          "plains"
        ],
        "allOf": []
      },
      "playerCollection": {
        "minDistinctPlayers": 5,
        "nationalities": [
          "比利时"
        ]
      }
    },
    "dependency": null
  },
  {
    "id": "W14",
    "assetId": "pont-du-gard",
    "name": "加尔桥",
    "region": "欧洲",
    "thumbnail": "./assets/wonders/thumbnails/pont-du-gard.webp",
    "effectText": "奇观所在地及一圈陆地相邻己方地块的生产力产出提高 50%。",
    "construction": {
      "totalProduction": 16000,
      "adjacentBuildings": [
        "recovery-center"
      ],
      "terrain": {
        "anyOf": [
          "plains",
          "hills"
        ],
        "allOf": []
      },
      "playerCollection": null
    },
    "dependency": null
  },
  {
    "id": "W15",
    "assetId": "leaning-tower-pisa",
    "name": "比萨斜塔",
    "region": "欧洲",
    "thumbnail": "./assets/wonders/thumbnails/leaning-tower-pisa.webp",
    "effectText": "使用强化保护时，保护所需金币降低 30%。",
    "construction": {
      "totalProduction": 18000,
      "adjacentBuildings": [
        "training-center"
      ],
      "terrain": {
        "anyOf": [],
        "allOf": []
      },
      "playerCollection": {
        "minDistinctPlayers": 6,
        "nationalities": [
          "意大利"
        ]
      }
    },
    "dependency": null
  },
  {
    "id": "W16",
    "assetId": "santiago-bernabeu",
    "name": "伯纳乌球场",
    "region": "欧洲",
    "thumbnail": "./assets/wonders/thumbnails/santiago-bernabeu.webp",
    "effectText": "玩家正式主场比赛的门票金币收入提高 50%。",
    "construction": {
      "totalProduction": 40000,
      "adjacentBuildings": [
        "main-stadium"
      ],
      "terrain": {
        "anyOf": [],
        "allOf": []
      },
      "playerCollection": {
        "minDistinctPlayers": 8,
        "clubs": [
          "皇家马德里"
        ]
      }
    },
    "dependency": "正式主场赛事与门票结算"
  },
  {
    "id": "W17",
    "assetId": "christ-the-redeemer",
    "name": "里约基督像",
    "region": "南美洲",
    "thumbnail": "./assets/wonders/thumbnails/christ-the-redeemer.webp",
    "effectText": "玩家固定球迷增长额外 +50 人／小时。",
    "construction": {
      "totalProduction": 22000,
      "adjacentBuildings": [],
      "terrain": {
        "anyOf": [
          "hills",
          "mountain"
        ],
        "allOf": []
      },
      "playerCollection": {
        "minDistinctPlayers": 8,
        "nationalities": [
          "巴西"
        ]
      }
    },
    "dependency": null
  },
  {
    "id": "W18",
    "assetId": "machu-picchu",
    "name": "马丘比丘",
    "region": "南美洲",
    "thumbnail": "./assets/wonders/thumbnails/machu-picchu.webp",
    "effectText": "玩家所有山脉地块，每块完整产出额外 +2 生产力、+2 科技值。",
    "construction": {
      "totalProduction": 16000,
      "adjacentBuildings": [],
      "terrain": {
        "anyOf": [
          "mountain"
        ],
        "allOf": []
      },
      "playerCollection": {
        "minDistinctPlayers": 6,
        "nationalities": [
          "巴西",
          "阿根廷",
          "乌拉圭",
          "哥伦比亚",
          "智利",
          "秘鲁",
          "厄瓜多尔",
          "巴拉圭",
          "委内瑞拉",
          "玻利维亚",
          "圭亚那",
          "苏里南"
        ],
        "minNationalities": 3
      }
    },
    "dependency": null
  },
  {
    "id": "W19",
    "assetId": "la-moneda",
    "name": "拉莫内达宫",
    "region": "南美洲",
    "thumbnail": "./assets/wonders/thumbnails/la-moneda.webp",
    "effectText": "玩家球员工资与设施维护的周期性金币支出降低 20%。",
    "construction": {
      "totalProduction": 24000,
      "adjacentBuildings": [
        "club-shop"
      ],
      "terrain": {
        "anyOf": [
          "plains"
        ],
        "allOf": []
      },
      "playerCollection": null
    },
    "dependency": null
  },
  {
    "id": "W20",
    "assetId": "teatro-colon",
    "name": "科隆剧院",
    "region": "南美洲",
    "thumbnail": "./assets/wonders/thumbnails/teatro-colon.webp",
    "effectText": "打开正式球员卡包并最终选中 A 级球员时增加 100 球迷，选中 S 级球员时增加 300 球迷；每天最多由此获得 1,000 球迷。",
    "construction": {
      "totalProduction": 18000,
      "adjacentBuildings": [
        "club-shop"
      ],
      "terrain": {
        "anyOf": [],
        "allOf": []
      },
      "playerCollection": {
        "minDistinctPlayers": 8,
        "nationalities": [
          "阿根廷"
        ]
      }
    },
    "dependency": null
  },
  {
    "id": "W21",
    "assetId": "palacio-salvo",
    "name": "萨尔沃宫",
    "region": "南美洲",
    "thumbnail": "./assets/wonders/thumbnails/palacio-salvo.webp",
    "effectText": "每 1,000 名闲置球迷额外提供 100 金币／小时，不足 1,000 按比例计算，最多 +500 金币／小时。",
    "construction": {
      "totalProduction": 14000,
      "adjacentBuildings": [
        "club-shop"
      ],
      "terrain": {
        "anyOf": [
          "coastal"
        ],
        "allOf": []
      },
      "playerCollection": {
        "minDistinctPlayers": 4,
        "nationalities": [
          "乌拉圭"
        ]
      }
    },
    "dependency": null
  },
  {
    "id": "W22",
    "assetId": "las-lajas-sanctuary",
    "name": "拉斯拉哈斯圣殿",
    "region": "南美洲",
    "thumbnail": "./assets/wonders/thumbnails/las-lajas-sanctuary.webp",
    "effectText": "远征队完成一次完整地块挑战后，实际出场且未伤退的球员额外恢复 15 体力，上限 100。",
    "construction": {
      "totalProduction": 18000,
      "adjacentBuildings": [
        "medical-center"
      ],
      "terrain": {
        "anyOf": [
          "hills",
          "mountain"
        ],
        "allOf": []
      },
      "playerCollection": {
        "minDistinctPlayers": 4,
        "nationalities": [
          "哥伦比亚"
        ]
      }
    },
    "dependency": null
  },
  {
    "id": "W23",
    "assetId": "museum-of-tomorrow",
    "name": "明日博物馆",
    "region": "南美洲",
    "thumbnail": "./assets/wonders/thumbnails/museum-of-tomorrow.webp",
    "effectText": "玩家实际地块科技产出的 25%，额外作为生产力参与建筑建设；原科技值不减少。",
    "construction": {
      "totalProduction": 28000,
      "adjacentBuildings": [
        "training-center"
      ],
      "terrain": {
        "anyOf": [
          "coastal"
        ],
        "allOf": []
      },
      "playerCollection": null
    },
    "dependency": null
  },
  {
    "id": "W24",
    "assetId": "maracana",
    "name": "马拉卡纳球场",
    "region": "南美洲",
    "thumbnail": "./assets/wonders/thumbnails/maracana.webp",
    "effectText": "正式主场比赛获胜额外增加 500 球迷，平局额外增加 200 球迷；每天仅前 3 场正式主场比赛可触发。",
    "construction": {
      "totalProduction": 36000,
      "adjacentBuildings": [
        "main-stadium"
      ],
      "terrain": {
        "anyOf": [
          "plains"
        ],
        "allOf": []
      },
      "playerCollection": {
        "minDistinctPlayers": 12,
        "nationalities": [
          "巴西"
        ]
      }
    },
    "dependency": "正式主场赛事与结果结算"
  }
];
export const WONDER_BY_ID = new Map(WONDERS.map(w => [w.assetId, w]));
