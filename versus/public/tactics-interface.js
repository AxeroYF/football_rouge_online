import {
  MENTALITIES, MENTALITY_VALUES, MENTALITY_DESCRIPTIONS, PRINCIPLE_GROUPS, PRINCIPLE_DESCRIPTIONS,
  TACTICAL_DIMENSION_LABELS, TACTICAL_PRINCIPLE_PRESETS, effectivePrinciples, isPrinciplesPlan,
} from "./tactical-principles.js";
import { IN_POSSESSION_DETAIL_OPTIONS, OUT_OF_POSSESSION_DETAIL_OPTIONS } from "./v2-tactical-profiles.js";
import {TACTICAL_FLOW_GROUPS,tacticalFlowFields} from "./tactical-flow.js";
import {EXECUTION_GROUPS,EXECUTION_SECTIONS,tacticalExecutionFields} from "./tactical-execution.js";

const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[c]);
const options = (choices, selected) => Object.entries(choices).map(([id, label]) => `<option value="${escape(id)}" ${id === selected ? "selected" : ""}>${escape(label)}</option>`).join("");

// Reuse the original controls and selectors, only arrange their presentation.
export function arrangeTacticalBoardToolbar(board) {
  const controls = board?.querySelector(".league-board-controls");
  const scheme = controls?.querySelector(".league-lineup-scheme-switcher");
  const toolbar = controls?.querySelector(".league-board-toolbar");
  const side = controls?.querySelector(".league-board-side");
  const auxiliaries = controls?.querySelector(".league-relationship-controls");
  if (!controls || !scheme || !toolbar || !side || !auxiliaries) return;
  const schemeRow = document.createElement("div");
  schemeRow.className = "tactics-board-scheme-row";
  schemeRow.append(scheme);
  const planRow = document.createElement("div");
  planRow.className = "tactics-board-plan-row";
  planRow.append(toolbar, side);
  const auxiliaryRow = document.createElement("div");
  auxiliaryRow.className = "league-board-tool-stack tactics-board-auxiliary-row";
  auxiliaryRow.append(auxiliaries);
  controls.replaceChildren(schemeRow, planRow, auxiliaryRow);
}

