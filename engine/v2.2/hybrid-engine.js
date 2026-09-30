import { buildV21DynamicTeamShape } from '../s4-v2.1/versus/v2/dynamic-shape-v2.js';
import { buildV2TeamPlayerEffects } from '../s4-v2.1/versus/v2/team-player-effects.js';
import { offlineEngineAttributeValue } from '../s4-v2.1/versus/offline-attribute-settings.js';
import { formationResearchMultiplier } from '../s4-v2.1/versus/v2/formation-research-v2.js';
import { captureOffside, offsideInvolvement, classifyBoundary, reviewGoal } from './football-rules.js';
import { positionFitScore } from '../s4-v2.1/game/public/schema.js';
import { buildV22TeamBlock, addV22SupportTargets } from './team-block.js';
import { boundedDimension, tacticalExecution } from './tactical-controls.js';
import { resolveV2PlayerDuty } from '../s4-v2.1/versus/v2/player-duties-v2.js';
import { applyV22AttackingMovement, v22CarrierTarget, v22DirectionPreference, v22ShotRange, selectV22Cross } from './attacking-movement.js';
import { v22ShotOpportunity, v22CanCarryForward } from './attacking-decisions.js';

export const STEP = 1 / 20;
export const PITCH = Object.freeze({ length: 105, width: 68 });
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const direction = team => team === 0 ? 1 : -1;
const depth = (p, team) => team === 0 ? p.x : 105 - p.x;
const world = (p, team) => ({ x: (team === 0 ? 100 - p.y : p.y) * 1.05, y: (team === 0 ? p.x : 100 - p.x) * .68 });
function rng(seed) {
  let n = 2166136261;
  for (const c of String(seed)) n = Math.imul(n ^ c.charCodeAt(0), 16777619);
  const next = () => { n = (n + 0x6D2B79F5) >>> 0; let t = Math.imul(n ^ n >>> 15, 1 | n); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  next.getState = () => n >>> 0;
  next.setState = value => { n = value >>> 0; };
  return next;
}
function segmentDistance(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1), 0, 1);
  return distance(p, { x: a.x + dx * t, y: a.y + dy * t });
}

