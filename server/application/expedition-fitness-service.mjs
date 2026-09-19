import {raidMatchForAccount} from '../../shared/config/elite-raids.mjs';
import {coalitionPlayerId} from '../../shared/config/coalition.mjs';
import { strongestRecoveryCenter } from '../../shared/map/recovery-aura.mjs';
import { FITNESS_RULES } from '../../shared/config/fitness.mjs';
import { effectiveFitness, setFitness } from '../../shared/football/fitness-lineup.mjs';

const MINUTE=60_000;
export function activeExpeditionPlayerIds(world,accountId) {
  return new Set([...Object.values(world?.activeChallenges ?? {}).filter(c=>c.attackerId===accountId&&!c.coalitionId)
    .flatMap(c=>c.live?.attacker?.players?.map(p=>p.id) ?? []),...(world?.eliteChallenges?.[accountId]?.leg?.away?.players??[]).map(p=>p.id)]);
}

export class ExpeditionFitnessService {
  constructor({world,accounts,territoryIndex,now=Date.now}) { Object.assign(this,{world,accounts,now});this.metadata=new Map((territoryIndex?.territories??[]).map(t=>[t.territoryId,t])); }
  plans(account,at) {
    const challenge=Object.values(this.world?.activeChallenges ?? {}).find(c=>c.attackerId===account.id&&!c.coalitionId);
    const locked=activeExpeditionPlayerIds(this.world,account.id);
    const piece=account.expeditionPiece, movement=piece?.movement;
    const territoryId=movement?.toTerritoryId ?? piece?.territoryId;
    const center=strongestRecoveryCenter(this.world,account.id,territoryId,this.metadata);
    const boostFrom=center ? Math.max(at,Number(movement?.arrivesAt ?? at),Number(center.builtAt ?? at)) : null;
    return Object.fromEntries((account.draft?.roster ?? []).map(p=>{
      const army=p.coalitionLoan?this.world.coalitions?.[p.coalitionLoan.armyId]:null;
      const coalitionChallenge=army?Object.values(this.world.activeChallenges??{}).find(c=>c.coalitionId===army.id):null;
      const inMatch=locked.has(p.id)||Boolean(coalitionChallenge)||Boolean(raidMatchForAccount(this.world,account.id));
      const match=coalitionChallenge??challenge;
      const loanMovement=army?.movement;
      const loanCenter=army?strongestRecoveryCenter(this.world,account.id,loanMovement?.toTerritoryId??army.territoryId,this.metadata):null;
      // Intermission ends at its saved deadline even if the server resumes later.
      const stopAt=inMatch ? (match?.phase==='intermission' ? match.secondLegStartsAt : at) : null;
      const boosted=!inMatch && !army && account.playerSquads?.assignments?.[p.id]==='expedition';
      if(army)return [p.id,{boostFrom:!inMatch&&loanCenter?Math.max(at,Number(loanMovement?.arrivesAt??at),Number(loanCenter.builtAt??at)):null,centerId:loanCenter?.buildingId,boostRate:loanCenter?.recoveryPerMinute??FITNESS_RULES.recoveryPerMinute,stopAt}];
      return [p.id,{boostFrom:boosted?boostFrom:null,centerId:boosted?center?.buildingId:null,boostRate:center?.recoveryPerMinute??FITNESS_RULES.recoveryPerMinute,stopAt}];
    }));
  }
  prepare(at=this.now()) {
    const snapshots=[];
    for(const account of this.accounts.values()) {
      if(!account.draft?.roster?.length) continue;
      snapshots.push([account,structuredClone(account.fitnessRecovery),account.draft.roster.map(p=>[p,structuredClone(p.state),p.fitness,Object.hasOwn(p,'fitness')])]);
      const previous=account.fitnessRecovery;
      const from=Number(previous?.at ?? at), until=Math.max(from,at);
      for(const p of account.draft.roster) {
        const plan=previous?.plans?.[p.id];
        let value=effectiveFitness(p);
        if(plan) {
          const end=Math.min(until,plan.stopAt ?? until);
          const elapsed=Math.max(0,end-from);
          const boosted=plan.boostFrom==null?0:Math.max(0,end-Math.max(from,plan.boostFrom));
          value+=elapsed/MINUTE*FITNESS_RULES.recoveryPerMinute+boosted/MINUTE*((plan.boostRate??FITNESS_RULES.centerPerMinute)-FITNESS_RULES.recoveryPerMinute);
        }
        value=Math.min(100,value);
        if(p.state?.fitness!=null||p.fitness!=null||value!==100){
          setFitness(p,value);
          // Fixed-fitness traits always win over ordinary recovery.
          setFitness(p,effectiveFitness(p));
        }
      }
      account.fitnessRecovery={version:1,at:until,plans:this.plans(account,until)};
    }
    return {rollback:()=>{for(const [a,b,players] of snapshots){if(b===undefined)delete a.fitnessRecovery;else a.fitnessRecovery=b;for(const [p,state,value,has]of players){if(state===undefined)delete p.state;else p.state=state;if(has)p.fitness=value;else delete p.fitness;}}}};
  }
  due(at=this.now()) {
    return [...this.accounts.values()].some(a=>a.draft?.roster?.length && (!a.fitnessRecovery || at-a.fitnessRecovery.at>=5000));
  }
  applyLeg(account,challenge,leg,at=this.now()) {
    if(!account||!leg||leg.fitnessApplied) return;
    const team=leg.match.teams.find(t=>t.id===account.id);
    for(const result of team?.players ?? []) {
      const player=account.draft.roster.find(p=>p.id===result.id);
      if(player) {setFitness(player,result.state?.fitness);setFitness(player,effectiveFitness(player));}
    }
    leg.fitnessApplied=true;
    // No outside recovery may be retrospectively credited for this match.
    for(const p of team?.players ?? []) if(account.fitnessRecovery?.plans?.[p.id]) account.fitnessRecovery.plans[p.id].stopAt=account.fitnessRecovery.at;
  }
  refreshPlans(account,at=this.now()) {
    if(account.fitnessRecovery) account.fitnessRecovery.plans=this.plans(account,at);
  }
  currentFitness(account,player) {
    const raid=raidMatchForAccount(this.world,account.id);if(raid){const team=raid.leg.match.teams.find(t=>t.id===(raid.armyId??account.id)),id=raid.armyId?coalitionPlayerId(account.id,player.id):player.id,current=team?.players?.find(p=>p.id===id);if(current)return effectiveFitness(current);}
    if(player.coalitionLoan){const ch=Object.values(this.world.activeChallenges??{}).find(c=>c.coalitionId===player.coalitionLoan.armyId),leg=ch?.phase==='first-leg'?ch.live.firstLeg:ch?.phase==='second-leg'?ch.live.secondLeg:null;const current=leg?.match?.teams?.find(t=>t.id===ch.coalitionId)?.players?.find(p=>p.id===coalitionPlayerId(account.id,player.id));return effectiveFitness(current??player);}
    const challenge=Object.values(this.world?.activeChallenges ?? {}).find(c=>c.attackerId===account.id&&!c.coalitionId);
    const leg=this.world?.eliteChallenges?.[account.id]?.leg ?? (challenge?.phase==='first-leg'?challenge.live?.firstLeg:challenge?.phase==='second-leg'?challenge.live?.secondLeg:null);
    const current=leg?.match?.teams?.find(t=>t.id===account.id)?.players?.find(p=>p.id===player.id);
    return effectiveFitness(current ?? player);
  }
  draftView(account,draft) {
    for(const player of draft.roster ?? [])setFitness(player,this.currentFitness(account,player));
    return draft;
  }
  publicState(account) {
    const at=this.now(),plans=this.plans(account,at);
    return {serverNow:at,...FITNESS_RULES,players:Object.fromEntries((account.draft?.roster ?? []).map(p=>{
      const plan=plans[p.id],paused=plan?.stopAt!=null&&plan.stopAt<=at;
      const fixed=effectiveFitness({...p,state:{...p.state,fitness:0}})===effectiveFitness({...p,state:{...p.state,fitness:100}});
      const rate=paused||fixed?0:plan?.boostFrom!=null&&plan.boostFrom<=at?(plan.boostRate??1):0.5;
      const fitness=this.currentFitness(account,p);
      return [p.id,{fitness,fixed,recoveryPerMinute:rate,fullInMinutes:rate?(100-fitness)/rate:null}];
    }))};
  }
}
