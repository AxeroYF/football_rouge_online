import crypto from 'node:crypto';
import {SHOP_ROTATION_MS,SHOP_LEGEND_PRICE,SHOP_LEGEND_OIL_PRICE,SHOP_LEGEND_LEVEL,SHOP_LEGEND_COUNT,SHOP_PACKS} from '../../shared/config/shop.mjs';
import {createPlayerCardViewModel} from '../../shared/player-card/player-card-contract.js';
const fail=(message,statusCode=400)=>{throw Object.assign(new Error(message),{statusCode});};
export class ShopService{
 constructor({world,oil=null,playerDatabase=[],economy,playerPacks,enhancement,now=Date.now,random=Math.random,save=()=>{}}){Object.assign(this,{world,oil,economy,playerPacks,enhancement,now,random,save});this.legends=[...new Map(playerDatabase.filter(p=>p.grade==='S'&&!p.isX&&!p.xPlayer).map(p=>[p.cardDefinitionId??p.id,p])).values()];}
 ensureRotation(){
  if(!this.world)fail('商店暂不可用',409);
  const now=this.now(),cycle=Math.floor(now/SHOP_ROTATION_MS),previous=this.world.shop;
  if(previous?.cycle===cycle)return previous;
  const available=[...this.legends],offers=[];
  while(available.length&&offers.length<SHOP_LEGEND_COUNT){
   const source=available.splice(Math.min(available.length-1,Math.floor(Math.max(0,Number(this.random())||0)*available.length)),1)[0];
   const player=structuredClone(source),id='shop-card:'+crypto.randomUUID();
   player.cardDefinitionId=source.cardDefinitionId??source.id;player.id=id;player.cardInstanceId=id;delete player.card;
   this.enhancement.applyLevel(player,SHOP_LEGEND_LEVEL);
   offers.push({id:'shop-offer:'+crypto.randomUUID(),player,price:SHOP_LEGEND_PRICE,oilPrice:SHOP_LEGEND_OIL_PRICE,soldAt:null,buyerId:null});
  }
  this.world.shop={schemaVersion:1,cycle,startsAt:cycle*SHOP_ROTATION_MS,refreshAt:(cycle+1)*SHOP_ROTATION_MS,offers};
  try{this.save();}catch(error){if(previous===undefined)delete this.world.shop;else this.world.shop=previous;throw error;}
  return this.world.shop;
 }
 publicState(account){
  if(!account.setupComplete||!account.draft)fail('请先完成初始建队',409);
  const shop=this.ensureRotation();
  return {serverNow:this.now(),refreshAt:shop.refreshAt,rotationId:String(shop.cycle),gold:account.gold,oil:this.oil?.view(account).balance??account.oil?.balance??0,
   packs:SHOP_PACKS.map(pack=>({...pack,choiceCount:this.playerPacks.wonders?.modifiers(account).packChoices??pack.choiceCount})),
   offers:shop.offers.map(o=>({id:o.id,price:o.price,oilPrice:o.oilPrice??SHOP_LEGEND_OIL_PRICE,sold:o.soldAt!==null,player:createPlayerCardViewModel(o.player)}))};
 }
 buy(account,{requestId,kind,itemId,rotationId,currency='gold'}={}){
  if(!account.setupComplete||!account.draft)fail('请先完成初始建队',409);
  if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(String(requestId??'')))fail('购买请求标识无效');
  if(!['gold','oil'].includes(currency))fail('支付资源无效');
  if(currency==='oil'&&kind!=='player')fail('只有限量传奇支持石油购买');
  const signature=JSON.stringify(currency==='gold'?[kind,itemId,rotationId??null]:[kind,itemId,rotationId??null,currency]);
  const prior=account.shopReceipts?.[requestId];
  if(prior){if(prior.signature!==signature)fail('请求标识与原购买不一致',409);return structuredClone(prior.result);}
  const shop=this.ensureRotation();
  let pack,offer;
  if(kind==='pack'){pack=SHOP_PACKS.find(p=>p.type===itemId);if(!pack)fail('未知卡包');}
  else if(kind==='player'){
   if(String(rotationId)!==String(shop.cycle))fail('商店已刷新，请查看本轮球员',409);
   offer=shop.offers.find(o=>o.id===itemId);if(!offer)fail('该球员已不在出售列表',409);
   if(offer.soldAt!==null)fail('该球员已被其他玩家购买',409);
  }else fail('未知商品类型');
  const before=structuredClone(account),beforeShop=structuredClone(shop);
  try{
   const price=currency==='oil'?(offer.oilPrice??SHOP_LEGEND_OIL_PRICE):(pack?.price??offer.price);
   if(currency==='oil'){if(!account.oil||account.oil.balance<price)fail('石油不足');account.oil.balance-=price;}
   else this.economy.spend(account,price,'global-shop-'+kind);
   let result;
   if(pack){this.playerPacks.addPacks(account,pack.type,1);result={kind,name:pack.name,price:pack.price};}
   else{
    const player=structuredClone(offer.player);player.state={...player.state,fitness:100};
    account.draft.roster.push(player);account.playerSquads??={schemaVersion:2,assignments:{}};account.playerSquads.assignments??={};account.playerSquads.assignments[player.id]='garrison';
    offer.soldAt=this.now();offer.buyerId=account.id;result={kind,name:player.name,playerId:player.id,price,currency};
   }
   account.shopReceipts??={};account.shopReceipts[requestId]={signature,result};this.save();return structuredClone(result);
  }catch(error){for(const key of Object.keys(account))delete account[key];Object.assign(account,before);this.world.shop=beforeShop;throw error;}
 }
}
