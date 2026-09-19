import { absenceMatches, setAbsence } from '../../shared/football/match-availability.mjs';
import { prepareFitnessSeat, setFitness } from '../../shared/football/fitness-lineup.mjs';

// The leg marker participates in the same save/rollback transaction as fitness.
export function applyLegConsequences(accounts, challenge, leg) {
  if(!leg?.match?.finished || leg.consequencesApplied) return;
  const sourceLegId=`${challenge.id}:leg-${leg.legNumber}`;
  for(const [teamIndex,team] of leg.match.teams.entries()) {
    const source=team.id===challenge.live.attacker.id ? challenge.live.attacker : challenge.live.defender;
    const selection=source.selectionSource ?? source;
    const roster=accounts.get(team.id)?.draft?.roster ?? [...selection.players,...(selection.substitutes??[])];
    const byId=new Map(roster.map(p=>[p.id,p]));
    for(const snapshot of team.availability ?? []) {
      const player=byId.get(snapshot.playerId);if(!player)continue;
      for(const kind of ['injury','suspension']) {
        const current=absenceMatches(player,kind);
        // Do not serve an absence issued by another overlapping match after this leg began.
        if(snapshot[kind]>0 && current>0 && (player.state?.[kind]?.sourceLegId??null)===(snapshot[`${kind}Source`]??null))
          setAbsence(player,kind,current-1);
      }
    }
    for(const [key,kind] of [['injuries','injury'],['suspensions','suspension']]) {
      for(const consequence of leg.match.postMatchConsequences?.[key]??[]) {
        if(consequence.teamIndex!==teamIndex)continue;
        const player=byId.get(consequence.playerId);if(!player)continue;
        setAbsence(player,kind,Math.max(absenceMatches(player,kind),Number(consequence.matches)||1),{sourceLegId,reason:consequence.reason});
      }
    }
  }
  leg.consequencesApplied=true;
}

export function nextLegSeat(source, account, {full=false}={}) {
  const selection=structuredClone(source.selectionSource ?? source);
  const byId=new Map((account?.draft?.roster??[]).map(p=>[p.id,p]));
  for(const p of [...selection.players,...(selection.substitutes??[])]) {
    const stored=byId.get(p.id);
    if(stored){p.state=structuredClone(stored.state??{});if(!full)setFitness(p,stored.state?.fitness);}
  }
  const seat=prepareFitnessSeat(selection,{minimum:0,full,allowShortHanded:true});
  seat.selectionSource=selection;
  return seat;
}