// Fixed physical time: advancing the scoreboard NEVER multiplies velocities.
// Rendering and networking are deliberately outside this deterministic core.
export class V22HybridMatch {
  constructor(input) {
    this.input = structuredClone(input);
    this.random = rng(input.seed);
    this.time = 0; this.tick = 0; this.accumulator = 0; this.score = [0, 0]; this.possession = 0;
    this.extraTimePlayed = false; this.needsPenalties = false;
    this.teams = this.input.teams;
    this.planKeys = ['opening', 'opening']; this.manualPlans = [false, false];
    this.dimensionOverrides = [{}, {}]; this.beforeOverrideManual = [false, false];
    this.players = []; this.events = []; this.phase = 'play'; this.restartAt = 0;
    this.stats = [0, 1].map(() => ({ passes: 0, completed: 0, shots: 0, tackles: 0, offsides: 0, possession: 0, distance: 0 }));
    this.offsideSnapshot = null; this.offsideOffence = null; this.review = null; this.lastTouchTeam = 0; this.restart = null;
    this.ball = { x: 52.5, y: 34, z: 0, owner: null, flight: null };
    this.lastTurnover = -10; this.nextDecision = 1;
    this.refreshTeams();
    this.teams.forEach((team, teamIndex) => team.players.forEach((player, i) => {
      const start = world(this.plan(teamIndex).positions[player.id], teamIndex);
      const gk = player.pool === 'GK' || player.role === 'GK';
      this.players.push({ id: `${teamIndex}:${player.id}`, sourceId: player.id, team: teamIndex, number: i + 1, name: player.name, gk, x: start.x, y: start.y, vx: 0, vy: 0, target: { ...start }, action: '保持阵型', distance: 0, cooldown: 0 });
    }));
    this.kickoff(0);
  }
  get duration() { return this.input.duration + (this.extraTimePlayed ? this.input.extraTimeDuration ?? 120 : 0); }
  get minute() { return this.extraTimePlayed ? Math.min(120, 90 + (this.time - this.input.duration) / (this.input.extraTimeDuration ?? 120) * 30) : Math.min(90, this.time / this.input.duration * 90); }
  get finished() { return this.phase === 'finished'; }
  checkpoint() {
    const { random, effective, shapes, onEvent, onContact, input, ...state } = this;
    return structuredClone({ ...state, rngState: random.getState() });
  }
  static restore(input, state) {
    const match = Object.create(V22HybridMatch.prototype);
    Object.assign(match, structuredClone(state));
    match.input = structuredClone(input); match.random = rng(input.seed);
    match.random.setState(state.rngState); match.refreshTeams();
    return match;
  }
  plan(t) {
    const base = this.teams[t].plans[this.planKeys[t]];
    return Object.keys(this.dimensionOverrides[t]).length ? { ...base, tacticalDimensions: { ...base.tacticalDimensions, ...this.dimensionOverrides[t] } } : base;
  }
  dimensions(t) { return this.plan(t).tacticalDimensions; }
  player(id) { return this.players.find(p => p.id === id); }
  ability(p, key) { return this.effective[p.team].get(p.sourceId)?.attributes[key] ?? 50; }
  execution(p, key) {
    const player = this.effective[p.team].get(p.sourceId);
    return this.ability(p, key) * (.75 + positionFitScore(player, this.plan(p.team).roles[p.sourceId]) * .25);
  }
  log(type, text, team = this.possession, details = {}) {
    const event = { time: this.time, minute: this.minute, type, text, team, ...details };
    this.events.push(event); this.onEvent?.(event);
    if (this.events.length > 100) this.events.shift();
  }
  setPlan(team, key, manual = true) {
    if (![0, 1].includes(team) || !this.teams[team].plans[key]) throw new Error('Unknown tactical plan');
    this.dimensionOverrides[team] = {};
    this.planKeys[team] = key; this.manualPlans[team] = manual; this.refreshTeams(); this.updateTargets();
    this.log('tactic', `${this.teams[team].name} · ${this.plan(team).label ?? key}`, team);
  }
  setDimensions(team, patch) {
    if (![0, 1].includes(team)) throw new Error('Unknown team');
    const values = Object.fromEntries(Object.entries(patch).map(([key, value]) => [key, boundedDimension(this.plan(team), key, value)]));
    if (!Object.keys(this.dimensionOverrides[team]).length) this.beforeOverrideManual[team] = this.manualPlans[team];
    this.dimensionOverrides[team] = { ...this.dimensionOverrides[team], ...values }; this.manualPlans[team] = true;
    this.updateTargets();
    const owner = this.player(this.ball.owner);
    if (owner?.team === team) this.nextDecision = this.time + this.executionProfile(owner).decisionDelay;
  }
  clearDimensions(team) {
    if (![0, 1].includes(team)) throw new Error('Unknown team');
    if (Object.keys(this.dimensionOverrides[team]).length) this.manualPlans[team] = this.beforeOverrideManual[team];
    this.dimensionOverrides[team] = {}; this.updateTargets();
    const owner = this.player(this.ball.owner);
    if (owner?.team === team) this.nextDecision = this.time + this.executionProfile(owner).decisionDelay;
  }
  executionProfile(owner) {
    return tacticalExecution(this.dimensions(owner.team), { transitionAge: this.time - this.lastTurnover, leading: this.score[owner.team] > this.score[1 - owner.team], pressureDistance: Math.min(...this.players.filter(p => p.team !== owner.team).map(p => distance(p, owner))) });
  }
  refreshTeams() {
    this.effective = this.teams.map((team, t) => {
      const plan = this.plan(t);
      const scoreState = this.score[t] > this.score[1 - t] ? 'leading' : this.score[t] < this.score[1 - t] ? 'trailing' : 'level';
      const source = { ...team, ...plan, players: team.players.map(p => ({ ...p, tacticalDuty: resolveV2PlayerDuty(plan.roles[p.id], Object.hasOwn(plan.playerDuties ?? {}, p.id) ? plan.playerDuties[p.id] : p.tacticalDuty) })) };
      const result = buildV2TeamPlayerEffects(source, { roles: plan.roles, minute: this.minute, scoreState, weather: this.input.environment?.weather ?? 'sunny', precipitation: this.input.environment?.precipitation ?? 0 });
      return new Map(result.players.map(p => [p.id, { ...p, attributes: Object.fromEntries(Object.entries(p.attributes).map(([k, v]) => [k, Number(Math.max(this.input.ability.minimum, offlineEngineAttributeValue(v, this.input.attributeSettings, this.input.ability.maximum)).toFixed(2))])) }]));
    });
  }
  kickoff(team) {
    // An explicit dead-ball scene cut; there is no in-play player teleport.
    this.possession = team; this.phase = 'play'; this.offsideSnapshot = null; this.offsideOffence = null; this.restart = null; this.lastTurnover = -10; this.assistCandidate = null;
    for (const p of this.players) {
      const base = world(this.plan(p.team).positions[p.sourceId], p.team);
      p.x = p.team === 0 ? Math.min(49, base.x) : Math.max(56, base.x); p.y = base.y; p.vx = 0; p.vy = 0;
    }
    const taker = this.players.filter(p => p.team === team && !p.gk).sort((a, b) => distance(a, { x: 52.5, y: 34 }) - distance(b, { x: 52.5, y: 34 }))[0];
    taker.x = 52.5; taker.y = 34;
    for (const p of this.players.filter(p => p.team !== team)) {
      if (distance(p, taker) < 9.15) p.x = team === 0 ? 62 : 43;
    }
    this.ball = { x: taker.x, y: taker.y, z: 0, owner: taker.id, flight: null };
    this.nextDecision = this.time + 1.2; this.updateTargets(); this.log('kickoff', '中圈开球', team);
    // A kick-off must be kicked before the taker may dribble or touch again.
    this.takeRestartPass(taker, 'kickoff');
  }
  stopForRestart(restart, text) {
    this.phase = 'stoppage'; this.restartAt = this.time + 3 + this.dimensions(restart.team).timeWasting * .008 * (this.score[restart.team] > this.score[1 - restart.team] ? 1 : .35); this.restart = restart;
    this.ball.owner = null; this.ball.flight = null; this.ball.z = 0;
    this.offsideSnapshot = null; this.offsideOffence = null;
    for (const p of this.players) { p.vx = 0; p.vy = 0; }
    this.log(restart.type, text, restart.team);
  }
  takeRestartPass(taker, type) {
    const receiver = this.players.filter(p => p.team === taker.team && p !== taker && !p.gk).sort((a, b) => distance(a, taker) - distance(b, taker))[0];
    this.stats[taker.team].passes++;
    this.kick(taker, { x: receiver.x, y: receiver.y }, 'pass', receiver, type);
  }
  executeRestart() {
    const restart = this.restart;
    if (restart.type === 'kickoff') { this.kickoff(restart.team); return; }
    this.phase = 'play'; this.possession = restart.team; this.lastTurnover = -10;
    const taker = this.players.filter(p => p.team === restart.team && (restart.type === 'goalKick' ? p.gk : !p.gk)).sort((a, b) => distance(a, restart.spot) - distance(b, restart.spot))[0];
    // Dead-ball arrangement is explicitly cut, not an in-play movement.
    for (const p of this.players) {
      p.vx = 0; p.vy = 0;
      if (p.team !== restart.team) {
        if (restart.type === 'goalKick' && depth(p, restart.team) < 17 && Math.abs(p.y - 34) < 21) p.x = restart.team === 0 ? 18 : 87;
        const min = restart.type === 'throwIn' ? 2 : 9.15, d = distance(p, restart.spot);
        if (d < min) { const sign = restart.spot.x > 52.5 ? -1 : 1; p.x = clamp(restart.spot.x + sign * (min + 1), 1, 104); }
      }
    }
    taker.x = restart.spot.x; taker.y = restart.spot.y;
    this.ball = { x: taker.x, y: taker.y, z: 0, owner: taker.id, flight: null };
    this.assistCandidate = null;
    if (restart.type === 'penalty') {
      for (const p of this.players) {
        if (p === taker) continue;
        if (p.gk && p.team !== restart.team) {p.x=restart.team===0?104.8:.2;p.y=34;}
        else {p.x=restart.team===0?Math.min(p.x,84):Math.max(p.x,21);}
      }
      const goalX = restart.team === 0 ? 105.3 : -.3;
      this.stats[restart.team].shots++;
      this.log('shot', `${taker.name} 主罚点球`, restart.team, { actorId: taker.sourceId });
      this.kick(taker, { x: goalX, y: 34 + (this.random() - .5) * 8 }, 'shot', null, 'penalty');
    } else this.takeRestartPass(taker, restart.type);
    this.restart = null;
  }
  penalizeOffside(offence = this.offsideOffence) {
    this.stats[offence.team].offsides++;
    this.lastOffsideEvidence = offence.snapshot;
    this.stopForRestart({ type: 'indirectFreeKick', team: 1 - offence.team, spot: offence.spot }, '越位 · 对方间接任意球');
  }
  beginGoalReview(team) {
    this.phase = 'var'; this.reviewAt = this.time + 2.5;
    this.review = { team, actorId: this.player(this.ball.flight?.kicker)?.sourceId ?? this.lastKicker?.sourceId, assistId: this.assistCandidate?.receiver === (this.ball.flight?.kicker ?? this.lastKicker?.id) ? this.assistCandidate.actorId : null, offence: this.offsideOffence, snapshot: this.offsideOffence?.snapshot ?? this.offsideSnapshot };
    this.ball.owner = null; this.ball.flight = null;
    this.log('var', '球已入网 · VAR 正在检查进攻阶段', team);
  }
  completeGoalReview() {
    const result = reviewGoal({ team: this.review.team, offsideOffence: this.review.offence });
    if (result.confirmed) {
      this.score[this.review.team]++;
      this.log('goal', '进球确认', this.review.team, { actorId: this.review.actorId, assistId: this.review.assistId, score: [...this.score] });
    }
    else { this.stats[this.review.team].offsides++; this.lastOffsideEvidence = result.evidence; }
    this.lastReview = { ...result, team: this.review.team, time: this.time };
    this.log('varResult', `VAR：${result.reason}`, this.review.team);
    this.stopForRestart(result.restart, result.confirmed ? '进球确认 · 中圈重新开球' : '越位取消进球 · 间接任意球');
    this.review = null;
  }
  advance(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) throw new Error('Invalid elapsed time');
    this.accumulator += seconds;
    while (this.accumulator + 1e-9 >= STEP && !this.finished) { this.accumulator -= STEP; this.step(); }
    if (this.finished) this.accumulator = 0;
  }
  step() {
    this.tick++; this.time = Math.min(this.duration, this.tick * STEP);
    if (this.time >= this.duration) {
      if (this.phase === 'var') this.completeGoalReview();
      if (!this.extraTimePlayed && this.input.knockout && this.score[0] === this.score[1]) {
        this.extraTimePlayed = true; this.kickoff(1); this.log('extraTime', '常规时间战平 · 进入加时赛'); return;
      }
      this.needsPenalties = Boolean(this.input.knockout && this.score[0] === this.score[1]);
      this.phase = 'finished'; this.log('fulltime', this.needsPenalties ? '加时结束 · 待点球决胜' : '全场结束'); return;
    }
    if (!this.halftimePlayed && this.time >= this.input.duration / 2 && this.phase === 'play') {
      this.halftimePlayed = true;
      this.stopForRestart({type:'kickoff',team:1}, '半场结束 · 准备下半场开球');
      this.log('halftime', '半场结束'); return;
    }
    if (this.phase === 'var') { if (this.time >= this.reviewAt) this.completeGoalReview(); return; }
    if (this.phase === 'stoppage') { if (this.time >= this.restartAt) this.executeRestart(); return; }
    if (this.offsideOffence && this.time > this.offsideOffence.deadline && this.ball.flight?.type !== 'shot') { this.penalizeOffside(); return; }
    if (this.tick % 100 === 0) {
      for (let t = 0; t < 2; t++) {
        if (this.manualPlans[t]) continue;
        const key = this.score[t] > this.score[1 - t] ? 'leading' : this.score[t] < this.score[1 - t] ? 'trailing' : 'opening';
        const difference = Math.abs(this.score[t] - this.score[1 - t]);
        const eligible = this.teams[t].plans[key] && (key === 'opening' || difference >= (this.teams[t].plans[key].triggerGoalDifference ?? 1));
        const next = eligible ? key : 'opening';
        if (this.planKeys[t] !== next) this.setPlan(t, next, false);
      }
      this.refreshTeams();
    }
    if (this.tick % 10 === 0) this.updateTargets();
    this.movePlayers(); this.moveBall();
    if (this.phase !== 'play') return;
    this.stats[this.possession].possession += STEP;
    if (this.time >= this.nextDecision && this.ball.owner) this.decide();
  }
  updateTargets() {
    const attacking = this.possession, ballDepth = depth(this.ball, attacking);
    this.stage = ballDepth < 37 ? 'buildUp' : ballDepth < 66 ? 'progression' : ballDepth < 83 ? 'finalThird' : 'chance';
    const localWidth = attacking === 0 ? this.ball.y / .68 : 100 - this.ball.y / .68;
    const lane = localWidth < 22 ? 'farLeft' : localWidth < 42 ? 'leftHalfSpace' : localWidth < 58 ? 'center' : localWidth < 78 ? 'rightHalfSpace' : 'farRight';
    this.shapes = [0, 1].map(t => {
      const plan = this.plan(t), dims = this.dimensions(t);
      const players = [...this.effective[t].values()];
      const shape = buildV21DynamicTeamShape({ team: { ...this.teams[t], ...plan, players, v2Snapshot: { minute: this.minute, scoreState: this.score[t] > this.score[1 - t] ? 'leading' : this.score[t] < this.score[1 - t] ? 'trailing' : 'level' } }, teamIndex: t, attackingTeamIndex: attacking, stage: this.stage, roles: plan.roles, dimensions: dims, ballLane: lane, possessionType: this.time - this.lastTurnover < 5 ? 'transition' : 'normal', config: this.input.shapeConfig });
      const counter = tacticalExecution(dims, { transitionAge: this.time - this.lastTurnover }).counter;
      const block = buildV22TeamBlock(shape, { team: t, attacking: t === attacking, ball: this.ball, dimensions: dims, counter });
      const reserved = t === attacking ? applyV22AttackingMovement(block.targets, shape, { team: t, ball: this.ball, ownerId: this.ball.owner, dimensions: dims }) : new Set();
      const backLine = this.players.filter(q => q.team !== t).map(q => depth(q, t)).sort((a, b) => b - a)[1] ?? 105;
      for (const item of shape.players) {
        const p = this.players.find(p => p.team === t && p.sourceId === item.id);
        const point = block.targets.get(item.id);
        if (p && point) { p.target = { x: clamp(point.x, 2, 103), y: clamp(point.y, 2, 66) }; p.action = point.action; }
      }
      if (t === attacking) {
        addV22SupportTargets(this.players, shape, { team: t, ball: this.ball, ownerId: this.ball.owner, dimensions: dims, reserved });
        // Apply after every off-ball instruction, including support runs.
        if (!this.ball.flight) for (const p of this.players.filter(p => p.team === t && !p.gk && p.id !== this.ball.owner)) {
          const onsideDepth = Math.max(depth(this.ball, t), backLine, 52.5) - 1.2;
          if (depth(p.target, t) > onsideDepth) p.target.x = t === 0 ? onsideDepth : 105 - onsideDepth;
        }
      }
      if (t !== attacking) {
        const candidates = this.players.filter(p => p.team === t && !p.gk).sort((a, b) => distance(a, this.ball) - distance(b, this.ball));
        const reach = 7 + dims.pressing * .22;
        candidates.slice(0, dims.pressing > 72 ? 2 : 1).forEach((p, i) => {
          if (distance(p, this.ball) < reach) { p.target = { x: clamp(this.ball.x + direction(attacking) * (i ? 5 : .7), 2, 103), y: clamp(this.ball.y + (i ? (34 - this.ball.y) * .2 : 0), 2, 66) }; p.action = i ? '压迫身后保护' : '压迫持球'; }
        });
      }
      return shape;
    });
    const owner = this.player(this.ball.owner);
    if (owner) {
      const target = v22CarrierTarget(owner, this.effective[owner.team].get(owner.sourceId).tacticalDuty);
      owner.target = { x: target.x, y: target.y }; owner.action = owner.gk ? '组织出球' : target.action;
      if (owner.gk) owner.target = { x: owner.x, y: owner.y };
    }
    if (this.ball.flight?.receiver) {
      const receiver = this.player(this.ball.flight.receiver);
      if (receiver) { receiver.target = { ...this.ball.flight.end }; receiver.action = '迎球接应'; }
    } else if (!owner && !this.ball.flight) {
      for (const t of [0, 1]) {
        const nearest = this.players.filter(p => p.team === t).sort((a, b) => distance(a, this.ball) - distance(b, this.ball))[0];
        nearest.target = { x: this.ball.x, y: this.ball.y }; nearest.action = '争抢落点';
      }
    }
  }
  movePlayers() {
    for (const p of this.players) {
      const attr = this.effective[p.team].get(p.sourceId), fitness = clamp(attr.state?.fitness ?? 100, 10, 100);
      const maxSpeed = (4.5 + clamp(this.ability(p, 'pace'), 1, 120) * .027) * (.84 + fitness * .0016);
      const carrying = this.ball.owner === p.id;
      let dx = p.target.x - p.x, dy = p.target.y - p.y;
      // Soft local avoidance changes velocity, never position directly.
      for (const q of this.players) {
        if (q === p) continue;
        const d = distance(p, q);
        if (d < 1.6 && d > .01) { dx += (p.x - q.x) / d * (1.6 - d) * 2; dy += (p.y - q.y) / d * (1.6 - d) * 2; }
      }
      const length = Math.hypot(dx, dy), speed = Math.min(maxSpeed * (carrying ? .62 : .86), length * 1.6);
      const desiredX = dx / (length || 1) * speed, desiredY = dy / (length || 1) * speed;
      const changeX = desiredX - p.vx, changeY = desiredY - p.vy, change = Math.hypot(changeX, changeY);
      const acceleration = 2.2 + clamp(this.ability(p, 'acceleration'), 1, 120) * .025;
      const fraction = Math.min(1, acceleration * STEP / (change || 1));
      p.vx += changeX * fraction; p.vy += changeY * fraction;
      const old = { x: p.x, y: p.y };
      p.x = clamp(p.x + p.vx * STEP, 0, 105); p.y = clamp(p.y + p.vy * STEP, 0, 68);
      const moved = distance(old, p); p.distance += moved; this.stats[p.team].distance += moved;
    }
  }
  receive(p, intercepted = false) {
    const former = this.possession;
    const incoming = this.ball.flight;
    const heldByKeeper = p.gk && intercepted && this.ball.flight?.team !== p.team && this.ball.flight != null && depth(p, p.team) <= 16.5 && Math.abs(p.y - 34) <= 20.16;
    const involvement = offsideInvolvement(this.offsideSnapshot, p);
    if (involvement) {
      if (involvement.margin > 1) { this.penalizeOffside(involvement); return; }
      this.offsideOffence ??= { ...involvement, deadline: this.time + 4 };
      this.log('flagDelayed', '助理裁判延迟举旗 · 继续本次进攻', p.team);
    }
    if (former !== p.team) {
      if (this.offsideOffence) { this.penalizeOffside(); return; }
      this.offsideSnapshot = null;
    }
    if (former !== p.team || intercepted) this.assistCandidate = null;
    else if (incoming && incoming.type !== 'shot') this.assistCandidate = { receiver: p.id, actorId: this.player(incoming.kicker)?.sourceId };
    this.possession = p.team; this.ball.owner = p.id; this.ball.flight = null; this.ball.z = 0; this.ball.heldByKeeper = heldByKeeper;
    this.ball.x = p.x; this.ball.y = p.y;
    this.lastTouchTeam = p.team;
    if (former !== p.team) { this.lastTurnover = this.time; this.log(intercepted ? 'interception' : 'tackle', `${p.name} ${intercepted ? '截下传球' : '夺回球权'}`, p.team, { actorId: p.sourceId }); }
    this.nextDecision = this.time + this.executionProfile(p).decisionDelay;
    p.cooldown = this.time + .8; this.updateTargets();
  }
  moveBall() {
    const owner = this.player(this.ball.owner);
    if (owner) {
      this.ball.x = owner.x + direction(owner.team) * .5; this.ball.y = owner.y + .25;
      if (!this.ball.heldByKeeper && this.tick % 4 === 0 && owner.cooldown < this.time) {
        const challenger = this.players.filter(p => p.team !== owner.team && !p.gk && distance(p, owner) < 1.3).sort((a, b) => distance(a, owner) - distance(b, owner))[0];
        if (challenger && this.onContact?.(owner, challenger)) return;
        if (challenger && this.random() < clamp(.15 + (this.ability(challenger, 'tackling') - this.ability(owner, 'dribbling')) * .003, .04, .35)) { this.stats[challenger.team].tackles++; this.receive(challenger); }
      }
      return;
    }
    const flight = this.ball.flight;
    if (!flight) {
      const candidate = [...this.players].sort((a, b) => distance(a, this.ball) - distance(b, this.ball))[0];
      if (distance(candidate, this.ball) < 1.25) this.receive(candidate);
      return;
    }
    const old = { x: this.ball.x, y: this.ball.y };
    flight.elapsed += STEP;
    const progress = Math.min(1, flight.elapsed / flight.duration);
    this.ball.x = flight.start.x + (flight.end.x - flight.start.x) * progress;
    this.ball.y = flight.start.y + (flight.end.y - flight.start.y) * progress;
    this.ball.z = (flight.startHeight ?? 0) * (1 - progress) + Math.sin(progress * Math.PI) * flight.height;
    // Interception is gated by actual trajectory and reach, not a remote dice roll.
    const blocker = this.players.filter(p => p.team !== flight.team && segmentDistance(p, old, this.ball) < (p.gk ? 1.8 : .8) && this.ball.z < (p.gk ? 2.5 : 1.4)).sort((a, b) => distance(a, old) - distance(b, old))[0];
    if (blocker) {
      const chance = flight.type === 'shot' ? clamp(.42 + this.ability(blocker, blocker.gk ? 'reflexes' : 'positioning') * .0035, .4, .88) : .88;
      if (this.random() < chance) { if (flight.type === 'shot') this.log(blocker.gk ? 'save' : 'block', `${blocker.name} ${blocker.gk ? '扑住射门' : '封堵射门'}`, blocker.team, { actorId: blocker.sourceId }); this.receive(blocker, true); return; }
    }
    if (progress < 1) return;
    if (flight.type === 'shot') {
      const boundary = classifyBoundary(this.ball, this.lastTouchTeam);
      if (boundary?.type === 'goal') this.beginGoalReview(boundary.team);
      else if (this.offsideOffence) this.penalizeOffside();
      else if (boundary) this.stopForRestart(boundary, boundary.type === 'corner' ? '底线出界 · 角球' : '射门偏出 · 球门球');
      else { this.ball.flight = null; this.updateTargets(); }
      return;
    }
    const receiver = this.player(flight.receiver);
    const boundary = classifyBoundary(this.ball, this.lastTouchTeam);
    if (boundary) {
      if (boundary.type === 'goal') this.beginGoalReview(boundary.team);
      else if (this.offsideOffence) this.penalizeOffside();
      else this.stopForRestart(boundary, { throwIn: '边线出界 · 界外球', corner: '底线出界 · 角球', goalKick: '底线出界 · 球门球' }[boundary.type]);
      return;
    }
    if (receiver && distance(receiver, this.ball) < 2) { this.stats[flight.team].completed++; this.receive(receiver); }
    else { this.ball.flight = null; this.log('loose', '传球落点出现争抢', flight.team); this.updateTargets(); }
  }
  kick(owner, end, type, receiver = null, restart = null) {
    this.lastKicker = { id: owner.id, sourceId: owner.sourceId, team: owner.team };
    if (type === 'shot' && Math.abs(end.y - 34) < 3.66) this.log('onTarget', `${owner.name} 射正`, owner.team, { actorId: owner.sourceId });
    const length = distance(owner, end);
    const speed = type === 'shot' ? 24 : type === 'cross' ? 18 : length > 28 ? 18 : 14;
    const fromHands = owner.gk && this.ball.heldByKeeper;
    this.ball.owner = null;
    this.ball.heldByKeeper = false;
    this.lastTouchTeam = owner.team;
    this.offsideSnapshot = captureOffside(this.players, this.ball, owner.team, owner.id, restart);
    this.ball.flight = { start: { x: this.ball.x, y: this.ball.y }, end, elapsed: 0, duration: Math.max(.2, length / speed), height: type === 'shot' ? .55 : type === 'cross' ? 3 : type === 'cutback' ? .3 : length > 28 ? 3.5 : .3, team: owner.team, kicker: owner.id, receiver: receiver?.id, type };
    // A caught ball is distributed from the hands, not rolled straight through
    // the striker who just shot. Keep the real arc and normal interception rules.
    if (fromHands) { this.ball.flight.startHeight = 1.8; this.ball.flight.height = length > 28 ? 5 : 2; this.ball.z = 1.8; }
    owner.action = type === 'shot' ? '起脚射门' : '传球';
    this.updateTargets();
  }
  decide() {
    const owner = this.player(this.ball.owner), t = owner.team, dims = this.dimensions(t), sign = direction(t);
    const goal = { x: t === 0 ? 105 : 0, y: 34 }, goalDistance = distance(owner, goal);
    const nearest = Math.min(...this.players.filter(p => p.team !== t).map(p => distance(p, owner)));
    const profile = this.executionProfile(owner);
    const details = this.plan(t).inPossessionDetails;
    const shotRange = v22ShotRange(details);
    const opponents = this.players.filter(p => p.team !== t), role = this.plan(t).roles[owner.sourceId];
    const opportunity = v22ShotOpportunity(owner, opponents, { range: shotRange, role, duty: this.effective[t].get(owner.sourceId).tacticalDuty, details });
    if (opportunity.canShoot && this.random() < opportunity.probability) {
      const finishing = this.execution(owner, 'finishing') * formationResearchMultiplier(this.plan(t).formationResearch, 'finishing', this.plan(t).roles[owner.sourceId]);
      const spread = 2.6 + goalDistance * .12 + Math.max(0, 90 - finishing) * .035;
      const aim = opportunity.aimY + (this.random() - .5) * spread * 2;
      this.stats[t].shots++; this.log('shot', `${owner.name} 起脚射门`, t, { actorId: owner.sourceId }); this.kick(owner, { x: goal.x + sign * .3, y: aim }, 'shot'); return;
    }
    const defenders = this.players.filter(p => p.team !== t).map(p => depth(p, t)).sort((a, b) => b - a);
    const offsideLine = Math.max(depth(this.ball, t), defenders[1] ?? 105, 52.5);
    const cross = selectV22Cross(owner, this.players, details, offsideLine);
    if (cross) {
      const receiver = cross.receiver, flightTime = distance(owner, receiver) / 18;
      const accuracy = this.execution(owner, 'crossing');
      const error = Math.max(.3, (105 - accuracy) * .03);
      const end = { x: clamp(receiver.x + receiver.vx * flightTime * .25 + (this.random() - .5) * error, 2, 103), y: clamp(receiver.y + receiver.vy * flightTime * .25 + (this.random() - .5) * error, 2, 66) };
      this.stats[t].passes++; owner.lastPass = this.time;
      this.log('cross', `${owner.name} ${cross.cutback ? '倒三角回传' : '边路传中'} → ${receiver.name}`, t);
      this.kick(owner, end, cross.cutback ? 'cutback' : 'cross', receiver); return;
    }
    const options = this.players.filter(p => p.team === t && p !== owner && distance(p, owner) > 4 && distance(p, owner) < 43).map(p => {
      const length = distance(p, owner), forward = (p.x - owner.x) * sign;
      const clearance = Math.min(...this.players.filter(q => q.team !== t).map(q => segmentDistance(q, owner, p)));
      const space = Math.min(...this.players.filter(q => q.team !== t).map(q => distance(q, p)));
      const desired = profile.desiredPassDistance;
      const flank = this.plan(t).inPossessionDetails.attackDirection;
      const localY = t === 0 ? p.y : 68 - p.y;
      const focus = v22DirectionPreference(flank, localY);
      const offsideRisk = Math.max(0, depth(p, t) - offsideLine) * 14;
      const retreatCost = depth(owner, t) > 65 && ['ST', 'LW', 'RW', 'AM'].includes(role) ? Math.max(0, -forward - 3) * .9 : 0;
      return { p, forward, score: forward * profile.forwardWeight + Math.min(clearance, 6) * (1.5 + profile.control) + Math.min(space, 9) * .7 - Math.abs(length - desired) * .3 + focus + this.random() * 3 - (p.gk ? 8 : 0) - offsideRisk - retreatCost };
    }).sort((a, b) => b.score - a.score);
    const option = options[0];
    const carryInstead = option?.forward < -3 && v22CanCarryForward(owner, opponents, role) && profile.control < .5;
    if (option && !carryInstead && (nearest < 6 || owner.gk || this.time - (owner.lastPass ?? -10) > 3.2 || option.score > 22)) {
      const receiver = option.p, flightTime = distance(owner, receiver) / 15;
      const accuracy = this.execution(owner, 'passing') * formationResearchMultiplier(this.plan(t).formationResearch, 'passing', this.plan(t).roles[owner.sourceId]);
      const error = Math.max(.25, (105 - accuracy) * .024);
      const end = { x: clamp(receiver.x + receiver.vx * flightTime * .35 + (this.random() - .5) * error, 2, 103), y: clamp(receiver.y + receiver.vy * flightTime * .35 + (this.random() - .5) * error, 2, 66) };
      this.stats[t].passes++; owner.lastPass = this.time;
      this.log('pass', `${owner.name} → ${receiver.name}`, t); this.kick(owner, end, 'pass', receiver);
    } else this.nextDecision = this.time + profile.retryDelay;
  }
}
