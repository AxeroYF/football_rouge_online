import {ChallengeService} from '../server/application/challenge-service.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {campaignBondCatalog} from '../shared/football/campaign-bonds.mjs';
import {buildV2TeamPlayerEffects} from '../engine/s4-v2.1/versus/v2/team-player-effects.js';
import {buildV2TeamSnapshots} from '../engine/s4-v2.1/versus/v2/team-snapshot-v2.js';
import {inferElevenBoardRoles} from '../engine/s4-v2.1/versus/public/formation-rules.js';
import {createCampaignLiveLeg} from '../engine/campaign-match-engine.mjs';
import {buildAccountMatchSeat} from '../shared/football/account-match-seat.mjs';
const roleList=['GK','LB','CB','CB','RB','LM','DM','AM','RM','ST','ST'];
const points=[[50,90],[17,68],[39,68],[65,68],[85,68],[18,44],[43,44],[59,44],[82,44],[38,20],[66,20]];
const player=i=>({id:'p'+i,name:'Player '+i,active:true,role:roleList[i%11],pool:i%11===0?'GK':i%11<5?'DEF':i%11<9?'MID':'ATT',heightCm:180,nationality:'法国',club:'巴黎',upgradeLevel:1,attributes:{passing:70,finishing:70,pace:70,heading:70,stamina:70},state:{fitness:100},traits:[]});
const registry=Array.from({length:12},(_,i)=>player(i));
const team=()=>({id:'a',players:Array.from({length:11},(_,i)=>player(i)),positions:Object.fromEntries(points.map(([x,y],i)=>['p'+i,{x,y}])),formationLines:{attack:20,midfield:44,defense:68,goalkeeper:90},style:'possession',tactic:'balanced',bondCatalog:campaignBondCatalog(registry)});
const roles=t=>inferElevenBoardRoles(t.players.filter(p=>p.active!==false).map(p=>({id:p.id,position:t.positions[p.id]})),t.formationLines);
const preview=t=>buildV2TeamPlayerEffects(t,{roles:roles(t),minute:25});
test('global bond eligibility uses ten unique non-X definitions, never the owned duplicate count',()=>{
 assert.ok(campaignBondCatalog(registry).some(b=>b.id==='nationality:法国'));
 const duplicates=Array.from({length:12},(_,i)=>({...player(i),cardDefinitionId:'same'}));assert.equal(campaignBondCatalog(duplicates).length,0);
 assert.equal(campaignBondCatalog(registry.map(p=>({...p,isX:true}))).length,0);
 assert.equal(campaignBondCatalog(registry.slice(0,9)).filter(b=>!b.regional).length,0);
});
test('five starters activate identity bonds; four starters plus an inactive substitute do not',()=>{
 const t=team();t.players.forEach((p,i)=>{p.club='other';if(i>=5)p.nationality='other';});
 assert.ok(preview(t).bonds.some(b=>b.id==='nationality:法国'));
 t.players[4].active=false;assert.equal(preview(t).bonds.some(b=>b.id==='nationality:法国'),false);
});
test('wildcard traits count toward the strongest identity group',()=>{
 const t=team();t.players.forEach((p,i)=>{p.club='other';if(i>=4)p.nationality='other';});t.players[4].traits=['lone-finisher'];
 const b=preview(t).bonds.find(b=>b.id==='nationality:法国');assert.equal(b.count,5);assert.ok(b.wildcardIds.includes('p4'));
});
test('engine effects and snapshot expose exactly the two strongest applied bonds',()=>{
 const t=team();t.players.forEach((p,i)=>{p.upgradeLevel=0;if(i>=5){p.club='other';p.nationality='other';}});
 const p=preview(t),snapshot=buildV2TeamSnapshots([t],{state:{minute:25,score:[0,0]}})[0];
 assert.equal(p.bonds[0].id,'structure:united');assert.equal(p.bonds.length,2);
 assert.deepEqual(snapshot.v2Snapshot.activeBonds.map(b=>b.id),p.bonds.map(b=>b.id));
 for(const x of p.players){const actual=snapshot.players.find(y=>y.id===x.id);assert.deepEqual(actual.displayAttributes,x.attributes);assert.equal(actual.ydlBondBonus,x.ydlBondBonus);}
 assert.equal(p.players[0].ydlBondBonus,.05);assert.equal(p.players[6].ydlBondBonus,.03);
});
test('height traits count once in tall/short structure thresholds',()=>{
 const t=team();t.players.forEach((p,i)=>{p.nationality='other';p.club='other';if(i<5){p.heightCm=160;p.traits=['aerial-beacon'];}});
 const p=preview(t);assert.equal(p.players[0].heightCm,180);assert.equal(p.eligibleBonds.some(b=>b.id==='structure:aerial-bombardment'),false);
});
test('nearby chemistry links and bonuses recompute when positions move',()=>{
 const t=team();t.players[0].traits=['shadow-marker'];t.positions.p1={x:50,y:75};
 assert.ok(preview(t).players.find(p=>p.id==='p1').v2ChemistryLinkIds.includes('p0'));
 t.positions.p1={x:10,y:10};assert.deepEqual(preview(t).players.find(p=>p.id==='p1').v2ChemistryLinkIds,[]);
});
test('relationship calculations never mutate roster attributes or accumulate across renders',()=>{
 const t=team(),original=structuredClone(t),a=preview(t),b=preview(t);assert.deepEqual(a,b);assert.deepEqual(t,original);assert.equal(a.players[0].attributes.passing,78.4);
});
test('account match seats and live match snapshots preserve the authoritative bond catalog',()=>{
 const t=team(),reserves=t.players.map(p=>({...p,id:'reserve-'+p.id,cardDefinitionId:'reserve-'+p.id,name:'Reserve '+p.name}));
 const account={id:'account',nickname:'Test',draft:{teamName:'Test',roster:[...t.players,...reserves]},playerSquads:{schemaVersion:2,assignments:Object.fromEntries([...t.players.map(p=>[p.id,'expedition']),...reserves.map(p=>[p.id,'garrison'])])}};
 const seat=buildAccountMatchSeat(account,'expedition',1000,{bondCatalog:t.bondCatalog});assert.deepEqual(seat.bondCatalog,t.bondCatalog);
 const leg=createCampaignLiveLeg({home:seat,away:{...team(),id:'opponent'},seed:'bond-smoke',legNumber:1,startedAt:1000});
 const snap=buildV2TeamSnapshots(leg.match.teams)[0];assert.ok(snap.v2Snapshot.activeBonds.some(b=>b.id==='nationality:法国'));
});

