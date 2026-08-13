import { V25_PHASES, dynamicFrame, interpolateFrames } from "./v25-dynamic-formation-engine.js";

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

function teamFromBroadcast(team, teamIndex) {
  const positions = team.positions ?? {};
  const players = (team.players ?? []).filter((player) => player.active || player.sentOff || player.injury).map((player, index) => {
    const board = player.position ?? positions[player.id] ?? { x:50, y:teamIndex ? 10 : 90 };
    return {
      ...player,
      number:Number(player.number ?? index + 1),
      role:player.assignedRole ?? player.role ?? "PLAYER",
      anchor:{ x:clamp(100 - Number(board.y ?? 50), 4, 96), y:clamp(Number(board.x ?? 50), 5, 95) },
    };
  });
  return {
    id:`broadcast-${teamIndex}`,
    name:team.name,
    shortName:team.name,
    color:teamIndex === 0 ? "#55d6ff" : "#ff6577",
    outline:teamIndex === 0 ? "#d8f7ff" : "#ffe0e4",
    direction:teamIndex === 0 ? 1 : -1,
    mentality:team.tactic ?? "balanced",
    shape:team.formation ?? "-",
    players,
  };
}

function eventPhaseIndex(match) {
  const latest = match.events?.at(-1);
  const eventMap = {
    goal:"counterGoal", ownGoal:"counterGoal", superWorldie:"counterGoal", penalty:"penalty", penaltyAwarded:"penalty",
    penaltyShootoutKick:"penalty", save:"save", butterFingers:"save", counter:"counterDefense", foul:"tackle",
    yellow:"tackle", red:"tackle", injury:"tackle", substitution:"recovery",
  };
  const eventPhase = eventMap[latest?.type];
  if (eventPhase) return V25_PHASES.findIndex((phase) => phase.id === eventPhase);
  const minute = clamp(Number(match.minute ?? 0), 0, 90);
  return Math.min(7, Math.floor(minute / 90 * 8));
}

function pitchPoint(position, pitch) {
  return { x:pitch.x + position.x / 100 * pitch.width, y:pitch.y + position.y / 100 * pitch.height };
}

function drawGoal(context, pitch, side) {
  const left = side === "left";
  const lineX = left ? pitch.x : pitch.x + pitch.width;
  const depth = 18;
  const outerX = left ? lineX - depth : lineX;
  const height = pitch.height * .18;
  const top = pitch.y + (pitch.height - height) / 2;
  context.save();
  context.strokeStyle = "rgba(245,255,250,.9)";
  context.lineWidth = 2;
  context.strokeRect(outerX, top, depth, height);
  context.strokeStyle = "rgba(235,255,243,.28)";
  context.lineWidth = 1;
  for (let x = 5; x < depth; x += 6) { context.beginPath(); context.moveTo(outerX + x, top); context.lineTo(outerX + x, top + height); context.stroke(); }
  for (let y = 6; y < height; y += 8) { context.beginPath(); context.moveTo(outerX, top + y); context.lineTo(outerX + depth, top + y); context.stroke(); }
  context.restore();
}

function carrierPosition(frame, phase) {
  const team = frame.teams[phase.possession];
  const player = team?.players.find((candidate) => candidate.role === phase.carrierRole) ?? team?.players.find((candidate) => candidate.active);
  if (!player) return { x:50, y:50 };
  return { x:player.x + team.direction * 1.5, y:player.y };
}

function drawBall(context, position, pitch) {
  const point = pitchPoint(position, pitch);
  context.save();
  context.shadowColor = "rgba(255,255,255,.85)";
  context.shadowBlur = 9;
  context.beginPath();
  context.arc(point.x, point.y, 4.5, 0, Math.PI * 2);
  context.fillStyle = "#fff";
  context.fill();
  context.shadowBlur = 0;
  context.strokeStyle = "#17231e";
  context.stroke();
  context.restore();
}