// Measure the real toolbar/banner instead of assuming a fixed browser chrome height.
export function createTacticalWorkspaceLayoutController() {
  let root = null;
  let observer = null;
  let frame = null;
  function resize() {
    frame = null;
    if (!root?.isConnected) return;
    const workspace = root.querySelector(".league-lineup-workspace");
    if (workspace && window.matchMedia("(min-width: 1051px)").matches) {
      const availableHeight = Math.max(360, window.innerHeight - (workspace.getBoundingClientRect().top + window.scrollY) - 16);
      const height = `${Math.floor(availableHeight)}px`;
      if (root.style.getPropertyValue("--tactics-workspace-height") !== height) root.style.setProperty("--tactics-workspace-height", height);
    } else root.style.removeProperty("--tactics-workspace-height");
    const board = root.querySelector(".league-board-panel");
    const heading = board?.querySelector(".league-board-heading");
    const pitch = board?.querySelector(":scope > .pitch");
    if (!board || !heading || !pitch) return;
    if (!window.matchMedia("(min-width: 1280px)").matches) {
      ["--tactics-fit-board-width", "--tactics-bench-columns", "--tactics-bench-width", "--tactics-bench-card-height"].forEach(name => root.style.removeProperty(name));
      root.classList.remove("tactics-compact-bench");
      return;
    }
    const style = getComputedStyle(board);
    const number = value => Number.parseFloat(value) || 0;
    const horizontal = number(style.paddingLeft) + number(style.paddingRight) + number(style.borderLeftWidth) + number(style.borderRightWidth);
    const vertical = number(style.paddingTop) + number(style.paddingBottom) + number(style.borderTopWidth) + number(style.borderBottomWidth) + number(style.rowGap);
    const available = window.innerHeight - (board.getBoundingClientRect().top + window.scrollY) - 16 - heading.getBoundingClientRect().height - vertical;
    const width = `${Math.floor(available * number(getComputedStyle(pitch).aspectRatio) + horizontal)}px`;
    if (root.style.getPropertyValue("--tactics-fit-board-width") !== width) root.style.setProperty("--tactics-fit-board-width", width);
    if (!window.matchMedia("(min-width: 2000px) and (min-height: 1100px)").matches) {
      ["--tactics-bench-columns", "--tactics-bench-width", "--tactics-bench-card-height"].forEach(name => root.style.removeProperty(name));
      root.classList.remove("tactics-compact-bench");
      return;
    }
    const bench = root.querySelector(".league-bench");
    const list = bench?.querySelector(".bench-magnet-list");
    if (list?.children.length) {
      const listStyle = getComputedStyle(list), benchStyle = getComputedStyle(bench);
      const gap = number(listStyle.rowGap);
      const space = window.innerHeight - board.getBoundingClientRect().top - 16
        - bench.querySelector(":scope > header").getBoundingClientRect().height
        - bench.querySelector(".league-autosave-footer").getBoundingClientRect().height
        - number(listStyle.paddingTop) - number(listStyle.paddingBottom)
        - number(benchStyle.borderTopWidth) - number(benchStyle.borderBottomWidth) - 2 * number(benchStyle.rowGap);
      const heightFor = columns => { const rows = Math.ceil(list.children.length / columns); return Math.floor((space - gap * (rows - 1)) / rows); };
      const columns = heightFor(2) < 58 ? 3 : 2;
      const height = Math.max(58, Math.min(78, heightFor(columns)));
      root.style.setProperty("--tactics-bench-columns", columns);
      root.style.setProperty("--tactics-bench-card-height", `${height}px`);
      if (columns === 3) root.style.setProperty("--tactics-bench-width", "clamp(294px,13vw,332px)");
      else root.style.removeProperty("--tactics-bench-width");
      root.classList.toggle("tactics-compact-bench", height < 72 || columns === 3);
    }
  }
  function schedule() {
    if (frame == null) frame = requestAnimationFrame(resize);
  }
  function detach() {
    observer?.disconnect();
    observer = null;
    window.removeEventListener("resize", schedule);
    if (frame != null) cancelAnimationFrame(frame);
    frame = null;
  }
  return {
    mount(element) {
      if (root !== element) {
        detach();
        root = element;
        if (root) {
          window.addEventListener("resize", schedule);
          if (typeof ResizeObserver !== "undefined") {
            observer = new ResizeObserver(schedule);
            [".league-board-heading", ".league-next-match", ".league-bench>header", ".league-autosave-footer"].map(selector => root.querySelector(selector)).filter(Boolean).forEach(element => observer.observe(element));
          }
        }
      }
      if (root) schedule();
    },
    dispose() { detach(); root = null; },
  };
}

