import { wonderCatalogDetails } from '../client/wonders/wonder-catalog-controller.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CampaignService } from '../campaign-service.mjs';
import { WONDERS } from '../shared/config/wonders.mjs';
import { allocateFans, rankFanTerritories } from '../shared/config/fans.mjs';
import { PLAYER_ATTRIBUTE_LABELS } from '../shared/config/player-attributes.mjs';
import { buildingPanelMarkup } from '../client/buildings/building-panel-controller.js';
const H=3600000;
const players=JSON.parse(fs.readFileSync(new URL('../assets/data/s4-player-catalog.json',import.meta.url),'utf8'));
function fixture(){
 let now=1000;
 const ids=['a','b','c','d'];
 const index={territories:ids.map((id,i)=>({territoryId:id,country:'法国',countryCode:'FRA',region:'europe',name:id,centroid:[2+i,48],bounds:[1+i,47,3+i,49],neighbors:ids.filter(v=>v!==id),landNeighbors:ids.filter(v=>v!==id),cityIds:[],clubIds:[],spawnAllowed:true,initialOwner:{type:'neutral',id:null,name:'中立'}}))};
 const resources={schemaVersion:1,version:'wonder-test',periodMs:H,territories:Object.fromEntries(ids.map(id=>[id,{terrain:['plains','coastal','forest','hills','mountain'],yields:{gold:12,production:10,science:4}}]))};
 const s=new CampaignService({catalog:players,territoryIndex:index,territoryResources:resources,now:()=>now,random:()=>.2});
 const a={id:'one',nickname:'奇观测试',token:'test',setupComplete:true,homeTerritoryId:'a',gold:10000,goldLedger:[],draft:{teamName:'测试队',roster:structuredClone(players.slice(0,22))},playerSquads:{assignments:{}},mapColor:'#123456'};
 s.accounts.set(a.id,a);s.world.players.one={playerId:'one',territoryIds:ids,capitalTerritoryId:'a'};
 for(const id of ids)Object.assign(s.world.territories[id],{ownerType:'player',ownerId:a.id,capitalOf:id==='a'?a.id:null,buildings:[]});s.save();
 const plain=(cost=40)=>({totalProduction:cost,adjacentBuildings:[],terrain:{anyOf:[],allOf:[]},playerCollection:null});
 const build=(id,cost=40,t='a')=>{s.wonders.getConstruction=()=>plain(cost);return s.buildings.build(a,s.world,t,'wonder:'+id,'production').building;};
 const activate=(id,t='a')=>{const b={id:'fixture:'+id,type:'wonder:'+id,wonderId:id,level:1,status:'active',builtAt:now,wonderActivatedAt:now};s.world.territories[t].buildings.push(b);return b;};
 return {s,a,index,resources,plain,build,activate,setNow:v=>now=v};
}
test('all 24 registered wonders have effects, construction options, visible gating and optional conditions',()=>{
 const f=fixture();assert.equal(WONDERS.length,24);assert.ok(WONDERS.every(w=>w.effectText.trim()));
 const view=f.s.buildings.territoryView(f.a,f.s.world,'b');assert.equal(view.availableWonders.length,24);
 const html=buildingPanelMarkup({view,catalog:f.s.buildings.catalog(),escapeHtml:s=>String(s).replaceAll('<','&lt;')});assert.match(html,/奇观建筑/);assert.doesNotMatch(html,/条件未满足/);for(const w of view.availableWonders)assert.equal(html.includes(`data-wonder-id="${w.wonderId}"`),w.canBuild);
 assert.equal(f.s.wonders.requirements(f.a,'b','eiffel-tower',f.plain()).canBuild,true);
});
test('requirements enforce ownership, slots, terrain, all adjacent facilities, distinct roster and nationalities',()=>{
 const {s,a,plain}=fixture();const c={...plain(),adjacentBuildings:['port'],terrain:{anyOf:['coastal'],allOf:['forest']},playerCollection:{minDistinctPlayers:2,nationalities:['葡萄牙'],minNationalities:1}};
 const p=players.find(p=>p.nationality==='葡萄牙');a.draft.roster=[{...p,id:'copy1',cardDefinitionId:p.id},{...p,id:'copy2',cardDefinitionId:p.id}];
 s.world.territories.a.buildings=[{id:'port',type:'port',status:'active'}];assert.equal(s.wonders.requirements(a,'b','belem-tower',c).canBuild,false);
 a.draft.roster.push(structuredClone(players.find(v=>v.nationality==='葡萄牙'&&v.id!==p.id)));assert.equal(s.wonders.requirements(a,'b','belem-tower',c).canBuild,true);
 s.world.territories.a.buildings[0].status='constructing';assert.equal(s.wonders.requirements(a,'b','belem-tower',c).canBuild,false);
 s.world.territories.b.ownerId='other';assert.equal(s.wonders.requirements(a,'b','belem-tower',plain()).canBuild,false);
});
test('wonder construction charges no gold, rejects gold bypass and duplicates, persists locked requirements and completes',()=>{
 const {s,a,build,setNow,plain}=fixture();assert.throws(()=>s.buildings.build(a,s.world,'a','wonder:louvre','gold'),/只能/);
 const b=build('louvre',40);assert.equal(a.gold,10000);assert.equal(b.buildCostProduction,40);assert.throws(()=>build('louvre',40,'b'),/最多一座/);
 s.wonders.getConstruction=()=>plain(99999);setNow(61000);s.save();const actual=s.world.territories.a.buildings[0];assert.equal(actual.status,'active');assert.equal(actual.productionWork.required,40*60000);assert.equal(s.wonders.has(a,'louvre'),true);
});
test('missing adjacency pauses work and restores it; collection is checked again at completion',()=>{
 const {s,a,setNow,plain}=fixture();const c={...plain(80),adjacentBuildings:['port'],playerCollection:{minDistinctPlayers:1,nationalities:['葡萄牙']}};
 a.draft.roster=[structuredClone(players.find(p=>p.nationality==='葡萄牙'))];s.world.territories.b.buildings=[{id:'port',type:'port',status:'active'}];s.wonders.getConstruction=()=>c;
 s.buildings.build(a,s.world,'a','wonder:belem-tower','production');const b=s.world.territories.a.buildings[0];
 s.world.territories.b.buildings[0].status='inactive';s.save();assert.equal(b.productionWork.paused,true);setNow(61000);s.save();assert.equal(b.productionWork.completed,0);
 s.world.territories.b.buildings[0].status='active';s.save();a.draft.roster=[];setNow(181000);s.save();assert.equal(b.status,'constructing');assert.match(b.blockedReason,/球员/);
 a.draft.roster=[structuredClone(players.find(p=>p.nationality==='葡萄牙'))];s.save();assert.equal(b.status,'active');a.draft.roster=[];s.save();assert.equal(b.status,'active');
});
test('offline Big Ben completion awards once using completion-time gold and affects only subsequent tile income',()=>{
 const {s,a,build,setNow}=fixture();const wages=s.operatingCosts.costs(a,s.world).wages;
 build('elizabeth-tower',2400);setNow(1000+2*H);s.save();
 const completionGold=10000+48-Math.floor(wages),expected=completionGold+Math.floor(completionGold*.5)+60-(Math.floor(wages*2)-Math.floor(wages))-30;
 assert.equal(a.gold,expected);assert.equal(s.resourceState(a).hourly.gold,60-s.operatingCosts.costs(a,s.world).total);s.save();assert.equal(a.gold,expected);
 s.world.territories.a.ownerId='other';s.save();assert.equal(s.wonders.has(a,'elizabeth-tower'),false);s.world.territories.a.ownerId='one';s.save();assert.equal(a.gold,expected);
});
test('offline and incremental construction agree across fan-growth and production wonder completions',()=>{
 const run=step=>{const f=fixture();f.build('christ-the-redeemer',2400);f.build('pont-du-gard',1200,'b');for(let t=step;t<=6*H;t+=step){f.setNow(1000+t);f.s.save();}return {gold:f.a.gold,fans:f.a.resources.fans,buildings:Object.values(f.s.world.territories).flatMap(t=>t.buildings).map(b=>[b.wonderId,b.builtAt,b.status])};};assert.deepEqual(run(6*H),run(60000));
});
test('resource wonders combine without loops, respect local fan requirements and optimize idle income',()=>{
 const f=fixture();for(const id of ['louvre','atomium','machu-picchu','pont-du-gard','museum-of-tomorrow','neuschwanstein'])f.activate(id);
 f.a.resources.fans=800;f.s.save();const r=f.s.resourceState(f.a);assert.equal(r.fans.assigned,800);assert.equal(r.fans.required,3200);assert.equal(r.sources.filter(t=>t.fans>0).length,1);assert.ok(r.current.production>18);assert.ok(r.current.science>=8);
 const g=fixture();g.a.resources.fans=5000;g.activate('palacio-salvo');g.a.fanEconomy.preference='gold';g.s.save();assert.equal(g.s.resourceState(g.a).hourly.gold,500-g.s.operatingCosts.costs(g.a,g.s.world).total);assert.equal(g.s.resourceState(g.a).fans.available,5000);assert.equal(g.s.resourceState(g.a).fans.assigned,0);
});
test('construction failure restores newly created wonder and a failed completion restores rewards and income',()=>{
 const f=fixture();f.build('elizabeth-tower',40);f.setNow(61000);const before=JSON.stringify({a:f.a,w:f.s.world});f.s.repository.save=()=>{throw Error('isolated failure');};assert.throws(()=>f.s.save(),/isolated failure/);assert.equal(JSON.stringify({a:f.a,w:f.s.world}),before);
 const g=fixture();g.s.repository.save=()=>{throw Error('isolated failure');};assert.throws(()=>g.build('louvre'),/isolated failure/);assert.equal(g.s.world.territories.a.buildings.length,0);
});
test('pack choice count survives migration and theater fans are limited and exactly once',()=>{
 const f=fixture();f.activate('sagrada-familia');f.activate('teatro-colon');f.s.playerPacks.addPacks(f.a,'exotic-player-pack',1);const o=f.s.playerPacks.open(f.a,'exotic-player-pack');assert.equal(o.cards.length,4);f.s.playerPacks.migrateAccount(f.a);assert.equal(f.a.inventory.pendingOpening.candidateIds.length,4);
 const before=f.a.resources.fans;for(let i=0;i<6;i++)f.s.wonders.packChosen(f.a,{id:'paid-'+i},{grade:'S'});assert.equal(f.a.resources.fans,before+1000);f.s.wonders.packChosen(f.a,{id:'paid-0'},{grade:'S'});assert.equal(f.a.resources.fans,before+1000);
});
test('training adds a point and assigns one within total; capped attributes and unauthorized selection rejected',()=>{
 const f=fixture(),p={attributes:Object.fromEntries(Object.keys(PLAYER_ATTRIBUTE_LABELS).map(k=>[k,50]))};f.activate('colosseum');f.activate('alhambra');
 const m=f.s.wonders.modifiers(f.a),g=f.s.training.gains(p,m.trainingPoints,'passing');assert.equal(Object.values(g).reduce((a,b)=>a+b,0),6);assert.ok(g.passing>=1);p.attributes.passing=99;assert.throws(()=>f.s.training.gains(p,6,'passing'),/上限/);
});
test('scouting, sponsorship and protection modifiers match the approved effects',()=>{
 const f=fixture();for(const id of ['british-museum','eiffel-tower','versailles-palace','leaning-tower-pisa'])f.activate(id);
 const m=f.s.wonders.modifiers(f.a);assert.equal(f.s.scouting.draw(1,'FRA',m.scoutChoices).length,4);assert.equal(f.s.wonders.nearby(f.a,'eiffel-tower','b'),true);assert.equal(m.protectionCostMultiplier,.7);
 f.s.sponsorship.migrateAccount(f.a);const offer={id:'sponsor-offer:wonder',sponsorId:'microsoft',type:'normal',durationDays:1,hourlyGold:200,status:'pending'};f.a.sponsorship.offers.push(offer);assert.equal(f.s.sponsorship.offerView(f.a,offer).durationDays,1.5);f.s.sponsorship.respond(f.a,offer.id,'accept');assert.equal(f.a.sponsorship.contracts[0].expiresAt-f.a.sponsorship.contracts[0].signedAt,36*H);
});
test('sea bonuses apply only to sea travel; deferred hooks exclude wrong systems and duplicate home events',()=>{
 const f=fixture();for(const id of ['belem-tower','brandenburg-gate','acropolis','santiago-bernabeu','la-moneda','maracana'])f.activate(id);
 assert.equal(f.s.wonders.seaTravel(f.a,{durationMs:1000,fitnessCost:10}).durationMs,700);assert.equal(f.s.wonders.seaTravel(f.a,{durationMs:1000,fitnessCost:10}).fitnessCost,7);
 assert.equal(f.s.wonders.researchRequirement(f.a,'formation',100),80);assert.equal(f.s.wonders.researchRequirement(f.a,'enhancement',100),100);assert.equal(f.s.wonders.recurringExpense(f.a,'wages',100),80);assert.equal(f.s.wonders.recurringExpense(f.a,'purchase',100),100);
 assert.equal(f.s.wonders.ticketIncome(f.a,{kind:'league',homeAccountId:f.a.id},100),150);assert.equal(f.s.wonders.ticketIncome(f.a,{kind:'challenge',homeAccountId:f.a.id},100),100);assert.equal(f.s.wonders.modifiers(f.a).neutralAttacksBonus,1);
 const before=f.a.resources.fans;for(let i=0;i<4;i++)f.s.wonders.homeMatchCompleted(f.a,{id:'home-'+i,kind:'league',homeAccountId:f.a.id,result:i===0?'loss':'win'});assert.equal(f.a.resources.fans,before+1000);f.s.wonders.homeMatchCompleted(f.a,{id:'home-1',kind:'league',homeAccountId:f.a.id,result:'win'});assert.equal(f.a.resources.fans,before+1000);
});
test('challenge recovery includes real starters and substitutes, excludes injured and unused bench, and never repeats',()=>{
 const f=fixture();f.activate('las-lajas-sanctuary');f.a.draft.roster=['start','sub','injury','bench'].map(id=>({id,state:{fitness:50}}));
 const challenge={id:'challenge-wonder',live:{firstLeg:{match:{teams:[{players:[{id:'start',startedMatch:true},{id:'sub',active:true},{id:'injury',startedMatch:true,injury:{}},{id:'bench',active:false}]}],events:[]}},secondLeg:{match:{teams:[{}, {players:[]}],events:[]}}}};
 f.s.wonders.challengeCompleted(f.a,challenge);assert.deepEqual(f.a.draft.roster.map(p=>p.state.fitness),[65,65,50,50]);f.s.wonders.challengeCompleted(f.a,challenge);assert.equal(f.a.draft.roster[0].state.fitness,65);
});

