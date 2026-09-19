import test from "node:test";
import assert from "node:assert/strict";
import { createFacilityActionsController, facilityActionsMarkup, demolitionDialogMarkup } from "../client/buildings/facility-actions-controller.js";
import { createCampaignStore } from "../client/core/campaign-store.js";
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){
  const requests=[], toasts=[], events={};
  const dialog={open:false,innerHTML:"",ownerDocument:{},showModal(){this.open=true;},close(){this.open=false;},querySelector(){return {focus(){}};},addEventListener(type,fn){events[type]=fn;}};
  const state={playerId:"p",buildings:{territories:{a:{canManage:true,buildings:[{id:"center"}]}}}};
  const store=createCampaignStore(state);
  const controller=createFacilityActionsController({dialog,campaignStore:store,getCampaignRequest:()=>((url,options)=>new Promise((resolve,reject)=>requests.push({url,options,resolve,reject}))),showToast:message=>toasts.push(message)});
  const click=selector=>events.click({target:{closest:value=>value===selector?{}:null}});
  const preview={building:{id:"center",label:"球探中心",iconPath:"./assets/building-icons-v2/scout-center.png",level:1},refundGold:0,releasedSlots:1,canDemolish:true,preservesScouts:true};
  const open=()=>controller.open({territoryId:"a",buildingId:"center"});
  return {controller,dialog,store,requests,toasts,events,click,preview,open};
}
test("upgrade has an actionable entry and demolition confirmation states actual consequences",()=>{
  const html=facilityActionsMarkup();
  assert.match(html,/class="facility-upgrade" data-facility-upgrade/);
  assert.match(html,/升级设施/);
  assert.match(html,/data-facility-demolish/);
  assert.doesNotMatch(html,/180,000|确认升级/);
  const modal=demolitionDialogMarkup({building:{label:"<设施>",level:1},canDemolish:false,blockedReason:"训练中",preservesScouts:true});
  assert.match(modal,/&lt;设施&gt;/);
  assert.match(modal,/释放槽位|返还金币/);
  assert.match(modal,/已招募球探及发掘任务保留/);
  assert.match(modal,/data-demolition-confirm disabled/);
});
test("opening and cancelling is read-only, stale preview cannot reopen the dialog",async()=>{
  const f=fixture(); f.open();
  assert.equal(f.dialog.open,true);
  assert.equal(f.requests[0].options,undefined);
  f.click("[data-demolition-close]");
  f.requests[0].resolve(f.preview); await flush();
  assert.equal(f.dialog.open,false);
  assert.equal(f.requests.length,1);
});
test("confirm sends once, locks cancellation while saving and refreshes state on success",async()=>{
  const f=fixture(); f.open(); f.requests[0].resolve(f.preview); await flush();
  f.click("[data-demolition-confirm]"); f.click("[data-demolition-confirm]");
  assert.equal(f.requests.length,2);
  assert.equal(f.requests[1].options.body.buildingId,"center");
  assert.ok(f.requests[1].options.body.requestId);
  f.events.cancel({preventDefault(){}});
  assert.equal(f.dialog.open,true);
  const state={...f.store.getState(),buildings:{territories:{a:{canManage:true,buildings:[]}}}};
  f.requests[1].resolve({state}); await flush();
  assert.equal(f.dialog.open,false);
  assert.equal(f.store.getState(),state);
  assert.deepEqual(f.toasts,["设施已拆除"]);
});
test("blocked preview cannot submit and network retry preserves its request ID",async()=>{
  const f=fixture(); f.open(); f.requests[0].resolve({...f.preview,canDemolish:false,blockedReason:"请先完成或取消训练"}); await flush();
  f.click("[data-demolition-confirm]"); assert.equal(f.requests.length,1);
  f.controller.close(); f.open(); f.requests[1].resolve(f.preview); await flush();
  f.click("[data-demolition-confirm]");
  const id=f.requests[2].options.body.requestId;
  f.requests[2].reject(Error("network error")); await flush();
  assert.equal(f.dialog.open,true); assert.match(f.dialog.innerHTML,/network error/);
  f.click("[data-demolition-confirm]");
  assert.equal(f.requests[3].options.body.requestId,id);
});
test("account changes ignore an in-flight response; a removed facility closes an idle confirmation",async()=>{
  const f=fixture(); f.open(); f.requests[0].resolve(f.preview); await flush(); f.click("[data-demolition-confirm]");
  f.store.setState({playerId:"other"});
  f.requests[1].resolve({state:{playerId:"p"}}); await flush();
  assert.equal(f.dialog.open,false); assert.equal(f.store.getState().playerId,"other");
  const g=fixture(); g.open(); g.requests[0].resolve(g.preview); await flush();
  g.store.setState({...g.store.getState(),buildings:{territories:{a:{canManage:true,buildings:[]}}}});
  assert.equal(g.dialog.open,false);
});
