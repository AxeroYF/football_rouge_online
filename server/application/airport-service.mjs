import {receipt} from './receipt-retention.mjs';
import crypto from 'node:crypto';
import {coalitionOilShares} from '../../shared/config/coalition.mjs';
import {createUnitMovement} from '../domain/expedition-piece.mjs';
import {canUseTerritory} from '../../shared/config/diplomacy.mjs';
import {territoryTravelEstimate} from '../domain/expedition-piece.mjs';
import {airportIdentity} from '../../shared/config/airport-identity.mjs';
const fail=(message,statusCode=409)=>{throw Object.assign(Error(message),{statusCode});};
const restore=(target,old)=>{for(const k of Object.keys(target))delete target[k];Object.assign(target,old);};
export class AirportService {
 constructor(c){this.c=c;}
 airport(ownerId,id){const t=this.c.world?.territories?.[id];return canUseTerritory(this.c.world,ownerId,id)&&!t?.raidSuppression?t?.buildings?.find(b=>b.type==='airport'&&b.status==='active'&&!b.raidSuppressed):null;}
 identity(id){const t=this.c.world.territories[id],a=this.c.accounts.get(t.ownerId),meta=this.c.territoryIndex.territories.find(t=>t.territoryId===id);return airportIdentity({clubName:a?.draft?.teamName??a?.nickname,territoryName:meta?.name,playerColor:a?.mapColor,playerId:t.ownerId});}
 units(a){const entries=[];if(a.expeditionPiece?.territoryId)entries.push({kind:'expedition',id:'expedition',name:'远征队',unit:a.expeditionPiece});
  for(const s of Object.values(a.scouting?.units??{}))entries.push({kind:'scout',id:s.id,name:s.name??'球探',unit:s});
  for(const army of this.c.coalitions.all())if(!army.disbandedAt&&army.commanderId===a.id)entries.push({kind:'coalition',id:army.id,name:army.name??'联军',unit:army});return entries;
 }
 requireUnit(a,body){const entry=this.units(a).find(e=>e.kind===body.kind&&e.id===body.unitId);if(!entry)fail('单位不存在或无指挥权',403);return entry;}
 idle(a,entry){if(entry.unit.movement)fail('单位正在移动');if(entry.kind==='expedition')this.c.ensureExpeditionCanMove(a);else if(entry.kind==='scout')this.c.scouting.requireIdle(a,entry.unit);else{this.c.coalitions.command(a,entry.unit);this.c.coalitions.idle(entry.unit);}}
 view(a,territoryId){if(!this.airport(a.id,territoryId))fail('机场尚未建成、被压制或不属于己方及盟友',403);return {name:this.identity(territoryId).name,territoryId,gold:a.gold,
  units:this.units(a).filter(e=>e.unit.territoryId===territoryId).map(e=>{let blocked=null;try{this.idle(a,e);}catch(error){blocked=error.message;}return {kind:e.kind,id:e.id,name:e.name,blocked};}),
  destinations:Object.keys(this.c.world.territories).filter(id=>id!==territoryId&&this.airport(a.id,id)).map(id=>({id,name:this.identity(id).name})),serverNow:this.c.now()};}
 quote(a,body){const entry=this.requireUnit(a,body);this.idle(a,entry);const from=entry.unit.territoryId,to=String(body.territoryId??'');
  if(from===to)fail('单位已经在该机场');const source=this.airport(a.id,from),target=this.airport(a.id,to);if(!source||!target)fail('起点和终点都必须有可使用的已建成机场');
  const base=territoryTravelEstimate(this.c.territoryIndex,from,to,{displayCoordinates:true}),band=Math.max(1,Math.ceil(base.distanceKm/500)),price=entry.kind==='scout'?[200,40]:[500,100];
  const goldCost=price[0]+price[1]*band;
  const shares=(entry.kind==='coalition'?coalitionOilShares(this.c.coalitions.members(entry.unit),goldCost,entry.unit.airportGoldCursor):[{ownerId:a.id,amount:goldCost}]).map(s=>({...s,name:this.c.accounts.get(s.ownerId)?.draft?.teamName??s.ownerId,balance:this.c.accounts.get(s.ownerId)?.gold??0}));
  const quoteId=crypto.createHash('sha256').update(JSON.stringify([entry.id,entry.unit.revision,from,to,source.id,target.id,shares.map(({ownerId,amount})=>({ownerId,amount}))])).digest('hex');
  return {...base,distanceBasis:'campaign-map',shares,quoteId,transport:'airport',mode:'air',durationMs:60000,stepDurationMs:60000,path:[from,to],routeMode:'direct',goldCost,oilSpent:0,useOil:false,
    sourceAirportId:source.id,targetAirportId:target.id,fromName:this.identity(from).name,toName:this.identity(to).name};
 }
 move(a,body){if(!a.setupComplete)fail('请先建队',403);if(!/^[\w:.-]{8,128}$/.test(String(body.requestId??'')))fail('请求编号无效',400);
  const signature=JSON.stringify([body.kind,body.unitId,body.territoryId]),prior=receipt(a,'airportRequests',body.requestId,this.c.now());if(prior){if(prior.signature!==signature)fail('请求编号已用于其他航班');return prior.result;}
  this.c.save();const entry=this.requireUnit(a,body),quote=this.quote(a,body);if(body.goldCost!==quote.goldCost)fail('机票价格已变化，请重新预览');
  if(entry.kind==='coalition'&&body.quoteId!==quote.quoteId)fail('机票分摊已变化，请重新预览');
  const payers=quote.shares.map(s=>this.c.accounts.get(s.ownerId));
  const before=[...new Set([a,...payers])].map(p=>[p,structuredClone(p)]),oldUnit=structuredClone(entry.unit),revision=this.c.world.revision;
  try{for(const s of quote.shares)if(s.amount>0)this.c.economy.spend(this.c.accounts.get(s.ownerId),s.amount,'airport-ticket');const startedAt=this.c.now();entry.unit.movement={...createUnitMovement(quote,startedAt),id:body.requestId,payerId:a.id};if(entry.kind==='coalition'){entry.unit.revision++;entry.unit.proposal=null;entry.unit.airportGoldCursor=(entry.unit.airportGoldCursor??0)+quote.goldCost%quote.shares.length;}
   const result={requestId:body.requestId,goldCost:quote.goldCost,arrivesAt:startedAt+60000};a.airportRequests??={};a.airportRequests[body.requestId]={signature,result,recordedAt:this.c.now()};this.c.world.revision++;this.c.save();return result;
  }catch(error){for(const [payer,snapshot] of before)restore(payer,snapshot);if(entry.kind==='coalition'){restore(entry.unit,oldUnit);const current=this.c.world.coalitions[entry.id];if(current!==entry.unit)restore(current,oldUnit);}this.c.world.revision=revision;throw error;}
 }
 flights(){return [...this.c.accounts.values()].flatMap(a=>this.units(a).filter(e=>e.unit.movement?.transport==='airport').map(e=>({...e,account:a})));}
 due(at){return this.flights().some(e=>e.unit.movement.arrivesAt<=at);}
 prepare(at){const changes=[],revision=this.c.world?.revision;const rollback=()=>{for(const e of changes.reverse()){restore(e.unit,e.before);for(const p of e.payers){p.account.gold=p.gold;p.account.goldLedger=p.ledger;}}if(this.c.world)this.c.world.revision=revision;};
  try{for(const {account:a,unit}of this.flights()){const m=unit.movement;if(m.arrivesAt>at)continue;const shares=m.shares??[{ownerId:m.payerId??a.id,amount:m.goldCost}];const payers=shares.map(s=>this.c.accounts.get(s.ownerId)).filter(Boolean);changes.push({unit,before:structuredClone(unit),payers:payers.map(account=>({account,gold:account.gold,ledger:structuredClone(account.goldLedger)}))});
   const valid=this.airport(a.id,m.toTerritoryId)?.id===m.targetAirportId;
   if(valid)unit.territoryId=m.toTerritoryId;
   else{const source=this.airport(a.id,m.fromTerritoryId);unit.territoryId=source?.id===m.sourceAirportId?m.fromTerritoryId:
    canUseTerritory(this.c.world,a.id,a.homeTerritoryId)&&this.c.world.territories[a.homeTerritoryId]?.ownerId===a.id?a.homeTerritoryId:
    Object.keys(this.c.world.territories).find(id=>this.c.world.territories[id].ownerId===a.id)??null;
    for(const s of shares){const payer=this.c.accounts.get(s.ownerId);if(payer&&s.amount>0)this.c.economy.adjust(payer,s.amount,'airport-flight-refund');}unit.lastAirportNotice='目的机场失效，已返航并退还机票';}
   unit.movement=null;if(unit.revision!=null)unit.revision++;this.c.world.revision++;
  }return {rollback};}catch(error){rollback();throw error;}
 }
}