test('server wonder preview includes all wonders, live conditions and deduplicated personal collection',()=>{
 const {s,a,plain}=fixture();const pt=players.filter(p=>p.nationality==='葡萄牙').slice(0,3);
 a.draft.roster=[...pt,{...pt[0],id:'duplicate-copy',cardDefinitionId:pt[0].id}];
 const requirement={...plain(7654),playerCollection:{minDistinctPlayers:10,nationalities:['葡萄牙']}};s.wonders.getConstruction=()=>requirement;
 const data=s.wonders.preview(a);assert.equal(data.wonders.length,24);
 const item=data.wonders[0];assert.equal(item.construction.totalProduction,7654);assert.equal(item.collection.current,3);assert.equal(item.collection.required,10);assert.equal(item.collection.met,false);
 const gate=s.wonders.requirements(a,'b',item.wonderId);assert.equal(gate.canBuild,false);
 a.draft.roster=[];assert.equal(s.wonders.preview(a).wonders[0].collection.current,0);
 s.wonders.getConstruction=()=>plain();assert.equal(s.wonders.preview(a).wonders[0].collection,null);
 assert.ok(data.wonders.every(w=>fs.existsSync(new URL('../'+w.modelUrl.split('?')[0],import.meta.url))));
});
test('preview hides rival construction, exposes completed owners and preserves own progress',()=>{
 const {s,a,activate}=fixture();activate('christ-the-redeemer');
 const rival={id:'other',nickname:'其他经理',token:'private-token',passwordHash:'secret',draft:{teamName:'对手俱乐部'}};s.accounts.set(rival.id,rival);s.world.territories.b.ownerId=rival.id;
 const project={wonderId:'christ-the-redeemer',status:'constructing',productionWork:{required:100,completed:25}};s.world.territories.b.buildings=[project];
 const preview=who=>s.wonders.preview(who).wonders.find(w=>w.wonderId==='christ-the-redeemer');
 const w=preview(a);assert.equal(w.owners.length,1);assert.equal(w.owners[0].mine,true);
 assert.doesNotMatch(JSON.stringify(w),/对手俱乐部|constructing|private-token|passwordHash|secret/);
 const own=preview(rival).owners.find(o=>o.mine);assert.equal(own.progress,25);assert.equal(own.status,'constructing');
 const stale={...w,owners:[...w.owners,{mine:false,status:'constructing',ownerName:'隐藏对手',territoryLabel:'隐藏地块',progress:25}]};
 assert.doesNotMatch(wonderCatalogDetails(stale),/隐藏对手|隐藏地块|25.0%/);assert.match(wonderCatalogDetails(stale),/我的在建 0/);
 project.status='active';assert.equal(preview(a).owners.length,2);assert.equal(preview(a).owners[1].ownerName,'对手俱乐部');
 s.world.territories.a.ownerId=rival.id;assert.equal(preview(a).owners.some(o=>o.mine),false);
});
test('collection preview applies intersecting filters and distinct-nationality target',()=>{
 const {s,a}=fixture();a.draft.roster=[{id:'1',nationality:'葡萄牙',club:'A',pool:'ATT'},{id:'2',nationality:'葡萄牙',club:'A',pool:'ATT'},{id:'3',nationality:'西班牙',club:'B',pool:'ATT'},{id:'4',nationality:'法国',club:'A',pool:'GK'}];
 const c=s.wonders.collectionProgress(a,{minDistinctPlayers:2,nationalities:['葡萄牙','西班牙'],clubs:['A'],pools:['ATT'],minNationalities:2});
 assert.equal(c.current,2);assert.equal(c.nationalities,1);assert.equal(c.met,false);
 const w={label:'<奇观>',region:'欧洲',effectText:'<script>bad</script>',dependency:'研究',construction:{totalProduction:500},requirements:['相邻港口'],collection:c,owners:[]};const html=wonderCatalogDetails(w);assert.match(html,/2 \/ 2/);assert.match(html,/1 \/ 2/);assert.match(html,/全服尚未建成/);assert.match(html,/研究开放后生效/);assert.doesNotMatch(html,/<script>|<奇观>/);
});

