import {S4_ENHANCEMENT} from '../../shared/config/enhancement.mjs';
import crypto from 'node:crypto';
import {createPlayerCardViewModel} from '../../shared/player-card/player-card-contract.js';
import {INTERACTION_RULES} from '../../shared/config/diplomacy.mjs';
import {territoryTradeIds,territoryTradeContext,territoryTradeBlock,territoryTradeSelection,transferTradedTerritory} from './territory-trade.mjs';
import {receipt,pruneReceipts} from './receipt-retention.mjs';

const fail=(message,statusCode=409)=>{throw Object.assign(Error(message),{statusCode});};
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const identity=p=>String(p.cardDefinitionId??p.card?.cardDefinitionId??p.id);
const level=p=>Number(p.upgradeLevel??p.card?.upgradeLevel??0);
const name=a=>a.draft?.teamName??a.nickname;
const restore=(target,before)=>{for(const key of Object.keys(target))delete target[key];Object.assign(target,before);};
export const PURCHASE_RULES=Object.freeze({maxPlayers:10,maxActive:20,pageSize:20,maxGold:INTERACTION_RULES.maxTradeGold,maxOil:INTERACTION_RULES.maxTradeOil,maxTerritories:3});

export class CardPurchaseService {
  constructor(campaign){this.c=campaign;this.catalog=new Map(campaign.playerLibrary.filter(p=>p.status!=='draft'&&['GK','DEF','MID','ATT'].includes(p.pool)).map(p=>[identity(p),p]));}
  data(a){return a.cardPurchases??{orders:{},receipts:{}};}
  ensure(a){return a.cardPurchases??={orders:{},receipts:{}};}
  ready(a){this.c.cardManagement.ready(a);if(!a.homeTerritoryId)fail('请先选择总部');}
  find(id){if(typeof id!=='string')fail('求购不存在',404);for(const buyer of this.c.accounts.values()){const orders=this.data(buyer).orders;if(Object.hasOwn(orders,id))return {buyer,order:orders[id]};}fail('求购不存在',404);}
  requirements(input){
    if(!Array.isArray(input)||!input.length||input.length>PURCHASE_RULES.maxPlayers)fail('每条求购请选择 1～10 名球员',400);
    return input.map(item=>{const id=item?.definitionId,p=this.catalog.get(id),upgradeLevel=item?.upgradeLevel;
      if(!p)fail('球员不在已发布的 YOOGLE 球员库中',400);
      if(!Number.isInteger(upgradeLevel)||upgradeLevel<0||upgradeLevel>S4_ENHANCEMENT.maxLevel)fail(`强化等级须为 0～${S4_ENHANCEMENT.maxLevel}`,400);
      return {definitionId:id,upgradeLevel,name:p.name,club:p.club,nationality:p.nationality,grade:p.grade,role:p.role};
    });
  }
  payment(a,input={}){
    if(!input||typeof input!=='object'||Array.isArray(input))fail('支付内容无效',400);
    const integer=(v,max,label)=>{if(!Number.isSafeInteger(v)||v<0||v>max)fail(label+'金额无效',400);return v;};
    const gold=integer(input.gold??0,PURCHASE_RULES.maxGold,'金币'),oil=integer(input.oil??0,PURCHASE_RULES.maxOil,'石油'),territoryIds=territoryTradeIds(input.territoryIds);
    if(!gold&&!oil&&!territoryIds.length)fail('至少填写一种支付资源',400);
    const territories=territoryIds.length?territoryTradeSelection(this.c,a,territoryIds):[];
    if(a.gold<gold||(this.c.oil.view(a).balance??0)<oil)fail('发布方金币或石油不足');
    return {gold,oil,territoryIds,territories};
  }
  publicOrder(order,buyer,viewer){return {...structuredClone(order),requirements:order.requirements.map(r=>({...r,card:createPlayerCardViewModel(this.catalog.get(r.definitionId)??{...r,id:r.definitionId})})),buyerName:name(buyer),mine:buyer.id===viewer.id};}
  list(a,{mine=false,page=0}={}){
    this.ready(a);page=Math.max(0,Math.min(100000,Math.floor(Number(page)||0)));
    const entries=[...this.c.accounts.values()].flatMap(buyer=>mine&&buyer.id!==a.id?[]:Object.values(this.data(buyer).orders).filter(o=>mine||o.status==='active').map(order=>({buyer,order}))).sort((a,b)=>b.order.createdAt-a.order.createdAt||b.order.id.localeCompare(a.order.id));
    const total=entries.length;page=Math.min(page,Math.max(0,Math.ceil(total/PURCHASE_RULES.pageSize)-1));
    return {orders:entries.slice(page*PURCHASE_RULES.pageSize,(page+1)*PURCHASE_RULES.pageSize).map(({buyer,order})=>this.publicOrder(order,buyer,a)),page,total,rules:PURCHASE_RULES};
  }
  options(a){this.ready(a);const context=territoryTradeContext(this.c);return {gold:a.gold,oil:this.c.oil.view(a).balance,territories:(this.c.world.players[a.id]?.territoryIds??[]).filter(id=>!territoryTradeBlock(this.c,a,id,context)).map(id=>territoryTradeSelection(this.c,a,[id],context)[0]),rules:PURCHASE_RULES};}
  detail(a,id){
    this.ready(a);const {buyer,order}=this.find(id),keys=new Set(order.requirements.map(r=>r.definitionId+'|'+r.upgradeLevel));
    const candidates=buyer.id===a.id?[]:a.draft.roster.filter(p=>keys.has(identity(p)+'|'+level(p))).map(p=>({...createPlayerCardViewModel(p),id:p.id,blocked:this.c.cardManagement.blocked(a,p)}));
    return {order:this.publicOrder(order,buyer,a),candidates};
  }
  validateDelivery(a,order,buyer,ids){
    if(buyer.id===a.id)fail('不能接受自己的求购');
    if(order.status!=='active')fail('求购已经成交或撤销');
    const cards=this.c.cardManagement.select(a,ids,order.requirements.length),remaining=[...cards];
    for(const r of order.requirements){const index=remaining.findIndex(p=>identity(p)===r.definitionId&&level(p)===r.upgradeLevel);if(index<0)fail('所选球员或强化等级不符合求购，请按整单要求选择');remaining.splice(index,1);}
    const pay=order.payment;
    if(buyer.gold<pay.gold||this.c.oil.view(buyer).balance<pay.oil)fail('求购方余额不足，暂时无法交割');
    if(!Number.isSafeInteger(a.gold+pay.gold)||!Number.isSafeInteger(this.c.oil.view(a).balance+pay.oil))fail('接单方资源超过安全范围');
    if(pay.territoryIds.length){const context=territoryTradeContext(this.c);if(context.wars.has(a.id)||context.wars.has(buyer.id))fail('交战玩家暂不能交易地块');const lands=territoryTradeSelection(this.c,buyer,pay.territoryIds,context);if(JSON.stringify(lands)!==JSON.stringify(pay.territories))fail('支付地块已变化，请求购方撤销后重新发布');}
    return cards;
  }
  quote(order,cards){return hash([order,cards.map(p=>[p.id,identity(p),level(p),p.attributes,p.effectiveAttributes,p.traits,p.trainingBonuses,p.enhancementTraitIds])]);}
  preview(a,input){this.ready(a);const {buyer,order}=this.find(input.orderId),cards=this.validateDelivery(a,order,buyer,input.cardIds);return {order:this.publicOrder(order,buyer,a),cards:cards.map(p=>({...createPlayerCardViewModel(p),id:p.id})),quote:this.quote(order,cards)};}
  transaction(accounts,lands,action){
    const snapshots=[...new Set(accounts)].map(a=>[a,structuredClone(a)]),territories=lands.map(id=>[id,structuredClone(this.c.world.territories[id])]),players=lands.length?accounts.map(a=>[a.id,structuredClone(this.c.world.players[a.id])]):[],revision=this.c.world.revision;
    try{const result=action();this.c.persist();return result;}catch(error){for(const [a,before] of snapshots)restore(a,before);for(const [id,t] of territories)this.c.world.territories[id]=t;for(const [id,p] of players)this.c.world.players[id]=p;this.c.world.revision=revision;throw error;}
  }
  mutate(a,input={}){
    this.ready(a);const {action,requestId}=input;
    if(!['publish','cancel','accept'].includes(action)||typeof requestId!=='string'||!/^[A-Za-z0-9._:-]{8,128}$/.test(requestId))fail('求购操作或请求标识无效',400);
    const signature=hash([action,input.requirements,input.payment,input.orderId,input.cardIds,input.quote]),prior=receipt(this.data(a),'receipts',requestId,this.c.now());
    if(prior){if(prior.signature!==signature)fail('请求标识已用于其他操作');return structuredClone(prior.result);}
    // Settle income, fuel and recovery before transferring ownership; periodic reads never save.
    if(action==='accept'||action==='publish'&&this.c.economyDue(this.c.now()))this.c.save();
    const found=action==='publish'?null:this.find(input.orderId),buyer=found?.buyer,order=found?.order;
    return this.transaction(buyer?[a,buyer]:[a],action==='accept'?order.payment.territoryIds:[],()=>{
      let result;
      if(action==='publish'){
        const data=this.ensure(a);if(Object.values(data.orders).filter(o=>o.status==='active').length>=PURCHASE_RULES.maxActive)fail('最多同时发布 20 条求购，请先撤销旧订单');
        const requirements=this.requirements(input.requirements),payment=this.payment(a,input.payment),id='purchase:'+crypto.randomUUID();
        data.orders[id]={id,status:'active',createdAt:this.c.now(),requirements,payment};result={orderId:id,status:'active'};
      }else if(action==='cancel'){
        if(buyer.id!==a.id)fail('只能撤销自己的求购',403);if(order.status!=='active')fail('求购已经成交或撤销');order.status='cancelled';order.closedAt=this.c.now();result={orderId:order.id,status:'cancelled'};
      }else{
        const cards=this.validateDelivery(a,order,buyer,input.cardIds);if(typeof input.quote!=='string'||input.quote!==this.quote(order,cards))fail('球员或订单已变化，请重新预览交割');
        const copies=cards.map(p=>this.c.cardManagement.transferable(p));
        const pay=order.payment;if(pay.gold){this.c.economy.spend(buyer,pay.gold,'player-card-purchase');this.c.economy.adjust(a,pay.gold,'player-card-purchase-sale');}
        if(pay.oil){const from=this.c.oil.initialize(buyer),to=this.c.oil.initialize(a);if(from.balance<pay.oil)fail('求购方石油不足');from.balance-=pay.oil;to.balance+=pay.oil;}
        this.c.cardManagement.remove(a,new Set(cards.map(p=>p.id)));for(const p of copies)this.c.cardManagement.receive(buyer,p);
        for(const id of pay.territoryIds)transferTradedTerritory(this.c,buyer,a,id);
        order.status='filled';order.closedAt=this.c.now();order.sellerName=name(a);
        const event={id:order.id,kind:'purchase-filled',createdAt:this.c.now(),cards:copies.map(createPlayerCardViewModel),payment:structuredClone(pay),buyerName:name(buyer),sellerName:name(a)};
        this.c.cardManagement.record(a,event);this.c.cardManagement.record(buyer,event);
        result={orderId:order.id,status:'filled'};
      }
      const data=this.ensure(a);data.receipts[requestId]={signature,result,recordedAt:this.c.now()};pruneReceipts(data,'receipts',this.c.now());
      for(const owner of new Set([a,buyer].filter(Boolean))){const orders=this.ensure(owner).orders,closed=Object.values(orders).filter(o=>o.status!=='active').sort((x,y)=>y.closedAt-x.closedAt);for(const old of closed.slice(100))delete orders[old.id];}
      return result;
    });
  }
}
