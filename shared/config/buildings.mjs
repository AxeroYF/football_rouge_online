import { FACILITY_UPGRADES } from './facility-levels.mjs';
import { facilityArtIcon } from './facility-art.mjs';
export const BUILDING_TYPES = Object.freeze({
  CLUB_HEADQUARTERS: "club-headquarters",
  MAIN_STADIUM: "main-stadium",
  SCOUT_CENTER: "scout-center",
  PORT: "port",
  AIRPORT: "airport",
  TRAINING_CENTER: "training-center",
  MEDICAL_CENTER: "medical-center",
  RECOVERY_CENTER: "recovery-center",
  CLUB_SHOP: "club-shop",
  OIL_WELL: "oil-well",
  FACTORY: "factory",
  UNIVERSITY: "university",
});

function definition(value) {
  return Object.freeze({
    ...value,
    buildCostProduction:FACILITY_UPGRADES[value.type].production[0],
    costsProduction:Object.freeze([...FACILITY_UPGRADES[value.type].production]),
    iconPath: facilityArtIcon(value.type, 1) ?? value.iconPath,
    costsGold: Object.freeze([...FACILITY_UPGRADES[value.type].gold]),
    capabilities: Object.freeze([...value.capabilities]),
  });
}

export const BUILDING_DEFINITIONS = Object.freeze({
 airport:definition({type:"airport",label:"机场",capabilities:["air-transport"],buildable:true,automatic:false,capitalOnly:false,coastalOnly:false,customName:false}),
 'oil-well':definition({type:'oil-well',label:'油井',capabilities:['oil-production'],buildable:true,oilOnly:true,automatic:false,capitalOnly:false,coastalOnly:false,customName:false}),
  factory:definition({type:'factory',label:'工厂',capabilities:['production-capacity','terrain-adjacency'],buildable:true,maxPerPlayer:1,automatic:false,capitalOnly:false,coastalOnly:false,customName:false}),
  university:definition({type:'university',label:'大学',capabilities:['science-capacity','terrain-adjacency'],buildable:true,maxPerPlayer:1,automatic:false,capitalOnly:false,coastalOnly:false,customName:false}),
  [BUILDING_TYPES.CLUB_HEADQUARTERS]: definition({
    type:BUILDING_TYPES.CLUB_HEADQUARTERS,label:"俱乐部总部",iconPath:"/assets/facilities/icons/club-headquarters-lv1.png",
    capabilities:["capital","club-development"],automatic:true,buildable:false,capitalOnly:true,coastalOnly:false,customName:false,
  }),
  [BUILDING_TYPES.MAIN_STADIUM]: definition({
    type: BUILDING_TYPES.MAIN_STADIUM,
    label: "主体育场",
    iconPath: "/assets/building-icons-v2/main-stadium.png",
    costsGold: [5_000, 200_000, 350_000, 600_000, 1_000_000],
    capabilities: ["home-match", "seating-capacity"],
    automatic: false,
    buildable: true,
    maxPerPlayer: 1,
    capitalOnly: false,
    coastalOnly: false,
    customName: true,
  }),
  [BUILDING_TYPES.SCOUT_CENTER]: definition({
    type: BUILDING_TYPES.SCOUT_CENTER,
    buildCostProduction: 400,
    label: "球探中心",
    iconPath: "/assets/building-icons-v2/scout-center.png",
    costsGold: [5_000, 180_000, 270_000, 400_000, 600_000],
    capabilities: ["scout-recruitment"],
    automatic: false,
    buildable: true,
    capitalOnly: false,
    coastalOnly: false,
    customName: false,
  }),
  [BUILDING_TYPES.PORT]: definition({
    type: BUILDING_TYPES.PORT,
    buildCostProduction: 500,
    label: "港口",
    iconPath: "/assets/building-icons-v2/port.png",
    costsGold: [5_000, 225_000, 340_000, 510_000, 765_000],
    capabilities: ["maritime-range", "maritime-time"],
    automatic: false,
    buildable: true,
    capitalOnly: false,
    coastalOnly: true,
    customName: false,
  }),
  [BUILDING_TYPES.TRAINING_CENTER]: definition({
    type: BUILDING_TYPES.TRAINING_CENTER,
    buildCostProduction: 400,
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
    buildCostProduction: 350,
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
    buildCostProduction: 300,
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
    buildCostProduction: 250,
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
  concurrentProjectLimit: 5,
  capitalSlotLimit: 3,
  standardTerritorySlotLimit: 1,
  oneBuildingPerTypePerTerritory: true,
  // Keep the original work requirement for migrating existing fixed-timer projects only.
  constructionDurationMs: 60_000,
  productionAllocation: "equal",
  productionPeriodMs: 60_000, // One capacity point completes one production requirement per minute.
  upgradesEnabled: true,
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
    costsProduction:[...entry.costsProduction],
    maxPerPlayer:entry.maxPerPlayer??null,
    oilOnly:entry.oilOnly===true,
    buildCostGold: entry.costsGold[0],
    buildCostProduction: entry.buildCostProduction ?? null,
    upgradeEnabled: BUILDING_RULES.upgradesEnabled && entry.costsGold.length > 1,
    capabilities: [...entry.capabilities],
    automatic: entry.automatic,
    buildable: entry.buildable,
    capitalOnly: entry.capitalOnly,
    coastalOnly: entry.coastalOnly,
    customName: entry.customName,
  }));
}
