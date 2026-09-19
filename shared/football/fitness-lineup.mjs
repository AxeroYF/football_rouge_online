import { availabilitySnapshot, healthUnavailable } from './match-availability.mjs';
import { FITNESS_RULES, boundedFitness, fitnessRedline } from '../config/fitness.mjs';
import { presentPlayerTraits } from '../config/player-trait-presentation.mjs';
import { analyzeElevenBoardFormation } from '../../formation-rules.js';
import { compareAutomaticSubstitutes, automaticSubstitutionRank, injurySubstitutionCandidate } from '../../engine/s4-v2.1/versus/automatic-substitution.js';

export const effectiveFitness = player => boundedFitness(presentPlayerTraits(player).effectiveFitness);
export function setFitness(player, value) {
  player.state = { ...player.state, fitness: boundedFitness(value) };
  if (Object.hasOwn(player, 'fitness')) player.fitness = player.state.fitness;
}
export function unavailablePlayer(player) {
  return Boolean(player.coalitionLoan || player.training || player.injury || player.sentOff || healthUnavailable(player));
}

// Redline is a pre-match rotation preference, never an extra in-match penalty.
// Work on the match copy so all three saved shapes and research bindings survive.
export function prepareFitnessSeat(source, { minimum = FITNESS_RULES.minimum, full = false, allowShortHanded = false } = {}) {
  const seat = structuredClone(source);
  const threshold = fitnessRedline(seat.fitnessThreshold);
  const unavailable=p=>unavailablePlayer(full?{...p,training:null}:p);
  const starters = seat.players.filter(p => p.active !== false);
  const pool = [...seat.players.filter(p => p.active === false), ...(seat.substitutes ?? [])];
  delete seat.substitutes;
  for (const p of [...starters, ...pool]) setFitness(p, effectiveFitness(full ? { ...p, state: { ...p.state, fitness: 100 } } : p));
  const roles = analyzeElevenBoardFormation(starters, seat.positions, seat.formationLines).roles;
  seat.availability = availabilitySnapshot([...starters, ...pool]);
  const excluded = new Set();
  const used = new Set(), replacements = new Map(), rotations = [];
  // Forced absences (especially goalkeepers) have first claim on reserves.
  const ordered = [...starters].sort((a,b) => Number(unavailable(b) || effectiveFitness(b) < minimum) - Number(unavailable(a) || effectiveFitness(a) < minimum));
  for (const original of ordered) {
    const value = effectiveFitness(original), forced = unavailable(original) || value < minimum;
    if (!forced && (full || value > threshold)) continue;
    const role = roles[original.id] ?? original.role;
    const fresh = pool.filter(p => !used.has(p.id) && !unavailable(p) && effectiveFitness(p) >= minimum
      && (forced || effectiveFitness(p) > threshold) && (forced?injurySubstitutionCandidate(role,p):automaticSubstitutionRank(role,p)>0));
    fresh.sort((a,b) => compareAutomaticSubstitutes(role,a,b,effectiveFitness,p => p.effectiveOverall ?? p.overall ?? 0));
    const replacement = fresh[0];
    if (!replacement) {
      if (forced && allowShortHanded && (original.coalitionLoan || healthUnavailable(original) || original.injury || original.sentOff)) {
        excluded.add(original.id);
        rotations.push({outId:original.id,outName:original.name,inId:null,reason:original.coalitionLoan?'联军借调，无合适替补':'伤停缺阵，无合适替补'});
        continue;
      }
      if (forced) throw Object.assign(new Error(original.coalitionLoan?`${original.name ?? original.id}正在联军借调，请补充替补球员`:`${original.name ?? original.id}无法出征（体力低于${minimum}或伤停），请补充同位置远征替补或休息`), { statusCode:409, code:'expedition-fitness' });
      continue;
    }
    replacements.set(original.id,replacement); used.add(replacement.id);
    rotations.push({ outId:original.id,outName:original.name,inId:replacement.id,inName:replacement.name,fitness:value,threshold,reason:original.coalitionLoan?'联军借调':forced?'出场条件不足':`体力${Math.round(value)}达到红线${threshold}` });
  }
  const remap = object => Object.fromEntries(Object.entries(object ?? {}).filter(([id])=>!excluded.has(id)).map(([id,value]) => [replacements.get(id)?.id ?? id,structuredClone(value)]));
  seat.positions=remap(seat.positions);
  for(const key of Object.keys(seat.positionPresets ?? {})) seat.positionPresets[key]=remap(seat.positionPresets[key]);
  for(const plan of Object.values(seat.tacticalPlans ?? {})) plan.playerDuties=remap(plan.playerDuties);
  seat.captainId=replacements.get(seat.captainId)?.id ?? seat.captainId;
  const selected=starters.filter(p=>!excluded.has(p.id)).map(p=>replacements.get(p.id) ?? p), selectedIds=new Set(selected.map(p=>p.id));
  seat.players=[...selected.map(p=>({...p,active:true})), ...[...starters,...pool].filter(p=>!selectedIds.has(p.id)&&!unavailable(p)&&effectiveFitness(p)>=minimum).map(p=>({...p,active:false}))];
  seat.fitnessThreshold=threshold; seat.rotations=rotations;
  return seat;
}
