import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {purchaseFixture} from './card-purchase-fixture.mjs';
import {createPlayerCardInstance} from '../server/domain/player-card-instance.mjs';
import {createCampaignApiHandler} from '../server/http/campaign-api-handler.mjs';

test('mixed payment transfers one exact card atomically, persists and retries once',()=>{
  const f=purchaseFixture(),before=[f.a.gold,f.b.gold],{orderId}=f.publish();assert.equal(f.a.gold,before[0]);
  const preview=f.s.cardPurchases.preview(f.b,{orderId,cardIds:[f.card.id]}),body={action:'accept',requestId:'purchase-fixed-accept',orderId,cardIds:[f.card.id],quote:preview.quote};
  const result=f.s.cardPurchases.mutate(f.b,body);assert.deepEqual(f.s.cardPurchases.mutate(f.b,body),result);
  assert.equal(f.a.gold,before[0]-1234);assert.equal(f.b.gold,before[1]+1234);assert.equal(f.a.oil.balance,950);assert.equal(f.b.oil.balance,150);
  assert.equal(f.s.world.territories[f.land].ownerId,'b');assert.ok(f.a.draft.roster.some(p=>p.id===f.card.id));assert.ok(!f.b.draft.roster.some(p=>p.id===f.card.id));
  assert.equal(f.a.playerSquads.assignments[f.card.id],'garrison');f.reload();assert.equal(f.s.cardPurchases.find(orderId).order.status,'filled');assert.ok(f.a.draft.roster.some(p=>p.id===f.card.id));
});
test('multiple orders and duplicate-player quantities require distinct instances and whole-bundle delivery',()=>{
  const f=purchaseFixture(),req={definitionId:f.definition.id,upgradeLevel:2};const one=f.publish({payment:{gold:10}}),two=f.publish({requirements:[req,req],payment:{oil:20}});
  assert.equal(f.s.cardPurchases.list(f.a,{mine:true}).total,2);
  assert.throws(()=>f.accept(two.orderId),/2 张/);assert.throws(()=>f.accept(two.orderId,[f.card.id,f.card.id]),/不重复/);
  const another=createPlayerCardInstance(f.definition,2);f.s.cardManagement.receive(f.b,another);f.accept(two.orderId,[f.card.id,another.id]);
  assert.equal(f.s.cardPurchases.find(one.orderId).order.status,'active');assert.equal(f.a.oil.balance,980);
});
test('exact enhancement, ownership, locked, training and league protections apply before delivery',()=>{
  for(const change of [f=>f.card.upgradeLevel=3,f=>f.card.locked=true,f=>f.card.training={id:'task'},f=>f.card.coalitionLoan={armyId:'army'},f=>f.card.medical={id:'task'}]){
    const f=purchaseFixture(),{orderId}=f.publish({payment:{gold:10}});change(f);const before=f.a.gold;assert.throws(()=>f.accept(orderId));assert.equal(f.a.gold,before);assert.equal(f.s.cardPurchases.find(orderId).order.status,'active');
  }
  const f=purchaseFixture(),{orderId}=f.publish({payment:{gold:10}});assert.throws(()=>f.s.cardPurchases.preview(f.a,{orderId,cardIds:[f.card.id]}),/自己的/);assert.throws(()=>f.accept(orderId,['foreign-card']),/不属于/);
});
test('insufficient funds, invalidated land, and changed quote cannot partially pay',()=>{
  for(const change of [f=>f.a.gold=0,f=>f.a.oil.balance=0,f=>f.s.world.territories[f.land].version++,f=>f.s.world.territories[f.land].ownerId='c']){
    const f=purchaseFixture(),{orderId}=f.publish();change(f);const before=f.b.gold;assert.throws(()=>f.accept(orderId));assert.equal(f.b.gold,before);assert.ok(f.b.draft.roster.includes(f.card));
  }
  const f=purchaseFixture(),{orderId}=f.publish(),preview=f.s.cardPurchases.preview(f.b,{orderId,cardIds:[f.card.id]});f.card.trainingBonuses={finishing:9};assert.throws(()=>f.s.cardPurchases.mutate(f.b,{action:'accept',requestId:'stale-quote-request',orderId,cardIds:[f.card.id],quote:preview.quote}),/重新预览/);
});
test('failed final persistence restores both accounts, territory, lineups and request receipt',()=>{
  const f=purchaseFixture(),{orderId}=f.publish(),preview=f.s.cardPurchases.preview(f.b,{orderId,cardIds:[f.card.id]});
  f.s.save();const before=structuredClone({a:f.a,b:f.b,land:f.s.world.territories[f.land],players:f.s.world.players,revision:f.s.world.revision});
  const persist=f.s.persist.bind(f.s);let calls=0;f.s.persist=()=>{if(++calls===2)throw Error('disk failure');return persist();};
  assert.throws(()=>f.s.cardPurchases.mutate(f.b,{action:'accept',requestId:'rollback-accept',orderId,cardIds:[f.card.id],quote:preview.quote}),/disk failure/);
  assert.deepEqual({a:f.a,b:f.b,land:f.s.world.territories[f.land],players:f.s.world.players,revision:f.s.world.revision},before);
  f.s.persist=persist;f.accept(orderId);assert.equal(f.s.cardPurchases.find(orderId).order.status,'filled');
});
test('cancel ownership, publish idempotency and competing accept cannot duplicate assets',()=>{
  const f=purchaseFixture(),body={action:'publish',requestId:'publish-replay',requirements:[{definitionId:f.definition.id,upgradeLevel:2}],payment:{gold:9}};
  const first=f.s.cardPurchases.mutate(f.a,body);assert.deepEqual(f.s.cardPurchases.mutate(f.a,body),first);assert.equal(f.s.cardPurchases.list(f.a,{mine:true}).total,1);
  assert.throws(()=>f.s.cardPurchases.mutate(f.b,{action:'cancel',requestId:'foreign-cancel',orderId:first.orderId}),/自己的/);
  f.s.cardPurchases.mutate(f.a,{action:'cancel',requestId:'owner-cancel',orderId:first.orderId});assert.throws(()=>f.accept(first.orderId),/撤销/);
  const second=f.publish({payment:{gold:10}});f.accept(second.orderId);assert.throws(()=>f.accept(second.orderId),/成交/);
});
test('bad definitions, prices, levels, empty orders and protected territories are rejected',()=>{
  const f=purchaseFixture();for(const patch of [{requirements:[]},{requirements:[{definitionId:'invented',upgradeLevel:2}]},{requirements:[{definitionId:f.definition.id,upgradeLevel:11}]},{payment:{gold:-1}},{payment:{gold:1.2}},{payment:{oil:1000001}},{payment:{}},{payment:{territoryIds:['a']}}])assert.throws(()=>f.publish(patch));
  assert.equal(f.s.cardPurchases.list(f.a,{mine:true}).total,0);
});
test('paged reads do not save or send another players warehouse; only detail sends own matches',()=>{
  const f=purchaseFixture();for(let i=0;i<20;i++)f.publish({payment:{gold:1}});assert.throws(()=>f.publish(),/20 条/);
  let writes=0;f.s.save=()=>writes++;f.s.persist=()=>writes++;const page=f.s.cardPurchases.list(f.b);assert.equal(page.orders.length,20);assert.equal(writes,0);assert.ok(!JSON.stringify(page).includes('effectiveAttributes'));
  const detail=f.s.cardPurchases.detail(f.b,page.orders[0].id);assert.equal(detail.candidates.length,1);assert.equal(detail.candidates[0].id,f.card.id);assert.equal(writes,0);assert.deepEqual(f.s.cardPurchases.detail(f.a,page.orders[0].id).candidates,[]);
});
test('gold-only, oil-only and territory-only settlement supported',()=>{
  for(const payment of [{gold:11},{oil:12},{territoryIds:['purchase-land']}]){const f=purchaseFixture(),{orderId}=f.publish({payment});f.accept(orderId);assert.equal(f.s.cardPurchases.find(orderId).order.status,'filled');}
});
test('API authenticates and exposes paged purchase routes with compact mutation responses',async()=>{
  const f=purchaseFixture(),handler=createCampaignApiHandler({campaign:f.s});let response;
  const res={writeHead(status){this.status=status;},end(body){response=JSON.parse(body);}};
  await handler({method:'GET',headers:{authorization:'Bearer a'}},res,'/api/campaign/card-purchases','/api/campaign/card-purchases?mine=1');assert.equal(res.status,200);assert.equal(response.total,0);
  await handler({method:'GET',headers:{authorization:'Bearer a'}},res,'/api/campaign/card-purchases/options','/api/campaign/card-purchases/options');assert.ok(response.territories.some(t=>t.id===f.land));
  const body={action:'publish',requestId:'http-publish-request',requirements:[{definitionId:f.definition.id,upgradeLevel:2}],payment:{gold:1}},req=Readable.from([Buffer.from(JSON.stringify(body))]);req.method='POST';req.headers={authorization:'Bearer a'};
  await handler(req,res,'/api/campaign/card-purchases','/api/campaign/card-purchases');assert.equal(response.result.status,'active');assert.deepEqual(Object.keys(response),['result']);
});


test('purchase orders deliver +9/+10 cards with traits intact and reject +11',()=>{
 for(const level of [9,10]){
  const f=purchaseFixture();f.card.upgradeLevel=level;f.card.enhancementTraitIds=['one','two','three','four'].slice(0,level===9?3:4);f.card.traits=f.card.enhancementTraitIds.map(id=>({id,name:id}));
  const {orderId}=f.publish({requirements:[{definitionId:f.definition.id,upgradeLevel:level}],payment:{gold:10}});f.accept(orderId);
  const received=f.a.draft.roster.find(p=>p.id===f.card.id);assert.equal(received.upgradeLevel,level);assert.equal(received.enhancementTraitIds.length,level===9?3:4);
 }
 const f=purchaseFixture();assert.throws(()=>f.publish({requirements:[{definitionId:f.definition.id,upgradeLevel:11}],payment:{gold:10}}),/强化等级/);
});