test('cancel wonder discards invested work, releases slot and leaves other project work untouched',()=>{
 const f=fixture();f.build('colosseum',10000,'b');f.build('acropolis',10000,'c');const first=f.s.world.territories.b.buildings[0],other=f.s.world.territories.c.buildings[0];f.setNow(1000+H);f.s.save();
 const spent=first.productionWork.completed;assert.ok(spent>0);const otherWork=other.productionWork.completed;const gold=f.a.gold,resources=structuredClone(f.a.resources);
 const result=f.s.cancelWonderConstruction(f.a,'b',first.id);assert.equal(result.refundProduction,0);assert.equal(result.cancelledBuildingId,first.id);assert.equal(f.a.gold,gold);assert.deepEqual(f.a.resources,resources);assert.equal(other.productionWork.completed,otherWork);assert.equal(result.territory.availableSlots,1);assert.ok(!f.s.wonders.entries(f.a,false).some(e=>e.building.id===first.id));
 const fresh=f.build('colosseum',10000,'b');assert.equal(fresh.productionWork.completed,0);assert.notEqual(fresh.id,first.id);assert.throws(()=>f.s.cancelWonderConstruction(f.a,'b',first.id),/不存在/);assert.ok(f.s.world.territories.b.buildings.some(b=>b.id===fresh.id));
});
test('wonder cancellation rejects foreign territory, normal buildings and completed wonders',()=>{
 const f=fixture(),b=f.build('colosseum',10000,'b');assert.throws(()=>f.s.cancelWonderConstruction({...f.a,id:'rival'},'b',b.id),/自己领地/);
 const active=f.activate('eiffel-tower','c');assert.throws(()=>f.s.cancelWonderConstruction(f.a,'c',active.id),/尚未建成/);
 f.s.world.territories.d.buildings=[{id:'normal',type:'port',status:'constructing',productionWork:{required:99999999999,completed:0,updatedAt:1000,ownerId:f.a.id}}];assert.throws(()=>f.s.cancelWonderConstruction(f.a,'d','normal'),/尚未建成/);
});
test('cancellation rechecks completion after settlement and rolls back a failed persistence',()=>{
 const f=fixture(),b=f.build('colosseum',10000,'b');const before=structuredClone(f.s.world.territories.b),rev=f.s.world.revision;const original=f.s.wonders.save;let calls=0;f.s.wonders.save=()=>{if(++calls===2)throw Error('disk failed');};assert.throws(()=>f.s.wonders.cancel(f.a,'b',b.id),/disk failed/);assert.deepEqual(f.s.world.territories.b,before);assert.equal(f.s.world.revision,rev);
 f.s.wonders.save=original;f.setNow(1000+1000*H);assert.throws(()=>f.s.cancelWonderConstruction(f.a,'b',b.id),/尚未建成/);assert.equal(f.s.world.territories.b.buildings[0].status,'active');
});
test('only owned constructing wonders offer cancellation and disclose forfeited production',()=>{
 const f=fixture(),b=f.build('colosseum',10000,'b');const view=f.s.buildings.territoryView(f.a,f.s.world,'b');assert.match(buildingPanelMarkup({view}),/data-cancel-wonder/);const html=buildingPanelMarkup({view,cancelWonderId:b.id});assert.match(html,/已投入的生产力不返还/);assert.match(html,/data-confirm-cancel-wonder/);assert.doesNotMatch(buildingPanelMarkup({view:{...view,canManage:false}}),/data-cancel-wonder/);assert.doesNotMatch(buildingPanelMarkup({view:{...view,buildings:view.buildings.map(b=>({...b,status:'active'}))}}),/data-cancel-wonder/);
});

