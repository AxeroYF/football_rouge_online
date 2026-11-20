import test from 'node:test';
import assert from 'node:assert/strict';
import {createEnhancementPresentation,createFusionWarehouseController} from '../versus/public/enhancement-interface.js';
import {createGameSettings,normalizeGameSettings,DEFAULT_GAME_SETTINGS} from '../versus/public/game-settings.js';

function environment() {
  const doc = new EventTarget(); doc.hidden = false;
  const timers = new Map(); let id = 0;
  return {document:doc, timers, setTimeout:fn => { timers.set(++id,fn); return id; }, clearTimeout:key => timers.delete(key)};
}
test('skipping an enhancement releases only the presentation wait and the next operation can animate', async () => {
  const env = environment(), effects = createEnhancementPresentation(env);
  effects.start(); const pending = effects.wait(1150);
  assert.equal(env.timers.size,1);
  effects.skip(); await pending;
  assert.equal(env.timers.size,0); assert.equal(effects.skipped,true);
  effects.start(); const next = effects.wait(1150);
  assert.equal(effects.skipped,false); assert.equal(env.timers.size,1);
  [...env.timers.values()][0](); await next;
  assert.equal(env.timers.size,0); effects.destroy();
});
test('reduced motion and backgrounding do not leave a pending presentation delay', async () => {
  const env = environment(); let enabled = false;
  const effects = createEnhancementPresentation(env,()=>enabled);
  effects.start(); await effects.wait(1150); assert.equal(env.timers.size,0);
  enabled = true; effects.start(); const pending = effects.wait(1150);
  env.document.hidden = true; env.document.dispatchEvent(new Event('visibilitychange'));
  await pending; assert.equal(env.timers.size,0);
  env.document.hidden = false; await effects.wait(1150); assert.equal(env.timers.size,0);
  effects.start(); const final = effects.wait(100); effects.destroy(); await final;
  assert.equal(env.timers.size,0);
});
test('classic and modern layouts persist, with modern as the missing or invalid preference default', () => {
  const env = new EventTarget(), data = new Map();
  env.localStorage = {getItem:key=>data.get(key),setItem:(key,value)=>data.set(key,value)};
  const settings = createGameSettings(env);
  assert.equal(settings.value.enhancementInterface,'modern');
  settings.update({enhancementInterface:'classic'});
  const restored = createGameSettings(env);
  assert.equal(restored.value.enhancementInterface,'classic');
  restored.update({enhancementInterface:'modern'});
  assert.equal(normalizeGameSettings({enhancementInterface:'broken'}).enhancementInterface,'modern');
  assert.equal(DEFAULT_GAME_SETTINGS.enhancementInterface,'modern');
  settings.destroy(); restored.destroy();
});

function drawerFixture() {
  const env = Object.assign(new EventTarget(),environment(),{innerHeight:900,scrollY:0});
  const classes = new Set(), attrs = new Map();
  const button = {setAttribute:(k,v)=>attrs.set(k,v),matches:s=>s==='[data-fusion-drawer-toggle]',focus:()=>{env.document.activeElement=button;}};
  const input = {matches:s=>s!=='[data-fusion-drawer-toggle]',focus:()=>{env.document.activeElement=input;}};
  const content = {inert:false};
  const drawer = Object.assign(new EventTarget(),{contains:node=>node===input||node===button});
  const nodes = {'[data-fusion-drawer]':drawer,'[data-fusion-drawer-toggle]':button,'.fusion-drawer-content':content,'.enhancement-tools input':input};
  const root = Object.assign(new EventTarget(),{isConnected:true,querySelector:s=>nodes[s],getBoundingClientRect:()=>({top:100}),style:{setProperty(){}},classList:{contains:s=>classes.has(s),toggle(s,on){on?classes.add(s):classes.delete(s);}}});
  const dispatch = (node,type,props={}) => {const event=new Event(type,{cancelable:true});for(const [k,v]of Object.entries(props))Object.defineProperty(event,k,{value:v});node.dispatchEvent(event);};
  const flush = () => {for(const fn of [...env.timers.values()])fn();};
  const controller=createFusionWarehouseController(env);controller.mount(root);
  return {env,root,drawer,button,input,content,attrs,classes,controller,dispatch,flush};
}
test('warehouse starts inert, opens on mouse hover, survives card rerender and closes after pointer exit',()=>{
  const f=drawerFixture(); assert.equal(f.content.inert,true);
  f.dispatch(f.drawer,'pointerenter',{pointerType:'mouse'});
  assert.equal(f.attrs.get('aria-expanded'),'true');assert.equal(f.content.inert,false);
  const mouseClick={detail:1,target:{closest:s=>s==='[data-fusion-drawer-toggle]'?f.button:null}};
  f.dispatch(f.root,'click',mouseClick);
  assert.equal(f.content.inert,false);
  f.dispatch(f.root,'click',mouseClick);
  assert.equal(f.content.inert,true);
  f.dispatch(f.root,'click',mouseClick);
  f.classes.clear();f.content.inert=true;f.controller.mount(f.root);
  assert.equal(f.content.inert,false);assert.ok(f.classes.has('fusion-warehouse-open'));
  f.dispatch(f.drawer,'pointerleave',{pointerType:'mouse'});assert.equal(f.content.inert,false);
  f.flush();assert.equal(f.content.inert,true);f.controller.destroy();
});
test('warehouse supports touch toggle, Escape and keeps focused filters available',()=>{
  const f=drawerFixture();
  f.dispatch(f.drawer,'pointerenter',{pointerType:'touch'});assert.equal(f.content.inert,true);
  f.dispatch(f.root,'click',{target:{closest:s=>s==='[data-fusion-drawer-toggle]'?f.button:null}});
  assert.equal(f.content.inert,false);
  f.dispatch(f.drawer,'focusout',{relatedTarget:null});f.flush();assert.equal(f.content.inert,false);
  f.env.document.activeElement=f.input;
  f.dispatch(f.drawer,'pointerleave',{pointerType:'mouse'});f.flush();assert.equal(f.content.inert,false);
  f.dispatch(f.root,'keydown',{key:'Escape',target:f.input});assert.equal(f.content.inert,true);assert.equal(f.env.document.activeElement,f.button);
  f.controller.destroy();
});
test('warehouse remains open during drag and resets when leaving the new interface',()=>{
  const f=drawerFixture();f.dispatch(f.root,'dragstart');
  f.dispatch(f.drawer,'pointerleave',{pointerType:'mouse'});f.flush();assert.equal(f.content.inert,false);
  f.dispatch(f.root,'dragend');f.flush();assert.equal(f.content.inert,true);
  f.dispatch(f.drawer,'pointerenter',{pointerType:'mouse'});f.controller.mount(null);f.controller.mount(f.root);
  assert.equal(f.content.inert,true);f.controller.destroy();
});
