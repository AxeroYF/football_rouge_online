import { bondBonusText, inferTraitBondIds, normalizeBondDefinitions } from "/game/bonds.js";
import {
  ATTRIBUTE_LABELS as SHARED_ATTRIBUTE_LABELS,
  INJURY_PROFILES,
  PERSONALITY_PROFILES,
  POSITION_ORDER,
  ROLE_LABELS,
  normalizePlayerSchema,
  roleGroup,
} from "/game/schema.js";
import { DEFAULT_GAME_CONFIG, normalizeGameConfig } from "/game/config.js";

const RARITY_LABELS = {
  common: "普通",
  rare: "稀有",
  epic: "史诗",
  legendary: "传奇",
};

const RARITY_GRADES = Object.freeze([
  { rarity: "legendary", grade: "A", label: "传奇", note: "改变比赛规则的核心构筑" },
  { rarity: "epic", grade: "B", label: "史诗", note: "强力且具有明确战术价值" },
  { rarity: "rare", grade: "C", label: "稀有", note: "稳定形成打法差异" },
  { rarity: "common", grade: "D", label: "普通", note: "基础构筑与条件增益" },
]);

function traitGrade(rarity) {
  return RARITY_GRADES.find((entry) => entry.rarity === rarity)?.grade ?? "D";
}

const TRAIT_DRAFT_STATUS_LABELS = {
  concept: "构思中",
  incomplete: "待补充",
  ready: "可测试",
  testing: "测试中",
  review: "待评审",
};

const ROLE_GROUP_LABELS = {
  ANY: "全位置",
  GK: "门将",
  DEF: "后卫",
  MID: "中场",
  ATT: "前锋",
};

const ROLES = [...POSITION_ORDER];

const ATTRIBUTE_GROUPS = [
  {
    name: "技术",
    fields: ["passing", "firstTouch", "dribbling", "crossing", "finishing", "longShots", "heading", "setPieces"],
  },
  {
    name: "防守与意识",
    fields: ["tackling", "marking", "positioning", "vision", "decisions", "composure", "offBall", "discipline"],
  },
  {
    name: "身体",
    fields: ["pace", "acceleration", "strength", "stamina", "agility", "jumping", "workRate", "aggression"],
  },
  {
    name: "门将",
    fields: ["goalkeeping", "reflexes"],
  },
];

const ATTRIBUTE_LABELS = SHARED_ATTRIBUTE_LABELS;

const TACTIC_FIELDS = {
  tempo: "节奏",
  directness: "直接程度",
  width: "进攻宽度",
  pressing: "逼抢强度",
  defensiveLine: "防线高度",
  risk: "冒险程度",
  tackleIntensity: "抢断强度",
  counterAttack: "反击倾向",
  crossing: "传中倾向",
  setPieceFocus: "定位球投入",
  timeWasting: "拖延时间",
};

const FORMATION_FIELDS = {
  defensiveBalance: "防守平衡",
  midfieldDensity: "中场密度",
  attackingNumbers: "进攻人数",
};

const COACH_FIELDS = {
  attack: "进攻指导",
  defense: "防守指导",
  adaptability: "临场适应",
  substitutions: "换人倾向",
};

const TEAM_STATE_FIELDS = {
  chemistry: "球队默契",
  morale: "球队状态",
  form: "近期状态",
};

const WEATHER_PRESETS = Object.freeze({
  sunny: { name: "晴天", probability: 60, precipitation: 5, wind: 9, temperature: 21, lightningChance: 0 },
  rain: { name: "雨天", probability: 15, precipitation: 72, wind: 18, temperature: 14, lightningChance: 0 },
  storm: { name: "雷暴", probability: 15, precipitation: 96, wind: 48, temperature: 12, lightningChance: 0.006 },
  snow: { name: "雪天", probability: 10, precipitation: 58, wind: 22, temperature: -2, lightningChance: 0 },
});

const VIEW_META = {
  traits: {
    eyebrow: "CONTENT SYSTEM / 01",
    title: "特性卡管理",
    description: "设计卡牌、调整效果参数，并维护随机卡池。",
  },
  ratings: {
    eyebrow: "CONTENT SYSTEM / 02",
    title: "特性卡等级管理",
    description: "在A、B、C、D四个等级框之间拖动正式卡，每张卡只保留一个等级。",
  },
  bonds: {
    eyebrow: "CONTENT SYSTEM / 03",
    title: "羁绊系统设计",
    description: "创建羁绊栏位、组合正式特性卡，并为每个激活档位编写效果与参数。",
  },
  simulation: {
    eyebrow: "MATCH LAB / 04",
    title: "比赛模拟实验室",
    description: "调整环境、球队和战术参数，观察单场事件与批量概率。",
  },
  players: {
    eyebrow: "ROSTER DATA / 05",
    title: "球员卡管理",
    description: "维护球员基础资料、26项能力、伤病成长、隐藏性格和特性槽。",
  },
  settings: {
    eyebrow: "GLOBAL RULES / 06",
    title: "全局配置",
    description: "保存玩家比赛实际使用的天气、雷击、裁判与经济参数。",
  },
};

const app = {
  state: null,
  dirty: false,
  activeView: "traits",
  traitWorkspace: "formal",
  selectedTraitId: null,
  selectedTraitDraftId: null,
  selectedVersusTraitId: null,
  versusTraits: [],
  selectedBondId: null,
  selectedPlayerId: null,
  traitRuleDrafts: new Map(),
  simulationConfig: null,
  simulationResult: null,
  toastTimer: null,
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function prepareClientState(state) {
  const next = state ?? {};
  next.traitDrafts = Array.isArray(next.traitDrafts) ? next.traitDrafts : [];
  next.bonds = normalizeBondDefinitions(next.bonds ?? []);
  synchronizeTraitBondIds(next);
  return next;
}

function synchronizeTraitBondIds(state = app.state) {
  if (!state) return;
  const definitions = state.bonds ?? [];
  for (const trait of [...(state.traitCards ?? []), ...(state.traitDrafts ?? [])]) {
    trait.bondIds = inferTraitBondIds(trait, definitions);
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function uniqueId(prefix, existing) {
  let id = prefix + "-" + Date.now().toString(36);
  let counter = 1;
  while (existing.has(id)) {
    id = prefix + "-" + Date.now().toString(36) + "-" + counter;
    counter += 1;
  }
  return id;
}

function initials(name) {
  const value = String(name || "?").trim();
  return value.slice(0, 2).toUpperCase();
}

function overall(player) {
  const keys = player.role === "GK"
    ? ["goalkeeping", "reflexes", "positioning", "composure", "passing"]
    : Object.keys(player.attributes ?? {}).filter((key) => !["goalkeeping", "reflexes"].includes(key));
  if (keys.length === 0) return 50;
  return Math.round(keys.reduce((sum, key) => sum + Number(player.attributes?.[key] ?? 50), 0) / keys.length);
}

function getPath(object, path) {
  return path.split(".").reduce((value, key) => value?.[key], object);
}

function setPath(object, path, value) {
  const keys = path.split(".");
  let cursor = object;
  for (const key of keys.slice(0, -1)) {
    cursor[key] ??= {};
    cursor = cursor[key];
  }
  cursor[keys.at(-1)] = value;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers ?? {}),
    },
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    const detail = payload.details?.length ? "\n" + payload.details.join("\n") : "";
    throw new Error((payload.error ?? "请求失败") + detail);
  }
  return payload;
}

function showToast(message, type = "success") {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.className = "toast visible" + (type === "error" ? " error" : "");
  clearTimeout(app.toastTimer);
  app.toastTimer = setTimeout(() => {
    toast.className = "toast";
  }, 3200);
}

function updateSaveState(mode = app.dirty ? "dirty" : "saved") {
  const status = document.querySelector("#save-state");
  status.className = "save-state";
  if (mode === "saving") {
    status.classList.add("saving");
    status.innerHTML = "<span></span>正在保存";
  } else if (mode === "dirty") {
    status.classList.add("dirty");
    status.innerHTML = "<span></span>有未保存改动";
  } else {
    status.innerHTML = "<span></span>已保存";
  }
}

function markDirty() {
  app.dirty = true;
  updateSaveState("dirty");
}

function commitTraitRuleDrafts() {
  for (const [traitId, draft] of app.traitRuleDrafts.entries()) {
    const trait = app.state.traitCards.find((candidate) => candidate.id === traitId);
    if (!trait) continue;
    try {
      const parsed = JSON.parse(draft);
      if (!Array.isArray(parsed)) throw new Error("规则必须是 JSON 数组");
      trait.rules = parsed;
    } catch (error) {
      app.selectedTraitId = traitId;
      switchView("traits");
      renderTraitEditor();
      throw new Error("“" + trait.name + "”的规则 JSON 无效：" + error.message);
    }
  }
}

async function saveState({ quiet = false } = {}) {
  if (!app.state) return;
  try {
    commitTraitRuleDrafts();
    updateSaveState("saving");
    const payload = await api("/api/state", {
      method: "POST",
      body: JSON.stringify({ state: app.state }),
    });
    app.state = prepareClientState(payload.state);
    app.selectedTraitDraftId = app.state.traitDrafts.find((draft) => draft.id === app.selectedTraitDraftId)?.id ?? app.state.traitDrafts[0]?.id ?? null;
    app.dirty = false;
    renderAll();
    updateSaveState("saved");
    if (!quiet) showToast("所有开发数据已保存，并保留了上一个备份");
  } catch (error) {
    updateSaveState("dirty");
    showToast(error.message, "error");
    throw error;
  }
}

function switchView(view) {
  app.activeView = view;
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.viewTarget === view);
  });
  document.querySelectorAll(".view").forEach((section) => {
    section.classList.toggle("active", section.id === "view-" + view);
  });
  const meta = VIEW_META[view];
  document.querySelector("#view-eyebrow").textContent = meta.eyebrow;
  document.querySelector("#view-title").textContent = meta.title;
  document.querySelector("#view-description").textContent = meta.description;
  if (view === "simulation") renderSimulationForm();
  if (view === "ratings") renderTraitRarityBoard();
  if (view === "bonds") renderBondDesigner();
  if (view === "settings") renderGlobalSettings();
}

function summaryCell(label, value) {
  return '<div class="summary-cell"><span>' + escapeHtml(label) + "</span><strong>" + escapeHtml(value) + "</strong></div>";
}

function draftCompletion(draft) {
  const checks = [
    Boolean(draft.name?.trim()),
    Boolean(draft.summary?.trim()),
    Boolean(draft.rarity),
    Boolean(draft.category?.trim()),
    Boolean(draft.eligibleRoleGroups?.length),
    Boolean(draft.tags?.length),
    Boolean(draft.implementationNotes?.trim() || draft.rulesDraft?.trim()),
    Boolean(draft.testNotes?.trim()),
  ];
  return { filled: checks.filter(Boolean).length, total: checks.length };
}

