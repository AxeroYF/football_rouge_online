import {applyMovementOilChoice} from '../../shared/config/movement-oil.mjs';
import {activeOilExtractor,oilExtractorLabel} from '../../shared/buildings/oil-extraction.mjs';
import {FACTORY_OIL_PER_HOUR,factoryOilSupply} from '../../shared/config/oil-economy.mjs';
import crypto from 'node:crypto';
import {oilDeposit} from '../../shared/config/oil-deposits.mjs';
import {playersAtWar,playersAllied} from '../../shared/config/diplomacy.mjs';
const HOUR=3600000,INITIAL=30;
const fail=(message,statusCode=400)=>{throw Object.assign(new Error(message),{statusCode});};
const integer=(n,max=1000000)=>{if(!Number.isSafeInteger(n)||n<1||n>max)fail('数量或单价无效');return n;};
export class OilService{
 constructor(campaign){this.c=campaign;this.activatedAt=campaign.now();this.deposit=oilDeposit;}
 wells(account,world=this.c.world){
  return Object.entries(world?.territories??{}).filter(([id,t])=>t.ownerType==='player'&&t.ownerId===account.id&&this.deposit(id)).flatMap(([id,t])=>{
   const b=activeOilExtractor(t.buildings);return b?[{id:b.id,territoryId:id,label:this.c.territoryIndex?.territories?.find(t=>t.territoryId===id)?.name??id,oilPerHour:3,sourceType:b.type==='oil-well'?'oil-well':'wonder',sourceLabel:oilExtractorLabel(b)}]:[];
  });
 }
 initialize(a,at=this.c.now()){if(!a.setupComplete)fail('请先完成建队',403);return a.oil??={schemaVersion:1,balance:INITIAL,settledAt:Math.max(at,this.activatedAt),remainder:0,hourly:0};}
 factoryDemand(a,world=this.c.world){return Object.values(world?.territories??{}).some(t=>t.ownerType==='player'&&t.ownerId===a.id&&t.buildings?.some(b=>b.type==='factory'&&b.status==='active'))?FACTORY_OIL_PER_HOUR:0;}
 view(a){const wells=this.wells(a),production=wells.length*3,factorySupply=factoryOilSupply({...a,oil:{...a.oil,hourly:production}}),consumption=factorySupply.active?this.factoryDemand(a):0;
  const sources=[...wells.map(w=>({id:w.id,label:w.label+' · '+w.sourceLabel,yields:{oil:w.oilPerHour}})),...(consumption?[{id:'factory-oil-supply',label:'工厂供油',yields:{oil:-consumption}}]:[])];
  return {balance:a.oil?.balance??(a.setupComplete?INITIAL:0),hourly:production-consumption,production,consumption,wells,sources,factorySupply};}
 due(accounts,now){return [...accounts.values()].some(a=>a.setupComplete&&(!a.oil||now-a.oil.settledAt>=30000));}
 nextSupplyBoundary(accounts,from,to){
  let boundary=to;
  for(const a of accounts.values()){
   const old=a.oil,net=(old?.hourly??0)-(old?.factoryDemand??0);if(!a.setupComplete||!old||old.balance<=0||net>=0)continue;
   const first=(old.periodStartedAt??old.settledAt)+HOUR;
   const remaining=BigInt(old.balance)*BigInt(HOUR)+BigInt(old.remainder)+BigInt(old.pendingWork??0)+BigInt(net)*BigInt(first-old.settledAt);
   const extra=remaining<=0n?0n:(remaining+BigInt(-net*HOUR)-1n)/BigInt(-net*HOUR);
   const time=BigInt(first)+extra*BigInt(HOUR);if(time>BigInt(from)&&time<BigInt(boundary))boundary=Number(time);
  }return boundary;
 }
 prepare(accounts,world,at){
  const snapshots=[];const rollback=()=>{for(const [a,old]of snapshots){if(old===undefined)delete a.oil;else a.oil=old;}};
  try{for(const a of accounts.values())if(a.setupComplete){
   snapshots.push([a,a.oil]);const old=this.initialize(a,at);
   if(old.schemaVersion!==1||![old.balance,old.settledAt,old.hourly,old.factoryDemand??0].every(n=>Number.isSafeInteger(n)&&n>=0)||!Number.isSafeInteger(old.remainder)||Math.abs(old.remainder)>=HOUR)fail('石油存档无效',500);
   const period=old.periodStartedAt??old.settledAt,pending=old.pendingWork??0;
   if(!Number.isSafeInteger(period)||period<0||period>old.settledAt||old.settledAt-period>=HOUR||!Number.isSafeInteger(pending))fail('石油结算周期无效',500);
   const end=Math.max(at,old.settledAt),demand=(old.balance>0||old.hourly>=(old.factoryDemand??0))?(old.factoryDemand??0):0,net=old.hourly-demand;
   const tick=period+Math.floor((end-period)/HOUR)*HOUR;
   let balance=BigInt(old.balance),remainder=old.remainder,pendingWork;
   if(tick>period){
    const work=BigInt(remainder)+BigInt(pending)+BigInt(net)*BigInt(tick-old.settledAt);
    balance+=work/BigInt(HOUR);remainder=Number(work%BigInt(HOUR));
    if(balance<=0n){balance=0n;remainder=Math.max(0,remainder);}
    pendingWork=(balance===0n&&net<0?0:net)*(end-tick);
   }else pendingWork=pending+net*(end-old.settledAt);
   if(balance>BigInt(Number.MAX_SAFE_INTEGER)||!Number.isSafeInteger(pendingWork))fail('石油库存超出安全范围');
   a.oil={...old,balance:Number(balance),settledAt:end,periodStartedAt:tick,remainder,pendingWork,hourly:this.wells(a,world).length*3,factoryDemand:this.factoryDemand(a,world)};

  }return {rollback};}catch(e){rollback();throw e;}
 }
 estimate(a,base,kind='expedition',{useOil=true}={}){
  const oilRequired=Math.max(1,Math.ceil(base.distanceKm/250))*(kind==='scout'?1:2),oilAvailable=this.view(a).balance,oilShortage=oilAvailable<oilRequired;
  return applyMovementOilChoice({...base,oilRequired,oilAvailable,oilShortage},useOil,kind);
 }
 spend(a,estimate){const oil=this.initialize(a);if(oil.balance<estimate.oilSpent)fail('石油库存已变化，请重新预览行程',409);a.oil={...oil,balance:oil.balance-estimate.oilSpent};}
 market(a){const orders=Object.values(this.c.world?.oilMarket?.orders??{}).filter(o=>o.remaining>0).sort((a,b)=>a.unitPrice-b.unitPrice||a.createdAt-b.createdAt);return {...this.view(a),feePercent:2,orders:orders.map(o=>({...o,mine:o.sellerId===a.id,blocked:playersAtWar(this.c.world,a.id,o.sellerId),sellerName:this.c.accounts.get(o.sellerId)?.draft?.teamName??this.c.accounts.get(o.sellerId)?.nickname??'球队'})),allies:[...this.c.accounts.values()].filter(b=>b.setupComplete&&b.id!==a.id&&playersAllied(this.c.world,a.id,b.id)).map(b=>({id:b.id,name:b.draft?.teamName??b.nickname}))};}
 mutate(a,body){
  if(!a.setupComplete)fail('请先完成建队',403);
  const {action,requestId}=body;if(typeof requestId!=='string'||!/^[A-Za-z0-9:_-]{8,128}$/.test(requestId))fail('交易请求编号无效');
  const signature=JSON.stringify([action,body.orderId,body.quantity,body.unitPrice,body.targetId]);
  const prior=a.oilRequests?.[requestId];if(prior){if(prior.signature!==signature)fail('请求编号已被使用',409);return prior.result;}
  const snapshots=[...this.c.accounts.values()].map(b=>[b,structuredClone(b)]),oldMarket=structuredClone(this.c.world.oilMarket);
  try{
   const market=this.c.world.oilMarket??={orders:{}};const oil=this.initialize(a);let result;
   if(action==='list'){
    const quantity=integer(body.quantity),unitPrice=integer(body.unitPrice,100000);
    if(Object.values(market.orders).filter(o=>o.sellerId===a.id&&o.remaining>0).length>=20)fail('最多同时挂出 20 笔石油订单');
    if(oil.balance<quantity)fail('石油库存不足');oil.balance-=quantity;
    const id='oil:'+crypto.randomUUID();market.orders[id]={id,sellerId:a.id,remaining:quantity,quantity,unitPrice,createdAt:this.c.now()};result={orderId:id};
   }else if(action==='buy'||action==='cancel'){
    const order=market.orders[body.orderId];if(!order||order.remaining<=0)fail('订单已结束，请刷新',409);
    if(action==='cancel'){if(order.sellerId!==a.id)fail('只能撤回自己的订单',403);oil.balance+=order.remaining;result={returned:order.remaining};delete market.orders[order.id];}
    else{
     if(order.sellerId===a.id)fail('不能购买自己的石油');if(playersAtWar(this.c.world,a.id,order.sellerId))fail('交战双方不能交易石油',403);
     const quantity=integer(body.quantity);if(quantity>order.remaining)fail('订单余量不足，请刷新',409);
     const seller=this.c.accounts.get(order.sellerId);if(!seller?.setupComplete)fail('卖方不可交易',409);
     const gold=quantity*order.unitPrice,fee=Math.floor(gold*.02);
     this.c.economy.spend(a,gold,'oil-purchase');this.c.economy.adjust(seller,gold-fee,'oil-sale');oil.balance+=quantity;order.remaining-=quantity;
     if(!order.remaining)delete market.orders[order.id];result={quantity,gold,fee};
    }
   }else if(action==='gift'){
    const target=this.c.accounts.get(body.targetId),quantity=integer(body.quantity);
    if(!target?.setupComplete||target.id===a.id||!playersAllied(this.c.world,a.id,target.id))fail('只能向盟友赠送石油',403);
    if(oil.balance<quantity)fail('石油库存不足');oil.balance-=quantity;this.initialize(target).balance+=quantity;result={quantity,targetId:target.id};
   }else fail('未知石油操作');
   for(const b of this.c.accounts.values())if(b.oil&&!Number.isSafeInteger(b.oil.balance))fail('石油库存超出安全范围');
   a.oilRequests??={};a.oilRequests[requestId]={signature,result};
   // Keep receipts durable: a retried completed request must never transfer twice.
   this.c.save();return result;
  }catch(e){for(const [b,old]of snapshots){for(const k of Object.keys(b))delete b[k];Object.assign(b,old);}if(oldMarket===undefined)delete this.c.world.oilMarket;else this.c.world.oilMarket=oldMarket;throw e;}
 }
}
