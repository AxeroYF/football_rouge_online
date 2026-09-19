import test from 'node:test';
import assert from 'node:assert/strict';
import {auditSnapshot,runAudit,halfRecovery} from '../scripts/audit-downtime-economy.mjs';
const H=3600000,from=Date.parse('2026-09-14T12:00:00+08:00'),to=Date.parse('2026-09-18T03:00:00+08:00');
const fixture=()=>({accounts:{a:{setupComplete:true,nickname:'A',gold:900,passwordHash:'secret-hash',token:'secret-token',goldLedger:[{id:'one',createdAt:to,reason:'territory-production',delta:870,balance:900},{id:'trade',createdAt:to,reason:'trade',delta:10}],resourceLedger:[{from,to,earned:{gold:870}}],operatingCosts:{lastSettlement:{from,to,paid:{wages:50,maintenance:10},waived:{wages:0,maintenance:0}}}},b:{setupComplete:false,gold:100}},world:{resourceEconomy:{settledAt:to}}});
test('audit reports 87-hour evidence without exposing credentials or changing the input',()=>{const s=fixture(),before=structuredClone(s),r=auditSnapshot(s,{from,to});assert.equal((to-from)/H,87);assert.equal(r.players.length,1);assert.equal(r.players[0].territorySettlements[0].goldInsideWindow,870);assert.equal(r.players[0].nearbyEconomicLedger.length,1);assert.equal(r.players[0].recoveryAmount,null);assert.deepEqual(s,before);assert.ok(!JSON.stringify(r).includes('secret-'));});
test('partial settlements never fabricate a proportional recovery amount',()=>{const s=fixture();s.accounts.a.resourceLedger[0].from-=H;const r=auditSnapshot(s,{from,to});assert.equal(r.players[0].territorySettlements[0].goldInsideWindow,null);assert.equal(r.players[0].territorySettlements[0].overlapHours,87);});
test('missing historical ledgers remain unknown, not zero recoveries',()=>{const r=auditSnapshot({accounts:{a:{setupComplete:true,gold:100}}},{from,to});assert.equal(r.players[0].recoveryAmount,null);assert.equal(r.players[0].operatingSettlement,null);});
test('sponsor evidence uses contract periods and filters unrelated payments',()=>{const s=fixture();s.accounts.a.sponsorship={contracts:[{id:'s',signedAt:from}],payments:[{contractId:'s',fromHour:0,toHour:87,amount:8700,paidAt:to},{contractId:'s',fromHour:90,toHour:91,amount:100,paidAt:to+4*H}]};const r=auditSnapshot(s,{from,to});assert.equal(r.players[0].sponsorPayments.length,1);assert.equal(r.players[0].sponsorPayments[0].fullyInsideWindow,true);});
test('CLI requires explicit timezone before reading any save',()=>{assert.throws(()=>runAudit(['--save','missing','--from','2026-09-14T12:00:00','--to','2026-09-18T03:00:00']),/时区/);});

test('oil audit distinguishes wallet, escrow and retained purchase receipts',()=>{
 const s=fixture();s.accounts.a.oil={balance:261,hourly:3,factoryDemand:1,settledAt:to};s.accounts.a.shopReceipts={legend:{signature:'oil-player',result:{currency:'oil',price:150,playerId:'legend'}}};
 s.world.oilMarket={orders:{one:{id:'one',sellerId:'a',remaining:20,quantity:30,unitPrice:10,createdAt:to}}};
 const oil=auditSnapshot(s,{from,to}).players[0].oil;assert.equal(oil.balance,261);assert.equal(oil.escrowOil,20);assert.equal(oil.hourlyProduction,3);assert.equal(oil.factoryDemand,1);assert.equal(oil.shopPurchases[0].price,150);assert.equal(oil.recoveryAmount,null);
});
test('half recovery retains odd units for players and never deducts negative net gains',()=>{
 assert.deepEqual(halfRecovery(261),{netGain:261,recover:130,retained:131});assert.deepEqual(halfRecovery(-10),{netGain:0,recover:0,retained:0});assert.throws(()=>halfRecovery(1.5),/核实整数/);
});

test('fan audit preserves snapshot growth plans instead of estimating from current balance',()=>{
 const s=fixture();s.accounts.a.resources={fans:50000};s.accounts.a.fanEconomy={growthAt:to,cycleGrowth:170,preference:'gold'};
 s.world.resourceEconomy.fanPlans={a:{fans:50000,hourlyGrowth:200,firstGrowth:170,growthAt:to,territories:[{territoryId:'owned',fanRequirement:1000,yields:{gold:50,production:10,science:5},privateData:'do-not-export'}]}};
 const before=structuredClone(s),r=auditSnapshot(s,{from,to}).players[0].fans;assert.equal(r.balance,50000);assert.equal(r.cycleGrowth,170);assert.equal(r.savedPlan.hourlyGrowth,200);assert.equal(r.savedPlan.firstGrowth,170);assert.equal(r.recoveryAmount,null);assert.deepEqual(s,before);assert.ok(!JSON.stringify(r).includes('do-not-export'));
});
test('normal fan rewards remain separate evidence and duplicate battle snapshots are deduplicated',()=>{
 const s=fixture(),b={id:'win',settledAt:to,rewards:{fans:1500}};s.accounts.a.elite={history:[b],lastBattle:b};s.accounts.a.wonderPackFans={day:'2026-09-18',total:300,events:['pack']};
 s.world.neutralRewards={offers:{one:{id:'one',kind:'fans',claimedBy:'a',claimedAt:to,amount:100},two:{id:'two',kind:'fans',claimedBy:'b',amount:999}}};
 const r=auditSnapshot(s,{from,to}).players[0].fans;assert.equal(r.rewardEvidence.length,3);assert.deepEqual(r.rewardEvidence.map(e=>e.amount),[100,1500,300]);assert.equal(r.recoveryAmount,null);
});
test('missing fan history does not fabricate a fan growth amount',()=>{
 const r=auditSnapshot(fixture(),{from,to}).players[0].fans;assert.equal(r.balance,null);assert.equal(r.savedPlan,null);assert.equal(r.recoveryAmount,null);assert.deepEqual(halfRecovery(8701),{netGain:8701,recover:4350,retained:4351});
});

test('audit includes only economic infrastructure timestamps, without account secrets',()=>{const s=fixture();s.world.territories={x:{ownerType:'player',ownerId:'a',buildings:[{id:'well',type:'oil-well',builtAt:from+3600000,status:'active',privateSecret:'secret'},{id:'scout',type:'scout-center'}]}};const r=auditSnapshot(s,{from,to}).players[0].oil;assert.equal(r.infrastructure.length,1);assert.equal(r.infrastructure[0].builtAt,new Date(from+3600000).toISOString());assert.ok(!JSON.stringify(r).includes('privateSecret'));});
