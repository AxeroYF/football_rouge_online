import {AI_FORMATIONS} from '../../engine/territory-ai.mjs';
import {canonicalClubName} from '../config/elite-clubs.mjs';
export function eliteClubPlayers(catalog,club){
 const grouped=new Map();
 for(const p of catalog){if(p.isX||p.xPlayer||canonicalClubName(p.club)!==club.name)continue;const key=p.sourceName?.trim().toLowerCase()||p.name,current=grouped.get(key);if(!current||Number(p.overall)>Number(current.overall))grouped.set(key,p);}
 return [...grouped.values()];
}
export function strongestEliteLineup(players,formation){
 const slots=AI_FORMATIONS[formation];if(!slots)throw Error('未知豪门阵型');const size=1<<11,dp=Array(size).fill(null);dp[0]={score:0,lineup:[]};
 for(const p of players)for(let mask=size-1;mask>=0;mask--){if(!dp[mask])continue;
  for(let i=0;i<11;i++)if(!(mask&(1<<i))){const role=slots[i][0],primary=p.role===role;if(!primary&&p.secondaryRole!==role)continue;
   const score=dp[mask].score+Number(p.effectiveOverall??p.overall)*100+(primary?1:0),next=mask|(1<<i);
   if(!dp[next]||score>dp[next].score)dp[next]={score,lineup:[...dp[mask].lineup,{player:p,slot:i,role}]};
  }
 }
 if(!dp[size-1])throw Error('该豪门球员库不足以组成合理首发');
 // Normalize role coordinates to the engine's formation lines. Some legacy AI
 // templates put AM/LW in an adjacent role zone; preview and engine must agree.
 const y={GK:90,CB:70,LB:70,RB:70,DM:49,AM:39,LM:44,RM:44,ST:18,LW:18,RW:18};
 return dp[size-1].lineup.sort((a,b)=>a.slot-b.slot).map(e=>({...e,x:slots[e.slot][1],y:y[e.role]}));
}
