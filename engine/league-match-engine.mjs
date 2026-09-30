import { CAMPAIGN_REGULATION_LIVE_MS, createCampaignLiveLeg, advanceCampaignLiveLeg, restoreCampaignLiveLeg, publicCampaignLiveLeg } from './campaign-match-engine.mjs';
import { advanceV2PlayerConditions, applyV2SpatialFoul } from './s4-v2.1/versus/v2/match-engine-v2.js';
import { prepareV22Match } from './v2.2/v21-adapter.mjs';
import { V22HybridMatch, STEP } from './v2.2/hybrid-engine.js';
import { inferElevenBoardRoles } from './s4-v2.1/versus/public/formation-rules.js';
import { LEAGUE_DYNAMIC_ENGINE, LEAGUE_LIVE_MS } from '../shared/config/league-featured.mjs';

const runtimes = new WeakMap(), broadcasts = new WeakMap();
const round = n => Math.round(n * 100) / 100;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function record(leg, event) {
  const m = leg.match, team = m.teams[event.team], p = team?.players.find(p => p.id === event.actorId);
  const key = { shot:'shots', onTarget:'shotsOnTarget', goal:'goals', save:'saves', block:'blocks', tackle:'tackles', interception:'interceptions' }[event.type];
  if (key) { if (p) p.matchStats[key] = (p.matchStats[key] ?? 0) + 1; if (team) team.stats[key] = (team.stats[key] ?? 0) + 1; }
  if (event.type === 'goal') {
    const assist = team?.players.find(p => p.id === event.assistId && p.id !== event.actorId);
    if (assist) assist.matchStats.assists++;
    event = { ...event, text:`${p?.name ?? team.name} 进球${assist ? ` · ${assist.name} 助攻` : ''}` };
  }
  if (event.type === 'onTarget') return;
  m.events.push({ ...event, id:`dynamic-${m.events.length + 1}`, teamIndex:event.team, importance:['goal','var','varResult','fulltime'].includes(event.type) ? 'major' : 'normal' });
}

// Keep the legacy full roster and independent league conditions as the one
// settlement model. Only active players participate in physical simulation.
function syncRoster(leg, sim) {
  const m = leg.match;
  if (m.abandoned) {
    sim.score = [...m.score]; sim.phase = 'finished'; sim.ball.owner=null; sim.ball.flight=null;
    sim.players=sim.players.filter(p=>m.teams[p.team].players.some(q=>q.id===p.sourceId&&q.active));
    return;
  }
  sim.teams.forEach((team, t) => {
    const source = m.teams[t];
    const active = source.players.filter(p => p.active);
    if (active.length && !active.some(p => (p.assignedRole ?? p.role) === 'GK')) {
      const emergency = [...active].sort((a,b)=>Number(b.attributes?.reflexes??0)-Number(a.attributes?.reflexes??0))[0];
      emergency.assignedRole='GK'; source.positions[emergency.id]={x:50,y:94};
      for(const positions of Object.values(source.positionPresets??{}))positions[emergency.id]={x:50,y:94};
      m.events.push({id:`dynamic-${m.events.length+1}`,minute:m.minute,type:'substitution',teamIndex:t,text:`${emergency.name} 临时担任门将`,actorId:emergency.id,importance:'major'});
    }
    team.players = active.map(p => structuredClone(p));
    team.captainId = source.captainId;
    for (const [key, plan] of Object.entries(team.plans)) {
      const raw = source.tacticalPlans?.[key] ?? {};
      plan.positions = structuredClone(source.positionPresets?.[raw.positionPreset ?? 'position1'] ?? source.positions);
      plan.playerDuties = structuredClone(raw.playerDuties ?? source.playerDuties ?? {});
      plan.roles = inferElevenBoardRoles(active.map(p => ({ id:p.id, position:plan.positions[p.id] })), plan.formationLines);
    }
    const ids = new Set(active.map(p => p.id));
    const removed = sim.players.filter(p => p.team === t && !ids.has(p.sourceId));
    sim.players = sim.players.filter(p => p.team !== t || ids.has(p.sourceId));
    for(const p of sim.players.filter(p=>p.team===t))p.gk=(active.find(q=>q.id===p.sourceId)?.assignedRole)==='GK';
    for (const p of active) {
      if (sim.players.some(q => q.team === t && q.sourceId === p.id)) continue;
      const outgoing = removed.find(q => q.sourceId === p.substitutedForId);
      const position = source.positions[p.id] ?? { x:50, y:50 };
      const x = outgoing?.x ?? (t === 0 ? 100 - position.y : position.y) * 1.05;
      const y = outgoing?.y ?? (t === 0 ? position.x : 100 - position.x) * .68;
      sim.players.push({ id:`${t}:${p.id}`, sourceId:p.id, team:t, number:source.players.indexOf(p)+1, name:p.name, gk:(p.assignedRole ?? p.role) === 'GK', x,y,vx:0,vy:0,target:{x,y},action:'替补出场',distance:0,cooldown:sim.time+1 });
    }
  });
  if (sim.ball.owner && !sim.player(sim.ball.owner)) { sim.ball.owner = null; sim.ball.heldByKeeper = false; }
  sim.refreshTeams(); sim.updateTargets();
}