function renderTraitWorkspaceControls() {
  const development = app.traitWorkspace === "development";
  const versus11 = app.traitWorkspace === "versus11";
  document.querySelectorAll("[data-trait-workspace]").forEach((button) => {
    const active = button.dataset.traitWorkspace === app.traitWorkspace;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  document.querySelector("#formal-trait-count").textContent = app.state.traitCards.length;
  document.querySelector("#draft-trait-count").textContent = app.state.traitDrafts.length;
  document.querySelector("#versus-trait-count").textContent = app.versusTraits.length;
  document.querySelector("#trait-rarity-filter").hidden = development;
  document.querySelector("#trait-role-filter").hidden = development;
  document.querySelector("#trait-status-filter").hidden = !development;
  document.querySelector("#trait-search").placeholder = development
    ? "搜索草稿名称、想法或备注"
    : versus11 ? "搜索11人制卡牌、位置或标签" : "搜索名称、标签或说明";
  document.querySelector("#add-trait-button").textContent = development ? "＋ 新建开发卡" : "＋ 新建特性";
  document.querySelector("#add-trait-button").hidden = versus11;
  document.querySelector("#trait-workspace-note").innerHTML = versus11
    ? "<span></span>11人制卡池独立维护，不会进入7人制抽取、装备和比赛模拟"
    : "<span></span>开发中草稿与正式卡池隔离，不参与抽取、装备和比赛模拟";
  if (app.activeView === "traits") {
    document.querySelector("#view-description").textContent = development
      ? "记录尚未定稿的卡牌想法；允许缺少标签、位置和程序规则。"
      : versus11 ? "查看11人制对战专用卡池，并区分适配卡与11人制新增卡。" : VIEW_META.traits.description;
  }
}

function renderTraitSummary() {
  if (app.traitWorkspace === "versus11") {
    const added = app.versusTraits.filter((trait) => trait.source === "versus11-new").length;
    const adapted = app.versusTraits.filter((trait) => trait.source === "adapted-seven-a-side").length;
    const roleCoverage = new Set(app.versusTraits.flatMap((trait) => trait.eligibleRoleGroups ?? [])).size;
    document.querySelector("#trait-summary").innerHTML =
      summaryCell("11人制卡池", app.versusTraits.length) +
      summaryCell("11人制新增", added) +
      summaryCell("7人制适配", adapted) +
      summaryCell("位置覆盖", roleCoverage + " 类");
    return;
  }
  if (app.traitWorkspace === "development") {
    const drafts = app.state.traitDrafts;
    const ready = drafts.filter((draft) => draft.status === "ready" || draft.status === "testing").length;
    const review = drafts.filter((draft) => draft.status === "review").length;
    const totalFields = drafts.length * 9;
    const completedFields = drafts.reduce((sum, draft) => sum + draftCompletion(draft).filled, 0);
    document.querySelector("#trait-summary").innerHTML =
      summaryCell("开发中草稿", drafts.length) +
      summaryCell("可测试 / 测试中", ready) +
      summaryCell("待评审", review) +
      summaryCell("平均信息完成度", totalFields ? Math.round(completedFields / totalFields * 100) + "%" : "—");
    return;
  }
  const counts = Object.fromEntries(Object.keys(RARITY_LABELS).map((rarity) => [rarity, 0]));
  for (const trait of app.state.traitCards) counts[trait.rarity] = (counts[trait.rarity] ?? 0) + 1;
  document.querySelector("#trait-summary").innerHTML =
    summaryCell("特性卡总数", app.state.traitCards.length) +
    summaryCell("普通 / 稀有", counts.common + " / " + counts.rare) +
    summaryCell("史诗 / 传奇", counts.epic + " / " + counts.legendary) +
    summaryCell("已装备数量", app.state.players.reduce((sum, player) => sum + (player.traitCards?.length ?? 0), 0));
}

function traitMatchesFilter(trait) {
  const query = document.querySelector("#trait-search").value.trim().toLowerCase();
  if (app.traitWorkspace === "development") {
    const status = document.querySelector("#trait-status-filter").value;
    const haystack = [
      trait.name,
      trait.id,
      trait.category,
      trait.summary,
      trait.designNotes,
      trait.implementationNotes,
      trait.testNotes,
      ...(trait.tags ?? []),
    ].join(" ").toLowerCase();
    return (!query || haystack.includes(query)) && (status === "all" || trait.status === status);
  }
  const rarity = document.querySelector("#trait-rarity-filter").value;
  const role = document.querySelector("#trait-role-filter").value;
  const haystack = [trait.name, trait.id, trait.category, trait.summary, ...(trait.tags ?? [])].join(" ").toLowerCase();
  return (
    (!query || haystack.includes(query)) &&
    (rarity === "all" || trait.rarity === rarity) &&
    (role === "all" || trait.eligibleRoleGroups.includes("ANY") || trait.eligibleRoleGroups.includes(role))
  );
}

function renderTraitList() {
  const list = document.querySelector("#trait-list");
  const development = app.traitWorkspace === "development";
  const versus11 = app.traitWorkspace === "versus11";
  const traits = (development ? app.state.traitDrafts : versus11 ? app.versusTraits : app.state.traitCards).filter(traitMatchesFilter);
  if (traits.length === 0) {
    list.innerHTML = development
      ? '<div class="empty-state draft-empty"><span>DEV</span><h2>还没有开发中草稿</h2><p>新建一张开发卡，先写名字或一句想法也可以。</p></div>'
      : '<div class="empty-state"><p>没有符合当前筛选的特性卡。</p></div>';
    return;
  }
  list.innerHTML = traits.map((trait) => {
    if (development) {
      const completion = draftCompletion(trait);
      const name = trait.name?.trim() || "未命名开发卡";
      const detail = trait.summary?.trim() || trait.designNotes?.trim() || "尚未填写效果或设计想法";
      return (
        '<button class="list-item ' + (trait.id === app.selectedTraitDraftId ? "active" : "") + '" data-trait-item-id="' + escapeHtml(trait.id) + '">' +
        '<span class="rarity-line development"></span>' +
        '<span class="list-copy"><strong>' + escapeHtml(name) + "</strong><small>" + escapeHtml(detail) + "</small></span>" +
        '<span class="list-meta draft-list-meta"><b>' + escapeHtml(TRAIT_DRAFT_STATUS_LABELS[trait.status] ?? "构思中") + "</b><small>" + completion.filled + "/" + completion.total + "</small></span></button>"
      );
    }
    const roles = (trait.eligibleRoleGroups ?? []).map((role) => ROLE_GROUP_LABELS[role] ?? role).join(" · ");
    return (
      '<button class="list-item ' + (trait.id === (versus11 ? app.selectedVersusTraitId : app.selectedTraitId) ? "active" : "") + '" data-trait-item-id="' + escapeHtml(trait.id) + '">' +
      '<span class="rarity-line ' + escapeHtml(trait.rarity) + '"></span>' +
      '<span class="list-copy"><strong>' + escapeHtml(trait.name) + "</strong><small>" + escapeHtml(roles + " · " + trait.category) + "</small></span>" +
      '<span class="list-meta">' + (versus11 ? '<b class="mode-list-badge">' + escapeHtml(trait.developerLabel) + '</b>' : '') + escapeHtml(RARITY_LABELS[trait.rarity] ?? trait.rarity) + "</span></button>"
    );
  }).join("");
  list.querySelectorAll("[data-trait-item-id]").forEach((button) => {
    button.addEventListener("click", () => {
      if (development) app.selectedTraitDraftId = button.dataset.traitItemId;
      else if (versus11) app.selectedVersusTraitId = button.dataset.traitItemId;
      else app.selectedTraitId = button.dataset.traitItemId;
      renderTraitList();
      renderTraitEditor();
    });
  });
}

function traitRoleCheckboxes(trait) {
  return Object.keys(ROLE_GROUP_LABELS).map((role) => {
    const checked = trait.eligibleRoleGroups.includes(role) ? " checked" : "";
    return '<label class="check-pill"><input type="checkbox" data-trait-role="' + role + '"' + checked + ' /><span>' + ROLE_GROUP_LABELS[role] + "</span></label>";
  }).join("");
}

function traitBondCheckboxes(trait) {
  const bonds = (app.state.bonds ?? []).filter((bond) => bond.traitIds.includes(trait.id));
  return bonds.length
    ? bonds.map((bond) => '<span class="membership-pill">' + escapeHtml(bond.name) + "</span>").join("")
    : '<span class="muted">尚未加入羁绊</span>';
}

function inferAttributeRulesFromSummary(trait) {
  const keywords = {
    passing: ["传球"], firstTouch: ["停球", "第一脚触球"], dribbling: ["盘带"], crossing: ["传中"],
    finishing: ["射门", "终结"], longShots: ["远射"], heading: ["头球"], setPieces: ["定位球"],
    tackling: ["抢断"], marking: ["盯人"], positioning: ["站位"], vision: ["视野"], decisions: ["决策"],
    composure: ["冷静"], offBall: ["无球"], discipline: ["纪律"], pace: ["速度"], acceleration: ["加速"],
    strength: ["力量"], stamina: ["耐力", "体能"], agility: ["灵活"], jumping: ["弹跳"], workRate: ["投入"],
    aggression: ["侵略性"], goalkeeping: ["守门", "门将"], reflexes: ["反应"],
  };
  const add = {};
  const copy = String(trait.summary ?? "");
  for (const [attribute, labels] of Object.entries(keywords)) {
    for (const label of labels) {
      const match = copy.match(new RegExp(label + "[^，。；;]{0,8}?([+＋\\-−])\\s*(\\d+)", "i"));
      if (!match) continue;
      add[attribute] = (match[1] === "-" || match[1] === "−" ? -1 : 1) * Number(match[2]);
      break;
    }
  }
  return Object.keys(add).length ? [{ hook: "attribute", add }] : [];
}

function draftRoleCheckboxes(draft) {
  return Object.keys(ROLE_GROUP_LABELS).map((role) => {
    const checked = (draft.eligibleRoleGroups ?? []).includes(role) ? " checked" : "";
    return '<label class="check-pill"><input type="checkbox" data-draft-role="' + role + '"' + checked + ' /><span>' + ROLE_GROUP_LABELS[role] + "</span></label>";
  }).join("");
}

function draftBondCheckboxes(draft) {
  return traitBondCheckboxes(draft);
}

function touchTraitDraft(draft) {
  draft.updatedAt = new Date().toISOString();
  markDirty();
}

function renderTraitDraftEditor() {
  const editor = document.querySelector("#trait-editor");
  const draft = app.state.traitDrafts.find((candidate) => candidate.id === app.selectedTraitDraftId);
  if (!draft) {
    editor.innerHTML = '<div class="empty-state draft-empty"><span>DEV</span><h2>建立你的第一张开发卡</h2><p>这里允许只保存一个名称、一段效果想法或测试备注。草稿不会进入正式卡池。</p><button class="button primary" id="empty-add-draft-button">＋ 新建开发卡</button></div>';
    document.querySelector("#empty-add-draft-button")?.addEventListener("click", addTraitDraft);
    return;
  }

  const completion = draftCompletion(draft);
  const completionPercent = Math.round(completion.filled / completion.total * 100);
  const displayName = draft.name?.trim() || "未命名开发卡";
  const displaySummary = draft.summary?.trim() || "还没有填写玩家可见效果。";
  const status = TRAIT_DRAFT_STATUS_LABELS[draft.status] ? draft.status : "concept";
  draft.status = status;
  draft.tags ??= [];
  draft.eligibleRoleGroups ??= [];
  draft.bondIds ??= [];

  editor.innerHTML = `
    <div class="draft-isolation-banner"><b>开发中草稿</b><span>不会被球员抽到、装备，也不会进入比赛模拟。测试通过后再与正式卡池合并。</span></div>
    <div class="editor-head draft-editor-head">
      <div class="card-preview development ${escapeHtml(draft.rarity || "unassigned")}" id="draft-preview">
        <span class="rarity-chip development" id="draft-preview-status">${escapeHtml(TRAIT_DRAFT_STATUS_LABELS[status])}</span>
        <h3 id="draft-preview-name">${escapeHtml(displayName)}</h3>
        <p id="draft-preview-summary">${escapeHtml(displaySummary)}</p>
      </div>
      <div class="editor-title">
        <p class="panel-label">DEVELOPMENT TRAIT / ${escapeHtml(draft.id)}</p>
        <h2 id="draft-editor-title">${escapeHtml(displayName)}</h2>
        <p>所有字段均可暂时留空。这里先沉淀设计，程序规则可以后续一起实现。</p>
        <div class="draft-completion">
          <div><span>信息完成度</span><b id="draft-completion-label">${completion.filled} / ${completion.total}</b></div>
          <i><span id="draft-completion-bar" style="width:${completionPercent}%"></span></i>
        </div>
        <div class="editor-actions"><button class="button ghost" id="duplicate-draft-button">复制草稿</button><button class="button danger" id="delete-draft-button">删除草稿</button></div>
      </div>
    </div>
    <div class="form-grid draft-form-grid">
      <div class="field"><label for="draft-name-input">卡牌名称 <small>可选</small></label><input id="draft-name-input" value="${escapeHtml(draft.name ?? "")}" placeholder="可以稍后命名" /></div>
      <div class="field"><label for="draft-status-input">开发状态</label><select id="draft-status-input">${Object.entries(TRAIT_DRAFT_STATUS_LABELS).map(([value, label]) => `<option value="${value}"${status === value ? " selected" : ""}>${label}</option>`).join("")}</select></div>
      <div class="field"><label for="draft-id-input">草稿 ID</label><input id="draft-id-input" value="${escapeHtml(draft.id)}" readonly /><p class="field-help">由工具自动生成，用于稳定保存草稿。</p></div>
      <div class="field"><label for="draft-rarity-input">预期稀有度 <small>可选</small></label><select id="draft-rarity-input"><option value="">暂未决定</option>${Object.entries(RARITY_LABELS).map(([value, label]) => `<option value="${value}"${draft.rarity === value ? " selected" : ""}>${label}</option>`).join("")}</select></div>
      <div class="field"><label for="draft-category-input">类别 <small>可选</small></label><input id="draft-category-input" value="${escapeHtml(draft.category ?? "")}" placeholder="例如 technique / mentality" /></div>
      <div class="field"><label for="draft-polarity-input">性质 <small>可选</small></label><select id="draft-polarity-input"><option value="">暂未决定</option><option value="positive"${draft.polarity === "positive" ? " selected" : ""}>正向</option><option value="mixed"${draft.polarity === "mixed" ? " selected" : ""}>双刃</option><option value="negative"${draft.polarity === "negative" ? " selected" : ""}>负面</option></select></div>
      <div class="field"><label for="draft-weight-input">预期掉落权重 <small>可选</small></label><input id="draft-weight-input" type="number" min="0.01" max="100" step="0.05" value="${escapeHtml(draft.dropWeight ?? "")}" placeholder="暂不填写" /></div>
      <div class="field span-2"><span class="field-label">适用位置 <small>可选，可全部不选</small></span><div class="checkbox-row">${draftRoleCheckboxes(draft)}</div></div>
      <div class="field span-2"><span class="field-label">羁绊分类 <small>可选，可全部不选</small></span><div class="checkbox-row">${draftBondCheckboxes(draft)}</div></div>
      <div class="field span-2"><label for="draft-tags-input">标签 <small>可选</small></label><input id="draft-tags-input" value="${escapeHtml(draft.tags.join(", "))}" placeholder="用逗号分隔，也可以留空" /></div>
      <div class="field span-2"><label for="draft-summary-input">玩家可见效果 / 核心想法 <small>可选</small></label><textarea id="draft-summary-input" placeholder="先写一句效果想法也可以">${escapeHtml(draft.summary ?? "")}</textarea></div>
      <div class="field span-2"><label for="draft-design-notes-input">设计说明 <small>可选</small></label><textarea id="draft-design-notes-input" class="notes-field" placeholder="记录触发条件、数值方向、适用场景或灵感">${escapeHtml(draft.designNotes ?? "")}</textarea></div>
      <div class="field span-2"><label for="draft-rules-input">程序实现草案 <small>可选，不校验格式</small></label><textarea id="draft-rules-input" class="code-field draft-rules-field" spellcheck="false" placeholder="现在可以留空；也可以写伪代码、JSON 草案或实现备注">${escapeHtml(draft.rulesDraft ?? "")}</textarea><p class="field-help">这里按原文保存，不要求是有效 JSON，不会进入当前规则引擎。</p></div>
      <div class="field span-2"><label for="draft-implementation-notes-input">程序实现备注 <small>可选</small></label><textarea id="draft-implementation-notes-input" class="notes-field" placeholder="记录后续需要一起处理的逻辑、依赖或疑问">${escapeHtml(draft.implementationNotes ?? "")}</textarea></div>
      <div class="field span-2"><label for="draft-test-notes-input">测试记录 <small>可选</small></label><textarea id="draft-test-notes-input" class="notes-field" placeholder="记录测试结论、待调整项；通过后可把状态改为待评审">${escapeHtml(draft.testNotes ?? "")}</textarea></div>
    </div>`;

  const refreshCompletion = () => {
    const next = draftCompletion(draft);
    document.querySelector("#draft-completion-label").textContent = next.filled + " / " + next.total;
    document.querySelector("#draft-completion-bar").style.width = Math.round(next.filled / next.total * 100) + "%";
    renderTraitSummary();
  };
  const bindText = (selector, key, onInput) => {
    document.querySelector(selector).addEventListener("input", (event) => {
      draft[key] = event.target.value;
      touchTraitDraft(draft);
      onInput?.();
      refreshCompletion();
    });
  };

  bindText("#draft-name-input", "name", () => {
    const name = draft.name.trim() || "未命名开发卡";
    document.querySelector("#draft-preview-name").textContent = name;
    document.querySelector("#draft-editor-title").textContent = name;
    renderTraitList();
  });
  bindText("#draft-category-input", "category");
  bindText("#draft-summary-input", "summary", () => {
    document.querySelector("#draft-preview-summary").textContent = draft.summary.trim() || "还没有填写玩家可见效果。";
    renderTraitList();
  });
  bindText("#draft-design-notes-input", "designNotes", renderTraitList);
  bindText("#draft-rules-input", "rulesDraft");
  bindText("#draft-implementation-notes-input", "implementationNotes");
  bindText("#draft-test-notes-input", "testNotes");
  document.querySelector("#draft-tags-input").addEventListener("input", (event) => {
    draft.tags = event.target.value.split(",").map((value) => value.trim()).filter(Boolean);
    touchTraitDraft(draft);
    refreshCompletion();
  });
  document.querySelector("#draft-status-input").addEventListener("change", (event) => {
    draft.status = event.target.value;
    touchTraitDraft(draft);
    renderTraits();
  });
  document.querySelector("#draft-rarity-input").addEventListener("change", (event) => {
    draft.rarity = event.target.value;
    touchTraitDraft(draft);
    document.querySelector("#draft-preview").className = "card-preview development " + (draft.rarity || "unassigned");
    refreshCompletion();
  });
  document.querySelector("#draft-polarity-input").addEventListener("change", (event) => { draft.polarity = event.target.value; touchTraitDraft(draft); });
  document.querySelector("#draft-weight-input").addEventListener("input", (event) => {
    draft.dropWeight = event.target.value === "" ? null : Number(event.target.value);
    touchTraitDraft(draft);
  });
  document.querySelectorAll("[data-draft-role]").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      if (checkbox.dataset.draftRole === "ANY" && checkbox.checked) {
        document.querySelectorAll("[data-draft-role]").forEach((input) => { if (input !== checkbox) input.checked = false; });
      } else if (checkbox.checked) {
        const any = document.querySelector('[data-draft-role="ANY"]');
        if (any) any.checked = false;
      }
      draft.eligibleRoleGroups = [...document.querySelectorAll("[data-draft-role]:checked")].map((input) => input.dataset.draftRole);
      touchTraitDraft(draft);
      refreshCompletion();
    });
  });
  document.querySelectorAll("[data-draft-bond]").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      draft.bondIds = [...document.querySelectorAll("[data-draft-bond]:checked")].map((input) => input.dataset.draftBond);
      touchTraitDraft(draft);
      refreshCompletion();
    });
  });
  document.querySelector("#duplicate-draft-button").addEventListener("click", () => duplicateTraitDraft(draft));
  document.querySelector("#delete-draft-button").addEventListener("click", () => deleteTraitDraft(draft));
}

