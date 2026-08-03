import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const inputPath = path.resolve(process.argv[2] ?? path.join(ROOT, "outputs", "S4-V2-alpha15-full-impact-30000-seeded.json"));
const outputPath = path.resolve(process.argv[3] ?? path.join(ROOT, "outputs", "S4-V2-alpha15-full-impact-30000-seeded-balance-report.html"));
const payload = JSON.parse(await readFile(inputPath, "utf8"));
const results = payload.results;
const v2 = results.v2;

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");
const number = (value, digits = 2) => Number(value ?? 0).toFixed(digits);
const percent = (value) => `${number(value)}%`;
const sampleNote = (samples) => Number(samples) < 500 ? "低样本" : `${Number(samples).toLocaleString("zh-CN")} 队次`;
const toneFor = (value, baseline = 33.33) => value >= baseline + 3 ? "positive" : value <= baseline - 3 ? "negative" : "neutral";
const groupMetrics = (group) => group?.v2 ?? group ?? {};
const groupSamples = (group) => Number(group?.teamSamples ?? groupMetrics(group).teamSamples ?? 0);

function metricRow({ label, value, max = 100, detail = "", tone = "neutral", valueLabel = value }) {
  const width = Math.max(0, Math.min(100, Number(value || 0) / max * 100));
  return `<div class="metric-row">
    <div class="metric-label"><span>${escapeHtml(label)}</span><strong>${escapeHtml(valueLabel)}</strong></div>
    <div class="metric-track"><span class="metric-fill ${tone}" style="width:${width.toFixed(2)}%"></span></div>
    <div class="metric-detail">${escapeHtml(detail)}</div>
  </div>`;
}

function dualRow({ label, winRate, xg, xga, samples }) {
  return `<div class="dual-row">
    <div class="dual-label"><strong>${escapeHtml(label)}</strong><span>${escapeHtml(sampleNote(samples))}</span></div>
    <div class="dual-cell"><span>胜率</span><strong class="${toneFor(winRate)}">${percent(winRate)}</strong><i><b class="${toneFor(winRate)}" style="width:${Math.max(0, Math.min(100, winRate))}%"></b></i></div>
    <div class="dual-cell"><span>xG</span><strong>${number(xg)}</strong><i><b class="teal" style="width:${Math.max(0, Math.min(100, xg / 1.8 * 100))}%"></b></i></div>
    <div class="dual-cell"><span>xGA</span><strong>${number(xga)}</strong><i><b class="gold" style="width:${Math.max(0, Math.min(100, xga / 1.8 * 100))}%"></b></i></div>
  </div>`;
}

function dimensionBlock(title, description, groups) {
  const rows = Object.entries(groups)
    .sort(([, left], [, right]) => Number(right.v2?.winRatePercent ?? 0) - Number(left.v2?.winRatePercent ?? 0))
    .map(([label, group]) => {
      const data = groupMetrics(group);
      return dualRow({
        label,
        winRate:Number(data.winRatePercent ?? 0),
        xg:Number(data.expectedGoalsPerMatch ?? 0),
        xga:Number(data.expectedGoalsAgainstPerMatch ?? 0),
        samples:groupSamples(group),
      });
    }).join("");
  return `<section class="report-section">
    <div class="section-heading"><div><p class="eyebrow">BALANCE DIMENSION</p><h2>${escapeHtml(title)}</h2></div><p>${escapeHtml(description)}</p></div>
    <div class="dual-head"><span>分组</span><span>结果</span><span>xG</span><span>xGA</span></div>
    <div class="dual-list">${rows}</div>
  </section>`;
}

