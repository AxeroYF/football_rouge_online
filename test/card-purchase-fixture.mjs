import {coalitionFixture} from './coalition-fixture.mjs';
import {createPlayerCardInstance} from '../server/domain/player-card-instance.mjs';
export function purchaseFixture(){
  const f=coalitionFixture(),definition=f.s.playerLibrary.find(p=>p.pool==='ATT'&&!p.isX),card=createPlayerCardInstance(definition,2);
  f.s.cardManagement.receive(f.b,card);f.s.oil.initialize(f.a).balance=1000;f.s.oil.initialize(f.b).balance=100;
  const land='purchase-land';f.s.world.territories[land]={...structuredClone(f.s.world.territories.a),capitalOf:null,version:1,buildings:[]};f.s.world.players.a.territoryIds.push(land);f.s.territoryIndex.territories.push({...f.s.territoryIndex.territories[0],territoryId:land,name:land});
  f.s.save();let sequence=0;
  const publish=(more={})=>f.s.cardPurchases.mutate(f.a,{action:'publish',requestId:'purchase-publish-'+(++sequence),requirements:[{definitionId:definition.id,upgradeLevel:2}],payment:{gold:1234,oil:50,territoryIds:[land]},...more});
  const accept=(id,ids=[card.id],more={})=>{const preview=f.s.cardPurchases.preview(f.b,{orderId:id,cardIds:ids});return f.s.cardPurchases.mutate(f.b,{action:'accept',requestId:'purchase-accept-'+(++sequence),orderId:id,cardIds:ids,quote:preview.quote,...more});};
  return {...f,get s(){return f.s;},get a(){return f.a;},get b(){return f.b;},card,definition,land,publish,accept};
}