function renderTraitEditor() {
  if (app.traitWorkspace === "development") return renderTraitDraftEditor();
  if (app.traitWorkspace === "versus11") return renderVersusTraitEditor();
  const editor = document.querySelector("#trait-editor");
  const trait = app.state.traitCards.find((candidate) => candidate.id === app.selectedTraitId);
  if (!trait) {
    editor.innerHTML = '<div class="empty-state"><h2>选择一张特性卡</h2><p>你可以修改数值、适用位置、掉率和底层效果规则。</p></div>';
    return;
  }
  trait.bondIds = inferTraitBondIds(trait, app.state.bonds);
  if (!app.traitRuleDrafts.has(trait.id)) {
    app.traitRuleDrafts.set(trait.id, JSON.stringify(trait.rules ?? [], null, 2));
  }
  const roleText = trait.eligibleRoleGroups.map((role) => ROLE_GROUP_LABELS[role] ?? role).join(" · ");
  const bondText = trait.bondIds.map((id) => app.state.bonds.find((bond) => bond.id === id)?.name ?? id).join(" · ") || "未加入";
  editor.innerHTML =
    '<div class="editor-head">' +
      '<div class="card-preview ' + escapeHtml(trait.rarity) + '" id="trait-preview">' +
        '<span class="rarity-chip ' + escapeHtml(trait.rarity) + '" id="trait-preview-rarity">' + escapeHtml(RARITY_LABELS[trait.rarity]) + "</span>" +
        '<h3 id="trait-preview-name">' + escapeHtml(trait.name) + "</h3>" +
        '<p id="trait-preview-summary">' + escapeHtml(trait.summary) + "</p>" +
      "</div>" +
      '<div class="editor-title"><p class="panel-label">TRAIT CARD / ' + escapeHtml(trait.id) + "</p><h2>" + escapeHtml(trait.name) + "</h2><p>" + escapeHtml(roleText) + " · 羁绊 " + escapeHtml(bondText) + " · " + escapeHtml(trait.tags?.join(" / ") || "暂无标签") + "</p>" +
        '<div class="editor-actions"><button class="button ghost" id="duplicate-trait-button">复制卡牌</button><button class="button danger" id="delete-trait-button">删除</button></div>' +
      "</div>" +
    "</div>" +
    '<div class="form-grid">' +
      '<div class="field"><label for="trait-name-input">卡牌名称</label><input id="trait-name-input" value="' + escapeHtml(trait.name) + '" /></div>' +
      '<div class="field"><label for="trait-id-input">稳定 ID</label><input id="trait-id-input" value="' + escapeHtml(trait.id) + '" /><p class="field-help">修改后会自动更新所有球员引用。</p></div>' +
      '<div class="field"><span class="field-label">当前等级</span><div class="rarity-management-link"><b class="grade-' + escapeHtml(traitGrade(trait.rarity).toLowerCase()) + '">' + escapeHtml(traitGrade(trait.rarity)) + '</b><span>' + escapeHtml(RARITY_LABELS[trait.rarity]) + '</span><button class="text-button" type="button" id="open-rarity-board">前往等级看板</button></div><p class="field-help">正式卡等级统一通过拖拽管理。</p></div>' +
      '<div class="field"><label for="trait-category-input">类别</label><input id="trait-category-input" value="' + escapeHtml(trait.category) + '" placeholder="technique / mentality" /></div>' +
      '<div class="field"><label for="trait-weight-input">掉落权重</label><input id="trait-weight-input" type="number" min="0.01" max="100" step="0.05" value="' + escapeHtml(trait.dropWeight ?? 1) + '" /></div>' +
      '<div class="field"><label for="trait-polarity-input">性质</label><select id="trait-polarity-input"><option value="positive"' + (trait.polarity === "positive" ? " selected" : "") + '>正向</option><option value="mixed"' + (trait.polarity === "mixed" ? " selected" : "") + '>双刃</option><option value="negative"' + (trait.polarity === "negative" ? " selected" : "") + ">负面</option></select></div>" +
      '<div class="field span-2"><span class="field-label">适用位置</span><div class="checkbox-row">' + traitRoleCheckboxes(trait) + "</div></div>" +
      '<div class="field span-2"><span class="field-label">所属羁绊</span><div class="checkbox-row">' + traitBondCheckboxes(trait) + '</div><p class="field-help">羁绊归属统一在“羁绊设计”工作台通过拖拽维护。</p></div>' +
      '<div class="field span-2"><label for="trait-tags-input">标签</label><input id="trait-tags-input" value="' + escapeHtml((trait.tags ?? []).join(", ")) + '" placeholder="finishing, lateGame, tradeoff" /></div>' +
      '<div class="field span-2"><label for="trait-summary-input">玩家可见效果</label><textarea id="trait-summary-input">' + escapeHtml(trait.summary) + "</textarea></div>" +
      '<div class="field span-2"><label for="trait-rules-input">效果规则 JSON</label><textarea id="trait-rules-input" class="code-field" spellcheck="false">' + escapeHtml(app.traitRuleDrafts.get(trait.id)) + '</textarea><div class="json-helper-row"><p class="validation-message" id="trait-rules-validation">规则数组会随保存写入；静态属性规则可直接参与当前模拟。</p><button class="button ghost compact" type="button" id="infer-trait-rules">从效果描述提取基础规则</button></div></div>' +
    "</div>";

  const updatePreview = () => {
    document.querySelector("#trait-preview-name").textContent = trait.name;
    document.querySelector("#trait-preview-summary").textContent = trait.summary;
    const preview = document.querySelector("#trait-preview");
    preview.className = "card-preview " + trait.rarity;
    const chip = document.querySelector("#trait-preview-rarity");
    chip.className = "rarity-chip " + trait.rarity;
    chip.textContent = RARITY_LABELS[trait.rarity];
  };

  document.querySelector("#trait-name-input").addEventListener("input", (event) => {
    trait.name = event.target.value;
    updatePreview();
    markDirty();
    renderTraitList();
  });
  document.querySelector("#trait-id-input").addEventListener("change", (event) => changeTraitId(trait, event.target));
  document.querySelector("#open-rarity-board").addEventListener("click", () => switchView("ratings"));
  document.querySelector("#trait-category-input").addEventListener("input", (event) => { trait.category = event.target.value; markDirty(); });
  document.querySelector("#trait-weight-input").addEventListener("input", (event) => { trait.dropWeight = Number(event.target.value); markDirty(); });
  document.querySelector("#trait-polarity-input").addEventListener("change", (event) => { trait.polarity = event.target.value; markDirty(); });
  document.querySelector("#trait-tags-input").addEventListener("input", (event) => { trait.tags = event.target.value.split(",").map((value) => value.trim()).filter(Boolean); markDirty(); });
  document.querySelector("#trait-summary-input").addEventListener("input", (event) => { trait.summary = event.target.value; updatePreview(); markDirty(); });
  document.querySelectorAll("[data-trait-role]").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      let roles = [...document.querySelectorAll("[data-trait-role]:checked")].map((input) => input.dataset.traitRole);
      if (checkbox.dataset.traitRole === "ANY" && checkbox.checked) roles = ["ANY"];
      if (checkbox.dataset.traitRole !== "ANY" && checkbox.checked) roles = roles.filter((role) => role !== "ANY");
      if (roles.length === 0) {
        checkbox.checked = true;
        showToast("至少保留一个适用位置", "error");
        return;
      }
      trait.eligibleRoleGroups = roles;
      renderTraitEditor();
      renderTraitList();
      markDirty();
    });
  });
  document.querySelector("#trait-rules-input").addEventListener("input", (event) => {
    app.traitRuleDrafts.set(trait.id, event.target.value);
    const message = document.querySelector("#trait-rules-validation");
    try {
      const parsed = JSON.parse(event.target.value);
      if (!Array.isArray(parsed)) throw new Error("必须是数组");
      event.target.classList.remove("invalid");
      message.className = "validation-message";
      message.textContent = "规则 JSON 有效，共 " + parsed.length + " 条。";
    } catch (error) {
      event.target.classList.add("invalid");
      message.className = "validation-message error";
      message.textContent = error.message;
    }
    markDirty();
  });
  document.querySelector("#infer-trait-rules").addEventListener("click", () => {
    const rules = inferAttributeRulesFromSummary(trait);
    if (!rules.length) return showToast("描述中没有识别到“属性名称 + 数值”的明确规则", "error");
    const draft = JSON.stringify(rules, null, 2);
    app.traitRuleDrafts.set(trait.id, draft);
    document.querySelector("#trait-rules-input").value = draft;
    document.querySelector("#trait-rules-input").dispatchEvent(new Event("input", { bubbles: true }));
    showToast("已提取基础属性规则，请确认后保存");
  });
  document.querySelector("#duplicate-trait-button").addEventListener("click", () => duplicateTrait(trait));
  document.querySelector("#delete-trait-button").addEventListener("click", () => deleteTrait(trait));
}

function renderVersusTraitEditor() {
  const editor = document.querySelector("#trait-editor");
  const trait = app.versusTraits.find((candidate) => candidate.id === app.selectedVersusTraitId);
  if (!trait) {
    editor.innerHTML = '<div class="empty-state"><h2>选择一张11人制特性卡</h2><p>这里展示对战模式实际使用的独立卡池。</p></div>';
    return;
  }
  const roles = (trait.eligibleRoleGroups ?? []).map((role) => ROLE_GROUP_LABELS[role] ?? role).join(" · ");
  const sourceLabel = trait.source === "versus11-new" ? "11人制新增" : "7人制适配";
  editor.innerHTML = `<div class="versus-source-banner"><b>${escapeHtml(sourceLabel)}</b><span>仅进入11人制好友对战卡池</span></div>
    <div class="editor-head">
      <div class="card-preview ${escapeHtml(trait.rarity)}"><span class="rarity-chip ${escapeHtml(trait.rarity)}">${escapeHtml(RARITY_LABELS[trait.rarity])}</span><span class="mode-chip">${escapeHtml(trait.developerLabel)}</span><h3>${escapeHtml(trait.name)}</h3><p>${escapeHtml(trait.summary)}</p></div>
      <div class="editor-title"><p class="panel-label">11V11 TRAIT / ${escapeHtml(trait.id)}</p><h2>${escapeHtml(trait.name)}</h2><p>${escapeHtml(roles)} · ${escapeHtml(trait.category)} · ${escapeHtml((trait.tags ?? []).join(" / "))}</p></div>
    </div>
    <div class="form-grid versus-readonly-grid">
      <div class="field"><span class="field-label">来源标记</span><div class="readonly-value"><b>${escapeHtml(sourceLabel)}</b><small>${escapeHtml(trait.introducedIn ?? "versus11-adaptation")}</small></div></div>
      <div class="field"><span class="field-label">等级与掉落权重</span><div class="readonly-value"><b>${escapeHtml(RARITY_LABELS[trait.rarity])}</b><small>权重 ${escapeHtml(trait.dropWeight)}</small></div></div>
      <div class="field span-2"><span class="field-label">适用位置</span><div class="checkbox-row">${(trait.eligibleRoleGroups ?? []).map((role) => `<span class="membership-pill">${escapeHtml(ROLE_GROUP_LABELS[role] ?? role)}</span>`).join("")}</div></div>
      <div class="field span-2"><span class="field-label">玩家可见效果</span><div class="readonly-copy">${escapeHtml(trait.summary)}</div></div>
      <div class="field span-2"><span class="field-label">实际效果规则</span><pre class="readonly-code">${escapeHtml(JSON.stringify(trait.rules ?? [], null, 2))}</pre></div>
    </div>`;
}

function changeTraitId(trait, input) {
  const nextId = input.value.trim();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(nextId)) {
    input.value = trait.id;
    showToast("稳定 ID 只能使用小写字母、数字和连字符", "error");
    return;
  }
  if (
    app.state.traitCards.some((candidate) => candidate !== trait && candidate.id === nextId) ||
    app.state.traitDrafts.some((candidate) => candidate.id === nextId)
  ) {
    input.value = trait.id;
    showToast("这个特性 ID 已经存在", "error");
    return;
  }
  const previousId = trait.id;
  trait.id = nextId;
  for (const player of app.state.players) {
    player.traitCards = (player.traitCards ?? []).map((id) => id === previousId ? nextId : id);
  }
  for (const bond of app.state.bonds) {
    bond.traitIds = bond.traitIds.map((id) => id === previousId ? nextId : id);
  }
  if (app.traitRuleDrafts.has(previousId)) {
    const draft = app.traitRuleDrafts.get(previousId);
    app.traitRuleDrafts.delete(previousId);
    app.traitRuleDrafts.set(nextId, draft);
  }
  app.selectedTraitId = nextId;
  markDirty();
  renderTraitList();
  renderTraitEditor();
}

function switchTraitWorkspace(workspace) {
  if (!Object.hasOwn({ formal: true, development: true, versus11: true }, workspace)) return;
  app.traitWorkspace = workspace;
  if (workspace === "development" && !app.selectedTraitDraftId) {
    app.selectedTraitDraftId = app.state.traitDrafts[0]?.id ?? null;
  }
  if (workspace === "versus11" && !app.selectedVersusTraitId) app.selectedVersusTraitId = app.versusTraits[0]?.id ?? null;
  renderTraits();
}

function addTraitDraft() {
  const ids = new Set([
    ...app.state.traitCards.map((trait) => trait.id),
    ...app.state.traitDrafts.map((trait) => trait.id),
  ]);
  const now = new Date().toISOString();
  const draft = {
    id: uniqueId("draft-trait", ids),
    name: "",
    status: "concept",
    rarity: "",
    category: "",
    eligibleRoleGroups: [],
    tags: [],
    bondIds: [],
    polarity: "",
    summary: "",
    designNotes: "",
    rulesDraft: "",
    implementationNotes: "",
    testNotes: "",
    dropWeight: null,
    createdAt: now,
    updatedAt: now,
  };
  app.state.traitDrafts.unshift(draft);
  app.selectedTraitDraftId = draft.id;
  markDirty();
  renderTraits();
  document.querySelector("#draft-name-input")?.focus();
}

