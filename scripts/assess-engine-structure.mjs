import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createV2Match,createV2MatchRng} from '../versus/v2/match-engine-v2.js';
import {simulateV2PossessionChain as nativeChain} from '../versus/v2/possession-chain-v2.js';
import {buildV2TeamSnapshots} from '../versus/v2/team-snapshot-v2.js';
import {buildV2SpatialMatchup,buildV2StageSpatialCache,buildV2StageSpatialMatchup,v2MidfieldStructureProfile} from '../versus/v2/spatial-model-v2.js';
import {resolveV2MatchParameters,V2_MATCH_PARAMETERS} from '../versus/v2/match-parameters-v2.js';
import {layouts,profiles,makeAssessmentTeam} from './engine-assessment-fixtures.mjs';

const output=path.resolve('outputs/engine-assessment');await fs.mkdir(output,{recursive:true});
const state={minute:30,score:[0,0]},environment={weather:'sunny',referee:'standard'};
// Experimental acceleration for fixed, immutable snapshots only. The game files
// are untouched. Memoize the pure stage geometry by teams, complete parameters,
// attacking side, stage, lane and possession type; compare complete chain outputs
// against the native module before collecting samples.
const originalUrl=new URL('../versus/v2/possession-chain-v2.js',import.meta.url);
let source=await fs.readFile(originalUrl,'utf8');
source=source.replace('buildV2StageSpatialCache, buildV2StageSpatialMatchup }','buildV2StageSpatialCache, buildV2StageSpatialMatchup as uncachedStageMatchup }');
source=source.replace(/from (["'])(\.\.?\/[^"']+)\1/g,(_,quote,spec)=>'from '+quote+new URL(spec,originalUrl).href+quote);
source+=`\nconst geometryCache=new WeakMap();const parameterKeys=new WeakMap();
function buildV2StageSpatialMatchup(teams,side,stage,options={}){
 let cache=geometryCache.get(teams);if(!cache)geometryCache.set(teams,cache=new Map());
 const parameters=options.parameters??{};let parameterKey=parameterKeys.get(parameters);
 if(!parameterKey){parameterKey=JSON.stringify(parameters);parameterKeys.set(parameters,parameterKey);}
 const key=JSON.stringify([side,stage,options.ballLane??'center',options.possessionType??'normal',options.includeDynamicShape!==false,parameterKey]);
 if(!cache.has(key))cache.set(key,uncachedStageMatchup(teams,side,stage,options));return cache.get(key);
}\n`;
const generated=path.resolve('.assessment/chain-assessment-runtime.mjs');await fs.mkdir(path.dirname(generated),{recursive:true});await fs.writeFile(generated,source);
const {simulateV2PossessionChain:cachedChain}=await import(pathToFileURL(generated).href+'?audit='+Date.now());

function prepare(a={},b={},parameters=V2_MATCH_PARAMETERS){
 const match=createV2Match([makeAssessmentTeam('A',{...a,boardLines:true}),makeAssessmentTeam('B',{...b,boardLines:true})],{parameters});
 const snapshots=buildV2TeamSnapshots(match.teams,{parameters,state,environment});
 const spatial=buildV2SpatialMatchup(snapshots,{parameters});
 const stageSpatials=buildV2StageSpatialCache(snapshots,{parameters});
 return {teams:match.teams,snapshots,spatial,stageSpatials,parameters};
}
function options(fixture,seed,transition=null){return {snapshotTeams:fixture.snapshots,spatial:fixture.spatial,stageSpatials:fixture.stageSpatials,parameters:fixture.parameters,state,environment,transition,rng:createV2MatchRng('audit-chain-'+seed),chainIndex:seed,deferShotResolution:true};}
const started=performance.now();let verified=0;
for(const [a,b,parameters] of [[{},{},V2_MATCH_PARAMETERS],[{profile:'counter'},{profile:'press'},V2_MATCH_PARAMETERS],[{formation:'4-2-3-1'},{formation:'3-5-2'},V2_MATCH_PARAMETERS],[{duties:{ST:'advancedForward',LW:'insideForward',RW:'insideForward',AM:'shadowStriker',LB:'overlappingFullback',RB:'overlappingFullback'}},{},V2_MATCH_PARAMETERS],[{},{},resolveV2MatchParameters({dynamicShape:{mode:'off'}})]]){
 const fixture=prepare(a,b,parameters);
 for(let seed=0;seed<8;seed++){
  const transition=seed%2?{attackingTeamIndex:0,wonZone:'buildUp:center',counterOpportunity:true}:null;
  assert.deepEqual(cachedChain(fixture.teams,options(fixture,seed,transition)),nativeChain(fixture.teams,options(fixture,seed,transition)));verified++;
 }
}
console.log(JSON.stringify({nativeChainEqualityChecks:verified,validationMs:performance.now()-started}));

const count=Number(process.env.AUDIT_CHAIN_SAMPLES??2048);
const rows=[];
function structure(fixture){return fixture.spatial.teams.map(team=>({centralControl:team.centralControl,flankControl:team.flankControl,midfieldIntegrity:team.midfieldIntegrity,exposure:team.backlineExposure,connection:team.connectionQuality,roles:team.players.map(p=>p.assignedRole),dimensions:team.tacticalDimensions}));}
async function probe(id,a={},b={},parameterOverride={},transition=null){
 const parameters=Object.keys(parameterOverride).length?resolveV2MatchParameters(parameterOverride):V2_MATCH_PARAMETERS;
 const fixture=prepare(a,b,parameters),totals=[{chains:0,shots:0,rawThreat:0,stages:0},{chains:0,shots:0,rawThreat:0,stages:0}];
 const raw=[];const start=performance.now();
 for(let seed=0;seed<count;seed++){
  const chain=cachedChain(fixture.teams,options(fixture,seed,transition));
  const side=chain.attackingTeamIndex,shot=chain.stages.at(-1)?.stage==='shot';
  totals[side].chains++;totals[side].shots+=Number(shot);totals[side].rawThreat+=Number(chain.xg??0);totals[side].stages+=chain.stages.length-1;
  raw.push([side,Number(shot),Number(chain.xg??0)]);
 }
 const stage=buildV2StageSpatialMatchup(fixture.snapshots,0,'chance',{parameters,parametersResolved:true,ballLane:'farLeft'});
 const row={id,count,ms:performance.now()-start,transition,structure:structure(fixture),totals,raw,stageThreat:{left:stage.teams[0].zones['box:farLeft'],right:stage.teams[0].zones['box:farRight']}};
 rows.push(row);console.log(JSON.stringify({id,ms:Math.round(row.ms),shots:totals.map(t=>t.shots),rawThreat:totals.map(t=>Math.round(t.rawThreat*100)/100)}));
}

// Neutral lineup and ability controls.
await probe('baseline');
await probe('ability88',{ability:88});
for(const formation of Object.keys(layouts).filter(name=>name!=='4-3-3'))await probe('formation:'+formation,{formation});
const standardFormations=Object.keys(layouts).filter(name=>!['4-3-3','2-2-6'].includes(name));
for(let i=0;i<standardFormations.length;i++)for(let j=i+1;j<standardFormations.length;j++)await probe('matrix:'+standardFormations[i]+':'+standardFormations[j],{formation:standardFormations[i]},{formation:standardFormations[j]});
for(const profile of Object.keys(profiles).filter(name=>name!=='balanced'))await probe('profile:'+profile,{profile});
for(const [name,value] of Object.entries({tempo:[20,80],directness:[20,80],attackingWidth:[20,80],defensiveLine:[20,80],pressing:[20,80],compactness:[20,80],counterAttack:[20,80],timeWasting:[0,80]}))for(const setting of value)await probe('slider:'+name+':'+setting,{plan:{tacticalDimensions:{[name]:setting}}});
for(const direction of ['left','center','right'])await probe('attack-hole:'+direction,{plan:{inPossessionDetails:{attackDirection:direction}}},{mutatePositions:positions=>{positions.B4.x=60;}});
await probe('duties:attacking',{duties:{ST:'advancedForward',LW:'insideForward',RW:'insideForward',AM:'shadowStriker',LB:'overlappingFullback',RB:'overlappingFullback'}});
await probe('duties:support',{duties:{ST:'deepLyingForward',LW:'bylineWinger',RW:'bylineWinger',AM:'advancedPlaymaker',DM:'anchor'}});
await probe('dynamic:off',{}, {},{dynamicShape:{mode:'off'}});
await probe('dynamic:zero',{}, {},{dynamicShape:{stableInfluence:0}});
const neutralDoublePivot=Object.fromEntries(Object.keys(V2_MATCH_PARAMETERS.spatial.roleBalance).filter(key=>key.startsWith('doublePivot451')).map(key=>[key,1]));
await probe('4231:without-pattern-bonus',{formation:'4-2-3-1'},{},{spatial:{roleBalance:neutralDoublePivot}});
for(const profile of ['balanced','patient','counter'])await probe('transition:'+profile,{profile},{profile:'press'},{},{attackingTeamIndex:0,wonZone:'buildUp:center',counterOpportunity:true});

// Exact boundary probe isolates the hard counting rule from role assignment.
const players=[{group:'DEF',localPosition:{x:40,y:72}},{group:'DEF',localPosition:{x:60,y:72}},{group:'ATT',localPosition:{x:50,y:18}},{group:'MID',localPosition:{x:38,y:48}},{group:'MID',localPosition:{x:62,y:48}},{group:'MID',localPosition:{x:50,y:31.99}}];
const below=v2MidfieldStructureProfile(players);players.at(-1).localPosition.y=32.01;const above=v2MidfieldStructureProfile(players);
await fs.writeFile(path.join(output,'structure.json'),JSON.stringify({nativeChainEqualityChecks:verified,samplesPerCondition:count,state,environment,parameters:V2_MATCH_PARAMETERS,method:'fixed immutable snapshots; cached pure stage geometry; full chain output checked against native; rawThreat is uncalibrated chain shot probability, not full-match xG or win rate',boundary:{below,above},elapsedMs:performance.now()-started,rows},null,2));
console.log(JSON.stringify({done:rows.length,elapsedSeconds:Math.round((performance.now()-started)/1000),boundary:{below,above}}));
