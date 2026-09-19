import test from "node:test";
import assert from "node:assert/strict";
import { TrainingService } from "../server/application/training-service.mjs";
import { EnhancementService } from "../server/application/enhancement-service.mjs";
import { EconomyService } from "../server/application/economy-service.mjs";
import { CampaignService } from "../campaign-service.mjs";
import { S4_ENHANCEMENT, s4EnhancementChanceForLevels, s4EnhancementProtectionCost } from "../shared/config/enhancement.mjs";
import { YDL_TRAIT_BY_ID } from "../engine/s4-v2.1/versus/trait-pool.js";
import { buildV2TeamSnapshots } from "../engine/s4-v2.1/versus/v2/team-snapshot-v2.js";
const card = (id, level = 0, family = "henry") => ({ id, playerId:id, cardDefinitionId:family, name:"亨利", pool:"ATT", role:"ST", grade:"S", baseOverall:90, overall:90 + S4_ENHANCEMENT.abilityBonuses[level], upgradeLevel:level, attributes:{ passing:70 + S4_ENHANCEMENT.abilityBonuses[level], finishing:90 + S4_ENHANCEMENT.abilityBonuses[level] }, referenceAttributes:{ passing:70, finishing:90 }, traits:[], state:{ fitness:100 } });
function fixture(mainLevel = 0, materialLevel = mainLevel) {
  const account = { id:"p", setupComplete:true, gold:100000, goldLedger:[], draft:{ roster:[card("main",mainLevel),card("material",materialLevel)] }, playerSquads:{assignments:{main:"expedition",material:"garrison"}} };
  let random = 0, failure = false, saved;
  const world = { activeChallenges:{},territories:{} };
  const service = new EnhancementService({ economy:new EconomyService(), random:()=>random, now:()=>1234, save:()=>{if(failure)throw Error("disk failure");saved=structuredClone(account);} });
  const run = (options={}) => service.enhance(account,world,{mainCardId:"main",materialCardId:"material",useProtection:false,requestId:"once-1234",...options});
  return {account,world,service,run,setRoll:v=>{random=v;},fail:v=>{failure=v;},saved:()=>saved};
}
test("S4 probabilities, protection prices, maximum and bonus thresholds are unchanged",()=>{
  assert.deepEqual(S4_ENHANCEMENT.equalLevelChances,[100,100,95,85,70,55,40,25]);
  for(let i=0;i<8;i++)assert.equal(s4EnhancementChanceForLevels(i,i),S4_ENHANCEMENT.equalLevelChances[i]);
  assert.equal(s4EnhancementChanceForLevels(3,2),51);assert.equal(s4EnhancementProtectionCost(85),150);
  assert.deepEqual(S4_ENHANCEMENT.abilityBonuses,[0,1,2,3,5,7,9,11,13]);
});
test("same-name enhancement consumes only material, preserves training and lineup, and retries once",()=>{
  const f=fixture(3),main=f.account.draft.roster[0];
  main.attributes.passing+=5;main.trainingBonuses={passing:5};main.traits=[{id:"existing",name:"既有特性"}];
  f.account.tactics={squads:{expedition:{starters:["main"],positions:{main:{x:40,y:20}},bench:["material"]}}};
  const result=f.run();assert.equal(result.afterLevel,4);assert.equal(main.attributes.passing,80);assert.equal(main.overall,95);
  assert.deepEqual(main.trainingBonuses,{passing:5});assert.equal(main.traits[0].id,"existing");
  assert.equal(f.account.draft.roster.length,1);assert.deepEqual(f.account.tactics.squads.expedition.starters,["main"]);
  assert.deepEqual(f.account.tactics.squads.expedition.positions.main,{x:40,y:20});assert.deepEqual(f.account.tactics.squads.expedition.bench,[]);
  assert.equal(f.run().id,result.id);assert.equal(f.account.enhancement.history.length,1);
  assert.throws(()=>f.run({useProtection:true}),/不一致/);
});
test("failed enhancement drops one level at +3 and above unless protected; low levels retain",()=>{
  for(const [before,protect,after] of [[2,false,2],[3,false,2],[4,false,3],[4,true,4]]) {
    const f=fixture(before);f.setRoll(.999);const result=f.run({useProtection:protect});
    assert.equal(result.success,false);assert.equal(result.afterLevel,after);assert.equal(f.account.draft.roster.length,1);
    assert.equal(f.account.gold,100000-(protect?s4EnhancementProtectionCost(result.chance):0));
  }
});
test("invalid ownership, identity, locked cards and insufficient gold cause no asset mutation",()=>{
  for(const change of [f=>{f.account.draft.roster[1].cardDefinitionId="other";},f=>{f.account.draft.roster[1].locked=true;},f=>{f.account.gold=0;}]) {
    const f=fixture(4);change(f);const before=structuredClone(f.account);assert.throws(()=>f.run({useProtection:true}));assert.deepEqual(f.account,before);
  }
  const f=fixture();assert.throws(()=>f.run({materialCardId:"main"}),/同一张/);assert.throws(()=>f.run({mainCardId:"foreign"}),/本队/);
  assert.throws(()=>fixture(8).run(),/最高/);assert.throws(()=>fixture(1,2).run(),/不能低于/);
});
test("failed persistence rolls back consumed card, rewards, trait offers and gold",()=>{
  const f=fixture(3),before=structuredClone(f.account);f.fail(true);assert.throws(()=>f.run({useProtection:true}),/disk failure/);assert.deepEqual(f.account,before);
  f.fail(false);f.run({useProtection:true});assert.equal(f.account.enhancement.history.length,1);
});
test("+4 and +7 grant unique eligible S4 traits that reach the match snapshot and survive downgrades",()=>{
  const f=fixture(3);let result=f.run();const offer=result.traitOffer;
  assert.equal(offer.traits.length,3);assert.equal(new Set(offer.traits.map(t=>t.id)).size,3);
  assert.ok(offer.traits.every(t=>t.eligibleRoleGroups.includes("ANY")||t.eligibleRoleGroups.includes("ATT")));
  assert.throws(()=>f.service.chooseTrait(f.account,{offerId:offer.id,traitId:"forged"}),/候选/);
  f.service.chooseTrait(f.account,{offerId:offer.id,traitId:offer.traits[0].id});
  f.service.chooseTrait(f.account,{offerId:offer.id,traitId:offer.traits[0].id});
  const main=f.account.draft.roster[0];assert.equal(main.enhancementTraitIds.length,1);
  const snapshots=buildV2TeamSnapshots([{id:"team",players:[main]}]);
  assert.ok(snapshots[0].players[0].v2AppliedTraitIds.includes(offer.traits[0].id));
  assert.ok(snapshots[0].players[0].traitDefinitions.some(t=>t.id===offer.traits[0].id));
  f.service.applyLevel(main,6);f.account.draft.roster.push(card("material2",6));
  result=f.run({materialCardId:"material2",requestId:"second-1234"});assert.equal(result.afterLevel,7);assert.equal(result.traitOffer.unlockLevel,7);
  assert.ok(result.traitOffer.traits.every(t=>t.id!==offer.traits[0].id));
  f.service.chooseTrait(f.account,{offerId:result.traitOffer.id,traitId:result.traitOffer.traits[0].id});
  f.account.draft.roster.push(card("material3",7));f.setRoll(.999);f.run({materialCardId:"material3",requestId:"third-1234"});
  assert.equal(main.upgradeLevel,6);assert.equal(main.enhancementTraitIds.length,2);
});
test("batch enhancement respects levels and supplies and is atomic and idempotent",()=>{
  const f=fixture();f.account.draft.roster=Array.from({length:8},(_,i)=>card("card"+i));
  const options={playerId:"henry",mainLevel:0,materialLevel:0,quantity:3,requestId:"batch-1234"};
  const result=f.service.batch(f.account,f.world,options);assert.equal(result.quantity,3);assert.equal(result.successCount,3);assert.equal(f.account.draft.roster.length,5);
  assert.equal(f.service.batch(f.account,f.world,options).quantity,3);assert.equal(f.account.draft.roster.length,5);
  assert.throws(()=>f.service.batch(f.account,f.world,{...options,mainLevel:3,requestId:"batch-invalid"}),/逐张/);
});
test("pending offer on consumed material is cancelled and finished training does not leave a stale result",()=>{
  const f=fixture(3);const first=f.run();const main=f.account.draft.roster[0];
  const other=card("other",4);f.account.draft.roster.push(other);
  f.account.training={tasks:{old:{playerId:"main",completedAt:1234}}};
  f.run({mainCardId:"other",materialCardId:"main",requestId:"consume-pending"});
  assert.equal(f.account.enhancement.offers[first.traitOffer.id].status,"cancelled");assert.equal(f.account.training.tasks.old.finishedAt,1234);
});
test("campaign reload preserves enhanced attributes, training, chosen traits and replay identity",()=>{
  const f=fixture(3);const result=f.run();f.service.chooseTrait(f.account,{offerId:result.traitOffer.id,traitId:result.traitOffer.traits[0].id});
  let saved={accounts:{p:structuredClone(f.account)},world:null};
  const repository={load:()=>structuredClone(saved),save:value=>{saved=structuredClone(value);}};
  const campaign=new CampaignService({catalog:[card("main",0)],repository,now:()=>1234});
  const restored=campaign.accounts.get("p").draft.roster[0];
  assert.equal(restored.upgradeLevel,4);assert.equal(restored.attributes.passing,75);assert.equal(restored.traits[0].id,result.traitOffer.traits[0].id);
  assert.equal(campaign.enhancement.enhance(campaign.accounts.get("p"),{}, {mainCardId:"main",materialCardId:"material",requestId:"once-1234",useProtection:false}).id,result.id);
});

