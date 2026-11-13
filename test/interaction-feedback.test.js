import test from 'node:test';
import assert from 'node:assert/strict';
import {createValueChanges,createInteractionFeedback,leagueActionNotice} from '../versus/public/interaction-feedback.js';
import {createUiMotion} from '../versus/public/ui-motion.js';

function fixture() {
  class Element extends EventTarget {
    constructor(){super();this.dataset={};this.style={};this.attrs=new Map();this.children=[];this.isConnected=true;this.disabled=false;}
    get attributes(){return [...this.attrs].map(([name,value])=>({name,value}));}
    setAttribute(name,value){this.attrs.set(name,String(value));}
    getAttribute(name){return this.attrs.get(name)??null;}
    removeAttribute(name){this.attrs.delete(name);}
    hasAttribute(name){return this.attrs.has(name);}
    closest(){return null;}
    querySelector(){return null;}
    querySelectorAll(){return [];}
    append(...items){this.children.push(...items);}
    remove(){this.isConnected=false;}
    getBoundingClientRect(){return {left:20,top:20,bottom:50,width:60,height:30};}
  }
  const document=Object.assign(new EventTarget(),{createElement:()=>new Element(),body:new Element(),querySelectorAll:()=>[]});
  const played=[];
  const motion={enabled:true,prune(){},play(element,kind){if(this.enabled)played.push({element,kind});}};
  const env={document,innerWidth:390,innerHeight:844,setTimeout,clearTimeout};
  const feedback=createInteractionFeedback({motion,env});
  return {Element,document,motion,feedback,played,env};
}

test('resource differences skip initial snapshots, duplicate refreshes and account changes',()=>{
  const changes=createValueChanges();
  assert.deepEqual(changes.update('a',{coins:100,packs:0}),[]);
  assert.deepEqual(changes.update('a',{coins:80,packs:2}),[{name:'coins',delta:-20},{name:'packs',delta:2}]);
  assert.deepEqual(changes.update('a',{coins:80,packs:2}),[]);
  assert.deepEqual(changes.update('b',{coins:200,packs:5}),[]);
  changes.reset();assert.deepEqual(changes.update('b',{coins:400,packs:10}),[]);
});

test('disabled motion consumes resource changes and background return never replays them',()=>{
  const f=fixture(),anchor=new f.Element();
  f.feedback.resourceChanges('a',{coins:100},{coins:anchor});
  f.motion.enabled=false;f.feedback.resourceChanges('a',{coins:80},{coins:anchor});
  f.motion.enabled=true;f.feedback.resourceChanges('a',{coins:80},{coins:anchor});
  assert.equal(f.played.length,0);
  f.document.dispatchEvent(new Event('visibilitychange'));
  f.feedback.resourceChanges('a',{coins:200},{coins:anchor});assert.equal(f.played.length,0);
  f.feedback.destroy();
});

test('pending requests deduplicate and preserve disabled state across rerender',async()=>{
  const f=fixture(),button=new f.Element();button.setAttribute('data-market-buy','listing-1');
  const ink=new Map();button.style={setProperty:(key,value)=>ink.set(key,value),removeProperty:key=>ink.delete(key)};
  f.env.getComputedStyle=element=>({color:element.disabled?'gray':'white'});
  let resolve,calls=0;
  const task=()=>{calls++;return new Promise(r=>resolve=r);};
  const pending=f.feedback.request(button,task,{key:'buy'});
  assert.equal(button.disabled,true);assert.equal(button.getAttribute('aria-busy'),'true');
  assert.equal(ink.get('--request-ink'),'white');
  assert.equal(f.feedback.request(button,task,{key:'buy'}),pending);
  await Promise.resolve();assert.equal(calls,1);
  // Server render has now disabled a sold-out replacement control independently.
  const replacement=new f.Element();replacement.disabled=true;
  f.document.querySelectorAll=()=>[replacement];
  f.feedback.sync({querySelectorAll:()=>[]},'shop');
  resolve({});await pending;
  assert.equal(button.disabled,false);assert.equal(button.getAttribute('aria-busy'),null);
  assert.equal(ink.has('--request-ink'),false);
  assert.equal(replacement.disabled,true);assert.equal(replacement.dataset.requestState,undefined);
  f.feedback.destroy();
});