test('restored active challenges receive bond eligibility without changing completed results',()=>{
 const home=team(),away={...team(),id:'opponent'};delete home.bondCatalog;delete away.bondCatalog;
 home.selectionSource=structuredClone(home);
 const firstLeg=createCampaignLiveLeg({home,away,seed:'old-bond-save',legNumber:1,startedAt:1000});
 const finished=JSON.parse(JSON.stringify(firstLeg));finished.match.finished=true;
 const live={attacker:home,defender:away,firstLeg,secondLeg:finished},before=structuredClone(finished.match);
 new ChallengeService({world:{activeChallenges:{legacy:{live}}},playerDatabase:registry}).restoreActiveChallenges();
 assert.deepEqual(home.bondCatalog,campaignBondCatalog(registry));assert.deepEqual(home.selectionSource.bondCatalog,home.bondCatalog);
 assert.ok(buildV2TeamSnapshots(firstLeg.match.teams)[0].v2Snapshot.activeBonds.some(b=>b.id==='nationality:法国'));
 assert.deepEqual(finished.match,before);
});


test('S4 bond display keeps all eligible labels and toggles attributes, ratings and cards together', async()=>{
 const {tacticsBondDisplay}=await import('../client/tactics/bond-display.js');
 const {playerTooltip}=await import('../tactics-page.js');
 const {tacticsCardMarkup}=await import('../client/tactics/card-display-controller.js');
 const {PLAYER_OVERALL_ATTRIBUTE_KEYS}=await import('../engine/s4-v2.1/game/public/schema.js');
 const keys=[...new Set(Object.values(PLAYER_OVERALL_ATTRIBUTE_KEYS).flat())];
 const t=team();
 t.players.forEach((p,i)=>{p.upgradeLevel=0;p.overall=70;p.effectiveOverall=70;p.attributes=Object.fromEntries(keys.map(k=>[k,60]));p.effectiveAttributes=Object.fromEntries(keys.map(k=>[k,70]));if(i>=5){p.club='other';p.nationality='other';}});
 const original=structuredClone(t);
 const off=tacticsBondDisplay(t.players,t.bondCatalog,{roles:roles(t)});
 const on=tacticsBondDisplay(t.players,t.bondCatalog,{roles:roles(t),showBonuses:true});
 assert.equal(off.players,t.players);assert.equal(off.bonds.length,3);assert.deepEqual(on.bonds,off.bonds);
 assert.equal(on.players[0].effectiveOverall,74);assert.equal(on.players[6].effectiveOverall,72);
 assert.equal(on.players[0].effectiveAttributes.passing,73.5);
 assert.equal(on.players[6].effectiveAttributes.passing,72.1);
 assert.equal(on.players[0].ydlBondIds.length,2);
 assert.match(tacticsCardMarkup(on.players[0]),/能力74/);
 assert.match(tacticsCardMarkup(off.players[0]),/能力70/);
 const tip=p=>playerTooltip(p,p.role,{displayAttributes:p.effectiveAttributes??p.attributes});
 assert.match(tip(on.players[0]),/综合能力：74/);assert.match(tip(on.players[0]),/守门 74/);
 assert.match(tip(off.players[0]),/综合能力：70/);assert.match(tip(off.players[0]),/守门 70/);
 assert.deepEqual(tacticsBondDisplay(t.players,t.bondCatalog,{roles:roles(t),showBonuses:true}),on);
 assert.deepEqual(tacticsBondDisplay(t.players,t.bondCatalog,{roles:roles(t)}),off);
 assert.deepEqual(t,original);
});

