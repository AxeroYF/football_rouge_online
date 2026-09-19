import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {readFileSync} from 'node:fs';
import {ShopService} from '../server/application/shop-service.mjs';
import {EconomyService} from '../server/application/economy-service.mjs';
import {PlayerPackService} from '../server/application/player-pack-service.mjs';
import {EnhancementService} from '../server/application/enhancement-service.mjs';
import {hydrateCampaignWorld,migrateCampaignSave} from '../server/infrastructure/campaign-save-migrations.mjs';
import {SHOP_ROTATION_MS,SHOP_PACKS} from '../shared/config/shop.mjs';
import {shopWindowMarkup,shopRequestId} from '../client/shop/shop-controller.js';
const catalog=Array.from({length:8},(_,i)=>({id:'legend-'+i,name:'传奇 '+i,grade:'S',pool:'MID',role:'CM',overall:92,heightCm:180,nationality:'法国',club:'巴黎',attributes:{passing:94,finishing:88},traits:[]}));
function setup(){let now=SHOP_ROTATION_MS*5+100,broken=false,saves=0;const world={},economy=new EconomyService({now:()=>now}),playerPacks=new PlayerPackService({playerDatabase:catalog}),enhancement=new EnhancementService({economy});const shop=new ShopService({world,playerDatabase:[...catalog,{...catalog[0],id:'x',isX:true},{...catalog[0],id:'a',grade:'A'}],economy,playerPacks,enhancement,now:()=>now,random:()=>.2,save:()=>{saves++;if(broken)throw Error('disk failure');}});const account=id=>({id,setupComplete:true,gold:1000000,goldLedger:[],draft:{roster:[]},playerSquads:{schemaVersion:2,assignments:{}}});return {world,shop,account,economy,setTime:v=>now=v,setBroken:v=>broken=v,saves:()=>saves};}
const request=(view,i=0)=>({kind:'player',itemId:view.offers[i].id,rotationId:view.rotationId,requestId:crypto.randomUUID()});
test('all accounts see the same three distinct +3 S cards, exact prices and fixed deadline',()=>{const f=setup(),a=f.account('a'),b=f.account('b'),v=f.shop.publicState(a);assert.deepEqual(v,f.shop.publicState(b));assert.equal(v.offers.length,3);assert.equal(new Set(v.offers.map(o=>o.player.cardDefinitionId)).size,3);assert.ok(v.offers.every(o=>o.player.grade==='S'&&o.player.upgradeLevel===3&&o.price===100000));assert.equal(v.refreshAt,SHOP_ROTATION_MS*6);assert.equal(f.saves(),1);assert.deepEqual(v.packs.map(p=>p.price),[1000,3000,8000,20000]);});
test('first buyer owns the real enhanced card; the second cannot buy it',()=>{const f=setup(),a=f.account('a'),b=f.account('b'),v=f.shop.publicState(a),r=request(v);f.shop.buy(a,r);assert.equal(a.gold,900000);const p=a.draft.roster[0];assert.equal(p.upgradeLevel,3);assert.equal(p.overall,95);assert.equal(p.attributes.passing,97);assert.equal(p.attributes.finishing,91);assert.equal(p.cardInstanceId,p.id);assert.equal(a.playerSquads.assignments[p.id],'garrison');assert.throws(()=>f.shop.buy(b,{...r,requestId:crypto.randomUUID()}),/已被其他/);assert.equal(b.gold,1000000);assert.equal(b.draft.roster.length,0);assert.equal(f.shop.publicState(b).offers[0].sold,true);assert.equal(f.shop.publicState(b).offers[0].buyerId,undefined);});
test('duplicate requests are idempotent, mismatched request reuse is rejected',()=>{const f=setup(),a=f.account('a'),v=f.shop.publicState(a),r=request(v),first=f.shop.buy(a,r);assert.deepEqual(f.shop.buy(a,r),first);assert.equal(a.draft.roster.length,1);assert.equal(a.gold,900000);assert.throws(()=>f.shop.buy(a,{...r,itemId:'other'}),/不一致/);f.setTime(v.refreshAt);assert.deepEqual(f.shop.buy(a,r),first);});
test('all sold cards remain until the shared three-hour boundary, stale purchases fail',()=>{const f=setup(),a=f.account('a'),v=f.shop.publicState(a);for(let i=0;i<3;i++)f.shop.buy(a,request(v,i));assert.equal(f.shop.publicState(a).offers.filter(o=>o.sold).length,3);f.setTime(v.refreshAt-1);assert.equal(f.shop.publicState(a).rotationId,v.rotationId);f.setTime(v.refreshAt);const next=f.shop.publicState(a);assert.notEqual(next.rotationId,v.rotationId);assert.equal(next.offers.filter(o=>o.sold).length,0);assert.throws(()=>f.shop.buy(a,request(v)),/已刷新/);});
test('each existing pack is delivered unopened once with its configured price',()=>{const f=setup(),a=f.account('a');for(const p of SHOP_PACKS){const r={kind:'pack',itemId:p.type,requestId:crypto.randomUUID()};f.shop.buy(a,r);f.shop.buy(a,r);assert.equal(a.inventory.packs[p.type],1);}assert.equal(a.inventory.pendingOpening,null);assert.equal(a.gold,968000);});
test('insufficient funds and invalid requests do not consume shared inventory',()=>{const f=setup(),a=f.account('a'),v=f.shop.publicState(a);a.gold=99;const before=structuredClone(a);assert.throws(()=>f.shop.buy(a,request(v)),/金币不足/);assert.deepEqual(a,before);assert.equal(f.shop.publicState(a).offers[0].sold,false);assert.throws(()=>f.shop.buy(a,{kind:'pack',itemId:SHOP_PACKS[0].type,requestId:'bad'}),/请求标识/);assert.throws(()=>f.shop.publicState({...a,setupComplete:false}),/建队/);});
test('save failures roll back debit, card delivery, stock and receipts',()=>{const f=setup(),a=f.account('a'),v=f.shop.publicState(a),before=structuredClone(a),stock=structuredClone(f.world.shop);f.setBroken(true);assert.throws(()=>f.shop.buy(a,request(v)),/disk/);assert.deepEqual(a,before);assert.deepEqual(f.world.shop,stock);});
test('rotation save failure restores previous shared offers',()=>{const f=setup(),a=f.account('a'),v=f.shop.publicState(a),before=structuredClone(f.world.shop);f.setTime(v.refreshAt);f.setBroken(true);assert.throws(()=>f.shop.publicState(a),/disk/);assert.deepEqual(f.world.shop,before);});
test('server restart hydrates sold inventory and keeps purchased +3 card instances',()=>{const f=setup(),a=f.account('a'),v=f.shop.publicState(a);f.shop.buy(a,request(v));const index=JSON.parse(readFileSync(new URL('../assets/data/territory-index.json',import.meta.url)));const saved=JSON.parse(JSON.stringify({accounts:{a},world:f.world}));const migrated=migrateCampaignSave({saved,territoryIndex:index,playerDatabase:catalog,playerCatalogVersion:'shop-test',economy:f.economy});assert.deepEqual(migrated.world.shop,f.world.shop);assert.equal(migrated.accounts.get('a').draft.roster[0].attributes.passing,97);assert.equal(migrated.accounts.get('a').draft.roster[0].upgradeLevel,3);assert.deepEqual(hydrateCampaignWorld(index,saved.world).shop,f.world.shop);});
test('sold cards keep their card art, turn gray and cannot be purchased in markup',()=>{const f=setup(),a=f.account('a'),v=f.shop.publicState(a);f.shop.buy(a,request(v));const html=shopWindowMarkup(f.shop.publicState(a));assert.equal((html.match(/data-shop-offer=/g)||[]).length,3);assert.equal((html.match(/data-shop-buy="pack"/g)||[]).length,4);assert.match(html,/shop-legend is-sold/);assert.match(html,/已售出 · 等待刷新/);assert.match(html,/强化加3/);});

