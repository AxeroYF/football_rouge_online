import test from 'node:test';
import assert from 'node:assert/strict';
import {OperatingCostService} from '../server/application/operating-cost-service.mjs';
import {EconomyService} from '../server/application/economy-service.mjs';
import {operatingCosts,playerHourlyWage} from '../shared/config/operating-costs.mjs';
import {resourceSourcesMarkup} from '../client/resources/resource-controller.js';
const H=3600000;
const player=(id,grade='C',extra={})=>({id,playerId:id,cardDefinitionId:id,grade,...extra});
function fixture(){const account={id:'one',setupComplete:true,gold:1000,goldLedger:[],draft:{roster:[player('a'),player('b','A')]}},accounts=new Map([['one',account]]),world={territories:{a:{ownerType:'player',ownerId:'one',buildings:[{id:'hq',type:'club-headquarters',level:1,status:'active'}]}}};const service=new OperatingCostService({economy:new EconomyService({now:()=>0}),now:()=>10*H});return{account,accounts,world,service,at:t=>service.prepare(accounts,world,t)};}
test('balanced wages use representatives, ignore enhancement and charge only completed owned facilities',()=>{
 const f=fixture();f.account.draft.roster.push(player('dup','C',{cardDefinitionId:'a',upgradeLevel:8}));
 f.world.territories.a.buildings.push({type:'factory',level:3,status:'active',upgradeTo:4},{type:'university',level:1,status:'constructing'},{wonderId:'la-moneda',status:'active'});
 f.world.territories.b={ownerType:'player',ownerId:'ally',buildings:[{type:'port',level:5,status:'active'}]};
 const costs=f.service.costs(f.account,f.world);assert.equal(costs.playerCount,2);assert.equal(costs.wages,20);assert.equal(costs.maintenance,70);assert.equal(playerHourlyWage(player('x','X')),25);assert.equal(playerHourlyWage(player('s','S')),20);
 assert.equal(operatingCosts({...f.account,setupComplete:false},f.world).total,0);
});
test('first activation never bills historical boundaries, then charges online and offline time identically',()=>{
 const f=fixture();f.at(H);f.at(5*H);f.at(10*H);assert.equal(f.account.gold,1000);f.at(11*H);assert.equal(f.account.gold,970);f.at(11*H);f.at(10*H);assert.equal(f.account.gold,970);
 const g=fixture();g.at(10*H);for(let t=10*H+1000;t<=11*H;t+=1000)g.at(t);assert.equal(g.account.gold,f.account.gold);assert.deepEqual(g.account.operatingCosts.remainders,f.account.operatingCosts.remainders);
});
test('stored rates settle the past before player acquisition, upgrade, loss and demolition change future rates',()=>{
 const f=fixture();f.at(10*H);f.account.draft.roster.push(player('c','B'));f.world.territories.a.buildings[0].level=5;f.at(11*H);assert.equal(f.account.gold,970);assert.equal(f.account.operatingCosts.wages,30);assert.equal(f.account.operatingCosts.maintenance,50);
 f.world.territories.a.ownerId='other';f.account.draft.roster=[];f.at(12*H);assert.equal(f.account.gold,890);f.at(13*H);assert.equal(f.account.gold,890);
});
test('saved checkpoints survive service restart and disk rollback without double billing',()=>{
 const f=fixture();f.at(10*H);f.at(10.5*H);const before=structuredClone(f.account);const transaction=f.at(12*H);assert.equal(f.account.gold,940);transaction.rollback();assert.deepEqual(f.account,before);
 const restarted=new OperatingCostService({economy:f.service.economy,now:()=>12*H});restarted.prepare(f.accounts,f.world,12*H);assert.equal(f.account.gold,940);restarted.prepare(f.accounts,f.world,12*H);assert.equal(f.account.gold,940);
});
test('insufficient gold is capped at zero, waived costs are not debt and future income remains spendable',()=>{
 const f=fixture();f.account.gold=0;f.at(10*H);f.at(11*H);assert.equal(f.account.gold,0);assert.equal(Object.values(f.account.operatingCosts.lastSettlement.waived).reduce((a,b)=>a+b,0),30);
 f.account.gold=100;f.at(11*H);assert.equal(f.account.gold,100);f.at(12*H);assert.equal(f.account.gold,70);
});
test('the recurring-expense wonder discounts both categories and rollback restores every account on failure',()=>{
 const f=fixture();f.service.wonders={modifiers:()=>({recurringExpenseMultiplier:.8})};f.world.territories.a.buildings[0].level=5;f.account.draft.roster.push(player('c','C'));
 const costs=f.service.costs(f.account,f.world);assert.equal(costs.wages,20);assert.equal(costs.maintenance,40);f.at(10*H);f.at(11*H);assert.equal(f.account.gold,940);
 const second={id:'bad',setupComplete:true,gold:5,operatingCosts:{schemaVersion:1,settledAt:-1}};f.accounts.set('bad',second);const before=structuredClone(f.account);assert.throws(()=>f.at(12*H),/存档无效/);assert.deepEqual(f.account,before);
});
test('gold source UI includes negative wages and upkeep, grouped details and the first-version protection',()=>{
 const html=resourceSourcesMarkup({resources:{hourly:{gold:-5},expenses:{discountPercent:20},sources:[{id:'wages',label:'球员工资',yields:{gold:-5},details:[{label:'<A级>',count:2,rate:3,total:6}]}]}},'gold');
 assert.match(html,/5\/10\/15\/20\/25/);assert.match(html,/每级每小时 10/);assert.match(html,/>-5/);assert.match(html,/&lt;A级&gt;/);assert.match(html,/不累积欠款/);assert.match(html,/减免 20%/);assert.doesNotMatch(html,/<A级>/);
});


test('a R9 save settles old prices before adopting the fivefold rates',()=>{
 const f=fixture();f.service.activatedAt=11*H;f.account.operatingCosts={schemaVersion:1,settledAt:10*H,wages:4,maintenance:2,remainders:{wages:0,maintenance:0}};
 f.at(11*H);assert.equal(f.account.gold,994);assert.equal(f.account.operatingCosts.wages,20);assert.equal(f.account.operatingCosts.maintenance,10);
 f.at(12*H);assert.equal(f.account.gold,964);
});

test('historical replay boundaries do not backdate the increased fees',()=>{
 const f=fixture();f.account.operatingCosts={schemaVersion:1,settledAt:8*H,wages:4,maintenance:2,remainders:{wages:0,maintenance:0}};
 f.at(9*H);assert.equal(f.account.operatingCosts.rateVersion,1);assert.equal(f.account.gold,994);
 f.at(10*H);assert.equal(f.account.operatingCosts.rateVersion,2);assert.equal(f.account.gold,988);
 f.at(11*H);assert.equal(f.account.gold,958);
});

test('a settlement crossing activation splits old and new fees exactly',()=>{
 const f=fixture();f.account.operatingCosts={schemaVersion:1,settledAt:9*H,wages:4,maintenance:2,remainders:{wages:0,maintenance:0}};
 f.at(11*H);assert.equal(f.account.gold,964);assert.equal(f.account.operatingCosts.rateVersion,2);
});