export function principlePlanMarkup(state, label, plan, dimensions) {
  const split = effectivePrinciples(plan);
  const legacy = !isPrinciplesPlan(plan);
  const low = split.defensiveBlock === "lowBlock";
  const mentality = `<section class="tactics-mentality"><h3>比赛心态 <small>整体冒险程度</small></h3><div class="tactics-mentality-options" aria-label="${label}心态">${Object.entries(MENTALITIES).map(([key, name]) => `<button type="button" title="${escape(MENTALITY_DESCRIPTIONS[key])}${low ? " 低位防守限制为均衡及以下。" : ""}" data-tactical-mentality="${key}" data-plan-state="${state}" aria-label="${name}" aria-pressed="${plan.tactic === key}" ${low && MENTALITY_VALUES[key] > 50 ? "disabled" : ""}>${key === "allOutAttack" ? "全力" : name}</button>`).join("")}</div></section>`;
  const groups = Object.entries(PRINCIPLE_GROUPS).map(([key, group]) => {
    const modified = group.dimensions.some(d => Object.hasOwn(plan.dimensionOverrides ?? {}, d));
    const choices = { ...group.choices };
    if (key === "defensiveBlock" && MENTALITY_VALUES[plan.tactic] > 50) choices.lowBlock = "低位防守（心态调为均衡）";
    return `<section class="tactics-principle"><label for="${state}-principle-${key}"><span>${group.label}${modified ? '<em>已微调</em>' : ""}</span><select title="${escape(key === "transitionStyle" && split[key] === "balanced" ? "有出球条件时再反击。" : key === "duelIntensity" && split[key] === "balanced" ? "平衡争夺与犯规风险。" : PRINCIPLE_DESCRIPTIONS[split[key]])}" id="${state}-principle-${key}" name="${state}Principle_${key}" data-league-principle="${key}" data-plan-state="${state}">${options(choices, split[key])}</select></label></section>`;
  }).join("");
  const detailMarkup = (config, values, labels, side) => Object.entries(config).map(([key, choices]) => `<label class="field"><span>${labels[key]}</span><select name="${state}${side}_${key}">${options(choices, values[key])}</select></label>`).join("");
  const flow=tacticalFlowFields(plan);
  const execution=tacticalExecutionFields(plan);
  const executionMarkup=Object.entries(EXECUTION_SECTIONS).map(([section,title])=>`<details class="tactics-details" data-tactics-section="execution-${section}"><summary>${title}</summary><div class="tactics-principles-grid">${Object.entries(EXECUTION_GROUPS).filter(([,group])=>group.section===section).map(([key,group])=>`<section class="tactics-principle"><label for="${state}-execution-${key}"><span>${group.label}</span><select title="${escape(group.description)}" id="${state}-execution-${key}" data-league-principle="${key}" data-plan-state="${state}">${options(group.choices,execution[key])}</select></label></section>`).join('')}</div></details>`).join('');
  const flowMarkup=`<details class="tactics-details" data-tactics-section="flow"><summary>攻守转换与时间管理</summary><div class="tactics-principles-grid">${Object.entries(TACTICAL_FLOW_GROUPS).map(([key,group])=>`<section class="tactics-principle"><label for="${state}-flow-${key}"><span>${group.label}</span><select title="${escape(group.description)}" id="${state}-flow-${key}" name="${state}Principle_${key}" data-league-principle="${key}" data-plan-state="${state}">${options(group.choices,flow[key])}</select></label></section>`).join("")}</div></details>`;
  const details = `<details class="tactics-details" data-tactics-section="instructions"><summary>有球与无球指令</summary><div class="league-phase-instructions"><section><header><b>有球进攻</b></header><div>${detailMarkup(IN_POSSESSION_DETAIL_OPTIONS, plan.inPossessionDetails, { attackDirection:"主攻方向", chanceCreation:"机会选择", longShots:"远射倾向", crossing:"传中倾向" }, "InDetail")}</div></section><section><header><b>无球防守</b></header><div>${detailMarkup(OUT_OF_POSSESSION_DETAIL_OPTIONS, plan.outOfPossessionDetails, { defensiveWidth:"防守宽度", defenseDirection:"防守方向", marking:"盯人方式", lineStrategy:"防线策略" }, "OutDetail")}</div></section></div></details>`;
  const sliders = Object.entries(TACTICAL_DIMENSION_LABELS).map(([key, name]) => {
    const value = legacy ? plan.tacticalDimensions?.[key] ?? dimensions[key] : dimensions[key];
    return `<label class="league-tactical-dimension"><span>${name}<output data-tactical-dimension-output="${state}Dimension_${key}">${value}</output></span><input type="range" name="${state}Dimension_${key}" min="0" max="100" step="1" value="${value}"></label>`;
  }).join("");
  return `<section class="league-match-plan tactics-principles-plan" data-plan-state="${state}"><header><b>${label}</b><span>${legacy ? "历史方案" : "独立战术原则"}</span></header>${legacy ? `<details class="tactics-legacy-note" data-tactics-section="legacy"><summary>历史参数已保留 · 查看说明</summary><p>保留原有比赛参数（有效心态 ${dimensions.mentality}）。修改原则后启用新规则；首发、站位和职责保留。</p></details>` : ""}<label class="tactics-preset"><span>快捷预设</span><select data-tactical-preset data-plan-state="${state}"><option value="">选择原则组合</option>${options(Object.fromEntries(Object.entries(TACTICAL_PRINCIPLE_PRESETS).map(([id, preset]) => [id, preset.label])), "")}</select></label>${mentality}<div class="tactics-principles-grid">${groups}</div>${flowMarkup}${executionMarkup}${details}<details class="tactics-details" data-tactics-section="advanced"><summary>高级微调</summary><div class="league-tactical-dimensions">${sliders}</div><p class="tactics-parameter-note">微调覆盖当前建议值；心态切换保留微调。重新选择原则只重置本组参数。</p></details></section>`;
}

