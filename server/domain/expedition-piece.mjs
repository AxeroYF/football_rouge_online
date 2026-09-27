import {territoryPointToDisplay} from '../../client/map/campaign-map-geometry.js';
import { canUseTerritory } from '../../shared/config/diplomacy.mjs';
import { expeditionArtIcon, expeditionStyle, isExpeditionStyle } from '../../shared/config/expedition-art.mjs';
export const EXPEDITION_TOKEN_ID = "default";
export const EXPEDITION_TOKEN_URL = expeditionArtIcon(EXPEDITION_TOKEN_ID);
export const EXPEDITION_MIN_MOVE_MS = 60_000;
export const EXPEDITION_MAX_MOVE_MS = 600_000;

function ownedTerritoryIds(account, world) {
  return world?.players?.[account?.id]?.territoryIds ?? [];
}

function fallbackTerritoryId(account, world) {
  const owned = ownedTerritoryIds(account, world);
  const preferred = account?.homeTerritoryId ?? world?.players?.[account?.id]?.capitalTerritoryId;
  return owned.includes(preferred) ? preferred : owned[0] ?? null;
}

function centroid(index, territoryId, displayCoordinates = false) {
  const territory = index?.territories?.find((entry) => entry.territoryId === territoryId);
  const point = territory?.centroid;
  if (!Array.isArray(point) || point.length !== 2 || !point.every((value) => Number.isFinite(Number(value)))) {
    throw new Error("地块缺少有效的中心坐标");
  }
  const coordinates=point.map(Number);
  return displayCoordinates?territoryPointToDisplay(coordinates,territory.region).reverse():coordinates;
}