test('trade history highlights new offers and confirmed status changes only once',()=>{
  const f=fixture(),offer=new f.Element();offer.dataset.motionTradeOffer='offer1';offer.dataset.motionTradeState='pending';
  let offers=[];
  const root={querySelectorAll:selector=>selector==='[data-motion-trade-offer]'?offers:[]};
  f.feedback.sync(root,'team:market');offers=[offer];f.feedback.sync(root,'team:market');
  assert.equal(f.played.length,1);
  f.feedback.sync(root,'team:market');assert.equal(f.played.length,1);
  offer.dataset.motionTradeState='accepted';f.feedback.sync(root,'team:market');assert.equal(f.played.length,2);
  f.feedback.sync(root,'team:market');assert.equal(f.played.length,2);f.feedback.destroy();
});

test('request errors leave a persistent readable notice and permit retry',async()=>{
  const f=fixture(),button=new f.Element();
  await assert.rejects(f.feedback.request(button,async()=>{throw new Error('余额不足');}),/余额不足/);
  assert.equal(button.disabled,false);assert.equal(button.dataset.requestState,undefined);
  assert.equal(f.feedback.isShowing('余额不足'),true);
  const notice=f.document.body.children.at(-1);assert.equal(notice.getAttribute('role'),'alert');
  await f.feedback.request(button,async()=>({ok:true}));assert.equal(button.disabled,false);
  assert.equal(f.feedback.isShowing('余额不足'),false);
  f.feedback.destroy();
});

test('lineup and selection effects target changed elements once without changing their positions',()=>{
  const f=fixture(),a=new f.Element(),b=new f.Element(),slot=new f.Element();
  a.setAttribute('data-league-magnet','a');a.dataset.leagueMagnet='a';a.style.left='20%';a.style.top='30%';
  b.setAttribute('data-league-magnet','b');b.dataset.leagueMagnet='b';b.style.left='60%';b.style.top='30%';
  slot.dataset.enhancementDrop='main';let card=null;slot.querySelector=()=>card;
  const root={querySelectorAll(selector){return selector.startsWith('[data-league-magnet]')?[a,b]:selector==='[data-enhancement-drop]'?[slot]:[];}};
  f.feedback.sync(root,'team:squad');assert.equal(f.played.length,0);
  a.style.left='25%';f.feedback.sync(root,'team:squad');
  assert.deepEqual(f.played.map(p=>p.element),[a]);assert.equal(a.style.left,'25%');
  f.feedback.sync(root,'team:squad');assert.equal(f.played.length,1);
  card={dataset:{enhancementCardId:'card1'}};f.feedback.sync(root,'team:squad');assert.equal(f.played.at(-1).element,slot);
  f.feedback.sync(root,'team:other');assert.equal(f.played.length,2);
  f.feedback.destroy();
});

test('purchase feedback uses confirmed inventory and business failures never become success notices',()=>{
  const before={shop:{catalog:[{id:'basic',name:'基础包'}]},s4Packs:{inventory:[{id:'old'}]}};
  const after={s4Packs:{inventory:[{id:'old'},{id:'new'}]},cardTradeResult:{status:'failed',reason:'球员卡已锁定'}};
  assert.deepEqual(leagueActionNotice('/shop/buy-s4',{packType:'basic',quantity:99},before,after),{title:'购买成功',detail:'基础包 × 1，已放入背包'});
  assert.equal(leagueActionNotice('/card-trades/respond',{action:'accept'},before,after).kind,'error');
  assert.equal(leagueActionNotice('/team/rename',{},before,after),null);
});

test('radar interpolation cancels to the final points immediately when motion is switched off',()=>{
  const document=Object.assign(new EventTarget(),{hidden:false,documentElement:{dataset:{}}});
  const frames=new Map();let id=0;
  const env={document,requestAnimationFrame:fn=>{frames.set(++id,fn);return id;},cancelAnimationFrame:token=>frames.delete(token)};
  const motion=createUiMotion(env);let points='10,10 20,20';
  const polygon={isConnected:true,getAttribute:()=>points,setAttribute:(_,value)=>points=value};
  motion.polygon(polygon,'0,0 0,0');assert.equal(frames.size,1);
  const first=frames.values().next().value;frames.clear();first(100);
  assert.equal(points,'0 0 0 0');
  motion.setPreference('off');assert.equal(points,'10,10 20,20');assert.equal(frames.size,0);
  motion.polygon(polygon,'0,0 0,0');assert.equal(frames.size,0);motion.destroy();
});
