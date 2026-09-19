import {setTestWar} from './diplomacy-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CampaignService } from '../campaign-service.mjs';
import { DRAFT_VERSION } from '../shared/config/draft.mjs';
import { buildAccountMatchSeat } from '../shared/football/account-match-seat.mjs';
import { prepareFitnessSeat, effectiveFitness, setFitness } from '../shared/football/fitness-lineup.mjs';
import { ExpeditionFitnessService } from '../server/application/expedition-fitness-service.mjs';
import { createCampaignLiveLeg, advanceCampaignLiveLeg } from '../engine/campaign-match-engine.mjs';
import { fitnessRedline } from '../shared/config/fitness.mjs';
import { YDL_TRAIT_CARDS } from '../engine/s4-v2.1/versus/trait-pool.js';
import { expeditionPanelView } from '../client/map/expedition-panel-controller.js';

const M=60000,H=60*M;
const catalog=JSON.parse(fs.readFileSync(new URL('../assets/data/s4-player-catalog.json',import.meta.url),'utf8')).filter(p=>!p.isX);
function account(id='a') {
  const roles=['GK','LB','CB','CB','RB','LM','DM','AM','RM','ST','ST'];
  const points=[[50,90],[17,68],[39,68],[65,68],[85,68],[18,44],[43,44],[59,44],[82,44],[38,20],[66,20]];
  const roster=[],assignments={},squads={};
  for(const squad of ['expedition','garrison']) {
    const starters=roles.map((role,i)=>{
      const p=structuredClone(catalog.find(p=>p.role===role));
      p.id=`${id}-${squad}-${i}`;p.cardDefinitionId=p.id;p.name=p.id;setFitness(p,100);
      roster.push(p);assignments[p.id]=squad;return p.id;
    });
    const positions=Object.fromEntries(starters.map((id,i)=>[id,{x:points[i][0],y:points[i][1]}]));
    const lines={attack:20,midfield:44,defense:68,goalkeeper:90};
    squads[squad]={starters,positions,formationLines:lines,planSnapshots:{__s4V2:{starters,captainId:starters[1],fitnessThreshold:65,
      positionPresets:{position1:positions,position2:structuredClone(positions),position3:structuredClone(positions)},
      formationLinePresets:{position1:lines,position2:lines,position3:lines},
      tacticalPlans:{opening:{tactic:'balanced',style:'possession',positionPreset:'position1',playerDuties:{[starters[1]]:'support'}},leading:{tactic:'defensive',style:'counterAttack',positionPreset:'position2',playerDuties:{}},trailing:{tactic:'positive',style:'possession',positionPreset:'position3',playerDuties:{}}}}}};
  }
  return {id,nickname:id,token:id,setupComplete:true,homeTerritoryId:id,gold:10000,draft:{version:DRAFT_VERSION,teamName:id,roster},playerSquads:{schemaVersion:2,assignments},tactics:{schemaVersion:2,activeSquadId:'expedition',squads},expeditionPiece:{schemaVersion:1,territoryId:id,tokenId:'default',movement:null}};
}
function reserve(a,role='LB',fitness=90,overall=90,suffix=role+'-bench') {
  const p={...structuredClone(catalog.find(p=>p.role===role)||catalog.find(p=>p.role===(role==='LWB'?'LB':'RB'))),role,id:a.id+'-'+suffix,name:suffix,overall,effectiveOverall:overall};
  p.cardDefinitionId=p.id;setFitness(p,fitness);a.draft.roster.push(p);a.playerSquads.assignments[p.id]='expedition';return p;
}
function baseFixture({resources=false}={}) {
  let now=1000000,saved=null,fail=false;
  const ids=['a','b','c'];
  const index={territories:ids.map((id,i)=>({territoryId:id,country:'法国',countryCode:'FRA',region:'europe',name:id,centroid:[2+i,48],bounds:[1+i,47,3+i,49],neighbors:ids.filter(x=>x!==id),landNeighbors:ids.filter(x=>x!==id),cityIds:[],clubIds:[],spawnAllowed:true,initialOwner:{type:'neutral',id:null,name:'中立'}}))};
  const resourceCatalog={schemaVersion:1,version:'fitness-test',periodMs:H,territories:Object.fromEntries(ids.map(id=>[id,{terrain:['plains'],yields:{gold:12,production:10,science:10}}]))};
  const repository={load:()=>saved,save:state=>{if(fail)throw Error('disk failure');saved=JSON.parse(JSON.stringify(state));}};
  const options={catalog,territoryIndex:index,territoryResources:resources?resourceCatalog:null,repository,now:()=>now,random:()=>0.2};
  let s=new CampaignService(options);const a=account('a'),b=account('b');
  for(const v of [a,b]){s.accounts.set(v.id,v);s.world.players[v.id]={playerId:v.id,territoryIds:[v.id],capitalTerritoryId:v.id};Object.assign(s.world.territories[v.id],{ownerType:'player',ownerId:v.id,capitalOf:v.id,buildings:[]});}
  setTestWar(s.world,'a','b');
  s.save();
  return {get s(){return s;},get a(){return s.accounts.get('a');},get b(){return s.accounts.get('b');},get now(){return now;},tick:ms=>now+=ms,fail:value=>fail=value,
    reload:()=>{s=new CampaignService(options);},begin:()=>s.challenges.begin(s.accounts.get('a'),'b').challenge,
    advance:()=>s.challenges.advance(now,{maximumMatches:10,maximumChainsPerMatch:1000})};
}

export function coalitionFixture(){const f=baseFixture();const c=account('c');f.s.accounts.set(c.id,c);f.s.world.players.c={playerId:'c',territoryIds:['c'],capitalTerritoryId:'c'};Object.assign(f.s.world.territories.c,{ownerType:'player',ownerId:'c',capitalOf:'c'});f.s.world.diplomacy.relationships[JSON.stringify(['a','b'])].state='alliance';f.s.save();return f;}