function duplicateTraitDraft(source) {
  const ids = new Set([
    ...app.state.traitCards.map((trait) => trait.id),
    ...app.state.traitDrafts.map((trait) => trait.id),
  ]);
  const now = new Date().toISOString();
  const copy = clone(source);
  copy.id = uniqueId(source.id + "-copy", ids);
  copy.name = source.name?.trim() ? source.name + "·副本" : "";
  copy.status = "incomplete";
  copy.createdAt = now;
  copy.updatedAt = now;
  app.state.traitDrafts.unshift(copy);
  app.selectedTraitDraftId = copy.id;
  markDirty();
  renderTraits();
}

function deleteTraitDraft(draft) {
  const name = draft.name?.trim() || "未命名开发卡";
  if (!window.confirm("确认删除开发中草稿“" + name + "”？这不会影响正式卡池。")) return;
  app.state.traitDrafts = app.state.traitDrafts.filter((candidate) => candidate.id !== draft.id);
  app.selectedTraitDraftId = app.state.traitDrafts[0]?.id ?? null;
  markDirty();
  renderTraits();
}

function addTrait() {
  if (app.traitWorkspace === "development") return addTraitDraft();
  if (app.traitWorkspace === "versus11") return;
  const ids = new Set([...app.state.traitCards, ...app.state.traitDrafts].map((trait) => trait.id));
  const id = uniqueId("trait", ids);
  const trait = {
    id,
    name: "新特性",
    rarity: "common",
    category: "technique",
    eligibleRoleGroups: ["ANY"],
    tags: [],
    bondIds: [],
    polarity: "positive",
    summary: "填写玩家可见的特性效果。",
    rules: [],
    dropWeight: 1,
    maxLevel: 1,
  };
  app.state.traitCards.unshift(trait);
  app.selectedTraitId = id;
  app.traitRuleDrafts.set(id, "[]");
  markDirty();
  renderTraits();
}

function duplicateTrait(source) {
  const ids = new Set([...app.state.traitCards, ...app.state.traitDrafts].map((trait) => trait.id));
  const copy = clone(source);
  copy.id = uniqueId(source.id + "-copy", ids);
  copy.name = source.name + "·副本";
  app.state.traitCards.unshift(copy);
  app.traitRuleDrafts.set(copy.id, JSON.stringify(copy.rules, null, 2));
  app.selectedTraitId = copy.id;
  markDirty();
  renderTraits();
}

function deleteTrait(trait) {
  const equipped = app.state.players.filter((player) => player.traitCards?.includes(trait.id));
  const message = equipped.length
    ? "这张卡已被 " + equipped.length + " 名球员装备。删除后会从这些球员身上移除，确认继续？"
    : "确认删除“" + trait.name + "”？";
  if (!window.confirm(message)) return;
  app.state.traitCards = app.state.traitCards.filter((candidate) => candidate.id !== trait.id);
  for (const player of app.state.players) {
    player.traitCards = (player.traitCards ?? []).filter((id) => id !== trait.id);
  }
  for (const bond of app.state.bonds) bond.traitIds = bond.traitIds.filter((id) => id !== trait.id);
  app.traitRuleDrafts.delete(trait.id);
  app.selectedTraitId = app.state.traitCards[0]?.id ?? null;
  markDirty();
  renderTraits();
}

function renderTraits() {
  renderTraitWorkspaceControls();
  renderTraitSummary();
  renderTraitList();
  renderTraitEditor();
}

function renderPlayerSummary() {
  const lineup = app.state.players.filter((player) => player.squadStatus === "lineup").length;
  const averageOverall = app.state.players.length
    ? Math.round(app.state.players.reduce((sum, player) => sum + overall(player), 0) / app.state.players.length)
    : 0;
  document.querySelector("#player-summary").innerHTML =
    summaryCell("球员卡总数", app.state.players.length) +
    summaryCell("球队数量", app.state.teams.length) +
    summaryCell("首发球员", lineup) +
    summaryCell("平均综合", averageOverall);
}

function renderPlayerTeamFilter() {
  const select = document.querySelector("#player-team-filter");
  const previous = select.value || "all";
  select.innerHTML = '<option value="all">全部球队</option>' + app.state.teams.map((team) => '<option value="' + escapeHtml(team.id) + '">' + escapeHtml(team.name) + "</option>").join("");
  select.value = app.state.teams.some((team) => team.id === previous) ? previous : "all";
}

function playerMatchesFilter(player) {
  const query = document.querySelector("#player-search").value.trim().toLowerCase();
  const teamId = document.querySelector("#player-team-filter").value;
  const group = document.querySelector("#player-role-filter").value;
  const team = app.state.teams.find((candidate) => candidate.id === player.teamId);
  const haystack = [player.name, player.id, player.role, team?.name, ...(player.traitCards ?? [])].join(" ").toLowerCase();
  return (
    (!query || haystack.includes(query)) &&
    (teamId === "all" || player.teamId === teamId) &&
    (group === "all" || player.role === group || roleGroup(player.role) === group)
  );
}

function renderPlayerList() {
  const list = document.querySelector("#player-list");
  const players = app.state.players.filter(playerMatchesFilter);
  if (players.length === 0) {
    list.innerHTML = '<div class="empty-state"><p>没有符合当前筛选的球员。</p></div>';
    return;
  }
  list.innerHTML = players.map((player) => {
    const team = app.state.teams.find((candidate) => candidate.id === player.teamId);
    return (
      '<button class="list-item player-list-item ' + (player.id === app.selectedPlayerId ? "active" : "") + '" data-player-id="' + escapeHtml(player.id) + '">' +
      '<span class="player-row-avatar">' + escapeHtml(initials(player.name)) + "</span>" +
      '<span class="list-copy"><strong>' + escapeHtml(player.name) + "</strong><small>" + escapeHtml(team?.name ?? "无球队") + " · " + escapeHtml(player.role) + " · " + escapeHtml(player.squadStatus) + "</small></span>" +
      '<span class="list-meta">' + overall(player) + "</span></button>"
    );
  }).join("");
  list.querySelectorAll("[data-player-id]").forEach((button) => {
    button.addEventListener("click", () => {
      app.selectedPlayerId = button.dataset.playerId;
      renderPlayerList();
      renderPlayerEditor();
    });
  });
}

function attributeControl(player, name) {
  const value = Number(player.attributes?.[name] ?? 50);
  return (
    '<div class="attribute-control"><label for="attr-' + name + '">' + escapeHtml(ATTRIBUTE_LABELS[name] ?? name) + "</label>" +
    '<input id="attr-' + name + '" type="range" min="1" max="99" value="' + value + '" data-attribute-range="' + name + '" style="--range-progress:' + value + '%" />' +
    '<input type="number" min="1" max="99" value="' + value + '" data-attribute-number="' + name + '" /></div>'
  );
}

function stateControl(player, name, label, min = 0, max = 100) {
  const value = Number(player.state?.[name] ?? 50);
  return (
    '<div class="attribute-control"><label for="state-' + name + '">' + label + "</label>" +
    '<input id="state-' + name + '" type="range" min="' + min + '" max="' + max + '" value="' + value + '" data-state-range="' + name + '" style="--range-progress:' + value + '%" />' +
    '<input type="number" min="' + min + '" max="' + max + '" value="' + value + '" data-state-number="' + name + '" /></div>'
  );
}

function systemNumberControl(player, group, name, label, min = 0, max = 100) {
  const value = Number(player[group]?.[name] ?? 50);
  return `<div class="attribute-control"><label for="system-${group}-${name}">${label}</label><input id="system-${group}-${name}" type="range" min="${min}" max="${max}" value="${value}" data-system-range="${group}:${name}" style="--range-progress:${Math.max(0, Math.min(100, ((value - min) / Math.max(1, max - min)) * 100))}%" /><input type="number" min="${min}" max="${max}" value="${value}" data-system-number="${group}:${name}" /></div>`;
}

function eligibleTraitsForPlayer(player) {
  const group = roleGroup(player.role);
  return app.state.traitCards.filter((trait) => trait.eligibleRoleGroups.includes("ANY") || trait.eligibleRoleGroups.includes(group));
}

function traitSlotsHtml(player) {
  const equipped = player.traitCards ?? [];
  const eligible = eligibleTraitsForPlayer(player);
  return [0, 1, 2].map((index) => {
    const current = equipped[index] ?? "";
    const options = eligible
      .filter((trait) => trait.id === current || !equipped.includes(trait.id))
      .map((trait) => '<option value="' + escapeHtml(trait.id) + '"' + (trait.id === current ? " selected" : "") + ">[" + escapeHtml(RARITY_LABELS[trait.rarity]) + "] " + escapeHtml(trait.name) + "</option>")
      .join("");
    return '<div class="trait-slot"><span>SLOT 0' + (index + 1) + '</span><select class="trait-slot-select" data-trait-slot="' + index + '"><option value="">未装备</option>' + options + "</select></div>";
  }).join("");
}

