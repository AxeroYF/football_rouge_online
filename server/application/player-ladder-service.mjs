import {createPlayerCardViewModel} from '../../shared/player-card/player-card-contract.js';
const compare=(a,b)=>b.score-a.score||b.level-a.level||(a.ownerId<b.ownerId?-1:a.ownerId>b.ownerId?1:0)||(a.cardId<b.cardId?-1:a.cardId>b.cardId?1:0);
export const LADDER_REFRESH_MS=60000;
// A shared, bounded top-100 snapshot. Reads never settle accounts or write saves.
export class PlayerLadderService{
 constructor({accounts,now=Date.now}){this.accounts=accounts;this.now=now;this.snapshot=null;}
 get(){
  const now=this.now();if(this.snapshot&&now>=this.snapshot.generatedAt&&now<this.snapshot.refreshAt)return this.snapshot;
  const best=[];let totalCards=0;
  for(const owner of this.accounts.values()){
   if(!owner.setupComplete)continue;
   const seen=new Set();
   for(const card of owner.draft?.roster??[]){
    const cardId=String(card.id??card.playerId??''),score=Number(card.effectiveOverall??card.card?.overall??card.overall);
    if(!cardId||seen.has(cardId)||!Number.isFinite(score)||score<=0)continue;seen.add(cardId);totalCards++;
    const item={card,owner,cardId,ownerId:String(owner.id),score,level:Number(card.upgradeLevel??card.card?.upgradeLevel??0)||0};
    if(best.length===100&&compare(item,best[99])>=0)continue;
    let lo=0,hi=best.length;while(lo<hi){const mid=(lo+hi)>>1;if(compare(item,best[mid])<0)hi=mid;else lo=mid+1;}best.splice(lo,0,item);if(best.length>100)best.pop();
   }
  }
  const entries=best.map((item,index)=>{
   const {status,...card}=createPlayerCardViewModel(item.card);
   return {rank:index+1,score:item.score,cardId:item.cardId,owner:{id:item.ownerId,nickname:String(item.owner.nickname??''),teamName:String(item.owner.draft?.teamName??item.owner.nickname??'俱乐部')},card:{...card,heightCm:item.card.heightCm??null,preferredFoot:item.card.preferredFoot??null}};
  });
  return this.snapshot={generatedAt:now,refreshAt:now+LADDER_REFRESH_MS,totalCards,entries};
 }
}
