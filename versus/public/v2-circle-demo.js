const canvas = document.querySelector("#pitch");
const context = canvas.getContext("2d");
const elements = {
  homeName:document.querySelector("#home-name"),
  awayName:document.querySelector("#away-name"),
  score:document.querySelector("#score"),
  clock:document.querySelector("#clock"),
  play:document.querySelector("#play"),
  replay:document.querySelector("#replay"),
  progress:document.querySelector("#progress"),
  currentEvent:document.querySelector("#current-event"),
  possession:document.querySelector("#possession-label"),
  eventFlash:document.querySelector("#event-flash"),
  eventCount:document.querySelector("#event-count"),
  events:document.querySelector("#events"),
  stats:document.querySelector("#stats"),
  engineVersion:document.querySelector("#engine-version"),
};

const state = {
  data:null,
  minute:0,
  playing:true,
  speed:1,
  lastTimestamp:0,
  eventIndex:-1,
  flashUntil:0,
};

const PLAYBACK_SECONDS = 105;
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const mix = (from, to, progress) => from + (to - from) * progress;
const smooth = (value) => value * value * (3 - 2 * value);

function formatMinute(minute, clock = false) {
  const totalSeconds = Math.round(Number(minute) * 60);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return clock ? `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}` : `${minutes}'`;
}