export function tacticalOutlookMarkup() {
  return `<section class="tactical-outlook" data-tactical-outlook aria-label="预期打法"><header><div><small>TACTICAL OUTLOOK</small><h3>预期打法</h3></div><span data-outlook-state>正在读取当前首发</span></header><label class="tactical-outlook-compare"><input type="checkbox" data-outlook-compare>对比修改前</label><div class="tactical-outlook-chart" data-outlook-chart></div><p class="tactical-outlook-message" data-outlook-message role="status" aria-live="polite">正在计算阵容与战术方向…</p><button type="button" class="button secondary" data-outlook-retry hidden>重试</button><div class="tactical-outlook-legend"><span><i></i>当前</span><span data-outlook-baseline-legend hidden><i></i>修改前</span></div><label class="tactical-outlook-axis"><span>查看方向依据</span><select data-outlook-axis aria-label="查看战术方向依据" disabled></select></label><div class="tactical-outlook-explanation" data-outlook-explanation aria-live="polite"></div><p class="tactical-outlook-assumptions">当前首发的静态侧重指数，面积不代表强弱。按晴天与当前体力估计，未计入对手；不是控球率或胜率。</p></section>`;
}

export function createTacticalOutlookController({ getContext, request, animateChart }) {
  let root = null;
  let timer = null;
  let generation = 0;
  let observer = null;
  let current = null;
  let baseline = null;
  let compare = false;
  let selected = "control";
  const baselines = new Map();
  const cache = new Map();
  const bindings = new WeakSet();
  const find = name => root?.querySelector(`[data-outlook-${name}]`);

  function draw(expand = false) {
    const chart = find("chart");
    if (!chart || !current?.valid) return;
    const width = Math.max(220, chart.clientWidth || 300);
    const spacious = window.matchMedia("(min-width: 2000px) and (min-height: 1100px)").matches;
    const height = spacious ? Math.min(420, Math.max(230, Math.min(width * .95, window.innerHeight - 950))) : window.matchMedia("(min-width: 1051px)").matches ? 230 : 285;
    const cx = width / 2, cy = height / 2;
    const radius = Math.max(45, Math.min(width / 2 - (spacious ? 75 : 57), height / 2 - 32));
    const point = (i, value) => [cx + Math.sin(i * Math.PI / 3) * radius * value / 100, cy - Math.cos(i * Math.PI / 3) * radius * value / 100];
    const points = values => values.map((value, index) => point(index, value).join(",")).join(" ");
    const axes = current.axes;
    const oldById = new Map((baseline?.axes ?? []).map(axis => [axis.id, axis.value]));
    const old = axes.map(axis => oldById.get(axis.id) ?? axis.value);
    const grid = [25,50,75,100].map(value => `<polygon points="${points(axes.map(() => value))}" class="outlook-grid"/>`).join("");
    const spokes = axes.map((axis, index) => { const [x,y] = point(index,100); return `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" class="outlook-grid"/>`; }).join("");
    const labels = axes.map((axis,index) => {
      let [x,y] = point(index,100), anchor = "middle";
      if (index === 0) y -= 12;
      else if (index === 3) y += 20;
      else if (index < 3) { x += 9; y += 4; anchor = "start"; }
      else { x -= 9; y += 4; anchor = "end"; }
      const [px,py] = point(index,axis.value);
      return `<text x="${x}" y="${y}" text-anchor="${anchor}" data-outlook-direction="${axis.id}">${escape(axis.label)}</text><circle cx="${px}" cy="${py}" r="${axis.id === selected ? 4 : 2.5}" class="outlook-point" data-outlook-direction="${axis.id}"/>`;
    }).join("");
    const previousPolygon = chart.querySelector('.outlook-current')?.getAttribute('points');
    chart.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escape(axes.map(axis => `${axis.label} ${axis.value}`).join("，"))}"><title>六方向预期打法</title>${grid}${spokes}${compare && baseline?.valid ? `<polygon points="${points(old)}" class="outlook-baseline"/>` : ""}<polygon points="${points(axes.map(axis => axis.value))}" class="outlook-current"/>${labels}</svg>`;
    animateChart?.(chart.querySelector('.outlook-current'),previousPolygon);
    find("baseline-legend").hidden = !compare || !baseline?.valid;
    const axis = axes.find(axis => axis.id === selected) ?? axes[0];
    const previous = oldById.get(axis.id);
    const delta = compare && Number.isFinite(previous) ? axis.value - previous : null;
    const open = expand === true || (find("explanation").querySelector("details")?.open ?? spacious);
    find("explanation").innerHTML = `<header><h4>${escape(axis.label)}</h4><strong>${axis.value}<small>/100${delta == null ? "" : ` · ${delta > 0 ? "+" : ""}${delta}`}</small></strong></header><details class="outlook-analysis" ${open ? "open" : ""}><summary>查看能力与站位依据</summary><p>${escape(axis.evidence)}</p><p>${escape(axis.support)}</p><p class="outlook-tradeoff">${escape(axis.tradeoff)}</p></details>`;
  }

  function showResult(result, previous) {
    current = result;
    baseline = previous;
    find("retry").hidden = true;
    const valid = Boolean(result?.valid);
    find("axis").disabled = !valid;
    if (!valid) {
      find("chart").innerHTML = "";
      find("explanation").innerHTML = "";
      find("message").textContent = result?.message ?? "当前信息不足，无法生成预期打法";
      return;
    }
    find("axis").innerHTML = options(Object.fromEntries(result.axes.map(axis => [axis.id, axis.label])), selected);
    find("message").textContent = result.warnings?.join(" ") ?? "";
    find("state").textContent = `${getContext()?.dirty ? "当前草稿" : "已保存方案"} · ${result.assumptions?.minute ?? 25} 分钟情景`;
    draw();
  }

  async function calculate(force = false) {
    const context = getContext();
    if (!root?.isConnected || !context) return;
    const ticket = ++generation;
    const { key, payload, signature } = context;
    if (!baselines.has(key)) {
      if (baselines.size >= 12) baselines.delete(baselines.keys().next().value);
      baselines.set(key, { payload:structuredClone(payload), signature });
    }
    const entry = baselines.get(key);
    find("state").textContent = "正在更新";
    find("message").textContent = "正在计算当前阵容与配置…";
    try {
      const cached = cache.get(key);
      const result = !force && cached?.signature === signature ? cached.result : await request(payload);
      if (!entry.result) entry.result = entry.signature === signature ? result : await request(entry.payload);
      if (ticket !== generation || !root?.isConnected || getContext()?.signature !== signature) return;
      if (cache.size >= 12 && !cache.has(key)) cache.delete(cache.keys().next().value);
      cache.set(key, { signature, result });
      showResult(result, entry.result);
    } catch (error) {
      if (ticket !== generation || !root?.isConnected) return;
      current = null;
      find("chart").innerHTML = "";
      find("explanation").innerHTML = "";
      find("axis").disabled = true;
      find("state").textContent = "暂不可用";
      find("message").textContent = error.message ?? "预期打法读取失败";
      find("retry").hidden = false;
    }
  }

  function refresh(delay = 240) {
    clearTimeout(timer);
    generation += 1;
    if (!root?.isConnected || !getContext()) return;
    const context = getContext();
    if (!baselines.has(context.key)) baselines.set(context.key, { payload:structuredClone(context.payload), signature:context.signature });
    timer = setTimeout(() => { void calculate(); }, delay);
  }

  function mount(element) {
    if (root !== element) {
      observer?.disconnect();
      window.removeEventListener("resize", draw);
      root = element;
      if (root) window.addEventListener("resize", draw);
      if (root && typeof ResizeObserver !== "undefined") {
        observer = new ResizeObserver(draw);
        observer.observe(find("chart"));
      }
    }
    if (!root) { clearTimeout(timer); generation += 1; return; }
    find("compare").checked = compare;
    if (!bindings.has(root)) {
      bindings.add(root);
      root.addEventListener("change", event => {
        if (event.target.matches("[data-outlook-axis]")) { selected = event.target.value; draw(true); event.stopPropagation(); }
        if (event.target.matches("[data-outlook-compare]")) { compare = event.target.checked; draw(); event.stopPropagation(); }
      });
      root.addEventListener("click", event => {
        const direction = event.target.closest("[data-outlook-direction]")?.dataset.outlookDirection;
        if (direction && current?.axes.some(axis => axis.id === direction)) {
          selected = direction;
          find("axis").value = direction;
          draw(true);
        }
      });
      find("retry").addEventListener("click", () => { void calculate(true); });
    }
    refresh(0);
  }

  return { mount, refresh, dispose(){ clearTimeout(timer); generation += 1; observer?.disconnect(); window.removeEventListener("resize", draw); root = null; baselines.clear(); cache.clear(); } };
}
