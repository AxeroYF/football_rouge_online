import { A_PLAYER_PROFILE_BY_PLAYER_ID } from "./a-player-profiles.js";
import { LEGENDARY_PROFILE_BY_PLAYER_ID } from "./legendary-profiles.js";
import { X_PLAYER_PROFILE_BY_PLAYER_ID } from "./x-player-profiles.js";

const PLAYERS = Object.freeze({
  "s4-fc26-204963":{ name:"卡瓦哈尔", grade:"A", overall:87, role:"RB", club:"皇家马德里", nationality:"西班牙" },
  "s4-dlc-20260731-003":{ name:"卡塞米罗", grade:"A", overall:88, role:"DM", club:"皇家马德里", nationality:"巴西" },
  "s4-fc26-243812":{ name:"罗德里戈", grade:"A", overall:87, role:"RW", club:"皇家马德里", nationality:"巴西" },
  "s4-fc26-238794":{ name:"维尼修斯", grade:"A", overall:89, role:"LW", club:"皇家马德里", nationality:"巴西" },
  "ydl-x-player-2":{ name:"李俊良", grade:"X", overall:62, role:"X", club:"黄狗青训", nationality:"中国" },
  "s4-retired-oliver-kahn":{ name:"卡恩", grade:"A", overall:86, role:"GK", club:"拜仁慕尼黑", nationality:"德国" },
  "s4-fc26-235212":{ name:"阿什拉夫", grade:"A", overall:89, role:"RB", club:"巴黎圣日耳曼", nationality:"摩洛哥" },
  "s4-dlc2-20260803-008":{ name:"奥斯卡·鲁杰里", grade:"A", overall:87, role:"CB", club:"河床", nationality:"阿根廷" },
  "legend-maradona":{ name:"马拉多纳", grade:"S", overall:96, role:"ST", club:"那不勒斯", nationality:"阿根廷" },
  "s4-retired-javier-zanetti":{ name:"萨内蒂", grade:"B", overall:84, role:"RB", club:"国际米兰", nationality:"阿根廷" },
  "legend-beckenbauer":{ name:"贝肯鲍尔", grade:"S", overall:95, role:"CB", club:"拜仁慕尼黑", nationality:"德国" },
  "legend-messi":{ name:"梅西", grade:"S", overall:96, role:"RW", club:"迈阿密国际", nationality:"阿根廷" },
  "s4-retired-carles-puyol":{ name:"普约尔", grade:"B", overall:83, role:"CB", club:"巴塞罗那", nationality:"西班牙" },
  "legend-pele":{ name:"贝利", grade:"S", overall:96, role:"ST", club:"桑托斯", nationality:"巴西" },
  "ydl-x-player-3":{ name:"黄威", grade:"X", overall:62, role:"X", club:"黄狗青训", nationality:"中国" },
  "s4-fc26-232580":{ name:"加布里埃尔", grade:"A", overall:89, role:"CB", club:"阿森纳", nationality:"巴西" },
  "s4-fc26-239818":{ name:"鲁本迪亚斯", grade:"A", overall:88, role:"CB", club:"曼城", nationality:"葡萄牙" },
  "s4-fc26-255253":{ name:"维蒂尼亚", grade:"A", overall:89, role:"AM", club:"巴黎圣日耳曼", nationality:"葡萄牙" },
  "legend-cristiano-ronaldo":{ name:"C罗", grade:"S", overall:94, role:"ST", club:"利雅得胜利", nationality:"葡萄牙" },
  "s4-fc26-241721":{ name:"莱奥", grade:"A", overall:86, role:"LW", club:"AC米兰", nationality:"葡萄牙" },
  "s4-fc26-239053":{ name:"巴尔韦德", grade:"A", overall:88, role:"AM", club:"皇家马德里", nationality:"乌拉圭" },
  "s4-fc26-256196":{ name:"帕乔", grade:"A", overall:88, role:"CB", club:"巴黎圣日耳曼", nationality:"厄瓜多尔" },
  "s4-fc26-203376":{ name:"范戴克", grade:"A", overall:89, role:"CB", club:"利物浦", nationality:"荷兰" },
  "s4-retired-gennaro-gattuso":{ name:"加图索", grade:"B", overall:80, role:"DM", club:"AC米兰", nationality:"意大利" },
  "s4-fc26-226268":{ name:"迪马尔科", grade:"A", overall:88, role:"LB", club:"国际米兰", nationality:"意大利" },
  "s4-fc26-231936":{ name:"本杰明怀特", grade:"B", overall:84, role:"RB", club:"阿森纳", nationality:"英格兰" },
  "s4-dlc2-20260803-064":{ name:"罗伯托·巴乔", grade:"A", overall:89, role:"ST", club:"尤文图斯", nationality:"意大利" },
  "s4-dlc2-20260803-071":{ name:"德尔·皮耶罗", grade:"A", overall:89, role:"ST", club:"尤文图斯", nationality:"意大利" },
  "s4-fc26-231443":{ name:"登贝莱", grade:"A", overall:89, role:"ST", club:"巴黎圣日耳曼", nationality:"法国" },
  "s4-fc26-229558":{ name:"于帕梅卡诺", grade:"A", overall:87, role:"CB", club:"拜仁慕尼黑", nationality:"法国" },
  "s4-fc26-194765":{ name:"格列兹曼", grade:"A", overall:88, role:"ST", club:"马德里竞技", nationality:"法国" },
});

