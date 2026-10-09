import { V22HybridMatch, STEP } from '../../engine/v2.2/hybrid-engine.js';

const $ = id => document.getElementById(id);
const canvas = $('pitch'), ctx = canvas.getContext('2d');
const colors = ['#5be1d2', '#ffae70'];
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const clock = seconds => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
let input, match, playing = false, selected = null, accumulator = 0, last = 0, lastUI = 0, previous = null;
let width = 0, height = 0, scale = 1, ox = 0, oy = 0, frameCount = 0, lastFPS = 0, fps = 0, lastDraw = 0;
const point = p => ({ x: ox + p.x * scale, y: oy + p.y * scale });
const capture = () => ({ players: match.players.map(p => ({ x: p.x, y: p.y })), ball: { ...match.ball } });
function resize() {
  const rect = canvas.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
  width = rect.width; height = rect.height; canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  scale = Math.max(.1, Math.min((width - 28) / 111, (height - 28) / 74)); ox = (width - 105 * scale) / 2; oy = (height - 68 * scale) / 2;
}
new ResizeObserver(resize).observe(canvas);
function line(a, b, color = '#5d82934d', thickness = 1) { ctx.strokeStyle = color; ctx.lineWidth = thickness; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
function circle(x, y, radius, fill, stroke = null) { ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); if (fill) { ctx.fillStyle = fill; ctx.fill(); } if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); } }
function drawField() {
  ctx.clearRect(0, 0, width, height);
  const gradient = ctx.createLinearGradient(0, 0, width, height); gradient.addColorStop(0, '#203b46'); gradient.addColorStop(1, '#182d3b');
  ctx.fillStyle = gradient; ctx.fillRect(ox, oy, 105 * scale, 68 * scale);
  for (let i = 0; i < 10; i += 2) { ctx.fillStyle = '#7cb1b006'; ctx.fillRect(ox + i * 10.5 * scale, oy, 10.5 * scale, 68 * scale); }
  ctx.strokeStyle = '#94b2bd66'; ctx.lineWidth = 1;
  ctx.strokeRect(ox, oy, 105 * scale, 68 * scale);
  line(point({ x: 52.5, y: 0 }), point({ x: 52.5, y: 68 }), '#94b2bd66');
  circle(ox + 52.5 * scale, oy + 34 * scale, 9.15 * scale, null, '#94b2bd66');
  circle(ox + 52.5 * scale, oy + 34 * scale, 1.8, '#afc7ce');
  for (const x of [0, 105]) {
    const sign = x === 0 ? 1 : -1;
    ctx.strokeStyle = '#94b2bd66';
    ctx.strokeRect(ox + x * scale, oy + 13.84 * scale, sign * 16.5 * scale, 40.32 * scale);
    ctx.strokeRect(ox + x * scale, oy + 24.84 * scale, sign * 5.5 * scale, 18.32 * scale);
    circle(ox + (x + sign * 11) * scale, oy + 34 * scale, 1.8, '#afc7ce');
    ctx.strokeStyle = '#c9dfe582'; ctx.strokeRect(ox + (x - (x === 0 ? 2.2 : 0)) * scale, oy + 30.34 * scale, 2.2 * scale, 7.32 * scale);
    for (let i = 1; i < 7; i++) line(point({ x: x - sign * 2.2, y: 30.34 + i }), point({ x, y: 30.34 + i }), '#9db7c829', .7);
    ctx.beginPath(); ctx.arc(ox + (x + sign * 11) * scale, oy + 34 * scale, 9.15 * scale, x === 0 ? -.925 : Math.PI - .925, x === 0 ? .925 : Math.PI + .925); ctx.strokeStyle = '#94b2bd66'; ctx.stroke();
  }
}
function draw(alpha = 1) {
  if (width < 30 || height < 30) return;
  drawField(); if (!match) return;
  const reviewSnapshot = match.phase === 'var' ? match.review?.snapshot : null;
  const positions = match.players.map((p, i) => {
    const evidence = reviewSnapshot?.players.find(q => q.id === p.id);
    if (evidence) return { ...p, x: evidence.x, y: evidence.y };
    const before = previous?.players[i] ?? p;
    return { ...p, x: before.x + (p.x - before.x) * alpha, y: before.y + (p.y - before.y) * alpha };
  });
  if (reviewSnapshot) {
    line(point({ x: reviewSnapshot.lineX, y: 0 }), point({ x: reviewSnapshot.lineX, y: 68 }), '#ffe187', 2);
    ctx.textAlign = 'left'; ctx.font = '11px "Microsoft YaHei"'; ctx.fillStyle = '#ffe187'; ctx.fillText('VAR · 出脚瞬间定格 / 越位参考线', ox + 12, oy + 16);
  }
  if ($('shape').checked) {
    for (const team of [0, 1]) for (const pool of ['DEF', 'MID', 'ATT']) {
      const players = positions.filter(p => p.team === team && match.effective[team].get(p.sourceId).pool === pool).sort((a, b) => a.y - b.y);
      ctx.setLineDash([4, 5]);
      for (let i = 1; i < players.length; i++) line(point(players[i - 1]), point(players[i]), colors[team] + '55');
      ctx.setLineDash([]);
    }
  }
  if ($('targets').checked) for (const p of positions) {
    const a = point(p), b = point(p.target); line(a, b, colors[p.team] + '48'); circle(b.x, b.y, 2.5, null, colors[p.team] + '85');
  }
  const radius = Math.max(5.8, Math.min(12, scale * 1.35));
  for (const p of positions) {
    const { x, y } = point(p), active = p.id === selected;
    circle(x + 1.5, y + 3, radius + 1, '#07131c88');
    if (p.id === match.ball.owner) circle(x, y, radius + 5, null, colors[p.team] + '88');
    if (active) circle(x, y, radius + 8, null, '#ffffffbb');
    const gradient = ctx.createLinearGradient(x, y - radius, x, y + radius); gradient.addColorStop(0, p.gk ? '#f4da83' : colors[p.team]); gradient.addColorStop(1, p.gk ? '#a5883e' : p.team === 0 ? '#309a95' : '#c67a45');
    circle(x, y, radius, gradient, '#e1fbf589');
    ctx.font = `700 ${Math.max(8, radius * .92)}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#132630'; ctx.fillText(p.number, x, y + .5);
    if (width > 700 || active || p.id === match.ball.owner) {
      ctx.font = `${width > 700 ? 10 : 9}px "Microsoft YaHei",sans-serif`; const label = p.name, w = ctx.measureText(label).width + 10;
      ctx.fillStyle = '#101d2bbd'; ctx.fillRect(x - w / 2, y + radius + 6, w, 16); ctx.fillStyle = '#e1e9ef'; ctx.fillText(label, x, y + radius + 14);
    }
  }
  const beforeBall = previous?.ball ?? match.ball, ball = point(reviewSnapshot?.ball ?? { x: beforeBall.x + (match.ball.x - beforeBall.x) * alpha, y: beforeBall.y + (match.ball.y - beforeBall.y) * alpha });
  circle(ball.x + 1, ball.y + 3, 3.8, '#00101bbb');
  circle(ball.x, ball.y - match.ball.z * scale * .6, Math.max(3, Math.min(5, scale * .65)), '#fff7d5', '#102c36');
  if (match.phase === 'var') {
    ctx.fillStyle = '#08151edd'; ctx.fillRect(width / 2 - 120, height - 44, 240, 28); ctx.fillStyle = '#ffe187'; ctx.font = '12px "Microsoft YaHei"'; ctx.textAlign = 'center'; ctx.fillText('VAR 检查中 · 暂未计入比分', width / 2, height - 29);
  }
  if (match.phase === 'stoppage' || match.finished) {
    ctx.fillStyle = '#09131ca6'; ctx.fillRect(0, height / 2 - 37, width, 74);
    ctx.fillStyle = '#f5f7ef'; ctx.textAlign = 'center'; ctx.font = `600 ${width < 500 ? 17 : 24}px "Microsoft YaHei"`; ctx.fillText(match.finished ? '全场结束' : match.events.at(-1)?.text ?? '死球', width / 2, height / 2 - 7);
    ctx.font = '11px "Microsoft YaHei"'; ctx.fillStyle = '#b5cbd2'; ctx.fillText(match.finished ? '可切换战术后重新观察' : '省略等待 · 按判罚位置恢复比赛', width / 2, height / 2 + 20);
  }
}
function updateUI() {
  if (!match) return;
  $('clock').textContent = clock(match.minute * 60); $('elapsed').textContent = `${clock(match.time)} / ${clock(match.duration)}`;
  $('home-score').textContent = match.score[0]; $('away-score').textContent = match.score[1]; $('progress').style.width = `${match.time / match.duration * 100}%`;
  const stages = { buildUp: '后场组织', progression: '中场推进', finalThird: '进攻三区', chance: '创造机会' };
  $('phase-label').textContent = (match.extraTimePlayed ? '加时 · ' : '') + (match.finished ? match.needsPenalties ? '待点球决胜' : '全场结束' : match.phase === 'var' ? 'VAR 检查中' : !playing ? '已暂停' : match.phase === 'stoppage' ? '死球过渡' : stages[match.stage]);
  $('var-status').textContent = match.phase === 'var' ? '正在回看出脚瞬间 · 检查越位参与' : match.lastReview ? `最近 VAR：${match.lastReview.reason}` : '越位监测已开启 · 进球自动 VAR 检查';
  $('play').textContent = match.finished ? '比赛结束' : playing ? 'Ⅱ 暂停' : match.time ? '▶ 继续' : '▶ 开始比赛'; $('play').disabled = match.finished;
  $('possession-label').textContent = `${match.teams[match.possession].name}控球 ${match.possession ? '←' : '→'}`;
  for (const [i, id] of [[0, 'home-plan'], [1, 'away-plan']]) $(id).textContent = `${match.plan(i).label} · ${match.teams[i].formation}`;
  for (const [i, id] of [[0, 'home-tactic'], [1, 'away-tactic']]) $(id).value = match.manualPlans[i] ? match.planKeys[i] : 'opening';
  $('dimensions').innerHTML = [['pressing','压迫强度'],['defensiveLine','防线高度'],['attackingWidth','进攻宽度'],['directness','传球直接度']].map(([key, label]) => { const a = Math.round(match.dimensions(0)[key]), b = Math.round(match.dimensions(1)[key]); return `<div class="dimension"><div><b>${a}</b><span>${label}</span><em>${b}</em></div><div class="bars"><i style="width:${a / 2}%"></i><i style="width:${b / 2}%"></i></div></div>`; }).join('');
  const total = match.stats[0].possession + match.stats[1].possession || 1;
  $('stats').innerHTML = [['控球率', ...match.stats.map(s => `${Math.round(s.possession / total * 100)}%`)], ['传球 / 成功', ...match.stats.map(s => `${s.passes} / ${s.completed}`)], ['射门', ...match.stats.map(s => s.shots)], ['抢断 / 越位', ...match.stats.map(s => `${s.tackles} / ${s.offsides}`)], ['累计跑动', ...match.stats.map(s => `${(s.distance / 1000).toFixed(1)} km`)]].map(([label, a, b]) => `<div class="stat-row"><b>${a}</b><span>${label}</span><b>${b}</b></div>`).join('');
  $('events').innerHTML = [...match.events].reverse().slice(0, 8).map(e => `<li><time>${clock(e.minute * 60)}</time><span>${escape(e.text)}</span></li>`).join('');
  $('event-line').textContent = match.events.at(-1)?.text ?? '';
  $('performance').textContent = `${fps} FPS · 20 Hz 模拟 · 本地计算`;
  const p = match.player(selected);
  if (p) {
    const source = match.effective[p.team].get(p.sourceId);
    $('player-detail').innerHTML = `<span class="eyebrow">${escape(match.teams[p.team].name)} · #${p.number} · ${escape(source.assignedRole)}</span><h3>${escape(p.name)}</h3><p>${escape(p.action)} · ${Math.hypot(p.vx, p.vy).toFixed(1)} m/s · 跑动 ${Math.round(p.distance)} m</p><div class="player-badges"><span>速度 ${Math.round(match.ability(p, 'pace'))}</span><span>传球 ${Math.round(match.ability(p, 'passing'))}</span><span>射门 ${Math.round(match.ability(p, 'finishing'))}</span></div>`;
  }
}
function frame(now) {
  const dt = last ? Math.min((now - last) / 1000, .1) : 0; last = now;
  if (match && playing && !document.hidden && !match.finished) {
    accumulator += dt;
    while (accumulator >= STEP) {
      previous = capture(); const phase = match.phase; match.advance(STEP);
      if (phase === 'stoppage' && match.phase === 'play') previous = capture();
      accumulator -= STEP;
    }
  }
  if (match?.finished) playing = false;
  const interval = playing ? (width < 600 ? 1000 / 30 : 1000 / 60) : 250;
  if (!document.hidden && now - lastDraw >= interval - 1) { draw(playing ? accumulator / STEP : 1); frameCount++; lastDraw = now; }
  if (now - lastFPS > 1000) { fps = Math.round(frameCount * 1000 / (now - lastFPS)); frameCount = 0; lastFPS = now; }
  if (now - lastUI > 250) { updateUI(); lastUI = now; }
  requestAnimationFrame(frame);
}
$('play').addEventListener('click', () => { playing = !playing; last = 0; updateUI(); });
$('restart').addEventListener('click', () => {
  const choices = match.planKeys.map((key, team) => ({ key: match.manualPlans[team] ? key : 'opening', manual: match.manualPlans[team] })); match = new V22HybridMatch(input);
  choices.forEach(({ key, manual }, team) => match.setPlan(team, key, manual));
  selected = match.ball.owner ?? match.players.find(p => !p.gk).id; previous = capture(); accumulator = 0; playing = true; updateUI();
});
$('next-event').addEventListener('click', () => {
  playing = false;
  // Omit uneventful passages, never speed up the animation of a shown action.
  const start = match.time;
  do { match.advance(STEP); } while (!match.finished && match.time - start < 90 && !(match.time - start > 3 && (match.ball.flight?.type === 'shot' || match.phase === 'var' || match.phase === 'stoppage')));
  previous = capture(); accumulator = 0; updateUI(); draw();
});
for (const [team, id] of [[0, 'home-tactic'], [1, 'away-tactic']]) $(id).addEventListener('change', event => { match.setPlan(team, event.target.value, event.target.value !== 'opening'); updateUI(); });
canvas.addEventListener('click', event => {
  if (!match) return;
  const rect = canvas.getBoundingClientRect(), location = { x: (event.clientX - rect.left - ox) / scale, y: (event.clientY - rect.top - oy) / scale };
  const nearest = [...match.players].sort((a, b) => Math.hypot(a.x - location.x, a.y - location.y) - Math.hypot(b.x - location.x, b.y - location.y))[0];
  if (Math.hypot(nearest.x - location.x, nearest.y - location.y) < Math.max(3, 16 / scale)) { selected = nearest.id; updateUI(); }
});
document.addEventListener('visibilitychange', () => { if (document.hidden && playing) { playing = false; updateUI(); } last = 0; });
try {
  const response = await fetch('/demo-input'); if (!response.ok) throw new Error('请通过 preview:v22 服务打开');
  input = await response.json(); match = new V22HybridMatch(input); previous = capture(); selected = match.players.find(p => !p.gk).id;
  $('loading').hidden = true; $('play').disabled = false; $('restart').disabled = false; $('next-event').disabled = false; updateUI();
  // Read-only capture plus an explicit deterministic seek for offline QA.
  window.v22Demo = { ready: true, get match() { return match; }, get playing() { return playing; }, seek(seconds) { playing = false; match = new V22HybridMatch(input); match.advance(seconds); previous = capture(); accumulator = 0; updateUI(); draw(); }, setPlaying(value) { playing = Boolean(value); last = 0; updateUI(); } };
} catch (error) { $('loading').textContent = `载入失败：${error.message}`; console.error(error); }
requestAnimationFrame(frame);
