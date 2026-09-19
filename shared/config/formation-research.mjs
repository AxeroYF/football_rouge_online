import { DEFAULT_FORMATION_LINES, sanitizeFormationLines, moveFormationLine, analyzeElevenBoardFormation } from '../../formation-rules.js';

// V2.1 match-parameters-v2.json metrics; these are metric bonuses, not success-rate points.
export const FORMATION_RESEARCH_DIRECTIONS = Object.freeze([
 {id:'buildUp',group:'组织',label:'组织出球',effect:'提升后场组织与传球衔接能力'},
 {id:'progression',group:'组织',label:'向前推进',effect:'提升向前传递与带球推进能力'},
 {id:'pressResistance',group:'组织',label:'抗压控球',effect:'提升受压时的接球与控球能力'},
 {id:'chanceCreation',group:'组织',label:'机会创造',effect:'提升最后一传与创造机会的能力'},
 {id:'movement',group:'进攻',label:'无球跑动',effect:'提升无球接应与寻找空当的能力'},
 {id:'finishing',group:'进攻',label:'射门终结',effect:'提升射门阶段的终结能力'},
 {id:'aerialFinishing',group:'进攻',label:'头球进攻',effect:'提升空中来球的争顶与终结能力'},
 {id:'longShot',group:'进攻',label:'远射能力',effect:'提升禁区外远射能力'},
 {id:'defensiveDuel',group:'防守',label:'防守对抗',effect:'提升抢断、盯人与防守对抗能力'},
 {id:'shotPrevention',group:'防守',label:'射门封锁',effect:'提升封堵射门与限制机会的能力'},
 {id:'pressing',group:'防守',label:'协同逼抢',effect:'提升团队施压与逼抢能力'},
 {id:'discipline',group:'防守',label:'防守纪律',effect:'提升防守动作控制，降低犯规风险'},
]);
export const FORMATION_RESEARCH_POINTS = Object.freeze(Array.from({length:10},(_,i)=>`point-${i+1}`));
const seed=[[16,20],[50,20],[84,20],[32,42],[68,42],[50,51],[16,70],[38,70],[62,70],[84,70]];
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
export function limitFormationPoint(point,lines){
 const x=Number(point?.x),y=Number(point?.y);
 // Outfield points must remain above the goalkeeper zone, even when its line moves.
 return {x:Math.round(clamp(Number.isFinite(x)?x:50,8,92)),y:Math.round(clamp(Number.isFinite(y)?y:44,6,Math.floor((lines.defense+lines.goalkeeper)/2)))};
}
export function createFormationResearchSlot(index){
 return {id:`custom-${index+1}`,name:`自定义阵型 ${index+1}`,configured:false,lines:{...DEFAULT_FORMATION_LINES},positions:Object.fromEntries(FORMATION_RESEARCH_POINTS.map((id,i)=>[id,{x:seed[i][0],y:seed[i][1]}])),showZones:true,direction:'buildUp',previewLevels:Object.fromEntries(FORMATION_RESEARCH_DIRECTIONS.map(d=>[d.id,1]))};
}
export function normalizeFormationResearchSlots(value){
 return Array.from({length:3},(_,i)=>{
  const slot=createFormationResearchSlot(i),raw=Array.isArray(value)?value[i]:null;
  if(!raw||typeof raw!=='object')return slot;
  slot.name=typeof raw.name==='string'&&raw.name.trim()?raw.name.trim().slice(0,24):slot.name;
  slot.lines=sanitizeFormationLines(raw.lines);
  slot.positions=Object.fromEntries(FORMATION_RESEARCH_POINTS.map(id=>[id,limitFormationPoint(raw.positions?.[id]??slot.positions[id],slot.lines)]));
  slot.configured=raw.configured===true;slot.showZones=raw.showZones!==false;
  slot.direction=FORMATION_RESEARCH_DIRECTIONS.some(d=>d.id===raw.direction)?raw.direction:slot.direction;
  for(const d of FORMATION_RESEARCH_DIRECTIONS){const n=raw.previewLevels?.[d.id];if(Number.isInteger(n)&&n>=1&&n<=5)slot.previewLevels[d.id]=n;}
  return slot;
 });
}
export function analyzeResearchFormation(slot){
 return analyzeElevenBoardFormation([...FORMATION_RESEARCH_POINTS,'fixed-gk'].map(id=>({id})),{...slot.positions,'fixed-gk':{x:50,y:94}},slot.lines);
}
export function moveResearchFormationLine(slot,key,y){
 slot.lines=moveFormationLine(slot.lines,key,y);
 for(const id of FORMATION_RESEARCH_POINTS)slot.positions[id]=limitFormationPoint(slot.positions[id],slot.lines);
}

// Science capacity follows the same per-minute cadence as building production.
export const FORMATION_RESEARCH_PERIOD_MS = 60_000;
export const FORMATION_RESEARCH_WORK = Object.freeze([100,200,400,800,1600]);
export const formationResearchLevels = value => Object.fromEntries(FORMATION_RESEARCH_DIRECTIONS.map(d=>[d.id,Number.isInteger(value?.[d.id])?Math.max(0,Math.min(5,value[d.id])):0]));
export function confirmedResearchFormation(account,id){return account?.formationResearch?.slots?.find(s=>s.id===id&&s.confirmedAt!=null)??null;}
const geometry=positions=>Object.values(positions??{}).map(p=>[Number(p.x),Number(p.y)]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
export function matchesResearchFormation(slot,positions,lines){
 return Boolean(slot&&Object.keys(positions??{}).length===11&&JSON.stringify(geometry(positions))===JSON.stringify(geometry({...slot.positions,'fixed-gk':{x:50,y:94}}))&&Object.keys(DEFAULT_FORMATION_LINES).every(k=>Number(lines?.[k])===slot.lines[k]));
}
export function researchProgress(job,now){
 if(!job)return null;
 // Keep older API snapshots readable during a client/server rolling refresh.
 const rate=Math.max(0,job.sciencePerMinute??(job.sciencePerHour??0)/60);
 const completed=Math.max(0,Math.min(job.required,job.completed+Math.max(0,now-job.updatedAt)*rate/FORMATION_RESEARCH_PERIOD_MS));
 return {completed,percent:job.required>0?100*completed/job.required:100,remaining:completed>=job.required?0:rate>0?(job.required-completed)/rate*FORMATION_RESEARCH_PERIOD_MS:null};
}
export function researchRemainingTime(remaining){
 if(remaining===null)return '等待科技值';
 const seconds=Math.ceil(Math.max(0,remaining)/1000);
 if(!seconds)return '等待完成确认';
 return `剩余 ${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
}
