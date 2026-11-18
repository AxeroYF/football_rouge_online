import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {ATTRIBUTE_NAMES,PLAYER_OVERALL_ATTRIBUTE_KEYS,roleGroup,playerOverallFromAttributes} from '../shared/football/schema.js';
import {REAL_PLAYER_BY_ID} from '../versus/player-pool.js';
import {S4_DLC_PLAYER_DATABASE} from '../versus/player-pool-s4-dlc-generated.js';
import {PRE_SCALED_DLC_IDS,DUPLICATE_PROFILE_PAIRS,REBUILT_DLC_PROFILES,REVISED_DLC_PLAYER_IDS,reviseDlcProfile} from '../devtool/player-dlc-profile-revisions.js';
import {applyS4Enhancement,s4EnhancementAbilityBonus} from '../versus/s4-balance.js';
const sources=new Map(S4_DLC_PLAYER_DATABASE.map(p=>[p.id,p]));
const canonical=new Map(['player-dlc-s4-final.json','player-dlc3-s4-final.json'].flatMap((file,batch)=>JSON.parse(fs.readFileSync(new URL('../data/'+file,import.meta.url))).players.map((p,i)=>[p.id||`${batch?'s4-dlc3-20260808-':'s4-dlc-20260731-'}${String(i+1).padStart(3,'0')}`,p])));

test('pre-scaled legacy inputs no longer receive a second non-core offset',()=>{
  assert.equal(REVISED_DLC_PLAYER_IDS.length,13);
  for(const id of PRE_SCALED_DLC_IDS){
    const source=sources.get(id),p=REAL_PLAYER_BY_ID[id];
    assert.ok(['target-scaled','game-final'].includes(source.attributeBasis));
    const core=PLAYER_OVERALL_ATTRIBUTE_KEYS[roleGroup(p.role)];
    for(const key of ATTRIBUTE_NAMES.filter(k=>!core.includes(k)))assert.equal(p.attributes[key],Math.min(96,source.attributes[key]),`${p.name}:${key}`);
    assert.equal(p.overall,source.suggestedOverall);
    assert.equal(playerOverallFromAttributes(p.attributes,p.role),p.overall);
  }
  const ze=canonical.get('s4-dlc-20260731-052');
  assert.equal(ze.attributes.composure,79);
  assert.equal(ze.dataCorrections.profileRevision.missingComposure.kind,'estimated-legacy-missing');
});

test('rebuilt profiles retain exact OVR and survive normalization and enhancement',()=>{
  for(const [id,design] of Object.entries(REBUILT_DLC_PROFILES)){
    const p=REAL_PLAYER_BY_ID[id],snapshot=structuredClone(p);
    assert.deepEqual(p.attributes,design.attributes);
    assert.equal(p.overall,design.overall);
    assert.equal(p.role,design.role);
    const upgraded=applyS4Enhancement(p,3);
    assert.equal(upgraded.id,p.id);
    assert.equal(upgraded.upgradeLevel,3);
    assert.equal(upgraded.attributes.pace,Math.min(96,p.attributes.pace+s4EnhancementAbilityBonus(3)));
    assert.deepEqual(p,snapshot);
  }
});

test('four former duplicate pairs have substantial and football-specific differences',()=>{
  for(const [left,right] of DUPLICATE_PROFILE_PAIRS){
    const a=REAL_PLAYER_BY_ID[left],b=REAL_PLAYER_BY_ID[right];
    assert.equal(a.overall,b.overall);
    assert.ok(ATTRIBUTE_NAMES.slice(0,24).filter(k=>a.attributes[k]!==b.attributes[k]).length>=18);
  }
  const [rui,cesc,kempes,raul,demi,carvalho,hierro,bonucci]=DUPLICATE_PROFILE_PAIRS.flat().map(id=>REAL_PLAYER_BY_ID[id].attributes);
  assert.ok(rui.dribbling>cesc.dribbling&&cesc.passing>rui.passing);
  assert.ok(kempes.pace>raul.pace&&kempes.strength>raul.strength&&raul.offBall>kempes.offBall);
  assert.ok(demi.strength>carvalho.strength&&carvalho.positioning>demi.positioning&&carvalho.agility>demi.agility);
  assert.ok(hierro.longShots>bonucci.longShots&&hierro.heading>bonucci.heading&&bonucci.passing>hierro.passing);
});

test('Joaquin is the Betis right winger with a stable gameplay ID',()=>{
  const id='s4-dlc-20260731-027',p=REAL_PLAYER_BY_ID[id],source=sources.get(id);
  assert.equal(p.id,id);assert.equal(p.overall,85);assert.equal(p.grade,'B');
  assert.equal(p.role,'RM');assert.equal(p.secondaryRole,'RW');assert.equal(p.preferredFoot,'right');
  assert.equal(source.sourceName,'Joaquín Sánchez Rodríguez');assert.equal(source.club,'皇家贝蒂斯');
  assert.equal(source.sourceId,'joaquin-sanchez-rodriguez');assert.equal(source.heightCm,179);
  assert.ok(source.sourceUrl.startsWith('https://rfef.es/'));
});

test('legacy import repairs are selective, reproducible, immutable and idempotent',()=>{
  for(const id of REVISED_DLC_PLAYER_IDS){
    const fixed=canonical.get(id),previous=fixed.dataCorrections.profileRevision.previous;
    const legacy={...fixed,...previous.identity,source:previous.source,attributes:previous.attributes,attributeBasis:previous.attributeBasis,dataCorrections:undefined};
    const snapshot=structuredClone(legacy),repaired=reviseDlcProfile(legacy,id);
    assert.deepEqual(legacy,snapshot);
    assert.deepEqual(repaired.attributes,fixed.attributes);
    assert.equal(repaired.attributeBasis,fixed.attributeBasis);
    assert.equal(repaired.role,fixed.role);
    assert.strictEqual(reviseDlcProfile(repaired,id),repaired);
    assert.strictEqual(reviseDlcProfile(legacy,'unrelated-player'),legacy);
    assert.throws(()=>reviseDlcProfile({...legacy,sourceName:'Wrong identity'},id),/identity mismatch/);
  }
});