const CLUBS = Object.freeze([
  {
    id:"P-A927135074", short:"芋泥", owner:"Akira", name:"芋泥暖香柑", accent:"#d7b06f", accent2:"#7d4e92",
    honors:{ league:["S2","S6","S8","S9","S10","S12"], cup:["S1","S6","S7","S8","S9"], worldCup:[] },
    appearances:[record("s4-fc26-239818",187,0,10,6.55),record("s4-fc26-255253",165,33,61,6.91),record("legend-cristiano-ronaldo",157,77,38,6.94)],
    scorer:record("s4-fc26-241721",151,97,21,7.02),
    ballonDor:record("legend-cristiano-ronaldo",157,77,38,6.94),
  },
  {
    id:"P-C0ACCAAD1C", short:"美国", owner:"唱反调", name:"皇马美国分部", accent:"#cfcfd8", accent2:"#385da8",
    honors:{ league:["S4前"], cup:["S12"], worldCup:[] },
    appearances:[record("s4-fc26-204963",210,3,22,6.57),record("s4-dlc-20260731-003",181,8,15,6.59),record("s4-fc26-243812",167,74,26,6.88)],
    scorer:record("s4-fc26-238794",120,84,24,7.11), ballonDor:null,
  },
  {
    id:"P-5CF850B13B", short:"皇马", owner:"皇马", name:"皇家马德里", accent:"#f1efe8", accent2:"#b8a064",
    honors:{ league:["S4前","S3","S4","S7"], cup:["S3","S4"], worldCup:[] },
    appearances:[record("ydl-x-player-2",215,80,29,6.79),record("s4-retired-oliver-kahn",170,0,0,6.85),record("s4-fc26-235212",146,1,10,6.54)],
    scorer:record("ydl-x-player-2",215,80,29,6.79), ballonDor:null,
  },
  {
    id:"P-F17F668064", short:"蓝白", owner:"Axero", name:"铁血蓝白AFA", accent:"#8bd7ff", accent2:"#2879c7",
    honors:{ league:["S5"], cup:["S5","S10"], worldCup:["世界杯 I"] },
    appearances:[record("s4-retired-gennaro-gattuso",169,7,18,6.51),record("s4-fc26-226268",164,12,21,6.54),record("s4-fc26-231936",144,3,13,6.57)],
    scorer:record("s4-dlc2-20260803-064",89,69,25,7.28),
    ballonDor:record("s4-dlc2-20260803-071",118,60,54,7.16),
  },
  {
    id:"P-A9C66353D3", short:"利雅得", owner:"ZH", name:"利雅得胜利足球俱乐部", accent:"#f0d75c", accent2:"#2474a6",
    honors:{ league:["S13"], cup:["S13"], worldCup:[] },
    appearances:[record("s4-fc26-231443",199,85,27,6.85),record("s4-fc26-229558",180,2,13,6.6),record("s4-fc26-194765",179,21,15,6.62)],
    scorer:record("s4-fc26-231443",199,85,27,6.85),
    ballonDor:record("s4-fc26-231443",199,85,27,6.85),
  },
  {
    id:"P-23D50182AD", short:"理工大", owner:"罗哥", name:"武汉理工大学", accent:"#75c9d7", accent2:"#455a78",
    honors:{ league:[], cup:[], worldCup:[] },
    appearances:[record("legend-beckenbauer",189,0,14,6.48),record("legend-messi",174,65,16,6.68),record("s4-retired-carles-puyol",171,1,7,6.48)],
    scorer:record("legend-messi",174,65,16,6.68), ballonDor:null,
  },
  {
    id:"P-269ABD614F", short:"教父", owner:"卢卡", name:"冠军教父", accent:"#d0b48b", accent2:"#673d38",
    honors:{ league:["S11"], cup:[], worldCup:[] },
    appearances:[record("s4-dlc2-20260803-008",154,2,12,6.73),record("legend-maradona",135,75,19,6.98),record("s4-retired-javier-zanetti",133,0,9,6.54)],
    scorer:record("legend-maradona",135,75,19,6.98), ballonDor:null,
  },
  {
    id:"P-A3FCAA6528", short:"巴士", owner:"AuI", name:"九龙巴士集团", accent:"#e9c258", accent2:"#8c292c",
    honors:{ league:[], cup:[], worldCup:["世界杯 II"] },
    appearances:[record("s4-fc26-239053",193,21,26,6.58),record("s4-fc26-256196",189,1,13,6.48),record("s4-fc26-203376",188,2,12,6.46)],
    scorer:record("legend-cristiano-ronaldo",107,86,17,7.24), ballonDor:null,
  },
  {
    id:"P-F162C8A606", short:"小黄", owner:"小黄", name:"小黄", accent:"#f1df4d", accent2:"#8c7819",
    honors:{ league:["S4前","S1"], cup:["S11"], worldCup:[] },
    appearances:[record("legend-pele",187,87,38,6.87),record("ydl-x-player-3",179,49,23,6.71),record("s4-fc26-232580",176,4,12,6.62)],
    scorer:record("legend-pele",187,87,38,6.87), ballonDor:null,
  },
]);

