import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createV3Match} from '../versus/v3/match-engine-v3.js';
import {autoSubstituteDismissedGoalkeeper} from '../versus/v2/match-engine-v2.js';
import {comparePassiveSubstitutes} from '../versus/passive-substitution.js';
import {makeAssessmentTeam} from './engine-assessment-fixtures.mjs';

function fixture(){
  const seats=['A','B'].map(name=>makeAssessmentTeam(name,{boardLines:true,holdScorePlans:true}));
  const keeper=seats[0].players.find(p=>p.role==='GK');
  seats[0].players.push({...structuredClone(keeper),id:'reserve-gk',name:'替补门将',active:false});
  const match=createV3Match(seats,{seed:'passive-audit',weather:'sunny',referee:'standard'}),team=match.teams[0];
  const dismissed=team.players.find(p=>p.active&&p.role==='GK');dismissed.active=false;dismissed.sentOff=true;
  return {match,team,dismissed};
}
const observations=[];
for(const kind of ['normal','no-center-back','no-reserve','limit-exhausted','substituted-out-reserve']){
  const {match,team,dismissed}=fixture(),reserve=team.players.find(p=>p.id==='reserve-gk');
  if(kind==='no-center-back')team.players.filter(p=>p.active&&p.assignedRole==='CB').forEach(p=>p.assignedRole='DM');
  if(kind==='no-reserve')reserve.injury={severity:'matchEnding'};
  if(kind==='limit-exhausted')team.stats.substitutions=5;
  if(kind==='substituted-out-reserve')reserve.substitutedOut=true;
  const result=autoSubstituteDismissedGoalkeeper(match,team,dismissed);
  assert.equal(Boolean(result),['normal','no-center-back'].includes(kind));
  assert.equal(team.players.filter(p=>p.active).length,10);
  assert.equal(team.players.filter(p=>p.active&&p.assignedRole==='GK').length,1);
  observations.push({case:kind,substitution:Boolean(result),playersOnField:10,
    assignedGoalkeepers:team.players.filter(p=>p.active&&p.assignedRole==='GK').length,
    dynamicShapeUpdated:result?Boolean(match.flowState.shapes[0][result.substitute.id]):null});
}
const candidates=[{id:'tired',role:'CB',overall:91,state:{fitness:1}},{id:'fresh',role:'CB',overall:90,state:{fitness:100}}];
candidates.sort((a,b)=>comparePassiveSubstitutes('CB',a,b));
assert.equal(candidates[0].id,'fresh');
observations.push({case:'fitness-edge',selected:candidates[0].id,fitness:candidates[0].state.fitness});
const out='outputs/passive-substitutions-20261117';fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(out+'/audit-after.json',JSON.stringify({engine:'3.3',observations},null,2));
console.log(JSON.stringify(observations,null,2));
