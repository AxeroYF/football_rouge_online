
import fs from "node:fs";
import { facilityActionsMarkup } from "../client/buildings/facility-actions-controller.js";
import { scoutingDetailMarkup, scoutMovementMarkup } from "../client/buildings/scouting-controller.js";
import { SCOUTING_RULES, scoutingLevel } from "../shared/config/scouting.mjs";
const dir=new URL("../outputs/scout-units-review/",import.meta.url); fs.mkdirSync(dir,{recursive:true});
const index=fs.readFileSync(new URL("../index.html",import.meta.url),"utf8");
const links=[...index.matchAll(/<link rel="stylesheet"[^>]+>/g)].map(m=>m[0]).join("\n");
const base=new URL("../",import.meta.url).href;
const scout={id:"unit-a",name:"Oliver Bennett",level:1,status:"idle",territoryId:"center",territoryLabel:"德国 · 巴伐利亚",movableTerritoryIds:["target"]};
const center={kind:"center",territoryId:"center",territoryLabel:"德国 · 巴伐利亚",building:{id:"b",status:"active",level:1},rules:SCOUTING_RULES,capacity:2,recruitAvailable:2,scouts:[]};
const unit={kind:"unit",countryCode:"DEU",coreCountry:true,scout,territoryLabel:scout.territoryLabel,rules:SCOUTING_RULES,levelRules:scoutingLevel(1),canDiscover:true};
const views={
  "center-empty":center,
  "center-full":{...center,recruitAvailable:0,scouts:[scout,{...scout,id:"unit-b",name:"Alexander Reynolds",territoryLabel:"西班牙 · 马德里",status:"working"}]},
  "unit-idle":unit,
  "unit-noncore":{...unit,countryCode:"NOR",coreCountry:false,territoryLabel:"挪威 · 西阿格德尔"},
  "unit-working":{...unit,task:{id:"task",countryCode:"DEU",coreCountry:true,status:"working",startedAt:1000,completesAt:601000}},
  "unit-moving":{...unit,sourceLabel:"德国 · 巴伐利亚",destinationLabel:"德国 · 萨克森",scout:{...scout,status:"moving",movement:{id:"trip",fromTerritoryId:"center",toTerritoryId:"target",startedAt:1000,arrivesAt:121000}}},
};
for(const [name,view] of Object.entries(views)){
  const body=scoutingDetailMarkup(view,{gold:10000});
  const moving = views["unit-moving"];
  const widget=`<aside class="campaign-notifications"><div class="scout-notifications"><article class="campaign-expedition-card scout-movement-notice"><header><strong>${moving.scout.name}</strong><button>查看</button></header>${scoutMovementMarkup(moving.scout,{fromLabel:moving.sourceLabel,toLabel:moving.destinationLabel})}</article></div></aside>`;
  const html=`<!doctype html><html lang="zh-CN" data-ui-theme="club"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base href="${base}">${links}<style>body{height:100vh;background:#172622}#review-map{position:relative;width:100%;height:100vh}</style></head><body><main id="review-map"><section id="scouting-window" class="scouting-window ${view.kind==="center"?"is-scout-center":view.scout?.movement?"is-scout-moving":"has-scout-pools"}"><div class="scouting-surface"><header class="scouting-header"><h2>${view.kind==="center"?"球探中心":"球探"}</h2><button>×</button></header><div class="scouting-content">${body}</div>${view.kind==="center"?`<footer class="facility-actions">${facilityActionsMarkup()}</footer>`:""}</div></section><div class="scout-unit-map-icon" style="position:absolute;left:460px;top:180px;width:64px;height:82px"><button class="scout-map-token is-ready"><img src="./assets/scout-tokens/default.svg" alt="球探"><span class="scout-map-badge">✓</span><span class="scout-map-name">Oliver Bennett</span></button></div>${widget}</main></body></html>`;
  fs.writeFileSync(new URL(name+".html",dir),html);
}
console.log("Generated six offline scout UI previews.");