function contact(leg, sim, owner, defender) {
  if (sim.time < (sim.nextContactAt ?? 0)) return false;
  sim.nextContactAt = sim.time + 1;
  const m = leg.match, team = m.teams[defender.team], config = m.parameters, referee = m.environment.referee;
  const aggression = sim.ability(defender, 'aggression'), discipline = sim.ability(defender, 'discipline');
  const rough = team.duelIntensity === 'roughPlay' || team.style === 'roughPlay';
  const intensity = rough ? config.events.roughPlay?.foulMultiplier ?? 1.9 : team.duelIntensity === 'cautious' ? .72 : 1;
  const probability = clamp((Number(config.events.baseFoulProbability ?? .025) + Math.max(0, aggression-65)/700 + Math.max(0,68-discipline)/600) * intensity, .01,.32);
  if (sim.random() >= probability) return false;
  const spot = { x:owner.x, y:owner.y }, depth = owner.team === 0 ? owner.x : 105-owner.x;
  const penalty = depth >= 88.5 && Math.abs(owner.y-34) <= 20.16;
  const cardRoll = sim.random(), red = config.environment.directRedProbability[referee] ?? .02, yellow = config.environment.cardProbability[referee] ?? .2;
  const card = cardRoll < red * (rough ? 2.2 : 1) ? 'red' : cardRoll < yellow * (rough ? 1.55 : 1) ? 'yellow' : null;
  m.minute = sim.minute;
  const chain = { attackingTeamIndex:owner.team, defendingTeamIndex:defender.team, independentEvents:[], stages:[{ actor:{id:owner.sourceId,name:owner.name}, defender:{id:defender.sourceId}, zone:penalty?'box:center':'midfield:center', foul:{occurred:true,penalty,card,referee} }] };
  applyV2SpatialFoul(m, chain); syncRoster(leg, sim);
  if (!sim.finished) sim.stopForRestart({ type:penalty?'penalty':'freeKick', team:owner.team, spot:penalty?{x:owner.team===0?94:11,y:34}:spot }, penalty?'禁区内犯规 · 点球':'犯规 · 任意球');
  return true;
}

function runtime(leg) {
  let sim = runtimes.get(leg);
  if (!sim) {
    sim = V22HybridMatch.restore(leg.dynamic.input, leg.dynamic.state);
    sim.onEvent = e => record(leg, e);
    sim.onContact = (owner, defender) => contact(leg, sim, owner, defender);
    runtimes.set(leg, sim);
  }
  return sim;
}

function frame(sim) {
  return { tick:sim.tick, time:round(sim.time), minute:round(sim.minute), phase:sim.phase, score:[...sim.score], players:sim.players.map(p=>[p.team,p.sourceId,p.number,round(p.x),round(p.y)]), ball:[round(sim.ball.x),round(sim.ball.y),round(sim.ball.z)], cut:sim.phase !== 'play' || sim.events.at(-1)?.time === sim.time };
}