test("training and starting players can enhance during a match, keeping the main task and starter positions",()=>{
  const f=fixture(3), main=f.account.draft.roster[0];main.training={taskId:"training-main",completesAt:9999};
  f.account.training={tasks:{"training-main":{playerId:"main",completedAt:null,gains:{passing:5}}}};
  f.account.tactics={squads:{expedition:{starters:["main"],positions:{main:{x:30,y:40}}}}};
  f.world.activeChallenges.x={attackerId:"p"};f.setRoll(.999);
  const before=structuredClone(f.account.tactics), task=structuredClone(main.training);
  assert.deepEqual(f.service.details(f.account,f.world).cards[0].labels,["训练中","远征首发"]);
  assert.equal(f.run().afterLevel,2);assert.deepEqual(main.training,task);assert.deepEqual(f.account.tactics,before);
  assert.equal(f.account.training.tasks["training-main"].completedAt,null);
});
test("consuming a training starter cancels its task and promotes a bench player into the same saved positions",()=>{
  const f=fixture();f.account.draft.roster.push(card("bench",0,"other"));
  f.account.draft.roster[1].training={taskId:"training-material"};
  f.account.playerSquads.assignments.bench="garrison";
  f.account.training={tasks:{"training-material":{playerId:"material",completedAt:null}}};
  const garrison={starters:["material"],bench:["bench"],positions:{material:{x:31,y:44}}};
  garrison.planSnapshots={__s4V2:{starters:["material"],positionPresets:{position1:{material:{x:31,y:44}},position2:{material:{x:20,y:25}}}}};
  f.account.tactics={squads:{garrison}};
  assert.deepEqual(f.service.details(f.account,f.world).cards[1].labels,["训练中","留守首发"]);
  f.run();const tactics=f.account.tactics.squads.garrison;
  assert.deepEqual(tactics.starters,["bench"]);assert.deepEqual(tactics.bench,[]);assert.deepEqual(tactics.positions.bench,{x:31,y:44});
  assert.deepEqual(tactics.planSnapshots.__s4V2.positionPresets.position2.bench,{x:20,y:25});
  assert.equal(f.account.training.tasks["training-material"].cancelledAt,1234);
});

