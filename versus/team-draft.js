import {REAL_PLAYERS,REAL_PLAYER_BY_ID,VERSUS_PLAYER_GRADE_WEIGHTS,isXPlayer} from './player-pool.js';
import {roleGroup,positionFitScore} from '../shared/football/schema.js';
import {v2OptimalLineupAssignment} from './public/v2-tactical-guidance.js';
import {applyPrinciplePreset} from './public/tactical-principles.js';
import {TEAM_DRAFT_FORMATIONS,TEAM_DRAFT_STYLES,TEAM_DRAFT_LIMIT} from './public/team-draft-config.js';

const skills={balanced:['decisions','teamwork'],control:['passing','firstTouch','vision','composure'],vertical:['pace','offBall','passing'],
  wing:['pace','crossing','dribbling'],target:['heading','jumping','strength','crossing'],press:['stamina','workRate','aggression','tackling'],counter:['pace','offBall','anticipation','passing']};
export function validateTeamDraftPreferences(value={}) {
  const formation=value.formation??'4-3-3',style=value.style??'balanced';
  if(!Object.hasOwn(TEAM_DRAFT_FORMATIONS,formation)||!Object.hasOwn(TEAM_DRAFT_STYLES,style))throw new Error('请选择有效的阵型与战术风格');
  return {formation,style};
}
export function draftStyleScore(player,style) {
  const keys=player.role==='GK'?['goalkeeping','reflexes','passing']:skills[style];
  return keys.reduce((sum,key)=>sum+Number(player.attributes?.[key]??player.overall),0)/keys.length;
}
// Optimize the whole eleven, rather than choosing one winner from each drawn pair.
export function recommendDraftLineup(players,formation,style) {
  const slots=TEAM_DRAFT_FORMATIONS[formation].map(([role,x,y],slot)=>({slot,role,position:{x,y}}));
  return v2OptimalLineupAssignment(slots,players,(player,slot)=>{
    if((slot.role==='GK')!==(player.role==='GK'))return -10000;
    return (Number(player.overall)*.8+draftStyleScore(player,style)*.2)*positionFitScore(player,slot.role);
  }).map(({player,slot})=>({id:player.id,...slot}));
}
export function recommendedDraftEntries(attempt) {
  const lineup=recommendDraftLineup(attempt.entries.map(e=>REAL_PLAYER_BY_ID[e.id]),attempt.formation,attempt.style);
  const starters=new Map(lineup.map(e=>[e.id,e]));
  // Keep reveal batches and roster order stable; only change the assigned first eleven.
  return attempt.entries.map(entry=>({...entry,...starters.get(entry.id),starter:starters.has(entry.id)}));
}
export function generateTeamDraft(preferences,unavailable,rng,number,previousIds=[]) {
  const {formation,style}=validateTeamDraftPreferences(preferences),used=new Set(unavailable),previous=new Set(previousIds);
  const entries=[];
  for(const [slot,[role,x,y]] of TEAM_DRAFT_FORMATIONS[formation].entries()) {
    const group=roleGroup(role),stage=group==='ATT'?0:group==='MID'?1:2;
    const picks=[];
    for(let copy=0;copy<2;copy++) {
      const pool=REAL_PLAYERS.filter(p=>!isXPlayer(p)&&Object.hasOwn(VERSUS_PLAYER_GRADE_WEIGHTS,p.grade)&&!used.has(p.id));
      let candidates=pool.filter(p=>p.role===role);
      if(!candidates.length)candidates=pool.filter(p=>p.secondaryRole===role);
      if(!candidates.length)candidates=pool.filter(p=>roleGroup(p.role)===group);
      if(!candidates.length)throw new Error(`可用球员不足，暂时无法补齐${role}位置；本次不会消耗机会`);
      const weights=candidates.map(p=>VERSUS_PLAYER_GRADE_WEIGHTS[p.grade]*Math.max(.35,Math.min(3,Math.exp((draftStyleScore(p,style)-Number(p.overall))/10)))*(previous.has(p.id)?.2:1));
      let remaining=Math.min(.999999999,Math.max(0,rng()))*weights.reduce((a,b)=>a+b,0),pick=candidates.at(-1);
      for(let i=0;i<candidates.length;i++){remaining-=weights[i];if(remaining<=0){pick=candidates[i];break;}}
      used.add(pick.id);picks.push(pick);
    }
    picks.sort((a,b)=>(Number(b.overall)+draftStyleScore(b,style)*.25)-(Number(a.overall)+draftStyleScore(a,style)*.25));
    picks.forEach((p,i)=>entries.push({id:p.id,slot,role,stage,starter:i===0,position:{x,y}}));
  }
  const plan=applyPrinciplePreset({style:({vertical:'possession',target:'longBall',press:'highPress',counter:'counterAttack',wing:'wingPlay'})[style]??'possession'},style==='target'?'longBall':style);
  return {number,formation,style,entries,revealed:0,candidate:false,plan};
}
export function batchDraftView(draft,summary) {
  const expose=attempt=>{
    const entries=attempt.revealed===3?recommendedDraftEntries(attempt):attempt.entries;
    const visible=entries.filter(e=>e.stage<attempt.revealed);
    return {number:attempt.number,formation:attempt.formation,style:attempt.style,revealed:attempt.revealed,candidate:attempt.candidate,
      complete:attempt.revealed===3,players:visible.map(e=>({...summary(REAL_PLAYER_BY_ID[e.id]),draftRole:e.role,starter:e.starter,stage:e.stage,position:e.position})),
      averageOverall:attempt.revealed===3?Math.round(visible.reduce((sum,e)=>sum+REAL_PLAYER_BY_ID[e.id].overall,0)/22*10)/10:null,
      startingOverall:attempt.revealed===3?Math.round(visible.filter(e=>e.starter).reduce((sum,e)=>sum+REAL_PLAYER_BY_ID[e.id].overall,0)/11*10)/10:null};
  };
  return {mode:'batch',teamName:draft.teamName,preferences:draft.preferences,attemptsUsed:draft.attemptsUsed,limit:TEAM_DRAFT_LIMIT,
    current:draft.current?expose(draft.current):null,candidates:(draft.candidates??[]).map(expose),selectedPlayers:[],offer:[]};
}