function renderPlayerEditor() {
  const editor = document.querySelector("#player-editor");
  const player = app.state.players.find((candidate) => candidate.id === app.selectedPlayerId);
  if (!player) {
    editor.innerHTML = '<div class="empty-state"><h2>选择一名球员</h2><p>调整球员能力、即时状态、所在球队和特性槽。</p></div>';
    return;
  }
  const team = app.state.teams.find((candidate) => candidate.id === player.teamId);
  const teamOptions = app.state.teams.map((candidate) => '<option value="' + escapeHtml(candidate.id) + '"' + (candidate.id === player.teamId ? " selected" : "") + ">" + escapeHtml(candidate.name) + "</option>").join("");
  const roleOptions = ROLES.map((role) => '<option value="' + role + '"' + (player.role === role ? " selected" : "") + ">" + ROLE_LABELS[role] + "（" + role + "）</option>").join("");
  const secondaryOptions = '<option value="">无副位置</option>' + ROLES.filter((role) => role !== "GK" && role !== player.role).map((role) => '<option value="' + role + '"' + (player.secondaryRole === role ? " selected" : "") + ">" + ROLE_LABELS[role] + "（" + role + "）</option>").join("");
  editor.innerHTML = `
    <div class="editor-head">
      <div class="editor-title player-hero">
        <div class="player-avatar">${escapeHtml(initials(player.name))}</div>
        <div>
          <p class="panel-label">PLAYER CARD / ${escapeHtml(player.id)}</p>
          <h2>${escapeHtml(player.name)}</h2>
          <p>${escapeHtml(team?.name ?? "无球队")} · ${escapeHtml(player.role)} · ${player.traitCards?.length ?? 0} 项特性</p>
        </div>
        <div class="player-overall"><strong>${overall(player)}</strong><span>OVERALL</span></div>
      </div>
      <div class="editor-actions">
        <button class="button ghost" id="duplicate-player-button">复制球员</button>
        <button class="button danger" id="delete-player-button">删除</button>
      </div>
    </div>
    <div class="form-section">
      <div class="form-section-head"><h3>基础资料</h3><span>IDENTITY & ROSTER</span></div>
      <div class="form-grid">
        <div class="field"><label for="player-name-input">姓名</label><input id="player-name-input" value="${escapeHtml(player.name)}" /></div>
        <div class="field"><label for="player-role-input">主位置</label><select id="player-role-input">${roleOptions}</select></div>
        <div class="field"><label for="player-secondary-role-input">副位置</label><select id="player-secondary-role-input" ${player.role === "GK" ? "disabled" : ""}>${secondaryOptions}</select></div>
        <div class="field"><label for="player-team-input">球队</label><select id="player-team-input">${teamOptions}</select></div>
        <div class="field"><label for="player-status-input">阵容状态</label><select id="player-status-input">
          <option value="lineup"${player.squadStatus === "lineup" ? " selected" : ""}>首发</option>
          <option value="bench"${player.squadStatus === "bench" ? " selected" : ""}>替补</option>
          <option value="reserve"${player.squadStatus === "reserve" ? " selected" : ""}>预备</option>
        </select></div>
        <div class="field"><label for="player-foot-input">惯用脚</label><select id="player-foot-input">
          <option value="right"${player.preferredFoot === "right" ? " selected" : ""}>右脚</option>
          <option value="left"${player.preferredFoot === "left" ? " selected" : ""}>左脚</option>
          <option value="both"${player.preferredFoot === "both" ? " selected" : ""}>双足</option>
        </select></div>
        <div class="field"><label for="player-height-input">身高（cm）</label><input id="player-height-input" type="number" min="140" max="220" value="${escapeHtml(player.heightCm ?? 180)}" /></div>
      </div>
    </div>
    <div class="form-section"><div class="form-section-head"><h3>特性槽</h3><span>MAX 3</span></div><div class="trait-slots">${traitSlotsHtml(player)}</div></div>
    <div class="form-section"><div class="form-section-head"><h3>即时状态</h3><span>MATCH CONDITION</span></div><div class="attribute-grid">
      ${stateControl(player, "fitness", "体能")}
      ${stateControl(player, "form", "状态")}
      ${stateControl(player, "morale", "状态")}
      ${stateControl(player, "injuryProneness", "受伤倾向")}
    </div></div>
    <div class="form-section"><div class="form-section-head"><h3>伤病与成长</h3><span>MEDICAL & DEVELOPMENT</span></div>
      <div class="form-grid">
        <div class="field"><label for="player-injury-severity">伤病状态</label><select id="player-injury-severity">${Object.entries(INJURY_PROFILES).map(([id, profile]) => `<option value="${id}"${player.state.injury.severity === id ? " selected" : ""}>${profile.label}${profile.unavailable ? "（不可出场）" : ""}</option>`).join("")}</select></div>
        <div class="field"><label for="player-injury-matches">预计剩余场次</label><input id="player-injury-matches" type="number" min="0" max="20" value="${player.state.injury.matchesRemaining}" /></div>
        <div class="field"><label for="player-age-input">年龄</label><input id="player-age-input" type="number" min="16" max="40" value="${player.development.age}" /></div>
        <div class="field"><label for="player-potential-input">潜力</label><input id="player-potential-input" type="number" min="40" max="99" value="${player.development.potential}" /></div>
        <div class="field"><label for="player-experience-input">成长经验</label><input id="player-experience-input" type="number" min="0" max="9999" value="${player.development.experience}" /></div>
        <div class="field"><label for="player-growth-rate-input">成长效率</label><input id="player-growth-rate-input" type="number" min="35" max="130" value="${player.development.growthRate}" /></div>
      </div>
    </div>
    <div class="form-section"><div class="form-section-head"><h3>隐藏性格</h3><span>DEVELOPER ONLY</span></div>
      <div class="form-grid"><div class="field"><label for="player-personality-input">性格原型</label><select id="player-personality-input">${Object.entries(PERSONALITY_PROFILES).map(([id, profile]) => `<option value="${id}"${player.hidden.personality === id ? " selected" : ""}>${profile.label}</option>`).join("")}</select></div></div>
      <div class="attribute-grid">
        ${systemNumberControl(player, "hidden", "mentality", "精神力")}
        ${systemNumberControl(player, "hidden", "professionalism", "职业素养")}
        ${systemNumberControl(player, "hidden", "ambition", "雄心")}
        ${systemNumberControl(player, "hidden", "consistency", "稳定性")}
        ${systemNumberControl(player, "hidden", "pressure", "抗压")}
        ${systemNumberControl(player, "hidden", "teamwork", "团队意识")}
        ${systemNumberControl(player, "hidden", "leadership", "领导力")}
        ${systemNumberControl(player, "hidden", "volatility", "情绪波动")}
        ${systemNumberControl(player, "hidden", "injuryResistance", "抗伤能力")}
      </div>
    </div>
    ${ATTRIBUTE_GROUPS.map((group) => `<div class="form-section"><div class="form-section-head"><h3>${group.name}</h3><span>${group.fields.length} ATTRIBUTES</span></div><div class="attribute-grid">${group.fields.map((name) => attributeControl(player, name)).join("")}</div></div>`).join("")}
  `;

  document.querySelector("#player-name-input").addEventListener("input", (event) => { player.name = event.target.value; markDirty(); renderPlayerList(); });
  document.querySelector("#player-role-input").addEventListener("change", (event) => {
    player.role = event.target.value;
    if (player.role === "GK" || player.secondaryRole === player.role) player.secondaryRole = null;
    const eligibleIds = new Set(eligibleTraitsForPlayer(player).map((trait) => trait.id));
    const removed = (player.traitCards ?? []).filter((id) => !eligibleIds.has(id));
    player.traitCards = (player.traitCards ?? []).filter((id) => eligibleIds.has(id));
    markDirty();
    renderPlayers();
    if (removed.length) showToast("已移除 " + removed.length + " 张不再适配新位置的特性卡");
  });
  document.querySelector("#player-secondary-role-input").addEventListener("change", (event) => {
    player.secondaryRole = event.target.value || null;
    markDirty();
  });
  document.querySelector("#player-team-input").addEventListener("change", (event) => {
    player.teamId = event.target.value;
    synchronizePlayerRoster(player);
    markDirty();
    renderPlayers();
  });
  document.querySelector("#player-status-input").addEventListener("change", (event) => {
    player.squadStatus = event.target.value;
    synchronizePlayerRoster(player);
    markDirty();
    renderPlayerSummary();
    renderPlayerList();
  });
  document.querySelector("#player-foot-input").addEventListener("change", (event) => { player.preferredFoot = event.target.value; markDirty(); });
  document.querySelector("#player-height-input").addEventListener("input", (event) => { player.heightCm = Number(event.target.value); markDirty(); });
  document.querySelector("#player-injury-severity").addEventListener("change", (event) => {
    player.state.injury.severity = event.target.value;
    if (event.target.value === "none") player.state.injury.matchesRemaining = 0;
    else if (player.state.injury.matchesRemaining <= 0) player.state.injury.matchesRemaining = 1;
    player.state.injury.totalMatches = Math.max(player.state.injury.totalMatches ?? 0, player.state.injury.matchesRemaining);
    markDirty(); renderPlayerEditor();
  });
  document.querySelector("#player-injury-matches").addEventListener("input", (event) => {
    player.state.injury.matchesRemaining = Math.max(0, Math.min(20, Number(event.target.value)));
    if (player.state.injury.matchesRemaining === 0) player.state.injury.severity = "none";
    markDirty();
  });
  document.querySelector("#player-age-input").addEventListener("input", (event) => { player.development.age = Math.max(16, Math.min(40, Number(event.target.value))); markDirty(); });
  document.querySelector("#player-potential-input").addEventListener("input", (event) => { player.development.potential = Math.max(40, Math.min(99, Number(event.target.value))); markDirty(); });
  document.querySelector("#player-experience-input").addEventListener("input", (event) => { player.development.experience = Math.max(0, Number(event.target.value)); markDirty(); });
  document.querySelector("#player-growth-rate-input").addEventListener("input", (event) => { player.development.growthRate = Math.max(35, Math.min(130, Number(event.target.value))); markDirty(); });
  document.querySelector("#player-personality-input").addEventListener("change", (event) => { player.hidden.personality = event.target.value; markDirty(); });

  document.querySelectorAll("[data-attribute-range], [data-attribute-number]").forEach((input) => {
    input.addEventListener("input", () => {
      const name = input.dataset.attributeRange ?? input.dataset.attributeNumber;
      const value = Math.max(1, Math.min(99, Number(input.value)));
      player.attributes[name] = value;
      const range = document.querySelector('[data-attribute-range="' + name + '"]');
      const number = document.querySelector('[data-attribute-number="' + name + '"]');
      range.value = value;
      range.style.setProperty("--range-progress", value + "%");
      number.value = value;
      markDirty();
    });
  });
  document.querySelectorAll("[data-state-range], [data-state-number]").forEach((input) => {
    input.addEventListener("input", () => {
      const name = input.dataset.stateRange ?? input.dataset.stateNumber;
      const value = Math.max(0, Math.min(100, Number(input.value)));
      player.state[name] = value;
      const range = document.querySelector('[data-state-range="' + name + '"]');
      const number = document.querySelector('[data-state-number="' + name + '"]');
      range.value = value;
      range.style.setProperty("--range-progress", value + "%");
      number.value = value;
      markDirty();
    });
  });
  document.querySelectorAll("[data-system-range], [data-system-number]").forEach((input) => {
    input.addEventListener("input", () => {
      const path = input.dataset.systemRange ?? input.dataset.systemNumber;
      const [group, name] = path.split(":");
      const value = Math.max(0, Math.min(100, Number(input.value)));
      player[group][name] = value;
      const range = document.querySelector(`[data-system-range="${path}"]`);
      const number = document.querySelector(`[data-system-number="${path}"]`);
      range.value = value;
      range.style.setProperty("--range-progress", value + "%");
      number.value = value;
      markDirty();
    });
  });
  document.querySelectorAll("[data-trait-slot]").forEach((select) => {
    select.addEventListener("change", () => {
      const slots = [...document.querySelectorAll("[data-trait-slot]")].map((item) => item.value).filter(Boolean);
      player.traitCards = [...new Set(slots)];
      markDirty();
      renderPlayerEditor();
      renderTraitSummary();
      renderPlayerList();
    });
  });
  document.querySelector("#duplicate-player-button").addEventListener("click", () => duplicatePlayer(player));
  document.querySelector("#delete-player-button").addEventListener("click", () => deletePlayer(player));
}

function synchronizePlayerRoster(player) {
  for (const team of app.state.teams) {
    team.lineupIds = (team.lineupIds ?? []).filter((id) => id !== player.id);
    team.benchIds = (team.benchIds ?? []).filter((id) => id !== player.id);
  }
  const team = app.state.teams.find((candidate) => candidate.id === player.teamId);
  if (!team) return;
  if (player.squadStatus === "lineup") team.lineupIds.push(player.id);
  if (player.squadStatus === "bench") team.benchIds.push(player.id);
}

function createBlankAttributes() {
  return Object.fromEntries(Object.keys(ATTRIBUTE_LABELS).map((name) => [name, name === "goalkeeping" || name === "reflexes" ? 10 : 50]));
}

function addPlayer() {
  const ids = new Set(app.state.players.map((player) => player.id));
  const team = app.state.teams[0];
  const player = normalizePlayerSchema({
    id: uniqueId("player", ids),
    name: "新球员",
    teamId: team?.id ?? null,
    squadStatus: "reserve",
    role: "DM",
    secondaryRole: "LM",
    preferredFoot: "right",
    heightCm: 180,
    attributes: createBlankAttributes(),
    state: { fitness: 100, form: 50, morale: 50, injuryProneness: 30 },
    traitCards: [],
    legacyTraits: [],
  });
  app.state.players.unshift(player);
  app.selectedPlayerId = player.id;
  markDirty();
  renderPlayers();
}

function duplicatePlayer(source) {
  const ids = new Set(app.state.players.map((player) => player.id));
  const player = clone(source);
  player.id = uniqueId("player", ids);
  player.name = source.name + "·副本";
  player.squadStatus = "reserve";
  app.state.players.unshift(player);
  app.selectedPlayerId = player.id;
  markDirty();
  renderPlayers();
}

function deletePlayer(player) {
  if (!window.confirm("确认删除球员“" + player.name + "”？阵容引用也会一并移除。")) return;
  app.state.players = app.state.players.filter((candidate) => candidate.id !== player.id);
  for (const team of app.state.teams) {
    team.lineupIds = team.lineupIds.filter((id) => id !== player.id);
    team.benchIds = team.benchIds.filter((id) => id !== player.id);
  }
  app.selectedPlayerId = app.state.players[0]?.id ?? null;
  markDirty();
  renderPlayers();
}

function renderPlayers() {
  renderPlayerSummary();
  renderPlayerTeamFilter();
  renderPlayerList();
  renderPlayerEditor();
}

function globalConfigNumberField(label, path, value, { min = 0, max = 100, step = 1, scale = 1, suffix = "" } = {}) {
  const displayed = Number((Number(value) * scale).toFixed(4));
  return '<label class="global-config-field"><span>' + escapeHtml(label) + '</span><div><input type="number" min="' + min + '" max="' + max + '" step="' + step + '" value="' + displayed + '" data-global-path="' + escapeHtml(path) + '" data-global-scale="' + scale + '" /><small>' + escapeHtml(suffix) + '</small></div></label>';
}

function updateGlobalConfigSummary() {
  const summary = document.querySelector("#global-config-summary");
  if (!summary) return;
  const config = normalizeGameConfig(app.state.globalConfig);
  const total = Object.values(config.weatherWeights).reduce((sum, value) => sum + value, 0);
  const probability = (key) => total > 0 ? Math.round((config.weatherWeights[key] / total) * 1000) / 10 : 0;
  summary.innerHTML =
    summaryCell("天气分布", `晴 ${probability("sunny")}% · 雨 ${probability("rain")}% · 雷 ${probability("storm")}% · 雪 ${probability("snow")}%`) +
    summaryCell("雷击/推进", `${(config.lightning.chance * 100).toFixed(1)}%`) +
    summaryCell("裁判严格范围", `${config.referee.strictnessMin}—${config.referee.strictnessMax}`) +
    summaryCell("第1关胜利金币", `${config.economy.victoryBaseGold + config.economy.victoryGoldPerStage} G`);
}

function renderGlobalSettings() {
  if (!app.state) return;
  app.state.globalConfig = normalizeGameConfig(app.state.globalConfig);
  const config = app.state.globalConfig;
  const container = document.querySelector("#global-settings-form");
  if (!container) return;
  container.innerHTML =
    '<section class="global-config-hero"><div><p class="eyebrow">PLAYER RUNTIME SOURCE</p><h2>玩家比赛全局参数</h2><p>保存后，冠军之路的新比赛会读取这些值；已经开始的比赛不会被中途改写。</p></div><button class="button ghost" id="reset-global-config">恢复推荐值</button></section>' +
    '<div class="summary-strip" id="global-config-summary"></div>' +
    '<div class="global-config-grid">' +
      '<article class="global-config-panel"><header><span>01</span><div><h3>天气权重</h3><p>四项可以使用任意正权重，玩家侧会按总和换算实际概率。</p></div></header><div class="global-field-grid">' +
        globalConfigNumberField("晴天", "weatherWeights.sunny", config.weatherWeights.sunny, { max: 1000, suffix: "权重" }) +
        globalConfigNumberField("雨天", "weatherWeights.rain", config.weatherWeights.rain, { max: 1000, suffix: "权重" }) +
        globalConfigNumberField("雷暴", "weatherWeights.storm", config.weatherWeights.storm, { max: 1000, suffix: "权重" }) +
        globalConfigNumberField("雪天", "weatherWeights.snow", config.weatherWeights.snow, { max: 1000, suffix: "权重" }) +
      '</div></article>' +
      '<article class="global-config-panel"><header><span>02</span><div><h3>雷击强度</h3><p>概率按每次推进抽取；命中后固定重伤5场，体力与状态损失区间进入共享比赛模型。</p></div></header><div class="global-field-grid">' +
        globalConfigNumberField("触发概率", "lightning.chance", config.lightning.chance, { min: 0, max: 5, step: 0.1, scale: 100, suffix: "% / 推进" }) +
        globalConfigNumberField("体能损失下限", "lightning.fitnessLossMin", config.lightning.fitnessLossMin, { max: 100, suffix: "点" }) +
        globalConfigNumberField("体能损失上限", "lightning.fitnessLossMax", config.lightning.fitnessLossMax, { max: 100, suffix: "点" }) +
        globalConfigNumberField("状态损失下限", "lightning.moraleLossMin", config.lightning.moraleLossMin, { max: 100, suffix: "点" }) +
        globalConfigNumberField("状态损失上限", "lightning.moraleLossMax", config.lightning.moraleLossMax, { max: 100, suffix: "点" }) +
      '</div></article>' +
      '<article class="global-config-panel"><header><span>03</span><div><h3>裁判参与度</h3><p>每场比赛在下限与上限之间生成主裁参数。</p></div></header><div class="global-field-grid">' +
        globalConfigNumberField("严格度下限", "referee.strictnessMin", config.referee.strictnessMin) +
        globalConfigNumberField("严格度上限", "referee.strictnessMax", config.referee.strictnessMax) +
        globalConfigNumberField("点球倾向下限", "referee.penaltyBiasMin", config.referee.penaltyBiasMin) +
        globalConfigNumberField("点球倾向上限", "referee.penaltyBiasMax", config.referee.penaltyBiasMax) +
        globalConfigNumberField("主场倾向下限", "referee.homeBiasMin", config.referee.homeBiasMin) +
        globalConfigNumberField("主场倾向上限", "referee.homeBiasMax", config.referee.homeBiasMax) +
      '</div></article>' +
      '<article class="global-config-panel"><header><span>04</span><div><h3>胜利金币公式</h3><p>实际奖励 = 基础金币 + 当前关卡 × 每关增量。</p></div></header><div class="global-field-grid">' +
        globalConfigNumberField("基础金币", "economy.victoryBaseGold", config.economy.victoryBaseGold, { max: 100000, suffix: "G" }) +
        globalConfigNumberField("每关增量", "economy.victoryGoldPerStage", config.economy.victoryGoldPerStage, { max: 10000, suffix: "G / 关" }) +
      '</div><p class="global-formula">当前公式：<b>' + config.economy.victoryBaseGold + ' + 关卡 × ' + config.economy.victoryGoldPerStage + '</b></p></article>' +
    '</div><p class="global-config-note">上下限填反时，保存会自动交换；所有值都会限制在安全范围内。点击右上角“保存全部”后生效。</p>';

  updateGlobalConfigSummary();
  container.querySelectorAll("[data-global-path]").forEach((input) => input.addEventListener("input", () => {
    const scale = Number(input.dataset.globalScale) || 1;
    setPath(app.state.globalConfig, input.dataset.globalPath, Number(input.value) / scale);
    markDirty();
    updateGlobalConfigSummary();
  }));
  document.querySelector("#reset-global-config").addEventListener("click", () => {
    app.state.globalConfig = clone(DEFAULT_GAME_CONFIG);
    markDirty();
    renderGlobalSettings();
  });
}

