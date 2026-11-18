import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {REAL_PLAYERS,normalizedS4LegendAttributes,S4_PLAYER_DEFAULT_ATTRIBUTE_CAP} from '../player-pool.js';
import {YDL_TRAIT_CARDS} from '../trait-pool.js';
import {migrateKnownPlayerDataPatch} from '../player-data-migrations.js';
import {ATTRIBUTE_NAMES,playerOverallFromAttributes,roleGroup} from '../../shared/football/schema.js';
import {createS4BondCatalog} from '../public/bond-rules.js';
import {createSourceSnapshot} from './source-snapshot.js';

const clone=value=>structuredClone(value);
const roles=['GK','CB','LB','RB','LWB','RWB','DM','AM','LM','RM','ST','LW','RW'];
const bounded=(n,min,max)=>{if(!Number.isFinite(Number(n)))throw new Error('球员来源数值无效');return Math.max(min,Math.min(max,Math.round(Number(n))));};
// Mirrors the existing content-store read policy on private copies. No store,
// writer, service constructor, migration persistence or global catalogue edits.
export function resolveSourceCatalog({content={},studio={},basePlayers=REAL_PLAYERS,baseTraits=YDL_TRAIT_CARDS}){
  const byId=new Map(basePlayers.map(p=>[p.id,clone(p)]));
  for(const record of Object.values(studio.published??{}))if(!byId.has(record.id)){
    const role=record.role;
    if(!record.id||!roles.includes(role)||ATTRIBUTE_NAMES.some(key=>!Object.hasOwn(record.attributes??{},key)))throw new Error('已发布球员定义损坏');
    const attributes=Object.fromEntries(ATTRIBUTE_NAMES.map(key=>[key,bounded(record.attributes[key],1,S4_PLAYER_DEFAULT_ATTRIBUTE_CAP)])),overall=playerOverallFromAttributes(attributes,role);
    byId.set(record.id,{...clone(record),pool:roleGroup(role),overall,baseOverall:overall,legendary:record.grade==='S'});
  }
  const patchPlayer=(id,raw)=>{
    const p=byId.get(id);if(!p)return;
    const patch=migrateKnownPlayerDataPatch(id,raw);
    for(const key of ['name','grade','role','secondaryRole','nationality','club'])if(Object.hasOwn(patch,key))p[key]=clone(patch[key]);
    for(const key of ['name','nationality','club'])if(Object.hasOwn(patch,key)){p[key]=String(patch[key]??'').trim();if(!p[key])throw new Error('球员来源文本为空');}
    p.pool=roleGroup(p.role);p.legendary=p.grade==='S';if(p.secondaryRole===p.role)p.secondaryRole=null;
    if(Object.hasOwn(patch,'heightCm'))p.heightCm=bounded(patch.heightCm,140,220);
    if(patch.attributes){
      if(Object.keys(patch.attributes).some(key=>!ATTRIBUTE_NAMES.includes(key)))throw new Error('未知球员来源属性');
      const attributes=Object.hasOwn(patch,'overall')?normalizedS4LegendAttributes(patch.attributes,p.role,patch.overall):patch.attributes;
      p.attributes={...p.attributes,...Object.fromEntries(Object.entries(attributes).map(([key,n])=>[key,bounded(n,1,S4_PLAYER_DEFAULT_ATTRIBUTE_CAP)]))};
    }else if(Object.hasOwn(patch,'overall'))p.attributes=normalizedS4LegendAttributes(p.attributes,p.role,bounded(patch.overall,1,S4_PLAYER_DEFAULT_ATTRIBUTE_CAP));
    p.overall=playerOverallFromAttributes(p.attributes,p.role);p.baseOverall=p.overall;
  };
  for(const [id,patch] of Object.entries(content.players??{}))patchPlayer(id,patch);
  if(content.players?.['legend-messi'])patchPlayer('legend-messi-rat',{...content.players['legend-messi'],name:'梅老鼠'});
  const traits=baseTraits.map(original=>{
    const trait=clone(original),draft=content.traitDrafts?.[trait.id];
    const patch=clone(content.traits?.[trait.id]??draft??{});
    if(draft&&!content.traits?.[trait.id]&&(!Array.isArray(patch.rules)||!patch.rules.length))delete patch.rules;
    if(Number(content.schemaVersion??1)<2)delete patch.rules;
    for(const key of ['name','summary','eligibleRoleGroups','rules'])if(Object.hasOwn(patch,key))trait[key]=patch[key];
    if(Object.hasOwn(patch,'name')){trait.name=String(patch.name??'').trim();if(!trait.name)throw new Error('特性名称为空');}
    if(Object.hasOwn(patch,'eligibleRoleGroups')){
      const groups=[...new Set((Array.isArray(patch.eligibleRoleGroups)?patch.eligibleRoleGroups:[]).map(String))];
      if(!groups.length||groups.some(g=>!['ANY','GK','DEF','MID','ATT'].includes(g)))throw new Error('特性适用位置无效');
      trait.eligibleRoleGroups=groups.includes('ANY')?['ANY']:groups;
    }
    return trait;
  });
  return {players:[...byId.values()],traits};
}

export function readLeagueSource(root){
  const revisions={};
  const read=name=>{const bytes=fs.readFileSync(path.join(root,'data',name));revisions[name]=createHash('sha256').update(bytes).digest('hex');return JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));};
  const league=read('yellowdogs-league.json'),content=read('ydl-content-overrides.json'),studio=read('ydl-player-card-studio.json');
  const catalog=resolveSourceCatalog({content,studio});
  for(const [name,expected] of Object.entries(revisions))if(createHash('sha256').update(fs.readFileSync(path.join(root,'data',name))).digest('hex')!==expected)throw new Error('读取期间来源变更，请重试快照');
  return createSourceSnapshot({league,catalog:catalog.players,traitCatalog:catalog.traits,bondCatalog:createS4BondCatalog(catalog.players),sourceRevisions:revisions});
}
