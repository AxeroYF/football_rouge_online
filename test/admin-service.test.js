import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { EnhancementService } from "../server/application/enhancement-service.mjs";
import { AdminService } from "../server/application/admin-service.mjs";

test("AdminService bootstraps from environment password, audits tasks and adjusts gold", () => {
  const dataPath = path.join(os.tmpdir(), `ydl-admin-${Date.now()}-${Math.random()}.json`);
  const account = { id: "YF-1", nickname:"测试玩家", gold: 100, packs:0 };
  const campaign = {
    accounts: new Map([[account.id, account]]),
    adjustGold(target, delta) { target.gold += delta; return { gold: target.gold }; },
    adminPlayerPackManagement() { return { players:[{ id:account.id,nickname:account.nickname,totalPacks:account.packs }],packTypes:[
      { type:"legendary-player-pack",name:"传奇球员卡包" },
      { type:"exotic-player-pack",name:"珍奇球员卡包" },
      { type:"rare-player-pack",name:"稀有球员卡包" },
      { type:"common-player-pack",name:"普通球员卡包" },
    ],maxGrantCount:999 }; },
    grantPlayerPacksToAccount(accountId, packType, count) { assert.equal(accountId,account.id);account.packs+=count;return { player:{ id:account.id,nickname:account.nickname,packs:[{ type:packType,count:account.packs }] },grant:{ type:packType,name:"珍奇球员卡包",count } }; },
    grantPlayerPacksToAllAccounts(packType,count) { account.packs+=count;return { grant:{ type:packType,name:"普通球员卡包",count },recipientCount:1,totalPacksGranted:count }; },
  };
  const admin = new AdminService({ dataPath, campaign, bootstrapPassword: "secret", now: () => 1000 });
  const session = admin.login("admin", "secret");
  const actor = admin.authenticate(session.token);
  const task = admin.createTask(actor, { type: "rebuild", idempotencyKey: "once" });
  assert.equal(admin.createTask(actor, { type: "other", idempotencyKey: "once" }).id, task.id);
  assert.equal(admin.adjustPlayerGold(actor, account.id, 50, "compensation").gold, 150);
  const management=admin.playerPackManagement(actor);
  assert.equal(management.players[0].id,account.id);
  assert.equal(management.packTypes.length,4);
  const granted=admin.grantPlayerPacks(actor,{ accountId:account.id,packType:"exotic-player-pack",count:3,reason:"活动补偿" });
  assert.equal(granted.player.packs[0].count,3);
  assert.equal(admin.listAudit().length, 3);
  assert.equal(admin.listAudit()[0].action,"player.pack.grant");
  const batch=admin.grantPlayerPacks(actor,{ scope:"all",packType:"common-player-pack",count:2,reason:"全服补偿" });
  assert.equal(batch.recipientCount,1);
  assert.equal(batch.totalPacksGranted,2);
  assert.equal(admin.listAudit().length,4);
  assert.equal(admin.listAudit()[0].action,"player.pack.grant-all");
  assert.throws(()=>admin.grantPlayerPacks(actor,{ accountId:account.id,packType:"legendary-player-pack",count:1000 }),/1 至 999/);
  fs.rmSync(dataPath, { force: true });
});


function grantFixture() {
 const source={id:'catalog-henry',name:'亨利',grade:'S',pool:'ATT',role:'ST',overall:90,attributes:{passing:70,finishing:95},traits:[]};
 const original={...structuredClone(source),id:'existing',playerId:'existing',training:{id:'training'}};
 const account={id:'team-a',nickname:'测试账号',setupComplete:true,gold:100,draft:{teamName:'测试球队',roster:[original]},playerSquads:{assignments:{existing:'expedition'}},tactics:{starters:['existing']},token:'private-token'};
 const other={id:'team-b',setupComplete:true,draft:{teamName:'其他球队',roster:[]}};
 let failure=false,saved;
 const campaign={accounts:new Map([[account.id,account],[other.id,other]]),playerLibrary:[source]};
 campaign.enhancement=new EnhancementService({random:()=>0,now:()=>1234,save:()=>{if(failure)throw new Error('disk failure');saved=structuredClone(account);}});
 const service=new AdminService({campaign,bootstrapPassword:'test-only',now:()=>1234});
 const actor={id:'op',username:'operator',role:'operator'};
 const body={accountId:account.id,playerId:source.id,count:2,upgradeLevel:8,requestId:'grant-123456',reason:'测试'};
 return {service,campaign,account,other,source,actor,body,fail:()=>{failure=true;},saved:()=>saved};
}