function drawPitch(context, pitch) {
  context.clearRect(0, 0, context.canvas.clientWidth, context.canvas.clientHeight);
  for (let stripe = 0; stripe < 12; stripe += 1) {
    context.fillStyle = stripe % 2 ? "#17623d" : "#1b6b43";
    context.fillRect(pitch.x + pitch.width / 12 * stripe, pitch.y, pitch.width / 12 + 1, pitch.height);
  }
  drawGoal(context, pitch, "left");
  drawGoal(context, pitch, "right");
  context.strokeStyle = "rgba(235,255,243,.68)";
  context.lineWidth = 1.2;
  context.strokeRect(pitch.x, pitch.y, pitch.width, pitch.height);
  context.beginPath();
  context.moveTo(pitch.x + pitch.width / 2, pitch.y);
  context.lineTo(pitch.x + pitch.width / 2, pitch.y + pitch.height);
  context.stroke();
  context.beginPath();
  context.arc(pitch.x + pitch.width / 2, pitch.y + pitch.height / 2, pitch.height * .145, 0, Math.PI * 2);
  context.stroke();
  const boxWidth = pitch.width * .16;
  const boxHeight = pitch.height * .55;
  const sixWidth = pitch.width * .065;
  const sixHeight = pitch.height * .26;
  for (const side of [0, 1]) {
    const boxX = side ? pitch.x + pitch.width - boxWidth : pitch.x;
    const sixX = side ? pitch.x + pitch.width - sixWidth : pitch.x;
    context.strokeRect(boxX, pitch.y + (pitch.height - boxHeight) / 2, boxWidth, boxHeight);
    context.strokeRect(sixX, pitch.y + (pitch.height - sixHeight) / 2, sixWidth, sixHeight);
  }
}

function drawPlayer(context, player, team, pitch, teamIndex) {
  const point = pitchPoint(player, pitch);
  const radius = 8;
  context.save();
  context.shadowColor = team.color;
  context.shadowBlur = 8;
  context.beginPath();
  context.arc(point.x, point.y, radius, 0, Math.PI * 2);
  context.fillStyle = team.color;
  context.fill();
  context.shadowBlur = 0;
  context.strokeStyle = team.outline;
  context.lineWidth = 1.6;
  context.stroke();
  context.fillStyle = teamIndex === 0 ? "#06202a" : "#fff";
  context.font = "800 7px Inter, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(String(player.number), point.x, point.y + .5);
  context.fillStyle = "rgba(255,255,255,.95)";
  context.font = '600 9px "Microsoft YaHei", sans-serif';
  context.textBaseline = "top";
  context.fillText(player.name ?? "球员", point.x, point.y + radius + 4);
  context.restore();
}

export function v25BroadcastMarkup() {
  return `<section class="v25-broadcast-board" data-v25-broadcast><header><div><small>V2.5 DYNAMIC LIVE SHAPE</small><h2>小圆点观战</h2></div><span data-v25-phase-label>动态阵型</span></header><div class="v25-broadcast-canvas-wrap"><canvas data-v25-canvas aria-label="V2.5动态小圆点观战"></canvas></div></section>`;
}

export function mountV25Broadcast(root, match) {
  const canvas = root?.querySelector("[data-v25-canvas]");
  if (!canvas) return () => {};
  const context = canvas.getContext("2d");
  const teams = (match.teams ?? []).map(teamFromBroadcast);
  const phaseIndex = eventPhaseIndex(match);
  const phase = V25_PHASES[phaseIndex];
  let progress = 0;
  let lastTime = performance.now();
  let animationFrame = 0;
  let disposed = false;

  function resize() {
    const ratio = Math.min(2, devicePixelRatio || 1);
    const bounds = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(bounds.width * ratio));
    const height = Math.max(1, Math.round(bounds.height * ratio));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function render() {
    resize();
    const pitch = { x:34, y:24, width:canvas.clientWidth - 68, height:canvas.clientHeight - 48 };
    const visualPhase = Number.isInteger(match.events?.at(-1)?.teamIndex) ? { ...phase, possession:match.events.at(-1).teamIndex } : phase;
    const from = dynamicFrame(phaseIndex, teams, visualPhase);
    const to = dynamicFrame((phaseIndex + 1) % V25_PHASES.length, teams);
    const frame = interpolateFrames(from, to, progress);
    drawPitch(context, pitch);
    frame.teams.forEach((team, teamIndex) => team.players.forEach((player) => drawPlayer(context, player, team, pitch, teamIndex)));
    drawBall(context, carrierPosition(frame, frame.phase), pitch);
    const label = root.querySelector("[data-v25-phase-label]");
    if (label) label.textContent = `${phase.label} · ${match.minute ?? 0}'`;
  }

  function animate(time) {
    if (disposed) return;
    const elapsed = Math.min(100, time - lastTime);
    lastTime = time;
    progress += elapsed / 2800;
    if (progress >= 1) progress = 0;
    render();
    animationFrame = requestAnimationFrame(animate);
  }

  const onResize = () => render();
  addEventListener("resize", onResize);
  render();
  animationFrame = requestAnimationFrame(animate);
  return () => { disposed = true; cancelAnimationFrame(animationFrame); removeEventListener("resize", onResize); };
}