function matrixBlock(title, groups, labels) {
  const matrix = labels.map((home) => {
    const cells = labels.map((away) => {
      const key = `${home} vs ${away}`;
      const group = groups[key];
      const data = groupMetrics(group);
      const value = Number(data.winRatePercent ?? 0);
      const samples = groupSamples(group);
      const intensity = Math.max(0.08, Math.min(0.92, 0.35 + (value - 33.33) / 45));
      const lowSample = samples < 500 ? " low-sample" : "";
      return `<td class="${lowSample}" style="--cell-alpha:${intensity.toFixed(2)}" title="${escapeHtml(key)}：${percent(value)}，${sampleNote(samples)}">${value ? number(value, 1) : "-"}</td>`;
    }).join("");
    return `<tr><th>${escapeHtml(home)}</th>${cells}</tr>`;
  }).join("");
  return `<section class="report-section matrix-section">
    <div class="section-heading"><div><p class="eyebrow">HEAD-TO-HEAD</p><h2>${escapeHtml(title)}</h2></div><p>行是主队，列是对手；颜色越深代表主队胜率越高。灰色斜线表示样本不足。</p></div>
    <div class="matrix-wrap"><table class="matrix"><thead><tr><th>主队 ↓ / 对手 →</th>${labels.map((label) => `<th>${escapeHtml(label)}</th>`).join("")}</tr></thead><tbody>${matrix}</tbody></table></div>
  </section>`;
}

const matchDistribution = v2.matchDistribution;
const routeTotal = Object.values(v2.routeTypes).reduce((sum, value) => sum + Number(value), 0);
const goalMinuteRows = Object.entries(v2.goalMinutes).sort(([left], [right]) => left.localeCompare(right, "en"));
const shotTypeRows = Object.entries(v2.shotTypes).sort(([, left], [, right]) => right.shots - left.shots);
const shotQualityRows = Object.entries(v2.shotQuality).sort(([, left], [, right]) => right.shots - left.shots);
const dimension = results.dimensions;
const headToHead = results.headToHead;
const tacticLabels = ["allOutAttack", "positive", "balanced", "defensive", "parkBus"];
const formationLabels = ["3-5-2", "3-4-3", "4-2-3-1", "4-3-3", "5-3-2"];

