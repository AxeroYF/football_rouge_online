import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {ATTRIBUTE_NAMES,PLAYER_OVERALL_ATTRIBUTE_KEYS,playerOverallFromAttributes,roleGroup} from '../shared/football/schema.js';
import {goalkeeperOutfieldFromReference} from '../shared/football/player-source-attributes.js';
import {REAL_PLAYER_BY_ID,REAL_PLAYERS} from '../versus/player-pool.js';
import {S4_PLAYER_DATABASE} from '../versus/player-pool-s4-generated.js';
import {S4_DLC_PLAYER_DATABASE} from '../versus/player-pool-s4-dlc-generated.js';
import {migrateKnownPlayerDataPatch} from '../versus/player-data-migrations.js';
import {applyS4Enhancement,s4EnhancementAbilityBonus} from '../versus/s4-balance.js';
import {REAL_PLAYER_POOLS} from '../versus/player-pool.js';
import {correctLegacyDlcPlayer} from '../devtool/player-dlc-corrections.js';

test('Neville missing composure is estimated once and Coentrao belongs to the defensive pool',()=>{
  const canonical=JSON.parse(fs.readFileSync(new URL('../data/player-dlc-s4-final.json',import.meta.url),'utf8')).players;
  const neville=canonical.find(p=>p.sourceName==='Gary Neville');
  const historical=JSON.parse(fs.readFileSync(new URL('../data/player-dlc-ea-reference.json',import.meta.url),'utf8')).players.find(p=>p.id==='dlc-garyneville');
  assert.equal(historical.rawReferenceAttributes.composure,0);
  assert.equal(neville.attributes.composure,historical.rawReferenceAttributes.reactions);
  assert.equal(neville.dataCorrections.composure.kind,'estimated-missing-value');
  const legacy={...neville,attributes:{...neville.attributes,composure:1}};
  const fixed=correctLegacyDlcPlayer(legacy,'s4-dlc-20260731-009');
  assert.equal(fixed.attributes.composure,72);assert.equal(legacy.attributes.composure,1);
  assert.strictEqual(correctLegacyDlcPlayer(fixed,'s4-dlc-20260731-009'),fixed);
  const custom={...legacy,attributes:{...legacy.attributes,composure:65}};
  assert.strictEqual(correctLegacyDlcPlayer(custom,'s4-dlc-20260731-009'),custom);
  assert.strictEqual(correctLegacyDlcPlayer(legacy,'another-id'),legacy);
  const player=REAL_PLAYER_BY_ID['s4-dlc-20260731-009'];
  assert.equal(player.attributes.composure,82);assert.equal(player.overall,86);assert.equal(player.grade,'A');
  const coentrao=REAL_PLAYER_BY_ID['s4-dlc-20260731-024'];
  const legacyPool={...canonical.find(p=>p.sourceName==='Fábio Coentrão'),pool:'MID'};
  const fixedPool=correctLegacyDlcPlayer(legacyPool,coentrao.id);
  assert.equal(fixedPool.pool,'DEF');assert.equal(legacyPool.pool,'MID');
  assert.deepEqual(fixedPool.attributes,legacyPool.attributes);
  assert.strictEqual(correctLegacyDlcPlayer(fixedPool,coentrao.id),fixedPool);
  assert.equal(coentrao.role,'LB');assert.equal(coentrao.secondaryRole,'RB');assert.equal(coentrao.overall,82);
  assert.ok(REAL_PLAYER_POOLS.DEF.includes(coentrao));assert.ok(!REAL_PLAYER_POOLS.MID.includes(coentrao));
  for(const p of REAL_PLAYERS.filter(p=>p.grade!=='X'))assert.equal(p.pool,roleGroup(p.role),p.id);
});

test('all DLC2/3 final inputs avoid a second reference-OVR offset',()=>{
  const final=S4_DLC_PLAYER_DATABASE.filter(p=>['2026-08-03','2026-08-08'].includes(p.dlcBatch)&&p.attributeBasis==='game-final');
  assert.equal(final.length,121);
  for(const source of final){
    const player=REAL_PLAYER_BY_ID[source.id],core=PLAYER_OVERALL_ATTRIBUTE_KEYS[roleGroup(source.role)];
    assert.equal(player.overall,source.suggestedOverall);
    assert.equal(playerOverallFromAttributes(player.attributes,player.role),source.suggestedOverall);
    for(const key of ATTRIBUTE_NAMES.filter(k=>!core.includes(k)))assert.equal(player.attributes[key],Math.min(96,Math.max(1,Math.round(source.attributes[key]))),`${player.name}:${key}`);
  }
  assert.equal(REAL_PLAYER_BY_ID['s4-dlc2-20260803-035'].attributes.finishing,82);
  assert.equal(REAL_PLAYER_BY_ID['s4-dlc2-20260803-035'].attributes.dribbling,88);
  assert.equal(REAL_PLAYER_BY_ID['s4-dlc3-20260808-028'].attributes.tackling,85);
  assert.equal(REAL_PLAYER_BY_ID['s4-dlc3-20260808-028'].attributes.strength,84);
  assert.equal(S4_DLC_PLAYER_DATABASE.filter(p=>p.attributeBasis==='reference').length,43);
  assert.equal(S4_DLC_PLAYER_DATABASE.filter(p=>p.attributeBasis==='target-scaled').length,4);
  assert.ok(S4_DLC_PLAYER_DATABASE.every(p=>p.referenceOverall>0),'missing historical OVR cannot become zero');
});