function haversineDistanceKm([leftLng, leftLat], [rightLng, rightLat]) {
  const radians = (degrees) => degrees * Math.PI / 180;
  const latitudeDelta = radians(rightLat - leftLat);
  const longitudeDelta = radians(rightLng - leftLng);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(leftLat)) * Math.cos(radians(rightLat)) * Math.sin(longitudeDelta / 2) ** 2;
  return Math.round(6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

export function expeditionMoveDuration(distanceKmValue) {
  const distanceKm = Math.max(0, Number(distanceKmValue) || 0);
  const minutes = Math.max(1, Math.min(10, Math.ceil(distanceKm / 250)));
  return minutes * 60_000;
}

export function normalizeExpeditionPiece(account, world, now = Date.now()) {
  if (!account || !world) return { changed: false, piece: null };
  const owned = ownedTerritoryIds(account, world);
  if (!account.homeTerritoryId || !owned.length) {
    const changed = account.expeditionPiece !== null && account.expeditionPiece !== undefined;
    account.expeditionPiece = null;
    return { changed, piece: null };
  }
  let changed = false;
  let piece = account.expeditionPiece;
  if (!piece || piece.schemaVersion !== 1) {
    piece = { schemaVersion: 1, tokenId: EXPEDITION_TOKEN_ID, territoryId: fallbackTerritoryId(account, world), movement: null };
    changed = true;
  }
  if (!isExpeditionStyle(piece.tokenId)) {
    piece.tokenId = EXPEDITION_TOKEN_ID;
    changed = true;
  }
  // Old footballer selections migrate to the matching vehicle without moving it.
  if (piece.tokenId !== 'default' && piece.tokenId !== expeditionStyle(piece.tokenId).id) {
    piece.tokenId=expeditionStyle(piece.tokenId).id;changed=true;
  }
  if(piece.movement?.transport==='airport'){account.expeditionPiece=piece;return {changed,piece};}
  changed = settleUnitMovement({piece,world,ownerId:account.id,now,fallbackTerritoryId:fallbackTerritoryId(account,world)}).changed || changed;
  account.expeditionPiece = piece;
  return { changed, piece };
}

export function publicExpeditionPiece(account, world, now = Date.now()) {
  const { piece } = normalizeExpeditionPiece(account, world, now);
  if (!piece) return null;
  const movement = piece.movement ? {
    ...piece.movement,
    remainingMs: Math.max(0, Number(piece.movement.arrivesAt) - Number(now)),
  } : null;
  return {
    schemaVersion: 1,
    tokenId: piece.tokenId,
    styleId: expeditionStyle(piece.tokenId).id,
    styleName: expeditionStyle(piece.tokenId).name,
    tokenUrl: expeditionArtIcon(piece.tokenId),
    territoryId: piece.territoryId,
    moving: Boolean(movement),
    movement,
  };
}

export function expeditionAttackSource(account, world, now = Date.now()) {
  const { piece } = normalizeExpeditionPiece(account, world, now);
  if (!piece?.territoryId) throw new Error("远征战棋尚未部署");
  if (piece.movement) {
    throw Object.assign(new Error("远征队正在行军，抵达后才能发起进攻"), { statusCode: 409 });
  }
  return piece.territoryId;
}

export function territoryTravelEstimate(territoryIndex, sourceTerritoryId, targetTerritoryId, {displayCoordinates = false} = {}) {
  const distanceKm = haversineDistanceKm(centroid(territoryIndex, sourceTerritoryId, displayCoordinates), centroid(territoryIndex, targetTerritoryId, displayCoordinates));
  return { fromTerritoryId:sourceTerritoryId, toTerritoryId:targetTerritoryId, distanceKm, durationMs:expeditionMoveDuration(distanceKm) };
}

export function createUnitMovement(estimate, now) {
  return {...estimate,startedAt:Number(now),arrivesAt:Number(now)+estimate.durationMs};
}

export function settleUnitMovement({piece,world,ownerId,now,fallbackTerritoryId=null,attackDeployment=false}) {
  if(piece.movement?.transport==='airport')return {changed:false,arrived:false};
  let changed=false,arrived=false;
  if(piece.movement&&!attackDeployment&&!canUseTerritory(world,ownerId,piece.movement.toTerritoryId)){piece.movement=null;changed=true;}
  if(piece.movement&&Number(piece.movement.arrivesAt)<=Number(now)){
    if(!attackDeployment)piece.territoryId=piece.movement.toTerritoryId;
    piece.movement=null;changed=true;arrived=true;
  }
  if(!canUseTerritory(world,ownerId,piece.territoryId)){
    changed=piece.territoryId!==fallbackTerritoryId || Boolean(piece.movement) || changed;
    piece.territoryId=fallbackTerritoryId;piece.movement=null;
  }
  return {changed,arrived};
}

export function estimateUnitMove({piece,ownerId,world,territoryIndex,targetTerritoryId}) {
  if(!piece?.territoryId || !canUseTerritory(world,ownerId,piece.territoryId))throw new Error('部队尚未部署于可用领土');
  if(piece.movement)throw Object.assign(new Error('部队正在行军，抵达后才能移动'),{statusCode:409});
  const target=String(targetTerritoryId??'');
  if(!canUseTerritory(world,ownerId,target))throw new Error('部队只能移动到自己或盟友的领土');
  if(target===piece.territoryId)throw new Error('部队已经驻扎在该地块');
  return territoryTravelEstimate(territoryIndex,piece.territoryId,target);
}

export function cancelUnitMovement(piece,now) {
  if(!piece?.movement)throw Object.assign(new Error('部队当前没有移动任务'),{statusCode:409});
  if(piece.movement.transport==='airport')throw Object.assign(new Error('航班已起飞，不能中途取消'),{statusCode:409});
  const canceledMovement={...piece.movement,canceledAt:Number(now)};
  piece.territoryId=piece.movement.fromTerritoryId;piece.movement=null;
  return canceledMovement;
}

export function estimateExpeditionMove({ account, world, territoryIndex, targetTerritoryId, now = Date.now() }) {
  expeditionAttackSource(account, world, now);
  return estimateUnitMove({piece:account.expeditionPiece,ownerId:account.id,world,territoryIndex,targetTerritoryId});
}

export function moveExpeditionPiece({ account, world, territoryIndex, targetTerritoryId, now = Date.now() }) {
  const estimate = estimateExpeditionMove({ account,world,territoryIndex,targetTerritoryId,now });
  account.expeditionPiece.movement = createUnitMovement(estimate,now);
  return publicExpeditionPiece(account, world, now);
}

export function cancelExpeditionMovement(account, world, now = Date.now()) {
  const { piece } = normalizeExpeditionPiece(account,world,now);
  if (!piece?.movement) {
    throw Object.assign(new Error("远征队当前没有移动任务"),{statusCode:409});
  }
  const canceledMovement=cancelUnitMovement(piece,now);
  return {piece:publicExpeditionPiece(account,world,now),canceledMovement};
}

export function selectExpeditionStyle(account, world, tokenId, now = Date.now()) {
  if (typeof tokenId !== "string" || !isExpeditionStyle(tokenId)) throw Object.assign(new Error("未知的远征单位外观"), {statusCode:400});
  const {piece}=normalizeExpeditionPiece(account,world,now);
  if (!piece) throw Object.assign(new Error("请先完成建队并建立总部"), {statusCode:409});
  piece.tokenId=expeditionStyle(tokenId).id;
  return publicExpeditionPiece(account,world,now);
}

export function placeExpeditionPiece(account, territoryId) {
  if (!account) return;
  account.expeditionPiece = {
    schemaVersion: 1,
    tokenId: isExpeditionStyle(account.expeditionPiece?.tokenId) ? account.expeditionPiece.tokenId : EXPEDITION_TOKEN_ID,
    territoryId: String(territoryId),
    movement: null,
  };
}