function resizeCanvas() {
  const bounds = canvas.getBoundingClientRect();
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.max(1, Math.round(bounds.width * ratio));
  const height = Math.max(1, Math.round(bounds.height * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function pitchGeometry() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const padding = Math.max(16, Math.min(width, height) * 0.035);
  return { x:padding, y:padding, width:width - padding * 2, height:height - padding * 2 };
}

function pointOnPitch(point, pitch) {
  return { x:pitch.x + point.x / 100 * pitch.width, y:pitch.y + point.y / 100 * pitch.height };
}

function drawPitch(pitch) {
  const styles = getComputedStyle(document.documentElement);
  const grass = styles.getPropertyValue("--pitch").trim();
  const grassAlt = styles.getPropertyValue("--pitch-alt").trim();
  const line = styles.getPropertyValue("--pitch-line").trim();
  context.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
  context.fillStyle = grass;
  context.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);
  for (let index = 0; index < 10; index += 1) {
    context.fillStyle = index % 2 ? grass : grassAlt;
    context.fillRect(pitch.x, pitch.y + pitch.height / 10 * index, pitch.width, pitch.height / 10 + 1);
  }
  context.strokeStyle = line;
  context.lineWidth = 1.4;
  context.strokeRect(pitch.x, pitch.y, pitch.width, pitch.height);
  context.beginPath();
  context.moveTo(pitch.x, pitch.y + pitch.height / 2);
  context.lineTo(pitch.x + pitch.width, pitch.y + pitch.height / 2);
  context.stroke();
  context.beginPath();
  context.arc(pitch.x + pitch.width / 2, pitch.y + pitch.height / 2, Math.min(pitch.width, pitch.height) * .105, 0, Math.PI * 2);
  context.stroke();
  context.fillStyle = line;
  context.beginPath();
  context.arc(pitch.x + pitch.width / 2, pitch.y + pitch.height / 2, 2, 0, Math.PI * 2);
  context.fill();
  const boxWidth = pitch.width * .44;
  const boxHeight = pitch.height * .16;
  const sixWidth = pitch.width * .21;
  const sixHeight = pitch.height * .065;
  for (const side of [0, 1]) {
    const y = side ? pitch.y + pitch.height - boxHeight : pitch.y;
    const sixY = side ? pitch.y + pitch.height - sixHeight : pitch.y;
    context.strokeRect(pitch.x + (pitch.width - boxWidth) / 2, y, boxWidth, boxHeight);
    context.strokeRect(pitch.x + (pitch.width - sixWidth) / 2, sixY, sixWidth, sixHeight);
    context.beginPath();
    context.arc(pitch.x + pitch.width / 2, side ? pitch.y + pitch.height - boxHeight * .64 : pitch.y + boxHeight * .64, 2, 0, Math.PI * 2);
    context.fill();
  }
}

function currentFrames() {
  const frames = state.data.keyframes;
  const nextIndex = frames.findIndex((frame) => frame.minute > state.minute);
  const index = nextIndex < 0 ? frames.length - 2 : Math.max(0, nextIndex - 1);
  const from = frames[index];
  const to = frames[Math.min(frames.length - 1, index + 1)];
  const span = Math.max(.001, to.minute - from.minute);
  return { from, to, progress:smooth(clamp((state.minute - from.minute) / span, 0, 1)) };
}

function tacticalPosition(player, teamIndex, frame, ball) {
  const possession = frame.teamIndex === teamIndex;
  const direction = teamIndex === 0 ? -1 : 1;
  const lanePull = (ball.x - player.base.x) * (possession ? .13 : .07);
  const verticalPull = possession ? direction * 4.2 : direction * -1.1;
  const chainWave = Math.sin((frame.chainIndex + player.number * 1.7) * .75) * 1.15;
  let x = clamp(player.base.x + lanePull + chainWave, 3, 97);
  let y = clamp(player.base.y + verticalPull + Math.cos((frame.chainIndex + player.number) * .62) * .9, 2, 98);
  if (player.id === frame.actorId) {
    x = ball.x;
    y = ball.y;
  } else if (player.id === frame.defenderId) {
    x = clamp(ball.x + (teamIndex === 0 ? 2.8 : -2.8), 3, 97);
    y = clamp(ball.y - direction * 3.1, 2, 98);
  }
  return { x, y };
}

function drawPlayer(player, team, teamIndex, position, pitch, active, defending) {
  const point = pointOnPitch(position, pitch);
  const radius = clamp(Math.min(pitch.width, pitch.height) * .022, 8, 14);
  if (active || defending) {
    context.beginPath();
    context.arc(point.x, point.y, radius + 4, 0, Math.PI * 2);
    context.strokeStyle = active ? "#ffe068" : "rgba(255,255,255,.72)";
    context.lineWidth = active ? 2.5 : 1.5;
    context.stroke();
  }
  context.beginPath();
  context.arc(point.x, point.y, radius, 0, Math.PI * 2);
  context.fillStyle = team.color;
  context.fill();
  context.strokeStyle = team.outline;
  context.lineWidth = 2;
  context.stroke();
  context.fillStyle = teamIndex === 0 ? "#12221d" : "#fff";
  context.font = `700 ${Math.max(8, radius * .78)}px Inter, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(player.number, point.x, point.y + .5);
  context.fillStyle = "rgba(255,255,255,.92)";
  context.font = `600 ${Math.max(8, radius * .66)}px "Microsoft YaHei", sans-serif`;
  context.fillText(player.name ?? player.shortName ?? "球员", point.x, point.y + radius + 9);
}

function drawBall(position, pitch) {
  const point = pointOnPitch(position, pitch);
  const radius = clamp(Math.min(pitch.width, pitch.height) * .009, 3.5, 6);
  context.shadowColor = "rgba(0,0,0,.45)";
  context.shadowBlur = 7;
  context.beginPath();
  context.arc(point.x, point.y, radius, 0, Math.PI * 2);
  context.fillStyle = "#ffffff";
  context.fill();
  context.strokeStyle = "#17211d";
  context.lineWidth = 1.2;
  context.stroke();
  context.shadowBlur = 0;
}

function render() {
  if (!state.data) return;
  resizeCanvas();
  const pitch = pitchGeometry();
  drawPitch(pitch);
  const { from, to, progress } = currentFrames();
  const ball = { x:mix(from.ball.x, to.ball.x, progress), y:mix(from.ball.y, to.ball.y, progress) };
  state.data.teams.forEach((team, teamIndex) => {
    team.players.forEach((player) => {
      const fromPosition = tacticalPosition(player, teamIndex, from, from.ball);
      const toPosition = tacticalPosition(player, teamIndex, to, to.ball);
      const position = { x:mix(fromPosition.x, toPosition.x, progress), y:mix(fromPosition.y, toPosition.y, progress) };
      drawPlayer(player, team, teamIndex, position, pitch, player.id === to.actorId, player.id === to.defenderId);
    });
  });
  drawBall(ball, pitch);
  elements.possession.textContent = `${state.data.teams[to.teamIndex].name} · ${stageLabel(to.stage)}`;
}

function stageLabel(stage) {
  return ({ kickoff:"开球", possession:"控球", buildUp:"后场组织", progression:"推进", finalThird:"进入前场", chance:"制造机会", shot:"射门", fulltime:"比赛结束" })[stage] ?? "攻防转换";
}

function eventIsImportant(event) {
  return event.importance === "major" || ["goal", "penaltyGoal", "ownGoal", "redCard", "injury", "fulltime"].includes(event.type);
}

function visibleScore(events) {
  const score = [0, 0];
  for (const event of events) {
    if (event.minute > state.minute) break;
    if (Array.isArray(event.score)) {
      score[0] = event.score[0];
      score[1] = event.score[1];
    } else if (["goal", "penaltyGoal"].includes(event.type) && event.teamIndex !== null) score[event.teamIndex] += 1;
    else if (event.type === "ownGoal" && event.teamIndex !== null) score[1 - event.teamIndex] += 1;
  }
  return score;
}

function updateEvents(timestamp = performance.now()) {
  const visible = state.data.events.filter((event) => event.minute <= state.minute);
  const currentIndex = visible.length - 1;
  if (currentIndex !== state.eventIndex) {
    state.eventIndex = currentIndex;
    const event = visible.at(-1);
    if (event) {
      elements.currentEvent.textContent = event.text;
      if (eventIsImportant(event) && event.type !== "kickoff") {
        elements.eventFlash.textContent = event.text;
        elements.eventFlash.hidden = false;
        state.flashUntil = timestamp + 1700;
      }
    }
    elements.events.innerHTML = visible.length
      ? [...visible].reverse().map((event) => `<li class="${eventIsImportant(event) ? "important" : ""}"><time>${formatMinute(event.minute)}</time><p>${escapeHtml(event.text)}</p></li>`).join("")
      : '<li class="empty-events"><time>0\'</time><p>等待开球</p></li>';
    elements.eventCount.textContent = String(visible.length);
  }
  if (timestamp > state.flashUntil) elements.eventFlash.hidden = true;
  elements.score.textContent = visibleScore(visible).join(" : ");
}

function escapeHtml(text) {
  const element = document.createElement("span");
  element.textContent = String(text ?? "");
  return element.innerHTML;
}

function statRow(label, home, away, formatter = String) {
  const total = Math.max(.001, Number(home) + Number(away));
  const homeWidth = clamp(Number(home) / total * 100, 0, 100);
  const awayWidth = clamp(Number(away) / total * 100, 0, 100);
  return `<div class="stat-row"><strong>${formatter(home)}</strong><div class="stat-track"><i style="width:${homeWidth}%"></i></div><span>${label}</span><div class="stat-track away"><i style="width:${awayWidth}%"></i></div><strong>${formatter(away)}</strong></div>`;
}

function renderStats() {
  const [home, away] = state.data.teams.map((team) => team.stats);
  const possessionTotal = Number(home.possessionSeconds) + Number(away.possessionSeconds);
  const possession = possessionTotal > 0 ? [home.possessionSeconds / possessionTotal * 100, away.possessionSeconds / possessionTotal * 100] : [50, 50];
  elements.stats.innerHTML = [
    statRow("控球率", possession[0], possession[1], (value) => `${Math.round(value)}%`),
    statRow("射门", home.shots, away.shots),
    statRow("射正", home.shotsOnTarget, away.shotsOnTarget),
    statRow("预期进球", home.xg, away.xg, (value) => Number(value).toFixed(2)),
    statRow("犯规", home.fouls, away.fouls),
  ].join("");
}

function seek(minute) {
  state.minute = clamp(minute, 0, state.data.durationMinutes);
  elements.progress.value = String(Math.round(state.minute * 60));
  elements.clock.textContent = formatMinute(state.minute, true);
  state.eventIndex = -2;
  updateEvents();
  render();
}

function setPlaying(playing) {
  state.playing = playing;
  elements.play.textContent = playing ? "暂停" : "播放";
}

function frame(timestamp) {
  if (!state.lastTimestamp) state.lastTimestamp = timestamp;
  const elapsedSeconds = Math.min(.1, (timestamp - state.lastTimestamp) / 1000);
  state.lastTimestamp = timestamp;
  if (state.playing && state.data) {
    state.minute += elapsedSeconds * state.data.durationMinutes / PLAYBACK_SECONDS * state.speed;
    if (state.minute >= state.data.durationMinutes) {
      state.minute = state.data.durationMinutes;
      setPlaying(false);
    }
    elements.progress.value = String(Math.round(state.minute * 60));
    elements.clock.textContent = formatMinute(state.minute, true);
    updateEvents(timestamp);
  }
  render();
  requestAnimationFrame(frame);
}

elements.play.addEventListener("click", () => {
  if (state.minute >= state.data.durationMinutes) seek(0);
  setPlaying(!state.playing);
});
elements.replay.addEventListener("click", () => { seek(0); setPlaying(true); });
elements.progress.addEventListener("input", () => seek(Number(elements.progress.value) / 60));
document.querySelectorAll("[data-speed]").forEach((button) => button.addEventListener("click", () => {
  state.speed = Number(button.dataset.speed);
  document.querySelectorAll("[data-speed]").forEach((entry) => entry.classList.toggle("active", entry === button));
}));
window.addEventListener("resize", render);

try {
  const response = await fetch("/versus/v2-circle-demo-data.json", { cache:"no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  state.data = await response.json();
  elements.homeName.textContent = `${state.data.teams[0].name} ${state.data.teams[0].formation}`;
  elements.awayName.textContent = `${state.data.teams[1].name} ${state.data.teams[1].formation}`;
  elements.engineVersion.textContent = state.data.engineVersion;
  elements.progress.max = String(state.data.durationMinutes * 60);
  renderStats();
  seek(0);
  requestAnimationFrame(frame);
} catch (error) {
  setPlaying(false);
  elements.currentEvent.textContent = `比赛数据加载失败：${error.message}`;
}