function initializeSimulationConfig() {
  const preset = app.state.simulationPresets[0];
  const homeTeam = app.state.teams.find((team) => team.id === preset?.homeTeamId) ?? app.state.teams[0];
  const awayTeam = app.state.teams.find((team) => team.id === preset?.awayTeamId) ?? app.state.teams[1] ?? app.state.teams[0];
  app.simulationConfig = {
    presetId: preset?.id,
    homeTeamId: homeTeam?.id,
    awayTeamId: awayTeam?.id,
    seed: preset?.seed ?? "devtool",
    matches: preset?.matches ?? 500,
    context: clone(preset?.context ?? {}),
    homeOverride: teamOverrideFrom(homeTeam),
    awayOverride: teamOverrideFrom(awayTeam),
  };
  app.simulationConfig.context.weather = {
    ...WEATHER_PRESETS.sunny,
    ...(app.simulationConfig.context.weather ?? {}),
  };
}

function teamOverrideFrom(team) {
  if (!team) return {};
  return {
    formation: clone(team.formation ?? {}),
    tactics: clone(team.tactics ?? {}),
    coach: clone(team.coach ?? {}),
    chemistry: team.chemistry ?? 50,
    morale: team.morale ?? 50,
    form: team.form ?? 50,
  };
}

function teamOptions(selected) {
  return app.state.teams.map((team) => '<option value="' + escapeHtml(team.id) + '"' + (team.id === selected ? " selected" : "") + ">" + escapeHtml(team.name) + "</option>").join("");
}

function sliderControl(label, path, value, min = 0, max = 100, step = 1) {
  const percentage = ((Number(value) - min) / (max - min)) * 100;
  return (
    '<div class="slider-control"><label for="sim-' + escapeHtml(path) + '">' + escapeHtml(label) + "</label>" +
    '<input id="sim-' + escapeHtml(path) + '" type="range" min="' + min + '" max="' + max + '" step="' + step + '" value="' + escapeHtml(value) + '" data-sim-path="' + escapeHtml(path) + '" style="--range-progress:' + percentage + '%" />' +
    '<output>' + escapeHtml(value) + "</output></div>"
  );
}

function weatherTypeControl(weather = {}) {
  const selected = weather.type ?? "sunny";
  const config = normalizeGameConfig(app.state?.globalConfig);
  const total = Object.values(config.weatherWeights).reduce((sum, weight) => sum + weight, 0);
  const probability = (key) => total > 0 ? Math.round((config.weatherWeights[key] / total) * 1000) / 10 : 0;
  return '<section class="weather-dev-control"><div class="field"><label for="sim-weather-type">天气类型</label><select id="sim-weather-type">' +
    Object.entries(WEATHER_PRESETS).map(([key, item]) => '<option value="' + key + '"' + (key === selected ? " selected" : "") + '>' + item.name + " · " + probability(key) + "%</option>").join("") +
    '</select></div><div class="weather-probability-strip">' + Object.entries(WEATHER_PRESETS).map(([key, item]) => '<span class="' + (key === selected ? "active" : "") + '"><b>' + item.name + '</b><small>' + probability(key) + '%</small></span>').join("") + '</div><p>修改天气类型会载入游戏内对应参数；当前雷暴雷击概率为每次推进 ' + (config.lightning.chance * 100).toFixed(1) + '%。</p></section>';
}

function pairedControls(fields, prefix, homeTeam, awayTeam) {
  return '<div class="two-team-controls"><div class="team-control-column"><h4>主队 · ' + escapeHtml(homeTeam?.name ?? "—") + "</h4>" +
    Object.entries(fields).map(([key, label]) => sliderControl(label, "homeOverride." + prefix + "." + key, getPath(app.simulationConfig, "homeOverride." + prefix + "." + key) ?? 50)).join("") +
    '</div><div class="team-control-column"><h4>客队 · ' + escapeHtml(awayTeam?.name ?? "—") + "</h4>" +
    Object.entries(fields).map(([key, label]) => sliderControl(label, "awayOverride." + prefix + "." + key, getPath(app.simulationConfig, "awayOverride." + prefix + "." + key) ?? 50)).join("") +
    "</div></div>";
}

function pairedTeamState(homeTeam, awayTeam) {
  return '<div class="two-team-controls"><div class="team-control-column"><h4>主队 · ' + escapeHtml(homeTeam?.name ?? "—") + "</h4>" +
    Object.entries(TEAM_STATE_FIELDS).map(([key, label]) => sliderControl(label, "homeOverride." + key, getPath(app.simulationConfig, "homeOverride." + key) ?? 50)).join("") +
    '</div><div class="team-control-column"><h4>客队 · ' + escapeHtml(awayTeam?.name ?? "—") + "</h4>" +
    Object.entries(TEAM_STATE_FIELDS).map(([key, label]) => sliderControl(label, "awayOverride." + key, getPath(app.simulationConfig, "awayOverride." + key) ?? 50)).join("") +
    "</div></div>";
}

function renderSimulationForm() {
  if (!app.state || !app.simulationConfig) return;
  const form = document.querySelector("#simulation-form");
  const config = app.simulationConfig;
  const homeTeam = app.state.teams.find((team) => team.id === config.homeTeamId);
  const awayTeam = app.state.teams.find((team) => team.id === config.awayTeamId);
  form.innerHTML =
    '<div class="matchup-row"><div class="field"><label for="sim-home-team">主队</label><select id="sim-home-team">' + teamOptions(config.homeTeamId) + '</select></div><div class="versus">VS</div><div class="field"><label for="sim-away-team">客队</label><select id="sim-away-team">' + teamOptions(config.awayTeamId) + "</select></div></div>" +
    '<details class="control-section" open><summary>基础与环境参数</summary><div class="control-section-body">' +
      weatherTypeControl(config.context.weather) +
      sliderControl("比赛分钟", "context.minutes", config.context.minutes ?? 90, 60, 120, 1) +
      sliderControl("控球序列", "context.basePossessions", config.context.basePossessions ?? 160, 80, 240, 1) +
      sliderControl("主场优势", "context.homeAdvantage", config.context.homeAdvantage ?? 3.2, 0, 10, 0.1) +
      sliderControl("场地质量", "context.pitchQuality", config.context.pitchQuality ?? 85, 0, 100, 1) +
      sliderControl("降雨", "context.weather.precipitation", config.context.weather?.precipitation ?? 10, 0, 100, 1) +
      sliderControl("风力", "context.weather.wind", config.context.weather?.wind ?? 10, 0, 100, 1) +
      sliderControl("温度", "context.weather.temperature", config.context.weather?.temperature ?? 18, -5, 42, 1) +
      sliderControl("雷击/推进", "context.weather.lightningChance", config.context.weather?.lightningChance ?? 0, 0, 0.05, 0.001) +
    "</div></details>" +
    '<details class="control-section" open><summary>双方战术</summary><div class="control-section-body">' + pairedControls(TACTIC_FIELDS, "tactics", homeTeam, awayTeam) + "</div></details>" +
    '<details class="control-section"><summary>阵型结构与球队状态</summary><div class="control-section-body">' + pairedControls(FORMATION_FIELDS, "formation", homeTeam, awayTeam) + pairedTeamState(homeTeam, awayTeam) + "</div></details>" +
    '<details class="control-section"><summary>教练与裁判</summary><div class="control-section-body">' + pairedControls(COACH_FIELDS, "coach", homeTeam, awayTeam) +
      sliderControl("判罚严格", "context.referee.strictness", config.context.referee?.strictness ?? 50) +
      sliderControl("点球倾向", "context.referee.penaltyBias", config.context.referee?.penaltyBias ?? 50) +
      sliderControl("主场倾向", "context.referee.homeBias", config.context.referee?.homeBias ?? 50) +
    "</div></details>" +
    '<div class="simulation-footer-fields"><div class="field"><label for="sim-matches">批量场次</label><input id="sim-matches" type="number" min="10" max="10000" step="10" value="' + escapeHtml(config.matches) + '" /></div><div class="field span-2"><label for="sim-seed">随机种子</label><input id="sim-seed" value="' + escapeHtml(config.seed) + '" /></div></div>' +
    '<p class="run-note">运行前会自动保存当前特性卡和球员数据。批量场次越大，概率越稳定，但计算时间也越长。</p>';

  document.querySelector("#sim-home-team").addEventListener("change", (event) => {
    config.homeTeamId = event.target.value;
    config.homeOverride = teamOverrideFrom(app.state.teams.find((team) => team.id === event.target.value));
    renderSimulationForm();
  });
  document.querySelector("#sim-away-team").addEventListener("change", (event) => {
    config.awayTeamId = event.target.value;
    config.awayOverride = teamOverrideFrom(app.state.teams.find((team) => team.id === event.target.value));
    renderSimulationForm();
  });
  document.querySelector("#sim-weather-type").addEventListener("change", (event) => {
    const type = event.target.value;
    config.context.weather = { type, ...WEATHER_PRESETS[type] };
    if (type === "storm") config.context.weather.lightningChance = normalizeGameConfig(app.state.globalConfig).lightning.chance;
    renderSimulationForm();
  });
  form.querySelectorAll("[data-sim-path]").forEach((input) => {
    input.addEventListener("input", () => {
      const value = Number(input.value);
      setPath(config, input.dataset.simPath, value);
      const decimals = Math.min(3, (input.step.split(".")[1] ?? "").length);
      input.nextElementSibling.textContent = decimals ? value.toFixed(decimals) : value;
      const min = Number(input.min);
      const max = Number(input.max);
      input.style.setProperty("--range-progress", ((value - min) / (max - min)) * 100 + "%");
    });
  });
  document.querySelector("#sim-matches").addEventListener("input", (event) => { config.matches = Number(event.target.value); });
  document.querySelector("#sim-seed").addEventListener("input", (event) => { config.seed = event.target.value; });
}

async function runSimulationFromUi() {
  const button = document.querySelector("#run-simulation-button");
  const results = document.querySelector("#simulation-results");
  button.disabled = true;
  button.textContent = "模拟中…";
  results.innerHTML = '<div class="loading-block">正在计算单场过程与批量概率…</div>';
  try {
    if (app.dirty) await saveState({ quiet: true });
    const payload = await api("/api/simulate", {
      method: "POST",
      body: JSON.stringify(app.simulationConfig),
    });
    app.simulationResult = payload.result;
    renderSimulationResults();
  } catch (error) {
    results.innerHTML = '<div class="empty-state large"><h2>模拟失败</h2><p>' + escapeHtml(error.message) + "</p></div>";
    showToast(error.message, "error");
  } finally {
    button.disabled = false;
    button.textContent = "运行模拟";
  }
}

function statRow(label, home, away) {
  return "<tr><th>" + escapeHtml(label) + "</th><td>" + escapeHtml(home) + "</td><td>" + escapeHtml(away) + "</td></tr>";
}

function eventDescription(event) {
  if (event.type === "goal") return escapeHtml(event.team + " · " + event.player + " · " + event.shotType + " · " + event.score);
  if (event.type === "yellowCard") return escapeHtml(event.team + " · " + event.player);
  if (event.type === "redCard") return escapeHtml(event.team + " · " + event.player + " · " + event.reason);
  if (event.type === "injury") return escapeHtml(event.team + " · " + event.player);
  if (event.type === "substitution") return escapeHtml(event.team + " · " + event.playerOut + " → " + event.playerIn);
  if (event.type === "penaltyAwarded") return escapeHtml(event.team + " 获得点球");
  if (event.type === "penaltyMiss") return escapeHtml(event.team + " · " + event.player + " 罚失点球");
  if (event.type === "foul") return escapeHtml(event.team + " · " + event.player + " 对 " + (event.victim ?? "对手") + " 犯规");
  if (event.type === "save") return escapeHtml(event.team + " · " + event.player + " 射门被扑");
  if (event.type === "miss") return escapeHtml(event.team + " · " + event.player + " 射偏");
  return escapeHtml(event.team ?? "比赛事件");
}

function eventTypeLabel(type) {
  return {
    goal: "进球",
    yellowCard: "黄牌",
    redCard: "红牌",
    injury: "伤病",
    substitution: "换人",
    penaltyAwarded: "点球",
    penaltyMiss: "点球罚失",
    foul: "犯规",
    save: "扑救",
    miss: "射偏",
  }[type] ?? type;
}

function renderSimulationResults() {
  const container = document.querySelector("#simulation-results");
  const { single, batch, meta } = app.simulationResult;
  const probabilities = [
    ["主胜", batch.probabilities.homeWin],
    ["平局", batch.probabilities.draw],
    ["客胜", batch.probabilities.awayWin],
  ];
  const stats = single.stats;
  const pendingNote = meta.traitRulesPending > 0
    ? '<div class="pending-note">本次应用了 ' + meta.traitRulesApplied + " 条静态特性规则；另有 " + meta.traitRulesPending + " 条临场条件规则已保存，但尚未接入比赛运行时。</div>"
    : '<div class="pending-note">本次应用了 ' + meta.traitRulesApplied + " 条特性规则，没有待接入规则。</div>";
  const bondSideHtml = (label, bonds = []) => {
    const active = bonds.filter((bond) => bond.active);
    return `<div class="simulation-bond-side">
      <b>${label}</b>
      <div class="tag-row">${active.length
        ? active.map((bond) => `<span class="tag">${escapeHtml(bond.name)} ${bond.tier}级 · ${escapeHtml(bondBonusText(bond.bonus, bond.effectText))}</span>`).join("")
        : '<span class="muted">暂无已激活羁绊</span>'}
      </div>
    </div>`;
  };
  const bondAuditHtml = `<div class="result-section"><h3>本场羁绊</h3><div class="simulation-bond-grid">
    ${bondSideHtml(single.homeTeam, meta.activeBonds?.home)}
    ${bondSideHtml(single.awayTeam, meta.activeBonds?.away)}
  </div></div>`;
  const probabilityHtml = probabilities.map(([label, probability]) => `
    <div class="probability-card">
      <span>${label}</span><strong>${(probability * 100).toFixed(1)}%</strong>
      <div class="probability-bar"><i style="width:${probability * 100}%"></i></div>
    </div>`).join("");
  const eventHtml = single.events.length
    ? single.events.map((event) => `
      <div class="event-row ${escapeHtml(event.type)}">
        <span class="event-minute">${event.minute}′</span>
        <span class="event-type">${escapeHtml(eventTypeLabel(event.type))}</span>
        <span>${eventDescription(event)}</span>
      </div>`).join("")
    : '<div class="event-row"><span>—</span><span>事件</span><span>本场没有关键事件</span></div>';
  container.innerHTML = `
    <div class="result-head">
      <div class="scoreboard">
        <div class="score-team"><span>HOME</span><strong>${escapeHtml(single.homeTeam)}</strong></div>
        <div class="score-value">${single.score.home} : ${single.score.away}</div>
        <div class="score-team"><span>AWAY</span><strong>${escapeHtml(single.awayTeam)}</strong></div>
      </div>
      <div class="simulation-meta">种子 ${escapeHtml(single.seed)} · ${batch.matches.toLocaleString("zh-CN")} 场 · ${(meta.durationMs / 1000).toFixed(2)} 秒</div>
    </div>
    <div class="result-body">
      <div class="probability-grid">${probabilityHtml}</div>
      <div class="result-section"><h3>单场数据</h3><table class="stats-table">
        <thead><tr><th>指标</th><td>${escapeHtml(single.homeTeam)}</td><td>${escapeHtml(single.awayTeam)}</td></tr></thead>
        <tbody>
          ${statRow("进球", stats.home.goals, stats.away.goals)}
          ${statRow("xG", stats.home.xg, stats.away.xg)}
          ${statRow("射门", stats.home.shots, stats.away.shots)}
          ${statRow("射正", stats.home.shotsOnTarget, stats.away.shotsOnTarget)}
          ${statRow("控球", stats.home.possession + "%", stats.away.possession + "%")}
          ${statRow("犯规", stats.home.fouls, stats.away.fouls)}
          ${statRow("黄牌", stats.home.yellowCards, stats.away.yellowCards)}
          ${statRow("红牌", stats.home.redCards, stats.away.redCards)}
        </tbody>
      </table></div>
      ${bondAuditHtml}
      <div class="result-section"><h3>批量均值</h3><table class="stats-table"><tbody>
        ${statRow("平均进球", batch.averages.homeGoals, batch.averages.awayGoals)}
        ${statRow("平均 xG", batch.averages.homeXg, batch.averages.awayXg)}
        ${statRow("平均射门", batch.averages.homeShots, batch.averages.awayShots)}
        ${statRow("平均牌数", batch.averages.homeCards, batch.averages.awayCards)}
        ${statRow("平均伤病", batch.averages.homeInjuries, batch.averages.awayInjuries)}
      </tbody></table></div>
      <div class="result-section"><h3>常见比分</h3><div class="scoreline-grid">
        ${batch.commonScorelines.map((item) => `<span class="scoreline-chip"><b>${item.score}</b> · ${(item.probability * 100).toFixed(1)}%</span>`).join("")}
      </div></div>
      <div class="result-section"><h3>单场事件</h3><div class="event-list">${eventHtml}</div></div>
      ${pendingNote}
    </div>`;
}

