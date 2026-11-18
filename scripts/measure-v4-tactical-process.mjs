import fs from 'node:fs';
import path from 'node:path';
import {createMatch,advanceMatch} from '../versus/v4/engine.js';
import {demoInput} from '../versus/v4/fixtures.js';
import {coordinates,distance,direction,playerByKey} from '../versus/v4/world.js';
const args=Object.fromEntries(process.argv.slice(2).map(a=>a.replace(/^--/,'').split('=')));
const duration=Number(args.duration??600),seeds=Number(args.seeds??1),presets=['balanced','left','press','counter'];
const rows=[];
for(const home of presets)for(const away of presets)for(let seed=0;seed<seeds;seed++){
  const m=createMatch(demoInput({home,away,seed:`tactical-process-${seed}`,duration}),{recording:false});
  const sides=[0,1].map(()=>({samples:0,attackingSamples:0,defendingSamples:0,attackingWidthSum:0,defensiveLineSum:0,
    holderXSum:0,heldSamples:0,pressuredHeldSamples:0,pressSamples:0,pressDistanceSum:0,pressCoverBehindSamples:0,
    carryDecisions:0,passDecisions:0,forwardPasses:0,backPasses:0,squarePasses:0,passProgressSum:0,shots:0}));
  while(m.state.phase!=='finished'){
    advanceMatch(m,5);const s=m.state;if(s.phase!=='playing')continue;
    const {localPoint}=coordinates(s),holder=playerByKey(s,s.ball.holder),owner=holder?.side??s.ball.flight?.side??s.lastOwner;
    for(const side of [0,1]){
      const row=sides[side],players=s.players.filter(p=>p.side===side&&p.active&&p.role!=='GK'),local=players.map(p=>localPoint(p,side));row.samples++;
      if(owner===side){row.attackingSamples++;row.attackingWidthSum+=Math.max(...local.map(p=>p.y))-Math.min(...local.map(p=>p.y));}
      else {row.defendingSamples++;const defenders=players.filter(p=>p.role==='CB').map(p=>localPoint(p,side).x);row.defensiveLineSum+=defenders.length?defenders.reduce((a,b)=>a+b,0)/defenders.length:0;}
      if(holder?.side===side){row.heldSamples++;row.holderXSum+=localPoint(holder,side).x;row.pressuredHeldSamples+=Number(s.players.some(p=>p.side!==side&&p.active&&distance(p,holder)<3));}
      const press=s.coordination[side].press,presser=playerByKey(s,press?.presser),cover=playerByKey(s,press?.cover);
      if(presser){row.pressSamples++;row.pressDistanceSum+=distance(presser,s.ball);row.pressCoverBehindSamples+=Number(cover&&localPoint(cover,side).x<localPoint(s.ball,side).x);}
    }
  }
  for(const e of m.events){if(e.side==null)continue;const row=sides[e.side];
    if(e.type==='carry')row.carryDecisions++;
    if(e.type==='shot')row.shots++;
    if(e.type==='pass'){const progress=(e.target.x-e.position.x)*direction(e.side,{clock:e.clock});row.passDecisions++;row.passProgressSum+=progress;
      if(progress>3)row.forwardPasses++;else if(progress< -3)row.backPasses++;else row.squarePasses++;}
  }
  rows.push({home,away,seed,score:m.state.score,sides:sides.map((s,side)=>({...s,preset:side?away:home,
    meanAttackingWidth:s.attackingWidthSum/Math.max(1,s.attackingSamples),meanDefensiveLine:s.defensiveLineSum/Math.max(1,s.defendingSamples),
    meanHeldX:s.holderXSum/Math.max(1,s.heldSamples),pressuredHoldShare:s.pressuredHeldSamples/Math.max(1,s.heldSamples),
    pressParticipationShare:s.pressSamples/Math.max(1,s.defendingSamples),meanPressDistance:s.pressDistanceSum/Math.max(1,s.pressSamples),
    meanPassProgress:s.passProgressSum/Math.max(1,s.passDecisions),stats:m.state.stats[side]}))});
}
const report={version:1,duration,runs:rows.length,scope:'One-football-second sampled spatial process; not exact possession seconds or causal attribution. Includes deterministic full engine events.',rows};
const output=args.output??'outputs/v4-tactics-20261117/process-baseline.json';fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2));
console.log(JSON.stringify({output,runs:rows.length}));
