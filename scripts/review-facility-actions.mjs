import fs from "node:fs";
import { facilityActionsMarkup, demolitionDialogMarkup } from "../client/buildings/facility-actions-controller.js";
import { trainingPanelMarkup } from "../client/buildings/training-controller.js";
const output = new URL("../outputs/facility-actions-review/", import.meta.url); fs.mkdirSync(output,{recursive:true});
const index = fs.readFileSync(new URL("../index.html",import.meta.url),"utf8");
const links = [...index.matchAll(/<link rel="stylesheet"[^>]+>/g)].map(match=>match[0]).join("\n");
const building={id:"training",label:"训练中心",type:"training-center",status:"active",level:1,iconPath:"./assets/building-icons-v2/training-center.png"};
const training={building,territoryLabel:"西班牙 · 马德里",capacity:1,tasks:[],players:[]};
const preview={building,canDemolish:true,refundGold:0,releasedSlots:1};
const cases={
  "training-idle":`<aside id="training-window" class="training-window"><header class="training-header"><h2>训练中心</h2><button>×</button></header><div class="training-content">${trainingPanelMarkup(training)}</div><footer class="facility-actions">${facilityActionsMarkup()}</footer></aside>`,
  "training-busy":`<aside id="training-window" class="training-window"><header class="training-header"><h2>训练中心</h2><button>×</button></header><div class="training-content">${trainingPanelMarkup({...training,tasks:[{id:"task",buildingId:"training",pool:"ATT",slot:0,status:"working",playerName:"训练球员",startedAt:1000,completesAt:601000}]})}</div><footer class="facility-actions">${facilityActionsMarkup()}</footer></aside>`,
  "confirm-training":`<dialog open id="facility-demolition-dialog">${demolitionDialogMarkup(preview)}</dialog>`,
  "confirm-scout":`<dialog open id="facility-demolition-dialog">${demolitionDialogMarkup({...preview,building:{...building,label:"球探中心",iconPath:"./assets/building-icons-v2/scout-center.png"},preservesScouts:true})}</dialog>`,
  "blocked-training":`<dialog open id="facility-demolition-dialog">${demolitionDialogMarkup({...preview,canDemolish:false,blockedReason:"请先完成或取消该中心正在进行的训练"})}</dialog>`,
  "pending":`<dialog open id="facility-demolition-dialog">${demolitionDialogMarkup(preview,{pending:true})}</dialog>`,
};
for(const [name,markup] of Object.entries(cases)){
  fs.writeFileSync(new URL(name+".html",output),`<!doctype html><html lang="zh-CN" data-ui-theme="club"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base href="${new URL("../",import.meta.url).href}">${links}<style>body{height:100vh;background:#172622}main{position:relative;height:100vh}</style></head><body><main>${markup}</main></body></html>`);
}
console.log("Generated six facility action previews.");