function record(playerId, appearances, goals, assists, rating) {
  return { playerId, appearances, goals, assists, rating };
}

const room = document.querySelector("#honor-room");
const switcher = document.querySelector("#honor-club-switcher");
const hero = document.querySelector("#honor-hero");
const galleries = document.querySelector("#honor-trophy-galleries");
const podium = document.querySelector("#appearance-podium");
const scorerFeature = document.querySelector("#top-scorer-feature");
const ballonFeature = document.querySelector("#ballon-dor-feature");
const toast = document.querySelector("#honor-toast");
let selectedClubId = CLUBS[0].id;
let toastTimer = null;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;" })[character]);
}

function profileFor(playerId) {
  return LEGENDARY_PROFILE_BY_PLAYER_ID[playerId] ?? A_PLAYER_PROFILE_BY_PLAYER_ID[playerId] ?? X_PLAYER_PROFILE_BY_PLAYER_ID[playerId] ?? null;
}

function playerCardMarkup(item, options = {}) {
  const player = PLAYERS[item.playerId] ?? { name:item.playerId, grade:"C", overall:0, role:"-", club:"-", nationality:"-" };
  const profile = profileFor(item.playerId);
  const ballonDor = options.ballonDor ? `<span class="s4-player-card-ballon-dor" title="赛季金球奖"><i aria-hidden="true"></i></span>` : "";
  const profileMarkup = profile ? `<img class="s4-player-card-profile" src="${escapeHtml(profile.imageUrl)}" alt="" draggable="false" decoding="async" style="--profile-x:${profile.xPercent}%;--profile-y:${profile.yPercent}%;--profile-width:${profile.widthPercent}%">` : "";
  return `<button type="button" class="s4-player-card honor-history-card grade-${String(player.grade).toLowerCase()} band-base ${profile ? "has-player-profile" : ""} ${options.ballonDor ? "has-ballon-dor" : ""}" data-player-name="${escapeHtml(player.name)}" aria-label="${escapeHtml(`${player.name}，队史${item.appearances}场${item.goals}球`)}">
    ${ballonDor}
    <div class="s4-player-card-head"><strong>${Number(player.overall)}</strong><b>${escapeHtml(player.role)}</b></div>
    <div class="s4-player-card-grade"><span>${escapeHtml(player.grade)}</span></div>
    <div class="s4-player-card-name"><h3>${escapeHtml(player.name)}</h3></div>
    <footer><b>${escapeHtml(player.club)} / ${escapeHtml(player.nationality)}</b></footer>
    ${profileMarkup}
  </button>`;
}