function exportDatabase() {
  commitTraitRuleDrafts();
  const blob = new Blob([JSON.stringify(app.state, null, 2) + "\n"], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "touchline-lab-" + new Date().toISOString().slice(0, 10) + ".json";
  link.click();
  URL.revokeObjectURL(url);
  showToast("开发数据已导出");
}

async function importDatabase(file) {
  if (!file) return;
  try {
    const state = JSON.parse(await file.text());
    if (!window.confirm("导入会替换当前开发数据，并自动保留旧数据备份。确认继续？")) return;
    const payload = await api("/api/state", { method: "POST", body: JSON.stringify({ state }) });
    app.state = prepareClientState(payload.state);
    app.traitRuleDrafts.clear();
    app.selectedTraitId = app.state.traitCards[0]?.id ?? null;
    app.selectedTraitDraftId = app.state.traitDrafts[0]?.id ?? null;
    app.selectedPlayerId = app.state.players[0]?.id ?? null;
    app.dirty = false;
    initializeSimulationConfig();
    renderAll();
    updateSaveState("saved");
    showToast("数据导入完成");
  } catch (error) {
    showToast("导入失败：" + error.message, "error");
  }
}

async function resetDatabase() {
  if (!window.confirm("确认恢复初始数据？当前数据会先保存为备份。")) return;
  try {
    const payload = await api("/api/reset", { method: "POST", body: "{}" });
    app.state = prepareClientState(payload.state);
    app.traitRuleDrafts.clear();
    app.selectedTraitId = app.state.traitCards[0]?.id ?? null;
    app.selectedTraitDraftId = app.state.traitDrafts[0]?.id ?? null;
    app.selectedPlayerId = app.state.players[0]?.id ?? null;
    app.dirty = false;
    initializeSimulationConfig();
    renderAll();
    updateSaveState("saved");
    showToast("已恢复初始开发数据");
  } catch (error) {
    showToast(error.message, "error");
  }
}

function setTraitDragData(event, traitId, sourceBondId = "") {
  event.dataTransfer.setData("text/plain", traitId);
  event.dataTransfer.setData("application/x-touchline-trait", traitId);
  if (sourceBondId) event.dataTransfer.setData("application/x-touchline-bond", sourceBondId);
}

function draggedTraitId(event) {
  return event.dataTransfer.getData("application/x-touchline-trait") || event.dataTransfer.getData("text/plain");
}

function traitRoleText(trait) {
  return (trait.eligibleRoleGroups ?? []).map((role) => ROLE_GROUP_LABELS[role] ?? role).join(" / ") || "未限制";
}

function traitBondText(trait) {
  const names = (app.state?.bonds ?? [])
    .filter((bond) => bond.traitIds.includes(trait.id))
    .map((bond) => bond.name);
  return names.join(" / ") || "暂未加入羁绊";
}

function traitInfoMarkup(trait) {
  return `<div class="trait-info-tooltip-head"><span class="trait-info-grade grade-${traitGrade(trait.rarity).toLowerCase()}">${traitGrade(trait.rarity)}</span><small>${escapeHtml(RARITY_LABELS[trait.rarity])} · ${escapeHtml(trait.category)}</small></div>
    <h3>${escapeHtml(trait.name)}</h3>
    <p>${escapeHtml(trait.summary || "尚未填写卡片效果说明")}</p>
    <footer><span>${escapeHtml(traitRoleText(trait))}</span><b>单击查看完整详情</b></footer>`;
}

function positionTraitInfoTooltip(event, card) {
  const tooltip = document.querySelector("#trait-info-tooltip");
  if (tooltip.hidden) return;
  const rect = card.getBoundingClientRect();
  const pointerX = Number.isFinite(event?.clientX) && event.clientX > 0 ? event.clientX : rect.right;
  const pointerY = Number.isFinite(event?.clientY) && event.clientY > 0 ? event.clientY : rect.top;
  const gap = 14;
  const width = tooltip.offsetWidth;
  const height = tooltip.offsetHeight;
  const left = Math.max(gap, Math.min(window.innerWidth - width - gap, pointerX + gap));
  const preferredTop = pointerY + gap;
  const top = preferredTop + height <= window.innerHeight - gap
    ? preferredTop
    : Math.max(gap, pointerY - height - gap);
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

function showTraitInfoTooltip(trait, event, card) {
  const tooltip = document.querySelector("#trait-info-tooltip");
  tooltip.innerHTML = traitInfoMarkup(trait);
  tooltip.hidden = false;
  positionTraitInfoTooltip(event, card);
}

function hideTraitInfoTooltip() {
  const tooltip = document.querySelector("#trait-info-tooltip");
  tooltip.hidden = true;
}

function closeTraitDetail() {
  document.querySelector("#trait-detail-backdrop").hidden = true;
  document.body.classList.remove("trait-detail-open");
}

function openTraitDetail(trait) {
  hideTraitInfoTooltip();
  const grade = traitGrade(trait.rarity);
  const rules = Array.isArray(trait.rules) ? trait.rules : [];
  document.querySelector("#trait-detail-content").innerHTML = `<article class="trait-detail-sheet rarity-${grade.toLowerCase()}">
    <header>
      <span class="trait-detail-grade">${grade}</span>
      <div><small>${escapeHtml(RARITY_LABELS[trait.rarity])} · ${escapeHtml(trait.category)} · TRAIT CARD</small><h2 id="trait-detail-title">${escapeHtml(trait.name)}</h2></div>
    </header>
    <p class="trait-detail-summary">${escapeHtml(trait.summary || "尚未填写卡片效果说明")}</p>
    <div class="trait-detail-grid">
      <section><small>适用位置</small><b>${escapeHtml(traitRoleText(trait))}</b></section>
      <section><small>所属羁绊</small><b>${escapeHtml(traitBondText(trait))}</b></section>
      <section><small>协同标签</small><b>${escapeHtml((trait.tags ?? []).join(" · ") || "无")}</b></section>
      <section><small>投放参数</small><b>权重 ${escapeHtml(trait.dropWeight ?? "—")} · 最高等级 ${escapeHtml(trait.maxLevel ?? 1)}</b></section>
    </div>
    <section class="trait-detail-rules"><div><small>PROGRAM RULES</small><b>${rules.length} 条程序规则</b></div><pre>${escapeHtml(JSON.stringify(rules, null, 2))}</pre></section>
    <footer><span>卡片 ID · ${escapeHtml(trait.id)}</span><button class="button primary compact" type="button" data-close-trait-detail>关闭详情</button></footer>
  </article>`;
  const backdrop = document.querySelector("#trait-detail-backdrop");
  backdrop.hidden = false;
  document.body.classList.add("trait-detail-open");
  backdrop.querySelector("[data-close-trait-detail]")?.focus();
}

function bindTraitInfoCard(card, traitId) {
  const trait = app.state.traitCards.find((candidate) => candidate.id === traitId);
  if (!trait) return;
  card.classList.add("trait-info-target");
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute("aria-label", `${trait.name}，单击查看详情，可拖拽管理`);
  card.addEventListener("mouseenter", (event) => showTraitInfoTooltip(trait, event, card));
  card.addEventListener("mousemove", (event) => positionTraitInfoTooltip(event, card));
  card.addEventListener("mouseleave", hideTraitInfoTooltip);
  card.addEventListener("focus", (event) => showTraitInfoTooltip(trait, event, card));
  card.addEventListener("blur", hideTraitInfoTooltip);
  card.addEventListener("dragstart", () => {
    card.dataset.traitDragActive = "true";
    hideTraitInfoTooltip();
  });
  card.addEventListener("dragend", () => {
    window.setTimeout(() => delete card.dataset.traitDragActive, 0);
  });
  card.addEventListener("click", (event) => {
    if (event.target.closest("button") || card.dataset.traitDragActive) return;
    openTraitDetail(trait);
  });
  card.addEventListener("keydown", (event) => {
    if ((event.key !== "Enter" && event.key !== " ") || event.target.closest("button")) return;
    event.preventDefault();
    openTraitDetail(trait);
  });
}

function gradeTraitCardMarkup(trait) {
  return `<article class="grade-trait-card" draggable="true" data-grade-trait-id="${escapeHtml(trait.id)}">
    <b>${escapeHtml(trait.name)}</b>
    <small>${escapeHtml(trait.category)} · ${escapeHtml((trait.eligibleRoleGroups ?? []).map((role) => ROLE_GROUP_LABELS[role] ?? role).join(" / "))}</small>
    <button type="button" data-open-grade-trait="${escapeHtml(trait.id)}">编辑</button>
    <span class="drag-handle" aria-hidden="true">⠿</span>
  </article>`;
}

function renderTraitRarityBoard() {
  const board = document.querySelector("#grade-board");
  if (!board || !app.state) return;
  const query = document.querySelector("#grade-trait-search")?.value.trim().toLowerCase() ?? "";
  board.innerHTML = RARITY_GRADES.map((group) => {
    const all = app.state.traitCards.filter((trait) => trait.rarity === group.rarity);
    const visible = all.filter((trait) => !query || [trait.name, trait.id, trait.category, trait.summary, ...(trait.tags ?? [])].join(" ").toLowerCase().includes(query));
    return `<section class="grade-lane grade-${group.grade.toLowerCase()}" data-grade-dropzone="${group.rarity}">
      <header><span class="grade-letter">${group.grade}</span><div><h2>${group.label}</h2><p>${group.note}</p></div><b>${all.length}</b></header>
      <div class="grade-lane-cards">${visible.length ? visible.map(gradeTraitCardMarkup).join("") : `<div class="grade-lane-empty">${query ? "没有匹配卡片" : "将正式卡拖到这里"}</div>`}</div>
    </section>`;
  }).join("");

  board.querySelectorAll("[data-grade-trait-id]").forEach((card) => {
    card.addEventListener("dragstart", (event) => {
      event.dataTransfer.effectAllowed = "move";
      setTraitDragData(event, card.dataset.gradeTraitId);
      card.classList.add("dragging");
    });
    card.addEventListener("dragend", () => card.classList.remove("dragging"));
    bindTraitInfoCard(card, card.dataset.gradeTraitId);
  });
  board.querySelectorAll("[data-open-grade-trait]").forEach((button) => button.addEventListener("click", () => {
    app.selectedTraitId = button.dataset.openGradeTrait;
    app.traitWorkspace = "formal";
    switchView("traits");
    renderTraits();
  }));
  board.querySelectorAll("[data-grade-dropzone]").forEach((lane) => {
    lane.addEventListener("dragover", (event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; lane.classList.add("drag-over"); });
    lane.addEventListener("dragleave", (event) => { if (!lane.contains(event.relatedTarget)) lane.classList.remove("drag-over"); });
    lane.addEventListener("drop", (event) => {
      event.preventDefault();
      lane.classList.remove("drag-over");
      const trait = app.state.traitCards.find((candidate) => candidate.id === draggedTraitId(event));
      const rarity = lane.dataset.gradeDropzone;
      if (!trait || !RARITY_LABELS[rarity] || trait.rarity === rarity) return;
      trait.rarity = rarity;
      markDirty();
      renderTraitRarityBoard();
      renderTraitSummary();
      renderTraitList();
      renderBondDesigner();
      showToast(`「${trait.name}」已调整为 ${traitGrade(rarity)} 级${RARITY_LABELS[rarity]}`);
    });
  });
}

function bondTraitCard(trait) {
  return `<article class="bond-trait-card ${escapeHtml(trait.rarity)}" draggable="true" data-bond-trait-id="${escapeHtml(trait.id)}">
    <span class="bond-trait-grade">${escapeHtml(traitGrade(trait.rarity))}</span>
    <div><b>${escapeHtml(trait.name)}</b><small>${escapeHtml((trait.eligibleRoleGroups ?? []).map((role) => ROLE_GROUP_LABELS[role] ?? role).join(" / "))}</small></div>
    <span class="drag-handle" aria-hidden="true">⠿</span>
  </article>`;
}

function renderBondLibrary() {
  const library = document.querySelector("#bond-trait-library");
  if (!library || !app.state) return;
  const query = document.querySelector("#bond-trait-search")?.value.trim().toLowerCase() ?? "";
  const traits = app.state.traitCards.filter((trait) => !query || [trait.name, trait.id, trait.category, trait.summary, ...(trait.tags ?? [])].join(" ").toLowerCase().includes(query));
  document.querySelector("#bond-library-count").textContent = `${traits.length} / ${app.state.traitCards.length}`;
  library.innerHTML = traits.length ? traits.map(bondTraitCard).join("") : '<div class="empty-state"><p>没有匹配的正式特性卡</p></div>';
  library.querySelectorAll("[data-bond-trait-id]").forEach((card) => {
    card.addEventListener("dragstart", (event) => {
      event.dataTransfer.effectAllowed = "copy";
      setTraitDragData(event, card.dataset.bondTraitId);
      card.classList.add("dragging");
    });
    card.addEventListener("dragend", () => card.classList.remove("dragging"));
    bindTraitInfoCard(card, card.dataset.bondTraitId);
  });
}

function bondTierMarkup(tier, bondIndex, tierIndex) {
  return `<div class="bond-tier-row" data-bond-tier-row="${tierIndex}">
    <div class="bond-tier-head"><b>档位 ${tierIndex + 1}</b><button class="icon-button danger-text" type="button" data-remove-bond-tier="${tierIndex}" aria-label="删除档位">×</button></div>
    <label>激活人数<input type="number" min="1" max="7" step="1" value="${escapeHtml(tier.threshold)}" data-bond-tier-threshold="${tierIndex}" /></label>
    <label>玩家可见效果<input value="${escapeHtml(tier.effectText ?? "")}" placeholder="例如：全队反击更有威胁" data-bond-tier-effect="${tierIndex}" /></label>
    <label class="span-2">效果参数 JSON<textarea class="code-field compact-code" spellcheck="false" data-bond-tier-bonuses="${tierIndex}">${escapeHtml(JSON.stringify(tier.bonuses ?? {}, null, 2))}</textarea></label>
    <p class="bond-tier-help span-2">已接入参数：attack、midfield、defense、goalkeeping、tempo、pressing、counterAttack、penaltyChance、penaltyConversion、injuryResistance、cardAvoidance。数值按百分比或评分加成处理。</p>
  </div>`;
}

function bondFrameMarkup(bond, index) {
  const traits = bond.traitIds.map((id) => app.state.traitCards.find((trait) => trait.id === id)).filter(Boolean);
  const tierSummary = bond.tiers.map((tier) => `${tier.threshold}人 · ${tier.effectText || bondBonusText(tier.bonuses) || "待设置效果"}`).join(" / ");
  return `<article class="bond-frame ${app.selectedBondId === bond.id ? "selected" : ""}" data-bond-index="${index}" data-bond-frame-id="${escapeHtml(bond.id)}">
    <header>
      <span class="bond-frame-mark">${escapeHtml((bond.short || bond.name || "羁").slice(0, 2))}</span>
      <div><span>BOND ${String(index + 1).padStart(2, "0")}</span><h3>${escapeHtml(bond.name || "未命名羁绊")}</h3></div>
      <button class="icon-button" type="button" data-select-bond="${escapeHtml(bond.id)}" aria-label="编辑羁绊">⚙</button>
    </header>
    <p class="bond-frame-description">${escapeHtml(bond.description || "尚未填写羁绊说明")}</p>
    <div class="bond-frame-dropzone" data-bond-dropzone="${index}">
      <div class="bond-frame-drophead"><b>特性卡</b><span>${traits.length} 张</span></div>
      <div class="bond-frame-members">${traits.length ? traits.map((trait) => `<article class="bond-member-card" draggable="true" data-bond-member-id="${escapeHtml(trait.id)}" data-source-bond-id="${escapeHtml(bond.id)}"><span>${escapeHtml(traitGrade(trait.rarity))}</span><b>${escapeHtml(trait.name)}</b><button type="button" data-remove-bond-trait="${escapeHtml(trait.id)}" aria-label="移除 ${escapeHtml(trait.name)}">×</button></article>`).join("") : '<div class="bond-frame-empty"><b>拖入特性卡</b><span>从左侧卡库拖到这个框内</span></div>'}</div>
    </div>
    <footer><span>${bond.tiers.length} 个激活档位</span><p>${escapeHtml(tierSummary)}</p></footer>
  </article>`;
}

function renderBondInspector() {
  const inspector = document.querySelector("#bond-inspector");
  if (!inspector) return;
  const index = app.state.bonds.findIndex((bond) => bond.id === app.selectedBondId);
  const bond = app.state.bonds[index];
  if (!bond) {
    inspector.innerHTML = '<div class="bond-inspector-empty"><span>⚙</span><h3>选择一个羁绊框</h3><p>配置名称、说明、激活人数和实际效果。</p></div>';
    return;
  }
  inspector.innerHTML = `<header class="bond-inspector-head"><div><span>SELECTED BOND</span><h2>${escapeHtml(bond.name)}</h2></div><button class="icon-button danger-text" type="button" data-delete-bond="${index}" aria-label="删除羁绊">×</button></header>
    <div class="bond-inspector-form">
      <label>羁绊名称<input value="${escapeHtml(bond.name)}" data-bond-name="${index}" /></label>
      <label>短标识<input maxlength="4" value="${escapeHtml(bond.short)}" data-bond-short="${index}" /></label>
      <label>羁绊说明<textarea data-bond-description="${index}" placeholder="说明这套羁绊的主题与玩法">${escapeHtml(bond.description)}</textarea></label>
    </div>
    <div class="bond-tier-section">
      <div class="bond-tier-title"><div><span>ACTIVATION TIERS</span><h3>激活档位</h3></div><button class="button ghost compact" type="button" data-add-bond-tier="${index}">＋ 添加</button></div>
      <div class="bond-tier-list">${bond.tiers.map((tier, tierIndex) => bondTierMarkup(tier, index, tierIndex)).join("")}</div>
    </div>`;
  inspector.querySelector(`[data-bond-name="${index}"]`).addEventListener("input", (event) => {
    bond.name = event.target.value;
    inspector.querySelector(".bond-inspector-head h2").textContent = bond.name || "未命名羁绊";
    document.querySelector(`[data-bond-frame-id="${bond.id}"] h3`).textContent = bond.name || "未命名羁绊";
    markDirty();
  });
  inspector.querySelector(`[data-bond-short="${index}"]`).addEventListener("input", (event) => { bond.short = event.target.value.slice(0, 4); markDirty(); });
  inspector.querySelector(`[data-bond-description="${index}"]`).addEventListener("input", (event) => { bond.description = event.target.value; markDirty(); });
  inspector.querySelector(`[data-delete-bond="${index}"]`).addEventListener("click", () => deleteBond(index));
  inspector.querySelector(`[data-add-bond-tier="${index}"]`).addEventListener("click", () => {
    const last = bond.tiers.at(-1)?.threshold ?? 1;
    bond.tiers.push({ threshold: Math.min(7, last + 1), bonuses: {}, effectText: "" });
    markDirty();
    renderBondDesigner();
  });
  inspector.querySelectorAll("[data-remove-bond-tier]").forEach((button) => button.addEventListener("click", () => {
    if (bond.tiers.length === 1) return showToast("每个羁绊至少保留一个激活档位", "error");
    bond.tiers.splice(Number(button.dataset.removeBondTier), 1);
    markDirty();
    renderBondDesigner();
  }));
  inspector.querySelectorAll("[data-bond-tier-threshold]").forEach((input) => input.addEventListener("input", () => {
    bond.tiers[Number(input.dataset.bondTierThreshold)].threshold = Math.max(1, Math.min(7, Math.round(Number(input.value) || 1)));
    markDirty();
  }));
  inspector.querySelectorAll("[data-bond-tier-effect]").forEach((input) => input.addEventListener("input", () => {
    bond.tiers[Number(input.dataset.bondTierEffect)].effectText = input.value;
    markDirty();
  }));
  inspector.querySelectorAll("[data-bond-tier-bonuses]").forEach((input) => input.addEventListener("input", () => {
    try {
      const parsed = JSON.parse(input.value || "{}");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("必须是对象");
      const invalid = Object.entries(parsed).find(([, value]) => !Number.isFinite(Number(value)));
      if (invalid) throw new Error(`${invalid[0]} 必须是数值`);
      bond.tiers[Number(input.dataset.bondTierBonuses)].bonuses = Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key, Number(value)]));
      input.classList.remove("invalid");
      markDirty();
    } catch (error) {
      input.classList.add("invalid");
    }
  }));
}