export function createLeagueLiveLeg(options, fixture) {
  const leg = createCampaignLiveLeg(options);
  leg.liveDurationMs = fixture.liveDurationMs;
  if (fixture.engine !== LEAGUE_DYNAMIC_ENGINE) return leg;
  const input = prepareV22Match([leg.home,leg.away], { seed:options.seed, duration:LEAGUE_LIVE_MS/1000, allowShortHanded:true });
  input.environment = structuredClone(leg.match.environment);
  const sim = new V22HybridMatch(input);
  leg.engine = LEAGUE_DYNAMIC_ENGINE; leg.match.engineVersion = '2.2'; leg.match.modelVersion = 'match-engine-v2.2';
  leg.dynamic = { version:1, input, state:sim.checkpoint(), frames:[frame(sim)], conditionIndex:0 };
  sim.events.forEach(e=>record(leg,e));
  return leg;
}

export function restoreLeagueLiveLeg(leg) {
  restoreCampaignLiveLeg(leg);
  // Lazy restoration: an audience request never starts a simulation.
  return leg;
}

export function advanceLeagueLiveLeg(leg, now, { maximumChains = 1 } = {}) {
  restoreLeagueLiveLeg(leg);
  if (leg.engine !== LEAGUE_DYNAMIC_ENGINE) {
    const mappedNow = leg.liveDurationMs ? leg.startedAt + Math.max(0,now-leg.startedAt)*CAMPAIGN_REGULATION_LIVE_MS/leg.liveDurationMs : now;
    return advanceCampaignLiveLeg(leg,mappedNow,{maximumChains});
  }
  if (leg.match.finished || maximumChains <= 0) return leg;
  const sim = runtime(leg), m = leg.match, dynamic = leg.dynamic;
  const target = Math.min(360, Math.max(0,(now-leg.startedAt)/1000));
  // Hard physical-step cap bounds recovery after downtime. Viewer count does
  // not affect this budget. Never fast-forward a full match in one timer tick.
  const steps = Math.min(80, Math.max(0,Math.floor(maximumChains))*40, Math.floor((target-sim.time+1e-8)/STEP));
  for (let i=0;i<steps&&!sim.finished;i++) {
    sim.advance(STEP);
    m.minute = sim.minute; m.score = [...sim.score];
    m.teams.forEach((t,index)=>{t.score=sim.score[index]; t.stats.possessionSeconds=sim.stats[index].possession;});
    if (sim.tick % 40 === 0) { advanceV2PlayerConditions(m,dynamic.conditionIndex++); syncRoster(leg,sim); }
    if (sim.tick % 4 === 0 || sim.finished) dynamic.frames.push(frame(sim));
  }
  if (steps <= 0) return leg;
  dynamic.frames = dynamic.frames.slice(-61); // Twelve seconds at 5 Hz, not an ever-growing replay.
  dynamic.state = sim.checkpoint(); m.nextChainIndex = sim.tick; m.finished = sim.finished;
  m.commentary = m.events.map(e=>({...e}));
  m.rngState = m.rng.getState();
  return leg;
}

export function publicLeagueLiveLeg(leg) {
  const revision = leg.match.nextChainIndex;
  let cached = broadcasts.get(leg);
  if (!cached || cached.revision !== revision || cached.finished !== leg.match.finished) {
    const broadcast = publicCampaignLiveLeg(leg);
    if (leg.engine === LEAGUE_DYNAMIC_ENGINE) {
      broadcast.engine = LEAGUE_DYNAMIC_ENGINE;
      broadcast.dynamic = { version:1, duration:360, frames:leg.dynamic.frames.map(f=>structuredClone(f)), finished:leg.match.finished };
    }
    cached = { revision, finished:leg.match.finished, broadcast }; broadcasts.set(leg,cached);
  }
  return cached.broadcast;
}

export function leagueBroadcastDelta(broadcast, afterTick) {
  const latest=broadcast.dynamic?.frames.at(-1)?.tick;
  if(!Number.isSafeInteger(afterTick)||afterTick<0||afterTick>latest||broadcast.finished)return broadcast;
  return {...broadcast,playerPatch:true,dynamic:{...broadcast.dynamic,frames:broadcast.dynamic.frames.filter(f=>f.tick>=afterTick-8)},teams:broadcast.teams.map(t=>({...t,players:t.players.map(p=>{
    const {card,overall,grade,upgradeLevel,name,role,...state}=p;return state;
  })}))};
}
