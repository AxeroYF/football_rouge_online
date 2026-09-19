import { canVisitScoutTerritory, scoutMovementFrame } from "../../shared/scouting/scout-units.mjs";
import { sharedHeadquarters, alliedTerritoryIds, canUseTerritory, allianceMembers } from "../../shared/config/diplomacy.mjs";
import crypto from "node:crypto";
import { FOG_RULES } from "../../shared/config/fog.mjs";
import { FogSpatialIndex } from "../../shared/map/fog-spatial.mjs";

export class FogService {
  constructor({ territoryIndex, territoryGeoJson, accounts = new Map(), now = Date.now } = {}) {
    this.accounts=accounts;this.now=now;this.previews=new Map();this.accountSight=new WeakMap();this.spatial=territoryGeoJson?new FogSpatialIndex(territoryGeoJson):null;
    this.aliases=territoryIndex?.territoryIdAliases??{};
    this.neighbours=new Map((territoryIndex?.territories??[]).map(e=>[e.territoryId,new Set()]));
    for(const e of territoryIndex?.territories??[])for(const id of new Set([...(e.neighbors??[]),...(e.landNeighbors??[]),...(e.maritimeNeighbors??[])])){
      if(!this.neighbours.has(id))continue;this.neighbours.get(e.territoryId).add(id);this.neighbours.get(id).add(e.territoryId);
    }
  }
  preview(account,world) {
    const p=this.previews.get(account.id);
    if(!p)return null;
    const piece=p.coalitionId?world?.coalitions?.[p.coalitionId]:account.expeditionPiece;
    if(p.seasonId!==world?.seasonId||p.expiresAt<=this.now()||!canUseTerritory(world,account.id,p.sourceTerritoryId)||piece?.territoryId!==p.sourceTerritoryId||piece?.movement||(p.coalitionId&&(piece?.disbandedAt||!allianceMembers(world,piece?.commanderId).includes(account.id)))){this.previews.delete(account.id);return null;}
    return p;
  }
  update(account,world,{share=true}={}) {
    if(!account?.homeTerritoryId||!world)return {changed:false,view:{enabled:false,sightRings:FOG_RULES.sightRings,visibleTerritoryIds:[],exploredTerritoryIds:[],metPlayerIds:[]}};
    const owned=Object.entries(world.territories).filter(([,e])=>e.ownerType==="player"&&e.ownerId===account.id).map(([id])=>id).sort();
    const scoutSources=[...new Set(Object.values(account.scouting?.units??{}).map(u=>scoutMovementFrame(u.movement,this.now())?.reachedTerritoryId??u.territoryId).filter(id=>canVisitScoutTerritory(account,world,id)))].sort();
    const old=account.fog?.seasonId===world.seasonId?account.fog:null;
    const previous=old?.schemaVersion===FOG_RULES.schemaVersion?old:null;
    const exploredSources=new Set((previous?.exploredSourceTerritoryIds??[]).filter(id=>world.territories[id]));
    owned.forEach(id=>exploredSources.add(id));
    const exploredScouts=[...new Set([...(previous?.exploredScoutTerritoryIds??[]),...scoutSources])].filter(id=>world.territories[id]).sort();
    const preview=this.preview(account,world);
    let baseVisible,visible;
    if(this.spatial){
      // Retain only each account's current geometry result. The shared 24-plan
      // renderer cache otherwise thrashes when a server has more than 24 owners.
      // Do not cache ownership, diplomacy, encounters or exploration state.
      const key=JSON.stringify([owned,scoutSources]);
      let cached=this.accountSight.get(account);
      if(!cached||cached.key!==key){cached={key,base:this.spatial.visibleIds(scoutSources.length?this.spatial.mergePlans([this.spatial.plan(owned),...scoutSources.map(id=>this.spatial.plan([id]))]):this.spatial.plan(owned))};this.accountSight.set(account,cached);}
      baseVisible=cached.base;
      if(preview){
        if(cached.previewId!==preview.id){cached.previewId=preview.id;cached.preview=this.spatial.visibleIds(scoutSources.length?this.spatial.mergePlans([this.spatial.plan(owned,preview),...scoutSources.map(id=>this.spatial.plan([id]))]):this.spatial.plan(owned,preview));}
        visible=cached.preview;
      }else{delete cached.previewId;delete cached.preview;visible=baseVisible;}
    }else{
      const base=new Set([...owned,...scoutSources]);for(const id of [...owned,...scoutSources])for(const n of this.neighbours.get(id)??[])if(world.territories[n])base.add(n);
      baseVisible=[...base].sort();visible=[...new Set([...baseVisible,...(preview?.routes??[]).map(r=>r.targetTerritoryId)])].sort();
    }
    // Preview-only destinations NEVER become permanent exploration footprints.
    const explored=new Set((previous?.exploredTerritoryIds??[]).map(id=>this.aliases[id]??id).filter(id=>world.territories[id]));
    baseVisible.forEach(id=>explored.add(id));
    const shared=[...new Set([...sharedHeadquarters(world,account.id),...alliedTerritoryIds(world,account.id)])];
    visible=[...new Set([...visible,...shared])].sort();
    const sharedViews=share?allianceMembers(world,account.id).filter(id=>id!==account.id).map(id=>this.accounts.get(id)).filter(a=>a?.homeTerritoryId).map(a=>this.update(a,world,{share:false}).view):[];
    const sharedVision=sharedViews.map(v=>({scoutSourceTerritoryIds:v.scoutSourceTerritoryIds,exploredScoutTerritoryIds:v.exploredScoutTerritoryIds,sourceTerritoryIds:v.sourceTerritoryIds,exploredSourceTerritoryIds:v.exploredSourceTerritoryIds,sharedTerritoryIds:v.sharedTerritoryIds,preview:v.preview}));
    visible=[...new Set([...visible,...sharedViews.flatMap(v=>v.visibleTerritoryIds)])].sort();
    const met=new Set((old?.metPlayerIds??[]).filter(id=>id!==account.id)),firstMetAt={...(old?.firstMetAt??{})};
    for(const id of visible){const e=world.territories[id];if(e?.ownerType!=="player"||!e.ownerId||e.ownerId===account.id)continue;if(!met.has(e.ownerId))firstMetAt[e.ownerId]=this.now();met.add(e.ownerId);}
    const record={exploredScoutTerritoryIds:exploredScouts,schemaVersion:FOG_RULES.schemaVersion,seasonId:world.seasonId,exploredSourceTerritoryIds:[...exploredSources].sort(),exploredTerritoryIds:[...explored].sort(),metPlayerIds:[...met].sort(),firstMetAt};
    const changed=JSON.stringify(account.fog??null)!==JSON.stringify(record);if(changed)account.fog=record;
    return {changed,view:{enabled:true,schemaVersion:FOG_RULES.schemaVersion,sightRings:FOG_RULES.sightRings,
      sharedVision,scoutSourceTerritoryIds:scoutSources,exploredScoutTerritoryIds:exploredScouts,sharedTerritoryIds:shared,sourceTerritoryIds:owned,exploredSourceTerritoryIds:record.exploredSourceTerritoryIds,
      visibleTerritoryIds:visible,baseVisibleTerritoryIds:[...new Set([...baseVisible,...shared,...sharedViews.flatMap(v=>v.visibleTerritoryIds)])].sort(),exploredTerritoryIds:[...new Set([...record.exploredTerritoryIds,...sharedViews.flatMap(v=>v.exploredTerritoryIds)])].sort(),
      metPlayerIds:record.metPlayerIds,navalVisibleTerritoryIds:visible.filter(id=>!baseVisible.includes(id)&&!shared.includes(id)),preview}};
  }
  survey(account,world,result,{coalitionId=null}={}) {
    this.update(account,world);if(!account.homeTerritoryId)return null;
    const preview={coalitionId,id:crypto.randomUUID(),seasonId:world.seasonId,sourceTerritoryId:result.sourceTerritoryId,sourcePoint:[...result.sourcePoint],
      routes:result.routes.map(r=>({targetTerritoryId:r.targetTerritoryId,...(r.targetPoint?{targetPoint:[...r.targetPoint]}:{})})),expiresAt:this.now()+FOG_RULES.previewLifetime};
    this.previews.set(account.id,preview);this.update(account,world);return preview;
  }
  clearPreview(account,id) {const p=this.previews.get(account.id);if(p&&(!id||p.id===id))this.previews.delete(account.id);}
  renewPreview(account,id) {
    const p=this.previews.get(account.id);if(!p||p.id!==id||p.expiresAt<=this.now())throw Object.assign(new Error("海岸预览已结束，请重新测绘"),{statusCode:409});
    p.expiresAt=this.now()+FOG_RULES.previewLifetime;return {previewId:p.id,expiresAt:p.expiresAt};
  }
  refreshAll(accounts,world) {
    let changed=false;for(const account of accounts?.values()??[])changed=this.update(account,world).changed||changed;
    for(const account of accounts?.values()??[])for(const id of account.homeTerritoryId&&account.fog?.seasonId===world?.seasonId?account.fog.metPlayerIds:[]){
      const other=accounts.get(id);if(!other?.homeTerritoryId||other.fog?.seasonId!==world?.seasonId||other.fog.metPlayerIds.includes(account.id))continue;
      other.fog.metPlayerIds=[...other.fog.metPlayerIds,account.id].sort();other.fog.firstMetAt[account.id]=account.fog.firstMetAt[id]??this.now();changed=true;
    }return changed;
  }
}