test("training settles after enhancement and its earned points survive a later downgrade",()=>{
  const f=fixture(3),main=f.account.draft.roster[0];
  main.training={taskId:"task",completesAt:1000};
  f.account.training={tasks:{task:{id:"task",playerId:"main",completedAt:null,completesAt:1000,gains:{passing:5}}}};
  const result=f.run();
  f.service.chooseTrait(f.account,{offerId:result.traitOffer.id,traitId:result.traitOffer.traits[0].id});
  const training=new TrainingService({now:()=>2000,save:()=>{},buildings:{}});training.settle(f.account);
  assert.equal(main.attributes.passing,80);assert.equal(main.trainingBonuses.passing,5);assert.equal(main.training,undefined);
  f.account.draft.roster.push(card("new-material",4));f.setRoll(.999);
  f.run({materialCardId:"new-material",requestId:"after-training"});
  assert.equal(main.upgradeLevel,3);assert.equal(main.attributes.passing,78);assert.equal(main.trainingBonuses.passing,5);
});


test("consuming a paid training material refunds its stored fee once and rolls back on save failure",()=>{
  const f=fixture();f.account.gold=98000;
  f.account.draft.roster[1].training={taskId:'paid-material'};
  f.account.training={tasks:{'paid-material':{playerId:'material',costGold:2000,refundedGold:0,completedAt:null,completesAt:9999}}};
  const before=structuredClone(f.account);f.fail(true);assert.throws(()=>f.run(),/disk failure/);assert.deepEqual(f.account,before);
  f.fail(false);f.run();f.run();assert.equal(f.account.gold,100000);assert.equal(f.account.training.tasks['paid-material'].refundedGold,2000);
});

test('completed enhancement research changes actual rolls and protection cost for its pairing only',()=>{
 const f=fixture(2,1);f.account.formationResearch={topicLevels:{'enhancement:2:1':1}};f.setRoll(.572);const result=f.run({useProtection:true});assert.equal(result.chance,57.5);assert.equal(result.success,true);assert.equal(result.protectionCost,s4EnhancementProtectionCost(57.5));assert.equal(f.service.publicState(f.account).researchLevels['enhancement:2:1'],1);
 const base=fixture(2,1);base.setRoll(.572);assert.equal(base.run().success,false);
 const capped=fixture(2,2);capped.account.formationResearch={topicLevels:{'enhancement:2:2':10}};capped.setRoll(.999);const guaranteed=capped.run({useProtection:true});assert.equal(guaranteed.chance,100);assert.equal(guaranteed.protectionCost,0);assert.equal(guaranteed.protectionUsed,false);
});