const TROPHY_ASSET_BY_TYPE = Object.freeze({
  league:"/versus/honor_assets/trophy-league-v2.webp",
  cup:"/versus/honor_assets/trophy-cup-v2.webp",
  worldCup:"/versus/honor_assets/trophy-world-cup-v2.webp",
  ballonDor:"/versus/honor_assets/trophy-ballon-dor-v2.webp",
});

function trophyModelMarkup(type) {
  const source = TROPHY_ASSET_BY_TYPE[type] ?? TROPHY_ASSET_BY_TYPE.ballonDor;
  return `<img class="trophy-render" src="${source}" alt="" draggable="false" decoding="async">`;
}

function trophyObjectMarkup(type, season, index) {
  const label = type === "league" ? "联赛冠军" : type === "cup" ? "杯赛冠军" : "世界杯冠军";
  return `<figure class="honor-trophy type-${type}" style="--trophy-delay:${index * 45}ms" title="${escapeHtml(`${season} ${label}`)}">
    <div class="trophy-model">${trophyModelMarkup(type, index)}</div>
    <figcaption><b>${escapeHtml(season)}</b></figcaption>
  </figure>`;
}

function trophyGalleryMarkup(type, seasons) {
  const title = type === "league" ? "联赛冠军" : type === "cup" ? "杯赛冠军" : "世界杯";
  const english = type === "league" ? "LEAGUE" : type === "cup" ? "CUP" : "WORLD CUP";
  const trophies = seasons.length ? seasons.map((season, index) => trophyObjectMarkup(type, season, index)).join("") : `<div class="empty-trophy-case"><span>◇</span><b>尚待镌刻</b><small>NO ${english} TROPHY YET</small></div>`;
  return `<article class="trophy-gallery type-${type}"><header><div><small>${english} HONOURS</small><h3>${title}</h3></div><strong>${seasons.length}<small>座</small></strong></header><div class="trophy-shelf">${trophies}</div></article>`;
}

function podiumCardMarkup(item, rank) {
  const player = PLAYERS[item.playerId];
  return `<article class="podium-entry rank-${rank}"><div class="podium-rank"><span>0${rank}</span><small>${rank === 1 ? "CLUB RECORD" : "APPEARANCES"}</small></div><div class="podium-card">${playerCardMarkup(item)}</div><footer><strong>${item.appearances}<small>场</small></strong><div><b>${escapeHtml(player.name)}</b><span>${item.goals}球 · ${item.assists}助 · ${Number(item.rating).toFixed(2)}评分</span></div></footer></article>`;
}

