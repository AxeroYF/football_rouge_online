import {assertConstructionSlot} from '../../shared/buildings/construction-limit.mjs';
import crypto from 'node:crypto';
import { WONDERS, WONDER_BY_ID, WONDER_VERSION } from '../../shared/config/wonders.mjs';
import { BUILDING_RULES } from '../../shared/config/buildings.mjs';
import { normalizeWonderConstruction, wonderRequirementOptions } from '../../shared/config/wonder-construction.mjs';

const fail = (message, statusCode=400) => {throw Object.assign(new Error(message),{statusCode});};
const restore = (object,before) => {for(const key of Object.keys(object))delete object[key];Object.assign(object,before);};
export const wonderDay = at => new Date(at+8*3600000).toISOString().slice(0,10);
export class WonderService {
 constructor({world,accounts,territoryIndex,resources,players=[],economy,now=Date.now,save=()=>{},getProduction=()=>0}) {
  this.version=WONDER_VERSION;
  Object.assign(this,{world,accounts,resources,economy,now,save,getProduction});
  this.metadata=new Map((territoryIndex?.territories??[]).map(t=>[t.territoryId,t]));
  this.options=wonderRequirementOptions(players,Object.fromEntries(WONDERS.map(w=>[w.assetId,w])));
  this.options.clubs=[...new Set([...this.options.clubs,...WONDERS.flatMap(w=>w.construction.playerCollection?.clubs??[])])];
  this.getConstruction=id=>WONDER_BY_ID.get(id)?.construction;
 }
 entries(account, active=true) {
  return Object.entries(this.world?.territories??{}).filter(([,t])=>t.ownerType==='player'&&t.ownerId===account?.id)
   .flatMap(([territoryId,t])=>(t.buildings??[]).filter(b=>WONDER_BY_ID.has(b.wonderId)&&(!active||b.status==='active')).map(building=>({territoryId,building})));
 }
 allEntries(){return Object.entries(this.world?.territories??{}).flatMap(([territoryId,territory])=>(territory.buildings??[]).filter(building=>WONDER_BY_ID.has(building.wonderId)).map(building=>({territoryId,territory,building})));}
 completedWonders(){
  const winners=new Map();
  for(const entry of this.allEntries().filter(e=>(e.building.status==='active'||e.building.raidSuppressed?.status==='active')&&(e.building.wonderActivatedAt!=null||!e.building.productionWork)).sort((a,b)=>Number(a.building.builtAt??a.building.wonderActivatedAt??0)-Number(b.building.builtAt??b.building.wonderActivatedAt??0)||String(a.building.id).localeCompare(String(b.building.id))))if(!winners.has(entry.building.wonderId))winners.set(entry.building.wonderId,entry);
  return winners;
 }
 has(account,id){return this.entries(account).some(e=>e.building.wonderId===id);}
 nearby(account,id,territoryId){return this.entries(account).some(e=>e.building.wonderId===id&&(e.territoryId===territoryId||(this.metadata.get(e.territoryId)?.landNeighbors??[]).includes(territoryId)));}
 roster(account){return [...new Map((account?.draft?.roster??[]).map(p=>[p.cardDefinitionId??p.id,p])).values()];}
 modifiers(account){
  const ids=new Set(this.entries(account).map(e=>e.building.wonderId)),has=id=>ids.has(id);
  return {packChoices:has('sagrada-familia')?4:3,scoutChoices:has('british-museum')?4:3,trainingPoints:has('colosseum')?6:5,
   trainingSelection:has('alhambra'),sponsorDurationMultiplier:has('versailles-palace')?1.5:1,protectionCostMultiplier:has('leaning-tower-pisa')?.7:1,
   maritimeTimeMultiplier:has('belem-tower')?.7:1,maritimeFitnessMultiplier:has('belem-tower')?.7:1,
   fanGrowth:has('christ-the-redeemer')?150:100,idleFanGold:has('palacio-salvo'),scienceProductionRatio:has('museum-of-tomorrow')?.25:0,
   neutralAttacksBonus:has('brandenburg-gate')?1:0,researchWorkMultiplier:has('acropolis')?.8:1,ticketGoldMultiplier:has('santiago-bernabeu')?1.5:1,
   recurringExpenseMultiplier:has('la-moneda')?.8:1,homeMatchFanRewards:has('maracana')};
 }
 adjustTerritories(account,territories){
  const owned=this.entries(account),ids=new Set(owned.map(e=>e.building.wonderId)),has=id=>ids.has(id),nearby=(id,t)=>owned.some(e=>e.building.wonderId===id&&(e.territoryId===t||(this.metadata.get(e.territoryId)?.landNeighbors??[]).includes(t))),firstLouvre=owned.find(e=>e.building.wonderId==='louvre')?.territoryId;
  return territories.map(t=>{
   const terrain=this.resources?.territories?.[t.territoryId]?.terrain??[],yields={...t.yields};
   if(has('atomium')&&yields.science>0)yields.science+=2;
   if(has('machu-picchu')&&terrain.includes('mountain')){yields.production+=2;yields.science+=2;}
   if(firstLouvre===t.territoryId)yields.science+=Math.min(30,new Set(this.roster(account).map(p=>p.nationality).filter(Boolean)).size*2);
   if(nearby('pont-du-gard',t.territoryId))yields.production*=1.5;
   if(owned.some(e=>e.territoryId===t.territoryId&&e.building.wonderId==='elizabeth-tower'))yields.gold*=2;
   if(has('museum-of-tomorrow'))yields.production+=yields.science*.25;
   return {...t,yields,fanRequirement:nearby('neuschwanstein',t.territoryId)?800:1000};
  });
 }
 collectionProgress(account, requirement){
  if(!requirement)return null;
  const p=requirement,roster=this.roster(account).filter(v=>(!p.nationalities?.length||p.nationalities.includes(v.nationality))&&(!p.clubs?.length||p.clubs.includes(v.club))&&(!p.pools?.length||p.pools.includes(v.pool)));
  const current=roster.length,nationalities=new Set(roster.map(v=>v.nationality).filter(Boolean)).size;
  return {current,required:p.minDistinctPlayers,nationalities,requiredNationalities:p.minNationalities??null,
   filterLabel:[p.nationalities?.join('／'),p.clubs?.join('／'),p.pools?.map(v=>this.options.pools.find(o=>o.value===v)?.label??v).join('／')].filter(Boolean).join(' · ')||'全部球员',
   met:current>=p.minDistinctPlayers&&(!p.minNationalities||nationalities>=p.minNationalities)};
 }
 preview(account){
  const holdings=new Map();
  for(const [territoryId,t] of Object.entries(this.world.territories??{}))for(const b of t.buildings??[]){
   if(!WONDER_BY_ID.has(b.wonderId)||!['active','constructing'].includes(b.status))continue;
   const owner=t.ownerType==='player'?this.accounts.get(t.ownerId):null,meta=this.metadata.get(territoryId);
   if(b.status==='constructing'&&owner?.id!==account.id)continue;
   const item={ownerName:owner?.draft?.teamName||owner?.nickname||'中立',mine:owner?.id===account.id,territoryLabel:meta?`${meta.country} · ${meta.name}`:territoryId,
    status:b.status,progress:b.status==='active'?100:Math.max(0,Math.min(100,100*Number(b.productionWork?.completed??0)/Math.max(1,Number(b.productionWork?.required??1))))};
   if(!holdings.has(b.wonderId))holdings.set(b.wonderId,[]);holdings.get(b.wonderId).push(item);
  }
  const labels=(values,options)=>values.map(v=>options.find(o=>o.value===v)?.label??v).join('、');
  return {version:WONDER_VERSION,serverNow:this.now(),wonders:WONDERS.map(w=>{
   const construction=normalizeWonderConstruction(this.getConstruction(w.assetId),this.options),requirements=[];
   if(construction.terrain.anyOf.length)requirements.push('地形任选：'+labels(construction.terrain.anyOf,this.options.terrain));
   if(construction.terrain.allOf.length)requirements.push('地形全部满足：'+labels(construction.terrain.allOf,this.options.terrain));
   if(!construction.terrain.anyOf.length&&!construction.terrain.allOf.length)requirements.push('地形不限');
   if(construction.adjacentBuildings.length)requirements.push('相邻自有且已建成：'+labels(construction.adjacentBuildings,this.options.buildings));
   return {wonderId:w.assetId,label:w.name,region:w.region,iconPath:`./assets/wonders/icons/${w.assetId}.png?v=20260907-color-v2`,modelUrl:`./assets/wonders/models/${w.assetId}.glb?v=20260907-color-v2`,
    effectText:w.effectText,dependency:w.dependency,construction,requirements,collection:this.collectionProgress(account,construction.playerCollection),owners:holdings.get(w.assetId)??[]};
  })};
 }
 requirements(account,territoryId,id,requirements=this.getConstruction(id),ignoreSlots=false){
  if(!WONDER_BY_ID.has(id))fail('奇观不存在',404);
  const c=normalizeWonderConstruction(requirements,this.options),t=this.world?.territories?.[territoryId],checks=[];
  const check=(label,met)=>checks.push({label,met:!!met});
  check('拥有该地块',account?.setupComplete&&t?.ownerType==='player'&&t.ownerId===account.id);
  if(!ignoreSlots){check('有空闲建筑槽位',(t?.buildings?.length??0)<(t?.capitalOf===account?.id?BUILDING_RULES.capitalSlotLimit:BUILDING_RULES.standardTerritorySlotLimit));check('每位玩家同一奇观最多一座（含在建）',!this.entries(account,false).some(e=>e.building.wonderId===id));}
  check('该奇观尚未在全服建成',!this.completedWonders().has(id));
  check('生产力需求已配置',c.totalProduction>0);
  const tags=this.resources?.territories?.[territoryId]?.terrain??[];
  const labels=values=>values.map(v=>this.options.terrain.find(t=>t.value===v)?.label??v).join('、');
  if(c.terrain.anyOf.length)check('地形任选：'+labels(c.terrain.anyOf),c.terrain.anyOf.some(v=>tags.includes(v)));
  if(c.terrain.allOf.length)check('地形全部：'+labels(c.terrain.allOf),c.terrain.allOf.every(v=>tags.includes(v)));
  const neighbors=(this.metadata.get(territoryId)?.landNeighbors??[]).map(id=>this.world.territories[id]).filter(n=>n?.ownerType==='player'&&n.ownerId===account.id);
  for(const type of c.adjacentBuildings)check('相邻'+(this.options.buildings.find(b=>b.value===type)?.label??type),neighbors.some(n=>(n.buildings??[]).some(b=>b.type===type&&b.status==='active')));
  const collection=this.collectionProgress(account,c.playerCollection);
  if(collection){
   check(`不同球员 ${collection.current}/${collection.required} · ${collection.filterLabel}`,collection.current>=collection.required);
   if(collection.requiredNationalities)check(`至少 ${collection.requiredNationalities} 种国籍`,collection.nationalities>=collection.requiredNationalities);
  }
  return {construction:c,checks,canBuild:checks.every(v=>v.met)};
 }
 catalog(){return WONDERS.map(w=>({type:'wonder:'+w.assetId,wonderId:w.assetId,label:w.name,iconPath:`./assets/wonders/icons/${w.assetId}.png?v=20260907-color-v2`,buildable:false,wonder:true,effectText:w.effectText,dependency:w.dependency}));}
 available(account,id){return WONDERS.map(w=>({...this.catalog().find(c=>c.wonderId===w.assetId),...this.requirements(account,id,w.assetId)}));}
 publicBuilding(b){const w=WONDER_BY_ID.get(b.wonderId);if(!w)return null;return {...b,label:w.name,iconPath:`./assets/wonders/icons/${w.assetId}.png?v=20260907-color-v2`,wonder:true,effectText:w.effectText,dependency:w.dependency,capabilities:[],maxLevel:1,upgradeEnabled:false,nextUpgradeCostGold:null,remainingConstructionMs:b.status==='constructing'?(b.completesAt==null?null:Math.max(0,b.completesAt-this.now())):0};}
 build(account,territoryId,id,method){
  if(method!=='production')fail('奇观只能使用生产力建造');
  if(this.world.territories[territoryId]?.raidSuppression)fail('地块受豪门压制，恢复后才能建造');
  this.save();
  assertConstructionSlot(account,this.world);
  const gate=this.requirements(account,territoryId,id);if(!gate.canBuild)fail(gate.checks.filter(c=>!c.met).map(c=>c.label).join('；'),409);
  const territory=this.world.territories[territoryId],before=structuredClone(territory),revision=this.world.revision;
  try{
   const at=this.now(),b={id:'wonder:'+crypto.randomUUID(),type:'wonder:'+id,wonderId:id,level:1,status:'constructing',builtAt:null,updatedAt:at,constructionStartedAt:at,completesAt:null,buildMethod:'production',buildCostProduction:gate.construction.totalProduction,
    constructionRequirements:structuredClone(gate.construction),effectVersion:WONDER_VERSION,productionWork:{required:gate.construction.totalProduction*BUILDING_RULES.productionPeriodMs,completed:0,updatedAt:at,ownerId:account.id}};
   territory.buildings??=[];territory.buildings.push(b);territory.version=Number(territory.version??0)+1;this.world.revision=Number(revision??0)+1;
   this.save();return {building:this.publicBuilding(b)};
  }catch(error){restore(territory,before);this.world.revision=revision;throw error;}
 }
 cancel(account,territoryId,buildingId){
  const territory=this.world.territories?.[territoryId];
  if(!account?.setupComplete||territory?.ownerType!=='player'||territory.ownerId!==account.id)fail('只能中止自己领地的奇观建造',403);
  // Accrue work up to this instant before changing the allocation among projects.
  this.save();
  const building=territory.buildings?.find(b=>b.id===buildingId);
  if(!building)fail('奇观施工项目不存在或已中止',404);
  if(!WONDER_BY_ID.has(building.wonderId)||building.status!=='constructing')fail('只能中止尚未建成的奇观',409);
  const before=structuredClone(territory),revision=this.world.revision;
  try{
   territory.buildings=territory.buildings.filter(b=>b.id!==buildingId);
   territory.version=Number(territory.version??0)+1;this.world.revision=Number(revision??0)+1;
   // Work already invested is discarded; remaining projects get future capacity only.
   this.save();return {cancelledBuildingId:buildingId,refundProduction:0};
  }catch(error){restore(territory,before);this.world.revision=revision;throw error;}
 }
 // A completed monument keeps its prerequisites as admission checks, not a permanent roster lock.
 synchronize(at){
  const entries=this.allEntries(),winners=this.completedWonders(),ready=[];
  for(const entry of entries){
   const {territoryId,territory:t,building:b}=entry,account=t.ownerType==='player'?this.accounts.get(t.ownerId):null;
   if(b.raidSuppressed||!account||b.wonderActivatedAt!=null||!b.productionWork||winners.has(b.wonderId))continue;
   const gate=this.requirements(account,territoryId,b.wonderId,b.constructionRequirements,true);
   const adjacencyOk=gate.checks.filter(c=>c.label.startsWith('相邻')||c.label==='拥有该地块').every(c=>c.met);
   b.productionWork.paused=!adjacencyOk;b.blockedReason=!adjacencyOk?gate.checks.filter(c=>!c.met).map(c=>c.label).join('；'):null;
   if(b.productionWork.completed>=b.productionWork.required-1e-6){
    if(gate.canBuild)ready.push({...entry,account,completedAt:b.builtAt??at});
    else{b.status='constructing';b.builtAt=null;b.productionWork.paused=true;b.completesAt=null;b.blockedReason=gate.checks.filter(c=>!c.met).map(c=>c.label).join('；');}
   }
  }
  // Same millisecond: earlier start, then stable building id. World iteration order never decides.
  ready.sort((a,b)=>a.completedAt-b.completedAt||Number(a.building.constructionStartedAt??0)-Number(b.building.constructionStartedAt??0)||String(a.building.id).localeCompare(String(b.building.id)));
  for(const entry of ready){
   const {territory:t,building:b,account,completedAt}=entry;if(winners.has(b.wonderId))continue;
   b.status='active';b.builtAt=completedAt;b.wonderActivatedAt=completedAt;b.rewardOwnerId=account.id;b.blockedReason=null;
   t.version=Number(t.version??0)+1;this.world.revision=Number(this.world.revision??0)+1;winners.set(b.wonderId,entry);
  }
  for(const {territoryId,territory:t,building:b} of entries){
   const winner=winners.get(b.wonderId);if(!winner||winner.building===b||b.wonderActivatedAt!=null||!b.productionWork)continue;
   const account=t.ownerType==='player'?this.accounts.get(t.ownerId):null;
   if(account){
    const id='wonder-race:'+b.id,spent=Math.max(0,Math.min(Number(b.productionWork.required)||0,Number(b.productionWork.completed)||0))/BUILDING_RULES.productionPeriodMs,amount=spent*.5;
    account.wonderCompetitionNotices??=[];
    if(!account.wonderCompetitionNotices.some(n=>n.id===id)){
     const owner=winner.territory.ownerType==='player'?this.accounts.get(winner.territory.ownerId):null;
     const notice={id,wonderId:b.wonderId,label:WONDER_BY_ID.get(b.wonderId).name,territoryId,winnerName:owner?.draft?.teamName||owner?.nickname||'其他俱乐部',completedAt:winner.building.builtAt??at,createdAt:at,spentProduction:spent,refundProduction:amount,rewardId:amount>0?id:null};
     account.wonderCompetitionNotices.push(notice);
     if(amount>0){account.pendingNeutralRewards??=[];account.pendingNeutralRewards.push({id,kind:'production',source:'wonder-competition',wonderId:b.wonderId,label:notice.label,sourceTerritoryId:territoryId,amount,totalAmount:amount,receivedAt:at,status:'pending'});}
    }
   }
   t.buildings=t.buildings.filter(v=>v!==b);t.version=Number(t.version??0)+1;this.world.revision=Number(this.world.revision??0)+1;
  }
  for(const {territory:t,building:b} of this.allEntries()){
   const account=t.ownerType==='player'?this.accounts.get(t.ownerId):null;
   if(account&&b.status==='active'&&b.wonderId==='elizabeth-tower'&&b.rewardOwnerId===account.id){
    account.wonderRewards??={};if(!account.wonderRewards['elizabeth-tower']){this.economy.adjust(account,Math.floor(Number(account.gold??0)*.5),'wonder:elizabeth-tower');account.wonderRewards['elizabeth-tower']={at};}
   }
  }
 }
 acknowledgeCompetition(account,id){
  const notice=(account.wonderCompetitionNotices??[]).find(n=>n.id===id);if(!notice)fail('通知不存在',404);if(notice.readAt!=null)return;
  notice.readAt=this.now();try{this.save();}catch(error){delete notice.readAt;const restored=(account.wonderCompetitionNotices??[]).find(n=>n.id===id);if(restored)delete restored.readAt;throw error;}
 }
 grantFans(account,amount){account.resources={...account.resources,fans:Number(account.resources?.fans??5000)+amount};}
 packChosen(account,opening,player){if(!this.has(account,'teatro-colon'))return;const reward=player.grade==='S'?300:player.grade==='A'?100:0;if(!reward)return;
  const day=wonderDay(this.now()),record=account.wonderPackFans??{day,total:0,events:[]};if(record.events.includes(opening.id))return;
  const state=record.day===day?structuredClone(record):{day,total:0,events:[]};const amount=Math.min(reward,1000-state.total);state.total+=amount;state.events.push(opening.id);account.wonderPackFans=state;this.grantFans(account,amount);
 }
 researchRequirement(account,kind,work){return Math.ceil(work*(['formation','tactic'].includes(kind)?this.modifiers(account).researchWorkMultiplier:1));}
 recurringExpense(account,kind,gold){return Math.ceil(gold*(['wages','maintenance'].includes(kind)?this.modifiers(account).recurringExpenseMultiplier:1));}
 ticketIncome(account,match,gold){return Math.floor(gold*(match?.kind==='league'&&match.homeAccountId===account.id?this.modifiers(account).ticketGoldMultiplier:1));}
 homeMatchCompleted(account,match){
  if(!match?.id||match.kind!=='league'||match.homeAccountId!==account.id||!this.modifiers(account).homeMatchFanRewards)return 0;
  const day=wonderDay(match.settledAt??this.now());account.wonderHomeEvents??={};if(account.wonderHomeEvents[match.id])return 0;
  account.wonderHomeEvents[match.id]={day};const count=Object.values(account.wonderHomeEvents).filter(e=>e.day===day).length;
  const amount=count<=3?(match.result==='win'?500:match.result==='draw'?200:0):0;this.grantFans(account,amount);return amount;
 }
 seaTravel(account,base){const m=this.modifiers(account);return {...base,durationMs:Math.ceil(base.durationMs*m.maritimeTimeMultiplier),fitnessCost:Number(base.fitnessCost??0)*m.maritimeFitnessMultiplier};}
 isSeaJourney(from,to){
  const visited=new Set([from]),queue=[from];
  while(queue.length){const id=queue.shift();if(id===to)return false;for(const n of this.metadata.get(id)?.landNeighbors??[])if(!visited.has(n)){visited.add(n);queue.push(n);}}
  return true;
 }
 challengeCompleted(account,challenge){
  if(!account||!this.has(account,'las-lajas-sanctuary')||account.wonderChallengeEvents?.includes(challenge.id))return;
  const participants=new Set(),injured=new Set();
  for(const leg of [challenge.live?.firstLeg,challenge.live?.secondLeg]){
   const found=leg?.match?.teams?.findIndex(t=>t.id===account.id);
   const index=found>=0?found:(leg===challenge.live?.firstLeg?0:1);
   for(const p of leg?.match?.teams?.[index]?.players??[]){if(p.startedMatch||p.active||p.sentOff)participants.add(p.id);if(p.injury)injured.add(p.id);}
   for(const event of leg?.match?.events??[])if(event.teamIndex===index&&event.type==='substitution'&&event.incomingPlayerId)participants.add(event.incomingPlayerId);
  }
  if(!participants.size)return;
  for(const p of account.draft?.roster??[])if(participants.has(p.id)&&!injured.has(p.id)&&Number(p.state?.injury?.matchesRemaining??p.state?.injuryMatches??p.state?.injuryRounds??0)<=0){p.state={...p.state,fitness:Math.min(100,Number(p.state?.fitness??p.fitness??100)+15)};if(Object.hasOwn(p,'fitness'))p.fitness=p.state.fitness;}
  account.wonderChallengeEvents=[...(account.wonderChallengeEvents??[]),challenge.id].slice(-1000);
 }
 publicState(account){return {competitionNotices:(account.wonderCompetitionNotices??[]).filter(n=>n.readAt==null).map(n=>structuredClone(n)),version:WONDER_VERSION,modifiers:this.modifiers(account),owned:this.entries(account,false).map(e=>({territoryId:e.territoryId,...this.publicBuilding(e.building)}))};}
}