function renderBondDesigner() {
  const board = document.querySelector("#bond-board");
  if (!board || !app.state) return;
  app.state.bonds = normalizeBondDefinitions(app.state.bonds ?? []);
  synchronizeTraitBondIds();
  if (!app.state.bonds.some((bond) => bond.id === app.selectedBondId)) app.selectedBondId = app.state.bonds[0]?.id ?? null;
  renderBondLibrary();
  document.querySelector("#bond-board-count").textContent = app.state.bonds.length;
  board.innerHTML = app.state.bonds.length
    ? app.state.bonds.map(bondFrameMarkup).join("")
    : '<div class="empty-state large bond-empty"><span class="empty-ball">＋</span><h2>还没有羁绊框</h2><p>建立第一个框，再从左侧把正式特性卡拖进去。</p><button class="button primary" type="button" id="empty-add-bond-button">＋ 新建羁绊框</button></div>';
  document.querySelector("#empty-add-bond-button")?.addEventListener("click", addBond);

  board.querySelectorAll("[data-select-bond]").forEach((button) => button.addEventListener("click", () => {
    app.selectedBondId = button.dataset.selectBond;
    renderBondDesigner();
  }));
  board.querySelectorAll("[data-bond-frame-id]").forEach((frame) => frame.addEventListener("click", (event) => {
    if (event.target.closest("button") || event.target.closest(".bond-frame-dropzone")) return;
    app.selectedBondId = frame.dataset.bondFrameId;
    renderBondDesigner();
  }));
  board.querySelectorAll("[data-bond-member-id]").forEach((card) => {
    card.addEventListener("dragstart", (event) => {
      event.dataTransfer.effectAllowed = "copy";
      setTraitDragData(event, card.dataset.bondMemberId, card.dataset.sourceBondId);
      card.classList.add("dragging");
    });
    card.addEventListener("dragend", () => card.classList.remove("dragging"));
    bindTraitInfoCard(card, card.dataset.bondMemberId);
  });
  board.querySelectorAll("[data-remove-bond-trait]").forEach((button) => button.addEventListener("click", () => {
    const index = Number(button.closest("[data-bond-index]").dataset.bondIndex);
    app.state.bonds[index].traitIds = app.state.bonds[index].traitIds.filter((id) => id !== button.dataset.removeBondTrait);
    synchronizeTraitBondIds();
    markDirty();
    renderBondDesigner();
  }));
  board.querySelectorAll("[data-bond-dropzone]").forEach((dropzone) => {
    const index = Number(dropzone.dataset.bondDropzone);
    const bond = app.state.bonds[index];
    dropzone.addEventListener("dragover", (event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; dropzone.classList.add("drag-over"); });
    dropzone.addEventListener("dragleave", (event) => { if (!dropzone.contains(event.relatedTarget)) dropzone.classList.remove("drag-over"); });
    dropzone.addEventListener("drop", (event) => {
      event.preventDefault();
      dropzone.classList.remove("drag-over");
      const traitId = draggedTraitId(event);
      if (!app.state.traitCards.some((trait) => trait.id === traitId)) return;
      if (bond.traitIds.includes(traitId)) return showToast("这张特性卡已经在该羁绊内", "error");
      bond.traitIds.push(traitId);
      app.selectedBondId = bond.id;
      synchronizeTraitBondIds();
      markDirty();
      renderBondDesigner();
    });
  });
  renderBondInspector();
}

function addBond() {
  const ids = new Set(app.state.bonds.map((bond) => bond.id));
  const bond = {
    id: uniqueId("bond", ids),
    name: `新羁绊 ${app.state.bonds.length + 1}`,
    short: "新羁绊",
    description: "",
    traitIds: [],
    tiers: [{ threshold: 2, bonuses: {}, effectText: "" }],
  };
  app.state.bonds.push(bond);
  app.selectedBondId = bond.id;
  markDirty();
  renderBondDesigner();
}

function deleteBond(index) {
  const bond = app.state.bonds[index];
  if (!bond || !window.confirm(`确认删除羁绊“${bond.name}”？特性卡本身不会被删除。`)) return;
  app.state.bonds.splice(index, 1);
  app.selectedBondId = app.state.bonds[Math.min(index, app.state.bonds.length - 1)]?.id ?? null;
  synchronizeTraitBondIds();
  markDirty();
  renderBondDesigner();
}

function renderAll() {
  renderTraits();
  renderTraitRarityBoard();
  renderBondDesigner();
  renderPlayers();
  renderSimulationForm();
  renderGlobalSettings();
}

function bindStaticEvents() {
  document.querySelectorAll("[data-view-target]").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.viewTarget));
  });
  document.querySelector("#save-button").addEventListener("click", () => saveState());
  document.querySelector("#export-button").addEventListener("click", exportDatabase);
  document.querySelector("#import-button").addEventListener("click", () => document.querySelector("#import-file").click());
  document.querySelector("#import-file").addEventListener("change", (event) => importDatabase(event.target.files[0]));
  document.querySelector("#reset-data-button").addEventListener("click", resetDatabase);
  document.querySelectorAll("[data-trait-workspace]").forEach((button) => {
    button.addEventListener("click", () => switchTraitWorkspace(button.dataset.traitWorkspace));
  });
  document.querySelector("#add-trait-button").addEventListener("click", addTrait);
  document.querySelector("#add-bond-button").addEventListener("click", addBond);
  document.querySelector("#bond-trait-search").addEventListener("input", renderBondLibrary);
  document.querySelector("#grade-trait-search").addEventListener("input", renderTraitRarityBoard);
  document.querySelector("#trait-detail-backdrop").addEventListener("click", (event) => {
    if (event.target === event.currentTarget || event.target.closest("[data-close-trait-detail]")) closeTraitDetail();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !document.querySelector("#trait-detail-backdrop").hidden) closeTraitDetail();
  });
  document.querySelector("#add-player-button").addEventListener("click", addPlayer);
  document.querySelector("#run-simulation-button").addEventListener("click", runSimulationFromUi);
  for (const selector of ["#trait-search", "#trait-rarity-filter", "#trait-role-filter", "#trait-status-filter"]) {
    document.querySelector(selector).addEventListener("input", renderTraitList);
    document.querySelector(selector).addEventListener("change", renderTraitList);
  }
  for (const selector of ["#player-search", "#player-team-filter", "#player-role-filter"]) {
    document.querySelector(selector).addEventListener("input", renderPlayerList);
    document.querySelector(selector).addEventListener("change", renderPlayerList);
  }
  window.addEventListener("beforeunload", (event) => {
    if (!app.dirty) return;
    event.preventDefault();
  });
}

async function start() {
  bindStaticEvents();
  try {
    const [payload, versusPayload] = await Promise.all([api("/api/state"), api("/api/versus-traits")]);
    app.state = prepareClientState(payload.state);
    app.versusTraits = versusPayload.traits ?? [];
    app.selectedTraitId = app.state.traitCards[0]?.id ?? null;
    app.selectedTraitDraftId = app.state.traitDrafts[0]?.id ?? null;
    app.selectedVersusTraitId = app.versusTraits[0]?.id ?? null;
    app.selectedPlayerId = app.state.players[0]?.id ?? null;
    initializeSimulationConfig();
    renderAll();
    updateSaveState("saved");
  } catch (error) {
    document.querySelector(".content-area").innerHTML = '<div class="empty-state large"><h2>开发数据加载失败</h2><p>' + escapeHtml(error.message) + "</p></div>";
    showToast(error.message, "error");
  }
}

start();