test('admin grants independent enhanced cards only to the specified team and preserves lineup/training',()=>{
 const f=grantFixture(),source=structuredClone(f.source),original=structuredClone(f.account.draft.roster[0]);
 const result=f.service.grantPlayers(f.actor,f.body),newCards=f.account.draft.roster.slice(1);
 assert.equal(result.count,2);assert.equal(new Set(result.cardIds).size,2);assert.equal(f.other.draft.roster.length,0);
 assert.deepEqual(f.source,source);assert.deepEqual(f.account.draft.roster[0],original);assert.deepEqual(f.account.tactics,{starters:['existing']});assert.equal(f.account.gold,100);
 for(const card of newCards){assert.equal(card.cardDefinitionId,f.source.id);assert.equal(card.upgradeLevel,8);assert.equal(card.overall,103);assert.equal(card.attributes.passing,83);assert.equal(card.attributes.finishing,99);assert.equal(card.acquisitionSource,'admin');assert.equal(f.account.playerSquads.assignments[card.id],'garrison');}
 assert.equal(f.account.playerSquads.assignments.existing,'expedition');assert.equal(f.saved().draft.roster.length,3);
 const offers=Object.values(f.account.enhancement.offers);assert.equal(offers.length,2);
 const offer=offers[0];f.campaign.enhancement.chooseTrait(f.account,{offerId:offer.id,traitId:offer.traits[0].id});
 const second=Object.values(f.account.enhancement.offers).find(item=>item.cardId===offer.cardId&&item.status==='pending');assert.equal(second.unlockLevel,7);
 f.campaign.enhancement.chooseTrait(f.account,{offerId:second.id,traitId:second.traits[0].id});assert.equal(newCards[0].enhancementTraitIds.length,2);
 assert.equal(f.service.listAudit()[0].action,'player.card.grant');
});

test('admin grant retries survive account reload without duplicate cards or audit records',()=>{
 const f=grantFixture(),first=f.service.grantPlayers(f.actor,f.body),saved=f.saved();
 f.campaign.accounts.set(f.account.id,structuredClone(saved));
 const again=f.service.grantPlayers(f.actor,f.body);assert.equal(again.replayed,true);assert.deepEqual(again.cardIds,first.cardIds);assert.equal(f.campaign.accounts.get(f.account.id).draft.roster.length,3);assert.equal(f.service.listAudit().length,1);
 assert.throws(()=>f.service.grantPlayers(f.actor,{...f.body,count:3}),error=>error.statusCode===409);
});

test('admin grants validate permission, team, active player, numeric bounds before changing a roster',()=>{
 const f=grantFixture(),before=structuredClone(f.account);
 for(const role of ['readonly','content'])assert.throws(()=>f.service.grantPlayers({...f.actor,role},f.body),error=>error.statusCode===403);
 for(const count of [0,-1,1.2,1000,true])assert.throws(()=>f.service.grantPlayers(f.actor,{...f.body,count}),/数量/);
 for(const upgradeLevel of [-1,9,1.2,null,false])assert.throws(()=>f.service.grantPlayers(f.actor,{...f.body,upgradeLevel}),/等级/);
 assert.throws(()=>f.service.grantPlayers(f.actor,{...f.body,accountId:'missing'}),/球队不存在/);
 assert.throws(()=>f.service.grantPlayers(f.actor,{...f.body,playerId:'draft-player'}),/已上线/);
 assert.throws(()=>f.service.grantPlayers(f.actor,{...f.body,requestId:'x'}),/标识/);
 assert.deepEqual(f.account,before);assert.equal(f.service.listAudit().length,0);
 f.account.setupComplete=false;assert.throws(()=>f.service.grantPlayers(f.actor,f.body),/尚未完成建队/);
 const management=f.service.playerGrantManagement({...f.actor,role:'readonly'});assert.equal(management.maxUpgradeLevel,8);assert.doesNotMatch(JSON.stringify(management),/private-token/);
});

test('admin grant restores the entire account when saving fails',()=>{
 const f=grantFixture(),before=structuredClone(f.account);f.fail();
 assert.throws(()=>f.service.grantPlayers(f.actor,f.body),/disk failure/);assert.deepEqual(f.account,before);assert.equal(f.service.listAudit().length,0);
});

test('admin grant levels use the complete S4 ability curve, including level zero',()=>{
 const f=grantFixture(),bonuses=[0,1,2,3,5,7,9,11,13];
 for(let level=0;level<=8;level++){
  f.service.grantPlayers(f.actor,{...f.body,count:1,upgradeLevel:level,requestId:`grant-level-${level}`});
  const card=f.account.draft.roster.at(-1);assert.equal(card.upgradeLevel,level);assert.equal(card.overall,90+bonuses[level]);assert.equal(card.attributes.passing,70+bonuses[level]);
 }
});