const reportHtml = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>S4 V2 alpha15 全量模拟平衡报告</title>
<style>
:root{--ink:#17212b;--muted:#64727e;--line:#d7dde2;--paper:#f5f7f8;--surface:#fff;--coral:#d85c4a;--teal:#198f8a;--gold:#c68a31;--blue:#4d74a8;--soft-coral:#fae5e0;--soft-teal:#dff3f0;--soft-gold:#f8edd7;--shadow:0 5px 18px rgba(23,33,43,.07)}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.55 Arial,"Microsoft YaHei",sans-serif}main{max-width:1180px;margin:0 auto;padding:28px 22px 70px}.hero{border-bottom:1px solid var(--line);padding:24px 0 28px}.eyebrow{color:var(--coral);font-size:11px;font-weight:700;letter-spacing:1.6px;margin:0 0 7px}.hero h1{font-size:clamp(27px,4vw,43px);line-height:1.12;letter-spacing:0;margin:0 0 12px}.hero p{color:var(--muted);max-width:830px;margin:0}.hero-meta{display:flex;flex-wrap:wrap;gap:8px;margin-top:18px}.tag{background:var(--surface);border:1px solid var(--line);border-radius:5px;padding:6px 10px;color:var(--muted);font-size:12px}.tag strong{color:var(--ink);margin-left:5px}.warning{margin-top:20px;padding:13px 16px;border-left:4px solid var(--coral);background:var(--soft-coral);color:#6f3028}.warning strong{color:#9f3e31}.section-heading{display:flex;align-items:end;justify-content:space-between;gap:24px;margin-bottom:16px}.section-heading h2{font-size:23px;line-height:1.2;letter-spacing:0;margin:0}.section-heading>p{max-width:500px;color:var(--muted);font-size:13px;margin:0}.report-section{padding:36px 0;border-bottom:1px solid var(--line)}.overview-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.overview-item{background:var(--surface);border:1px solid var(--line);box-shadow:var(--shadow);padding:14px 15px;border-radius:6px}.overview-item span{display:block;color:var(--muted);font-size:12px}.overview-item strong{display:block;font-size:25px;line-height:1.15;margin-top:5px}.chart-grid{display:grid;grid-template-columns:1fr 1fr;gap:22px}.chart-block{background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:16px}.chart-block h3{font-size:16px;margin:0 0 12px}.metric-row{margin:12px 0}.metric-label{display:flex;justify-content:space-between;gap:10px;font-size:13px}.metric-label span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.metric-label strong{font-variant-numeric:tabular-nums}.metric-track{height:9px;background:#e9edf0;border-radius:8px;overflow:hidden;margin-top:5px}.metric-fill{display:block;height:100%;border-radius:8px;background:var(--blue)}.metric-fill.positive{background:var(--coral)}.metric-fill.negative{background:var(--gold)}.metric-fill.neutral{background:var(--blue)}.metric-detail{font-size:11px;color:var(--muted);margin-top:3px}.funnel{display:grid;gap:8px}.funnel-row{display:grid;grid-template-columns:105px 1fr 60px;gap:10px;align-items:center;font-size:12px}.funnel-label{color:var(--muted)}.funnel-track{height:24px;background:#e9edf0;overflow:hidden;border-radius:3px}.funnel-track span{display:block;height:100%;background:var(--teal)}.funnel-value{text-align:right;font-weight:700}.dual-head,.dual-row{display:grid;grid-template-columns:minmax(160px,1.4fr) repeat(3,minmax(105px,1fr));gap:12px;align-items:center}.dual-head{color:var(--muted);font-size:11px;border-bottom:1px solid var(--line);padding:0 10px 8px}.dual-row{background:var(--surface);border:1px solid var(--line);border-radius:5px;padding:10px;margin-top:7px}.dual-label strong{display:block;font-size:13px;word-break:break-word}.dual-label span{display:block;color:var(--muted);font-size:11px;margin-top:2px}.dual-cell{display:grid;grid-template-columns:auto auto;align-items:center;gap:5px;font-size:11px}.dual-cell span{color:var(--muted)}.dual-cell strong{font-size:13px;text-align:right}.dual-cell strong.positive{color:var(--coral)}.dual-cell strong.negative{color:var(--gold)}.dual-cell strong.neutral{color:var(--ink)}.dual-cell i{grid-column:1 / 3;height:6px;background:#e9edf0;border-radius:5px;overflow:hidden}.dual-cell b{display:block;height:100%;background:var(--blue)}.dual-cell b.positive{background:var(--coral)}.dual-cell b.negative{background:var(--gold)}.dual-cell b.teal{background:var(--teal)}.dual-cell b.gold{background:var(--gold)}.matrix-wrap{overflow-x:auto}.matrix{border-collapse:separate;border-spacing:4px;width:100%;min-width:650px;font-size:12px}.matrix th{font-weight:500;color:var(--muted);padding:8px;text-align:center;white-space:nowrap}.matrix tbody th{text-align:right}.matrix td{background:color-mix(in srgb,var(--coral) calc(var(--cell-alpha) * 100%),var(--surface));border:1px solid var(--line);min-width:78px;height:52px;text-align:center;border-radius:4px;font-weight:700}.matrix td.low-sample{background:repeating-linear-gradient(135deg,#edf0f2,#edf0f2 5px,#d9dfe3 5px,#d9dfe3 7px);color:var(--muted)}.footnote{color:var(--muted);font-size:12px;margin-top:12px}.conclusion{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.conclusion article{background:var(--surface);border-top:3px solid var(--coral);padding:15px;border-radius:0 0 6px 6px;box-shadow:var(--shadow)}.conclusion article:nth-child(2){border-color:var(--teal)}.conclusion article:nth-child(3){border-color:var(--gold)}.conclusion h3{font-size:15px;margin:0 0 7px}.conclusion p{color:var(--muted);font-size:13px;margin:0}.source{font-size:11px;color:var(--muted);padding-top:22px;word-break:break-all}@media(max-width:760px){main{padding:18px 14px 50px}.overview-grid{grid-template-columns:repeat(2,1fr)}.chart-grid,.conclusion{grid-template-columns:1fr}.section-heading{display:block}.section-heading>p{margin-top:9px}.dual-head{display:none}.dual-row{grid-template-columns:1fr 1fr}.dual-label{grid-column:1 / -1}.dual-cell{min-width:0}.hero h1{font-size:29px}.funnel-row{grid-template-columns:82px 1fr 50px}}
</style>
</head>
<body>
<main>
  <header class="hero">
    <p class="eyebrow">YELLOWDOGS LEAGUE / S4 ENGINE STUDY</p>
    <h1>S4 V2 alpha15 全量模拟平衡报告</h1>
    <p>基于固定随机种子的 30,000 场 V2 生态模拟，观察比赛分布、战术选择、阵容强度、强化、特性、羁绊、传奇、X 球员、天气与裁判对比赛结果的关联。</p>
    <div class="hero-meta">
      <span class="tag">模拟场次<strong>${Number(results.matches).toLocaleString("zh-CN")}</strong></span>
      <span class="tag">完成<strong>${percent(v2.matchExecution.completedMatches / results.matches * 100)}</strong></span>
      <span class="tag">V2 possession<strong>${number(v2.possessionsPerMatch, 1)} / 场</strong></span>
      <span class="tag">V2 xG<strong>${number(v2.expectedGoalsPerMatch, 3)} / 场</strong></span>
      <span class="tag">种子<strong>${escapeHtml(payload.seed)}</strong></span>
    </div>
    <div class="warning"><strong>比较口径限制：</strong>本文件的配置是 <code>v2Only: true</code>，结果中没有 results.v1。因此它是 V2 生态影响研究，不是严格的 V1/V2 胜率差分实验；不能据此宣称 V2 相比 V1 的改变量。</div>
  </header>

  <section class="report-section">
    <div class="section-heading"><div><p class="eyebrow">EXECUTIVE READ</p><h2>先看结论</h2></div><p>红色为偏高，金色为偏低，蓝色为接近总体基线。</p></div>
    <div class="conclusion">
      <article><h3>总体胜负平衡正常</h3><p>主胜 ${percent(matchDistribution.homeWinRatePercent)}、平 ${percent(matchDistribution.drawRatePercent)}、客胜 ${percent(matchDistribution.awayWinRatePercent)}。主客差仅 ${number(Math.abs(matchDistribution.homeWinRatePercent - matchDistribution.awayWinRatePercent),2)} 个百分点，未见主场偏置。</p></article>
      <article><h3>战术收益明显偏向主动进攻</h3><p>全力进攻胜率 ${percent(dimension.tactic.allOutAttack.v2.winRatePercent)}，停车战术仅 ${percent(dimension.tactic.parkBus.v2.winRatePercent)}；两者相差 ${number(dimension.tactic.allOutAttack.v2.winRatePercent - dimension.tactic.parkBus.v2.winRatePercent,2)} 个百分点。主动打法有收益，但防守策略的反击价值偏弱。</p></article>
      <article><h3>阵容强度与国家羁绊有效</h3><p>85+ 平均总评队胜率 ${percent(dimension.averageOverall["85+"].v2.winRatePercent)}，75-79 组仅 ${percent(dimension.averageOverall["75-79"].v2.winRatePercent)}；国家羁绊组胜率 ${percent(dimension.activeBondType.nationality.v2.winRatePercent)}，收益高于结构羁绊。</p></article>
    </div>
  </section>

  <section class="report-section">
    <div class="section-heading"><div><p class="eyebrow">MATCH OUTCOMES</p><h2>比赛结果分布</h2></div><p>V2 总体进球环境偏开放，平局占比高于单侧胜率。</p></div>
    <div class="overview-grid">
      <div class="overview-item"><span>主胜</span><strong>${percent(matchDistribution.homeWinRatePercent)}</strong></div>
      <div class="overview-item"><span>平局</span><strong>${percent(matchDistribution.drawRatePercent)}</strong></div>
      <div class="overview-item"><span>客胜</span><strong>${percent(matchDistribution.awayWinRatePercent)}</strong></div>
      <div class="overview-item"><span>平均 xG</span><strong>${number(v2.expectedGoalsPerMatch,3)}</strong></div>
      <div class="overview-item"><span>0-0</span><strong>${percent(matchDistribution.zeroZeroRatePercent)}</strong></div>
      <div class="overview-item"><span>6+ 总进球</span><strong>${percent(matchDistribution.sixPlusGoalsRatePercent)}</strong></div>
      <div class="overview-item"><span>3+ 净胜球</span><strong>${percent(matchDistribution.threePlusGoalMarginRatePercent)}</strong></div>
      <div class="overview-item"><span>4+ 净胜球</span><strong>${percent(matchDistribution.fourPlusGoalMarginRatePercent)}</strong></div>
    </div>
    <div class="chart-grid" style="margin-top:22px">
      <div class="chart-block"><h3>胜平负</h3>${metricRow({label:"主胜",value:matchDistribution.homeWinRatePercent,detail:`${matchDistribution.homeWins.toLocaleString("zh-CN")} 场`,tone:"neutral"})}${metricRow({label:"平局",value:matchDistribution.drawRatePercent,detail:`${matchDistribution.draws.toLocaleString("zh-CN")} 场`,tone:"positive"})}${metricRow({label:"客胜",value:matchDistribution.awayWinRatePercent,detail:`${matchDistribution.awayWins.toLocaleString("zh-CN")} 场`,tone:"neutral"})}</div>
      <div class="chart-block"><h3>进球尾部风险</h3>${metricRow({label:"0-0",value:matchDistribution.zeroZeroRatePercent,detail:"低比分停滞",tone:"negative"})}${metricRow({label:"6+ 总进球",value:matchDistribution.sixPlusGoalsRatePercent,detail:"高比分",tone:"negative"})}${metricRow({label:"8+ 总进球",value:matchDistribution.eightPlusGoalsRatePercent,detail:"极端高比分",tone:"negative"})}${metricRow({label:"3+ 净胜球",value:matchDistribution.threePlusGoalMarginRatePercent,detail:"单边滚雪球",tone:"negative"})}</div>
    </div>
  </section>

  <section class="report-section">
    <div class="section-heading"><div><p class="eyebrow">V2 MATCH FLOW</p><h2>比赛阶段漏斗</h2></div><p>推进成功率在进入前场后从 72.10% 降至 55.68%，机会转化环节进一步降至 38.24%；这条曲线符合“组织容易、制造机会难”的战术导向。</p></div>
    <div class="chart-grid">
      <div class="chart-block"><h3>阶段成功率</h3><div class="funnel">${metricRow({label:"组织 build-up",value:v2.stages.buildUp.successRatePercent,detail:`${v2.stages.buildUp.attempts.toLocaleString("zh-CN")} 次尝试`,tone:"positive"})}${metricRow({label:"推进 progression",value:v2.stages.progression.successRatePercent,detail:`${v2.stages.progression.attempts.toLocaleString("zh-CN")} 次尝试`,tone:"neutral"})}${metricRow({label:"进入前场",value:v2.stages.finalThird.successRatePercent,detail:`${v2.stages.finalThird.attempts.toLocaleString("zh-CN")} 次尝试`,tone:"neutral"})}${metricRow({label:"形成机会",value:v2.stages.chance.successRatePercent,detail:`${v2.stages.chance.attempts.toLocaleString("zh-CN")} 次尝试`,tone:"negative"})}${metricRow({label:"持球到射门",value:v2.shotReachRatePercent,detail:`${v2.possessions.toLocaleString("zh-CN")} 次持球`,tone:"negative"})}</div></div>
      <div class="chart-block"><h3>进球时间段</h3>${goalMinuteRows.map(([label,value]) => metricRow({label:`${label} 分钟`,value, max:Math.max(...goalMinuteRows.map(([,v])=>v)),valueLabel:Number(value).toLocaleString("zh-CN"),detail:`占总进球 ${(value / Object.values(v2.goalMinutes).reduce((sum,item)=>sum+item,0)*100).toFixed(1)}%`,tone:"neutral"})).join("")}</div>
    </div>
  </section>

  ${dimensionBlock("阵型平衡", "4-3-3 在本次生态中结果最好；4-2-3-1 控球最高但进攻产出偏低，说明控球没有自动转化为机会。", dimension.formation)}
  ${dimensionBlock("比赛战术", "全力进攻和积极战术的 xG 更高，但同时抬高 xGA；停车战术降低失球，却牺牲了主动取胜能力。", dimension.tactic)}
  ${dimensionBlock("打法风格", "高压、长传和反击的结果高于控球；控球风格当前更像稳定控场，而不是高效创造机会。", dimension.style)}
  ${dimensionBlock("生态阵容类型", "国家队羁绊重阵容和特性重阵容领先；标准阵容显著落后，强度分层已经进入结果端。", dimension.archetype)}
  ${dimensionBlock("强化等级", "0-1 强化组与 3-5、5-8 组之间存在明显断层，说明强化收益不是噪声，而是强结果变量。", dimension.averageUpgrade)}
  ${dimensionBlock("特性数量", "特性从 0 增加到 6-11 后收益大幅提升，12+ 仍继续提升但边际收益开始变小。", dimension.traitAssignments)}
  ${dimensionBlock("激活羁绊数量", "0、1、2 条羁绊呈近似单调上升，当前羁绊系统对结果有清晰贡献。", dimension.activeBondCount)}
  ${dimensionBlock("羁绊类型", "国家羁绊收益最高；俱乐部羁绊样本很少，暂不应据此调高数值。", dimension.activeBondType)}
  ${dimensionBlock("传奇数量", "传奇数量从 0 增加到 1-2、3-5 后胜率只小幅上升，传奇没有表现出压倒性独立增益。", dimension.legendCount)}
  ${dimensionBlock("X 球员", "本次 X 球员存在组略低于无 X 组，不能解读为 X 球员负收益；该维度与阵容强度和生态类型高度混杂。", dimension.xPlayer)}
  ${dimensionBlock("平均总评", "总评是当前最强的结果分层之一；75-79 样本仅 56 队次，结论只适合作为方向信号。", dimension.averageOverall)}
  ${dimensionBlock("天气", "暴雪和雷暴显著降低 xG 并提高平局率；天气影响强度高，适合做环境变化，不适合做纯随机装饰。", dimension.weather)}
  ${dimensionBlock("裁判尺度", "严格裁判的 xG 略高、胜率几乎不变；当前裁判主要改变纪律和对抗节奏，不是强胜负变量。", dimension.referee)}

  <section class="report-section">
    <div class="section-heading"><div><p class="eyebrow">ATTACKING MODEL</p><h2>射门来源与质量</h2></div><p>倒三角和反击是主要射门来源；高质量机会的进球/xG 接近 1，整体校准没有明显系统性过射或欠射。</p></div>
    <div class="chart-grid">
      <div class="chart-block"><h3>射门类型占比</h3>${shotTypeRows.map(([label,value]) => metricRow({label,value:value.shareOfShotsPercent,detail:`${value.shotsPerMatch} 次/场 · 转化 ${percent(value.conversionRatePercent)}`,tone:label === "cutback" ? "positive" : "neutral"})).join("")}</div>
      <div class="chart-block"><h3>xG 桶与实际转化</h3>${shotQualityRows.map(([label,value]) => metricRow({label,value:value.shareOfShotsPercent,detail:`${value.shots.toLocaleString("zh-CN")} 次 · ${percent(value.conversionRatePercent)} 转化 · goals/xG ${number(value.goalsPerExpectedGoal,3)}`,tone:value.goalsPerExpectedGoal > 1.03 ? "negative" : "neutral"})).join("")}</div>
    </div>
  </section>

  <section class="report-section">
    <div class="section-heading"><div><p class="eyebrow">POSSESSION CHAIN</p><h2>V2 空间与失误分布</h2></div><p>结构化路线占比最高；防守端抢断/夺回集中在后场和禁区，若希望战术更强调中场博弈，需要继续提高中场终结权重。</p></div>
    <div class="chart-grid">
      <div class="chart-block"><h3>推进路线</h3>${Object.entries(v2.routeTypes).map(([label,value]) => metricRow({label,value:value / routeTotal * 100,detail:`${Number(value).toLocaleString("zh-CN")} 次 · ${(value / routeTotal * 100).toFixed(1)}%`,tone:label === "structured" ? "positive" : "neutral"})).join("")}</div>
      <div class="chart-block"><h3>防守终结者位置</h3>${Object.entries(v2.turnoverDefenderRoles).map(([label,value]) => metricRow({label,value:value / v2.terminalOutcomes.defensiveTurnover * 100,detail:`${Number(value).toLocaleString("zh-CN")} 次 · ${(value / v2.terminalOutcomes.defensiveTurnover * 100).toFixed(1)}%`,tone:label === "DEF" ? "negative" : "neutral"})).join("")}</div>
    </div>
    <p class="footnote">防守终结总量：${Number(v2.terminalOutcomes.defensiveTurnover).toLocaleString("zh-CN")}；其中 DEF ${percent(v2.turnoverDefenderRoles.DEF / v2.terminalOutcomes.defensiveTurnover * 100)}，MID ${percent(v2.turnoverDefenderRoles.MID / v2.terminalOutcomes.defensiveTurnover * 100)}。</p>
  </section>

  ${matrixBlock("战术对位矩阵：主队胜率", headToHead.tactic, tacticLabels)}
  ${matrixBlock("阵型对位矩阵：主队胜率", headToHead.formation, formationLabels)}

  <section class="report-section">
    <div class="section-heading"><div><p class="eyebrow">OPERATIONS &amp; SAFETY</p><h2>运行稳定性与极端事件</h2></div><p>49 场中止必须在后续测试中定位原因；它不是平衡结论，但会影响线上体验和样本可信度。</p></div>
    <div class="chart-grid">
      <div class="chart-block"><h3>比赛执行</h3>${metricRow({label:"完成率",value:v2.matchExecution.completedMatches / results.matches * 100,detail:`${v2.matchExecution.completedMatches.toLocaleString("zh-CN")} 场完成`,tone:"positive"})}${metricRow({label:"中止率",value:v2.matchExecution.abandonedMatches / results.matches * 100,detail:`${v2.matchExecution.abandonedMatches.toLocaleString("zh-CN")} 场中止`,tone:"negative"})}${metricRow({label:"战术切换",value:v2.matchExecution.tacticalSwitchesPerMatch,max:6,valueLabel:`${number(v2.matchExecution.tacticalSwitchesPerMatch,2)} 次/场`,detail:"以 6 次/场作为显示上限",tone:"neutral"})}${metricRow({label:"伤病",value:v2.matchExecution.injuriesPerMatch,max:1,valueLabel:`${number(v2.matchExecution.injuriesPerMatch,3)} 次/场`,detail:`雷击伤病 ${v2.independentEvents.lightningInjury.toLocaleString("zh-CN")}`,tone:"negative"})}</div>
      <div class="chart-block"><h3>纪律事件</h3>${metricRow({label:"犯规",value:v2.discipline.foulsPerMatch,max:12,valueLabel:`${number(v2.discipline.foulsPerMatch,2)} 次/场`,detail:"总计"+v2.discipline.fouls.toLocaleString("zh-CN"),tone:"neutral"})}${metricRow({label:"黄牌",value:v2.discipline.yellowCardsPerMatch,max:3,valueLabel:`${number(v2.discipline.yellowCardsPerMatch,2)} 张/场`,detail:"总计"+v2.discipline.yellowCards.toLocaleString("zh-CN"),tone:"negative"})}${metricRow({label:"红牌",value:v2.discipline.redCardsPerMatch,max:.3,valueLabel:`${number(v2.discipline.redCardsPerMatch,3)} 张/场`,detail:"总计"+v2.discipline.redCards.toLocaleString("zh-CN"),tone:"negative"})}${metricRow({label:"点球",value:v2.discipline.penaltiesPerMatch,max:.5,valueLabel:`${number(v2.discipline.penaltiesPerMatch,3)} 次/场`,detail:"总计"+v2.discipline.penalties.toLocaleString("zh-CN"),tone:"negative"})}</div>
    </div>
  </section>

  <section class="report-section">
    <div class="section-heading"><div><p class="eyebrow">DECISION</p><h2>平衡调整建议</h2></div><p>按影响强度和证据质量排序，不对低样本组合做直接数值改动。</p></div>
    <div class="conclusion">
      <article><h3>优先检查 1：战术主动性</h3><p>全力进攻胜率比停车高 10.76 个百分点。先检查全力进攻的收益是否来自过高的推进/射门成功率，再决定是否下调，而不是直接增强停车。</p></article>
      <article><h3>优先检查 2：强度断层</h3><p>85+ 对 80-84 的头对头胜率为 43.05%，80-84 对 85+ 为 22.09%。总评、强化和特性共同产生强分层，建议下一轮做同强度固定阵容实验。</p></article>
      <article><h3>优先检查 3：天气尺度</h3><p>晴天 xG 1.520，暴雪 0.660，雷暴 0.748。天气影响已经足够显著，建议用固定阵容单变量复验，确认是否需要收窄极端天气倍率。</p></article>
    </div>
    <p class="source">来源：${escapeHtml(path.basename(inputPath))}；诊断样本：${escapeHtml(payload.outputProtection?.rawSamplesFile ?? "raw-samples.json")}。报告生成时间：${new Date().toISOString()}。</p>
  </section>
</main>
</body>
</html>
`;

await writeFile(outputPath, reportHtml, "utf8");
console.log(JSON.stringify({ output:outputPath, bytes:Buffer.byteLength(reportHtml), matches:results.matches, mode:payload.analysisMethod.mode }, null, 2));