test('LAN HTTP clients without randomUUID can create a valid purchase request',()=>{const f=setup(),a=f.account('a');const requestId=shopRequestId({getRandomValues:values=>values.fill(1)});assert.match(requestId,/^[a-f0-9-]{36}$/);f.shop.buy(a,{requestId,kind:'pack',itemId:SHOP_PACKS[0].type});assert.equal(a.inventory.packs[SHOP_PACKS[0].type],1);});


test('150 oil buys the same limited legend without spending gold; either currency exhausts shared stock',()=>{
 const f=setup(),a=f.account('a'),b=f.account('b');a.oil={balance:200};b.oil={balance:200};
 const v=f.shop.publicState(a);assert.equal(v.offers[0].oilPrice,150);assert.equal(v.oil,200);
 const req={...request(v),currency:'oil'},result=f.shop.buy(a,req);assert.equal(a.oil.balance,50);assert.equal(a.gold,1000000);assert.equal(result.price,150);assert.equal(result.currency,'oil');assert.equal(a.draft.roster.length,1);
 assert.deepEqual(f.shop.buy(a,req),result);assert.equal(a.oil.balance,50);
 assert.throws(()=>f.shop.buy(b,{...req,currency:'gold',requestId:crypto.randomUUID()}),/已被其他/);
 assert.throws(()=>f.shop.buy(a,{...req,currency:'gold'}),/不一致/);
 f.shop.buy(b,request(v,1));assert.throws(()=>f.shop.buy(a,{...request(v,1),currency:'oil'}),/已被其他/);
});
test('oil payment validates funds and eligible items and rolls back fuel, card, receipt and stock',()=>{
 const f=setup(),a=f.account('a');a.oil={balance:149};const v=f.shop.publicState(a),req={...request(v),currency:'oil'};
 assert.throws(()=>f.shop.buy(a,req),/石油不足/);assert.equal(a.oil.balance,149);assert.equal(f.shop.publicState(a).offers[0].sold,false);
 assert.throws(()=>f.shop.buy(a,{...req,currency:'science'}),/支付资源/);
 assert.throws(()=>f.shop.buy(a,{...req,kind:'pack',itemId:SHOP_PACKS[0].type}),/只有限量传奇/);
 a.oil.balance=150;const before=structuredClone(a),stock=structuredClone(f.world.shop);f.setBroken(true);assert.throws(()=>f.shop.buy(a,req),/disk/);assert.deepEqual(a,before);assert.deepEqual(f.world.shop,stock);f.setBroken(false);f.shop.buy(a,req);assert.equal(a.oil.balance,0);
});
test('existing rotations expose oil pricing and legacy gold receipts still replay after update',()=>{
 const f=setup(),a=f.account('a');a.oil={balance:150};const view=f.shop.publicState(a);delete f.world.shop.offers[0].oilPrice;
 assert.equal(f.shop.publicState(a).offers[0].oilPrice,150);f.shop.buy(a,{...request(view),currency:'oil'});
 const req=request(view,1);const legacy={kind:'player',name:'old',price:100000};a.shopReceipts[req.requestId]={signature:JSON.stringify([req.kind,req.itemId,req.rotationId]),result:legacy};
 assert.deepEqual(f.shop.buy(a,{...req,currency:'gold'}),legacy);
 const saved=JSON.parse(JSON.stringify(a)),balance=a.oil.balance;const oilRequestId=Object.keys(a.shopReceipts).find(id=>id!==req.requestId);assert.equal(f.shop.buy(saved,{...request(view),currency:'oil',requestId:oilRequestId}).currency,'oil');assert.equal(saved.oil.balance,balance);
});
test('legend controls allow oil when gold is insufficient and never offer oil for packs',()=>{
 const f=setup(),a=f.account('a');a.gold=0;a.oil={balance:150};const html=shopWindowMarkup(f.shop.publicState(a));
 assert.equal((html.match(/data-shop-currency="oil"/g)||[]).length,3);assert.match(html,/150 石油/);assert.doesNotMatch(html,/data-shop-currency="oil"[^>]+disabled/);assert.match(html,/共用限量库存/);
});