test('S4 bond display uses assigned role for structure recipients and caps only the preview', async()=>{
 const {tacticsBondDisplay}=await import('../client/tactics/bond-display.js');
 const {PLAYER_OVERALL_ATTRIBUTE_KEYS}=await import('../engine/s4-v2.1/game/public/schema.js');
 const keys=[...new Set(Object.values(PLAYER_OVERALL_ATTRIBUTE_KEYS).flat())];
 const t=team();t.players.forEach(p=>{p.nationality='other';p.club='other';p.heightCm=180;p.attributes=Object.fromEntries(keys.map(k=>[k,98]));p.overall=98;});
 const assigned=Object.fromEntries(t.players.map((p,i)=>[p.id,i<6?'CB':i===6?'GK':'ST']));
 const display=tacticsBondDisplay(t.players,[],{roles:assigned,showBonuses:true});
 assert.deepEqual(display.bonds.map(b=>b.id),['structure:steel-defense']);
 assert.equal(display.players[0].effectiveOverall,99);assert.equal(display.players[0].attributes.passing,99);
 assert.equal(display.players[7].effectiveOverall,98);assert.equal(display.players[7].ydlBondBonus,undefined);
 assert.equal(t.players[0].attributes.passing,98);
 const noBonds=tacticsBondDisplay(t.players,[],{roles:roles(t),showBonuses:true});
 assert.equal(noBonds.bonds.length,0);assert.equal(noBonds.players,t.players);
});