function recordFeatureMarkup(item, kind, hasBallonDor = false) {
  const player = PLAYERS[item.playerId];
  const headline = kind === "scorer" ? `${item.goals}<small>球</small>` : "金球奖<small>×1</small>";
  const detail = kind === "scorer" ? `${item.appearances}次出场 · ${item.assists}次助攻` : `${item.appearances}场 · ${item.goals}球 · ${item.assists}助攻`;
  const award = kind === "ballonDor" ? `<div class="ballon-award-trophy" aria-label="金球奖奖杯">${trophyModelMarkup("ballonDor", item.playerId)}</div>` : "";
  return `<div class="record-feature-content"><div class="record-feature-card">${playerCardMarkup(item, { ballonDor:hasBallonDor })}</div><div class="record-feature-copy">${award}<span>${kind === "scorer" ? "队史进球纪录" : "俱乐部金球奖得主"}</span><h3>${escapeHtml(player.name)}</h3><strong>${headline}</strong><p>${detail}</p><dl><div><dt>场均评分</dt><dd>${Number(item.rating).toFixed(2)}</dd></div><div><dt>纪录口径</dt><dd>归档正式赛事</dd></div></dl></div></div>`;
}

function emptyBallonDorMarkup() {
  return `<div class="empty-ballon"><div class="empty-ballon-model">${trophyModelMarkup("ballonDor", "empty")}</div><div><small>THE NEXT BALLON D'OR</small><h3>金色展台仍在等待</h3><p>当俱乐部球员赢得赛季金球奖后，他的真实球员卡将在这里永久陈列。</p></div></div>`;
}

function renderSwitcher() {
  switcher.innerHTML = CLUBS.map((club) => `<button type="button" data-club-id="${club.id}" class="${club.id === selectedClubId ? "active" : ""}" style="--club-accent:${club.accent}"><span>${escapeHtml(club.short)}</span><small>${escapeHtml(club.owner)}</small></button>`).join("");
}

function render() {
  const club = CLUBS.find((entry) => entry.id === selectedClubId) ?? CLUBS[0];
  const totalTrophies = club.honors.league.length + club.honors.cup.length + club.honors.worldCup.length;
  room.style.setProperty("--club-accent", club.accent);
  room.style.setProperty("--club-accent-2", club.accent2);
  document.title = `${club.name} · 荣誉室 Demo`;
  renderSwitcher();
  hero.innerHTML = `<div class="honor-hero-copy"><small>ESTABLISHED LEGACY · 13 RECOVERED SEASONS</small><h1>${escapeHtml(club.name)}</h1><p>经理 ${escapeHtml(club.owner)} 的俱乐部荣誉档案</p><div class="hero-stat-line"><span><b>${totalTrophies}</b>冠军奖杯</span><span><b>${club.appearances[0].appearances}</b>队史出场纪录</span><span><b>${club.scorer.goals}</b>队史进球纪录</span></div></div>`;
  galleries.classList.toggle("has-world-cup", club.honors.worldCup.length > 0);
  galleries.innerHTML = trophyGalleryMarkup("league", club.honors.league) + trophyGalleryMarkup("cup", club.honors.cup) + (club.honors.worldCup.length ? trophyGalleryMarkup("worldCup", club.honors.worldCup) : "");
  podium.innerHTML = [club.appearances[1], club.appearances[0], club.appearances[2]].map((item, index) => podiumCardMarkup(item, [2, 1, 3][index])).join("");
  scorerFeature.innerHTML = recordFeatureMarkup(club.scorer, "scorer");
  ballonFeature.innerHTML = club.ballonDor ? recordFeatureMarkup(club.ballonDor, "ballonDor", true) : emptyBallonDorMarkup();
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 1800);
}

switcher.addEventListener("click", (event) => {
  const button = event.target.closest("[data-club-id]");
  if (!button || button.dataset.clubId === selectedClubId) return;
  selectedClubId = button.dataset.clubId;
  render();
  window.scrollTo({ top:0, behavior:"smooth" });
});

document.addEventListener("click", (event) => {
  const card = event.target.closest(".honor-history-card");
  if (card) showToast(`${card.dataset.playerName} · 完整球员生涯档案将在正式版中展开`);
});

document.querySelector("#honor-theme-toggle").addEventListener("click", () => {
  room.classList.toggle("cool-light");
  showToast(room.classList.contains("cool-light") ? "展厅已切换为冷光模式" : "展厅已切换为暖光模式");
});

render();
