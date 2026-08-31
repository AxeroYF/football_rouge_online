export const BUILDING_TYPES = Object.freeze({
  MAIN_STADIUM: "main-stadium",
  SCOUT_CENTER: "scout-center",
  PORT: "port",
  TRAINING_CENTER: "training-center",
  MEDICAL_CENTER: "medical-center",
  RECOVERY_CENTER: "recovery-center",
  CLUB_SHOP: "club-shop",
});

function definition(value) {
  return Object.freeze({
    ...value,
    costsGold: Object.freeze([...value.costsGold]),
    capabilities: Object.freeze([...value.capabilities]),
  });
}

export const BUILDING_DEFINITIONS = Object.freeze({
  [BUILDING_TYPES.MAIN_STADIUM]: definition({
    type: BUILDING_TYPES.MAIN_STADIUM,
    label: "主体育场",
    iconPath: "/assets/building-icons-v2/main-stadium.png",
    costsGold: [5_000, 200_000, 350_000, 600_000, 1_000_000],
    capabilities: ["capital", "home-match"],
    automatic: true,
    buildable: false,
    capitalOnly: true,
    coastalOnly: false,
    customName: true,
  }),
  [BUILDING_TYPES.SCOUT_CENTER]: definition({
    type: BUILDING_TYPES.SCOUT_CENTER,
    label: "球探中心",
    iconPath: "/assets/building-icons-v2/scout-center.png",
    costsGold: [5_000, 180_000, 270_000, 400_000, 600_000],
    capabilities: ["player-card-production", "national-pool-bias", "legendary-roll"],
    automatic: false,
    buildable: true,
    capitalOnly: false,
    coastalOnly: false,
    customName: false,
  }),
  [BUILDING_TYPES.PORT]: definition({
    type: BUILDING_TYPES.PORT,
    label: "港口",
    iconPath: "/assets/building-icons-v2/port.png",
    costsGold: [5_000, 225_000, 340_000, 510_000, 765_000],
    capabilities: ["maritime-range", "maritime-fitness-cost"],
    automatic: false,
    buildable: true,
    capitalOnly: false,
    coastalOnly: true,
    customName: false,
  }),
  [BUILDING_TYPES.TRAINING_CENTER]: definition({
    type: BUILDING_TYPES.TRAINING_CENTER,
    label: "训练中心",
    iconPath: "/assets/building-icons-v2/training-center.png",
    costsGold: [5_000, 180_000, 270_000, 400_000, 600_000],
    capabilities: ["attribute-training", "core-attribute-bias"],
    automatic: false,
    buildable: true,
    capitalOnly: false,
    coastalOnly: false,
    customName: false,
  }),
  [BUILDING_TYPES.MEDICAL_CENTER]: definition({
    type: BUILDING_TYPES.MEDICAL_CENTER,
    label: "医疗中心",
    iconPath: "/assets/building-icons-v2/medical-center.png",
    costsGold: [5_000, 150_000, 225_000, 340_000, 510_000],
    capabilities: ["injury-treatment"],
    automatic: false,
    buildable: true,
    capitalOnly: false,
    coastalOnly: false,
    customName: false,
  }),
  [BUILDING_TYPES.RECOVERY_CENTER]: definition({
    type: BUILDING_TYPES.RECOVERY_CENTER,
    label: "体能恢复中心",
    iconPath: "/assets/building-icons-v2/recovery-center.png",
    costsGold: [5_000, 135_000, 205_000, 310_000, 465_000],
    capabilities: ["fitness-recovery"],
    automatic: false,
    buildable: true,
    capitalOnly: false,
    coastalOnly: false,
    customName: false,
  }),
  [BUILDING_TYPES.CLUB_SHOP]: definition({
    type: BUILDING_TYPES.CLUB_SHOP,
    label: "俱乐部商店",
    iconPath: "/assets/building-icons-v2/club-shop.png",
    costsGold: [5_000, 120_000, 180_000, 270_000, 405_000],
    capabilities: ["gold-production"],
    automatic: false,
    buildable: true,
    capitalOnly: false,
    coastalOnly: false,
    customName: false,
  }),
});

export const BUILDING_RULES = Object.freeze({
  capitalSlotLimit: Object.keys(BUILDING_DEFINITIONS).length,
  standardTerritorySlotLimit: 1,
  oneBuildingPerTypePerTerritory: true,
  constructionDurationMs: 60_000,
  upgradesEnabled: false,
});

export function buildingDefinition(typeValue) {
  return BUILDING_DEFINITIONS[String(typeValue ?? "")] ?? null;
}

export function publicBuildingCatalog() {
  return Object.values(BUILDING_DEFINITIONS).map((entry) => ({
    type: entry.type,
    label: entry.label,
    iconPath: entry.iconPath,
    maxLevel: entry.costsGold.length,
    costsGold: [...entry.costsGold],
    buildCostGold: entry.costsGold[0],
    constructionDurationMs: BUILDING_RULES.constructionDurationMs,
    upgradeEnabled: BUILDING_RULES.upgradesEnabled,
    capabilities: [...entry.capabilities],
    automatic: entry.automatic,
    buildable: entry.buildable,
    capitalOnly: entry.capitalOnly,
    coastalOnly: entry.coastalOnly,
    customName: entry.customName,
  }));
}