function raceFixture({winnerCost=100,loserCost=1000,otherProject=true}={}){
 const f=fixture(),rival={...structuredClone(f.a),id:'rival',nickname:'竞建对手',token:'rival-token',homeTerritoryId:'c',draft:{...structuredClone(f.a.draft),teamName:'竞建对手'}};
 f.s.accounts.set(rival.id,rival);f.s.world.players.one.territoryIds=['a','b'];f.s.world.players.rival={playerId:'rival',territoryIds:['c','d'],capitalTerritoryId:'c'};
 for(const id of ['c','d'])Object.assign(f.s.world.territories[id],{ownerId:rival.id,capitalOf:id==='c'?rival.id:null});f.s.save();
 const winner=f.build('colosseum',winnerCost,'b');f.s.wonders.getConstruction=()=>f.plain(loserCost);
 const loser=f.s.buildings.build(rival,f.s.world,'c','wonder:colosseum','production').building;
 if(otherProject)f.s.buildings.build(rival,f.s.world,'d','training-center','production');
 return {...f,rival,winnerId:winner.id,loserId:loser.id};
}
test('offline wonder competition stops losers at first completion and stores half actual invested production',()=>{
 const f=raceFixture();assert.ok(f.s.wonders.requirements(f.rival,'c','colosseum',f.plain(),true).canBuild);
 f.setNow(1000+10*H);f.s.save();const winner=f.s.world.territories.b.buildings[0];assert.equal(winner.wonderId,'colosseum');assert.equal(winner.status,'active');assert.equal(winner.builtAt,301000);
 assert.equal(f.s.world.territories.c.buildings.length,0);const notice=f.rival.wonderCompetitionNotices[0];assert.equal(notice.spentProduction,50);assert.equal(notice.refundProduction,25);assert.equal(notice.createdAt,301000);assert.equal(notice.winnerName,'测试队');
 const reward=f.rival.pendingNeutralRewards[0];assert.equal(reward.amount,25);assert.equal(reward.status,'pending');assert.equal(reward.source,'wonder-competition');assert.equal(f.a.pendingNeutralRewards,undefined);
 assert.equal(f.s.world.territories.d.buildings[0].builtAt,1351000); // 50 invested before the race, then 350 at full capacity.
 assert.throws(()=>f.s.buildings.build(f.rival,f.s.world,'c','wonder:colosseum','production'),/全服建成/);assert.equal(f.s.wonders.available(f.rival,'c').find(w=>w.wonderId==='colosseum').canBuild,false);
 const owned=f.s.wonders.preview(f.rival).wonders.find(w=>w.wonderId==='colosseum').owners;assert.equal(owned.length,1);assert.equal(owned[0].mine,false);
 f.s.save();f.s.state(f.rival);assert.equal(f.rival.pendingNeutralRewards.length,1);assert.equal(f.rival.wonderCompetitionNotices.length,1);
});
test('same-time wonder race uses start time then stable id and never pays loser effects',()=>{
 const f=raceFixture({winnerCost:100,loserCost:100,otherProject:false});const a=f.s.world.territories.b.buildings[0],b=f.s.world.territories.c.buildings[0];a.id='zz';b.id='aa';f.setNow(301000);f.s.save();assert.equal(f.s.world.territories.b.buildings.length,0);assert.equal(f.s.world.territories.c.buildings[0].id,'aa');assert.equal(f.a.wonderCompetitionNotices[0].refundProduction,50);assert.equal(f.s.wonders.modifiers(f.a).trainingPoints,5);assert.equal(f.s.wonders.modifiers(f.rival).trainingPoints,6);
});
test('instant production completion resolves competitors, retains refund remainder and does not duplicate',()=>{
 const f=raceFixture({winnerCost:1000,loserCost:1000,otherProject:false});f.setNow(61000);f.s.save();f.a.pendingNeutralRewards=[{id:'boost',kind:'production',amount:1000,status:'pending'}];
 f.s.assignNeutralProduction(f.a,{rewardId:'boost',territoryId:'b',buildingId:f.winnerId});assert.equal(f.s.world.territories.c.buildings.length,0);const refund=f.rival.pendingNeutralRewards[0];assert.equal(refund.amount,10);
 // Stored compensation is reusable without dropping surplus when a project needs less.
 const t=f.s.world.territories.d;const target={id:'near-done',type:'port',status:'constructing',productionWork:{required:100*60000,completed:95*60000,updatedAt:61000,ownerId:'rival'}};t.buildings=[target];
 f.s.assignNeutralProduction(f.rival,{rewardId:refund.id,territoryId:'d',buildingId:target.id});assert.equal(refund.amount,5);assert.equal(refund.status,'pending');assert.equal(target.status,'active');
 assert.throws(()=>f.s.assignNeutralProduction(f.rival,{rewardId:refund.id,territoryId:'d',buildingId:target.id}),/项目已完成/);assert.equal(refund.amount,5);
 f.s.acknowledgeWonderCompetition(f.rival,f.rival.wonderCompetitionNotices[0].id);assert.equal(f.s.wonders.publicState(f.rival).competitionNotices.length,0);assert.equal(f.s.neutralRewards.publicState(f.rival).pending[0].amount,5);
});
test('failed competition save restores both projects, refund, notice, allocation and completion effect',()=>{
 const f=raceFixture(),snapshot=structuredClone({b:f.s.world.territories.b,c:f.s.world.territories.c,d:f.s.world.territories.d,construction:f.s.world.constructionEconomy,resource:f.s.world.resourceEconomy,revision:f.s.world.revision});const save=f.s.repository.save.bind(f.s.repository);f.s.repository.save=()=>{throw Error('disk failed');};f.setNow(1000+H);assert.throws(()=>f.s.save(),/disk failed/);
 assert.deepEqual({b:f.s.world.territories.b,c:f.s.world.territories.c,d:f.s.world.territories.d,construction:f.s.world.constructionEconomy,resource:f.s.world.resourceEconomy,revision:f.s.world.revision},snapshot);assert.equal(f.rival.pendingNeutralRewards,undefined);assert.equal(f.rival.wonderCompetitionNotices,undefined);
 f.s.repository.save=save;f.s.save();assert.equal(f.rival.pendingNeutralRewards.length,1);assert.equal(f.rival.wonderCompetitionNotices.length,1);
});
test('manual cancellation has no compensation and zero-investment race still notifies',()=>{
 const f=raceFixture({otherProject:false});f.s.cancelWonderConstruction(f.rival,'c',f.loserId);assert.equal(f.rival.pendingNeutralRewards,undefined);assert.equal(f.rival.wonderCompetitionNotices,undefined);
 const g=raceFixture({otherProject:false});g.a.pendingNeutralRewards=[{id:'instant',kind:'production',amount:100,status:'pending'}];g.s.assignNeutralProduction(g.a,{rewardId:'instant',territoryId:'b',buildingId:g.winnerId});assert.equal(g.rival.wonderCompetitionNotices[0].refundProduction,0);assert.equal(g.rival.pendingNeutralRewards,undefined);assert.equal(g.s.world.territories.c.buildings.length,0);
});


test('failed notice acknowledgement stays unread and preserves stored compensation',()=>{
 const f=raceFixture();f.setNow(301000);f.s.save();const id=f.rival.wonderCompetitionNotices[0].id,save=f.s.repository.save.bind(f.s.repository),amount=f.rival.pendingNeutralRewards[0].amount;
 f.s.repository.save=()=>{throw Error('disk failed');};assert.throws(()=>f.s.acknowledgeWonderCompetition(f.rival,id),/disk failed/);assert.equal(f.s.wonders.publicState(f.rival).competitionNotices.length,1);assert.equal(f.rival.pendingNeutralRewards[0].amount,amount);
 f.s.repository.save=save;f.s.acknowledgeWonderCompetition(f.rival,id);assert.equal(f.s.wonders.publicState(f.rival).competitionNotices.length,0);assert.equal(f.rival.pendingNeutralRewards[0].amount,amount);f.s.acknowledgeWonderCompetition(f.rival,id);assert.equal(f.rival.wonderCompetitionNotices.length,1);
});
