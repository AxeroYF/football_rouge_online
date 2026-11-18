import test from 'node:test';
import assert from 'node:assert/strict';
import {createSourceSnapshot,sourceCoverage} from '../versus/v4-adapter/source-snapshot.js';
import {representativeCard} from '../versus/s4-assets.js';
import {resolveSourceCatalog} from '../versus/v4-adapter/read-source.js';
import {ATTRIBUTE_NAMES,playerOverallFromAttributes} from '../shared/football/schema.js';
import {prepareSourceTeam} from '../versus/v4-adapter/prepare-teams.js';
import {demoInput} from '../versus/v4/fixtures.js';

const fixture=()=>({league:{season:{id:'season',currentRound:1},wallets:{secret:123},ledger:[{private:true}],teams:[{id:'a',name:'A',ownerId:'private-owner',ownerName:'private-name',rosterIds:['p'],tacticalPlans:{opening:{style:'wingPlay'}}}],
  s4Assets:{cards:{a:{id:'a',ownerId:'private-owner',playerId:'p',upgradeLevel:2,traitIds:['t'],acquiredAt:3},b:{id:'b',ownerId:'private-owner',playerId:'p',upgradeLevel:3,traitIds:['t'],acquiredAt:4},c:{id:'c',ownerId:'private-owner',playerId:'p',upgradeLevel:9,status:'recycled'}}}},
  catalog:[{id:'p',name:'P',role:'ST',attributes:{finishing:80}}],traitCatalog:[{id:'t',name:'T',rules:[{hook:'attribute',add:{finishing:5}}]}]});
test('source capture is immutable, deterministic and excludes unrelated account data',()=>{
  const input=fixture(),before=structuredClone(input),a=createSourceSnapshot(input),b=createSourceSnapshot(input);
  assert.deepEqual(input,before);assert.deepEqual(a,b);assert.ok(!JSON.stringify(a).includes('private-owner'));assert.ok(!JSON.stringify(a).includes('wallets'));
  assert.throws(()=>a.teams[0].roster[0].attributes.finishing=1,TypeError);
  input.catalog[0].attributes.finishing=10;assert.equal(a.teams[0].roster[0].attributes.finishing,80);
  assert.notEqual(createSourceSnapshot(input).fingerprint,a.fingerprint);
});
test('card choice matches the formal representative-card policy and captures hook definitions',()=>{
  const input=fixture(),snapshot=createSourceSnapshot(input),expected=representativeCard(input.league,'private-owner','p');
  assert.equal(snapshot.teams[0].roster[0].card.id,expected.id);assert.equal(sourceCoverage(snapshot).hooks.attribute,1);
  input.league.s4Assets.cards.b.traitIds=['unknown'];assert.throws(()=>createSourceSnapshot(input),/未知特性/);
});
test('unresolved players and duplicate roster slots fail without silently inventing inputs',()=>{
  const input=fixture();input.league.teams[0].rosterIds=['missing'];assert.throws(()=>createSourceSnapshot(input),/缺少球员/);
  input.league.teams[0].rosterIds=['p','p'];assert.throws(()=>createSourceSnapshot(input),/重复/);
});
test('catalog resolution preserves overrides, published players and schema-specific trait migration on private copies',()=>{
  const attributes=Object.fromEntries(ATTRIBUTE_NAMES.map(key=>[key,50]));
  const input={basePlayers:[{id:'p',role:'ST',grade:'A',attributes}],baseTraits:[{id:'t',name:'Old',rules:[{hook:'height',addCm:5}]}],
    content:{schemaVersion:2,players:{p:{overall:70,attributes}},traits:{t:{name:'New'}}},studio:{published:{custom:{id:'custom',role:'GK',grade:'A',attributes}}}};
  const before=structuredClone(input),resolved=resolveSourceCatalog(input);assert.deepEqual(input,before);
  assert.equal(resolved.players.find(p=>p.id==='p').overall,70);assert.equal(playerOverallFromAttributes(resolved.players[0].attributes,'ST'),70);
  assert.equal(resolved.players.find(p=>p.id==='custom').pool,'GK');assert.equal(resolved.traits[0].name,'New');assert.equal(resolved.traits[0].rules[0].hook,'height');
  input.content.schemaVersion=1;input.content.traits.t.rules=[];assert.equal(resolveSourceCatalog(input).traits[0].rules.length,1);
  input.content.schemaVersion=2;assert.deepEqual(resolveSourceCatalog(input).traits[0].rules,[]);
});
test('prematch preparation excludes injury, respects competition suspension and preserves replacement slot/duty',()=>{
  const players=demoInput().teams[0].players.map(p=>({...p,overall:75,role:p.role==='CM'?'DM':p.role,traitDefinitions:[]}));
  const positions=Object.fromEntries(players.map(p=>[p.id,{x:p.anchor.y/68*100,y:100-p.anchor.x/105*100}]));
  const reserve={...structuredClone(players[9]),id:'reserve'};
  const team={id:'t',name:'T',humanOwned:true,roster:[...players,reserve],rosterIds:[...players,reserve].map(p=>p.id),preferredStarterIds:players.map(p=>p.id),positions,
    positionPresets:{position1:positions,position2:positions,position3:positions},playerState:{p10:{injuryRounds:1}},tacticalPlans:{opening:{positionPreset:'position1',playerDuties:{p10:'poacher'}}}};
  const snapshot={fingerprint:'test',teams:[team],bondCatalog:[]},before=structuredClone(snapshot),prepared=prepareSourceTeam(snapshot,'t');
  assert.deepEqual(snapshot,before);assert.ok(!prepared.players.some(p=>p.id==='p10'));
  assert.deepEqual(prepared.positions.reserve,positions.p10);assert.equal(prepared.tacticalPlans.opening.playerDuties.reserve,'poacher');
  team.playerState.p10={suspension:1};assert.ok(!prepareSourceTeam(snapshot,'t').players.some(p=>p.id==='p10'));
  assert.ok(prepareSourceTeam(snapshot,'t',{competition:'friendly'}).players.some(p=>p.id==='p10'));
  assert.ok(prepareSourceTeam(snapshot,'t',{competition:'cup'}).players.some(p=>p.id==='p10'));
});