test('goalkeeper physical fields require detailed columns, not face-card ratings',()=>{
  assert.deepEqual(goalkeeperOutfieldFromReference({pace:94,dribbling:95,sprintSpeed:42,ballDribbling:17}),{pace:42,dribbling:17});
  assert.throws(()=>goalkeeperOutfieldFromReference({pace:94,dribbling:95,sprintSpeed:42}),/明细/);
  const keepers=S4_PLAYER_DATABASE.filter(p=>p.goalkeeperMappingVersion===1);
  assert.equal(keepers.length,50);
  for(const source of keepers){
    const ref=source.eafcReferenceAttributes??source.referenceAttributes;
    const offset=source.attributes.acceleration-ref.acceleration;
    assert.equal(source.attributes.pace,Math.max(1,Math.min(99,Math.round(ref.sprintSpeed+offset))));
    assert.equal(source.attributes.dribbling,Math.max(1,Math.min(99,Math.round(ref.ballDribbling+offset))));
  }
  const courtois=REAL_PLAYER_BY_ID['legend-courtois'];
  assert.equal(courtois.overall,90);assert.equal(courtois.attributes.pace,54);assert.equal(courtois.attributes.dribbling,15);
  assert.equal(courtois.attributes.goalkeeping,89);assert.equal(courtois.attributes.reflexes,92);
  assert.equal(REAL_PLAYER_BY_ID['s4-retired-petr-cech'].attributes.dribbling,24,'historical outfield profiles stay intact');
});

const legacyAttributes=Object.fromEntries(ATTRIBUTE_NAMES.map((k,i)=>[k,[76,48,85,72,17,20,29,29,15,21,90,19,87,90,16,79,85,33,84,47,55,75,47,33,90,90][i]]));
test('known admin override migration is selective, immutable and idempotent',()=>{
  const patch={role:'GK',overall:90,name:'诺伊尔',attributes:legacyAttributes};
  const fixed=migrateKnownPlayerDataPatch('s4-fc26-167495',patch);
  assert.equal(fixed.attributes.pace,39);assert.equal(fixed.attributes.dribbling,34);
  assert.equal(fixed.overall,90);assert.equal(patch.attributes.pace,85);
  assert.strictEqual(migrateKnownPlayerDataPatch('s4-fc26-167495',fixed),fixed);
  const customized={...patch,attributes:{...legacyAttributes,pace:70}};
  assert.strictEqual(migrateKnownPlayerDataPatch('s4-fc26-167495',customized),customized);
  assert.strictEqual(migrateKnownPlayerDataPatch('other-player',patch),patch);
});

test('content-store restart persists the corrected override without applying it twice',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'yffm-player-repair-'));
  try{
    const content=path.join(dir,'content.json');
    fs.writeFileSync(content,JSON.stringify({schemaVersion:2,players:{'s4-fc26-167495':{role:'GK',overall:90,attributes:legacyAttributes}},traits:{},traitDrafts:{}}));
    const script="const c=await import('./versus/ydl-content-store.js');await c.flushContentWrites();const {REAL_PLAYER_BY_ID}=await import('./versus/player-pool.js');const p=REAL_PLAYER_BY_ID['s4-fc26-167495'];console.log(JSON.stringify({overall:p.overall,attributes:p.attributes}));";
    const run=()=>JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',windowsHide:true,env:{...process.env,YDL_CONTENT_OVERRIDES_PATH:content,YDL_PLAYER_CARD_STUDIO_PATH:path.join(dir,'studio.json')}}));
    const first=run(),saved=fs.readFileSync(content,'utf8'),second=run();
    assert.deepEqual(second,first);assert.equal(fs.readFileSync(content,'utf8'),saved);
    assert.equal(first.overall,90);assert.equal(first.attributes.pace,39);assert.equal(first.attributes.dribbling,34);
    assert.equal(JSON.parse(saved).players['s4-fc26-167495'].playerDataRevision,1);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('library integrity and enhancement levels are preserved with repaired base stats',()=>{
  assert.equal(REAL_PLAYERS.length,733);assert.equal(new Set(REAL_PLAYERS.map(p=>p.id)).size,733);
  for(const p of REAL_PLAYERS){
    assert.ok(ATTRIBUTE_NAMES.every(k=>Number.isFinite(p.attributes[k])&&p.attributes[k]>=1&&p.attributes[k]<=96));
    if(p.grade!=='X')assert.equal(playerOverallFromAttributes(p.attributes,p.role),p.overall);
  }
  const player=REAL_PLAYER_BY_ID['s4-dlc2-20260803-035'],before=structuredClone(player),card=applyS4Enhancement(player,3);
  assert.equal(card.upgradeLevel,3);assert.equal(card.attributes.finishing,82+s4EnhancementAbilityBonus(3));
  assert.deepEqual(player,before,'enhancement must not mutate repaired source');
});
