import {coalitionFixture} from './coalition-fixture.mjs';
import {EliteRaidService} from '../server/application/elite-raid-service.mjs';
export function raidFixture(){const f=coalitionFixture();f.tick(Date.parse('2026-09-18T12:00:00Z')-f.now);const s=f.s;
 for(const [id,clubId,centroid]of [['elite-r','real-madrid',[-4,40]],['elite-b','barcelona',[2,41]],['a-outer',null,[3,48]],['b-outer',null,[-65,-20]]]){
  const owner=id.startsWith('a-')?'a':id.startsWith('b-')?'b':null;
  s.territoryIndex.territories.push({territoryId:id,country:'测试',name:id,centroid,bounds:[centroid[0]-.1,centroid[1]-.1,centroid[0]+.1,centroid[1]+.1],landNeighbors:[],neighbors:[],cityIds:[],clubIds:clubId?[clubId]:[],eliteClubIds:clubId?[clubId]:[],initialOwner:{type:owner?'player':'club',id:owner},spawnAllowed:!clubId});
  s.world.territories[id]={territoryId:id,ownerType:owner?'player':'club',ownerId:owner,buildings:[],version:1};if(owner)s.world.players[owner].territoryIds.push(id);
 }
 s.eliteRaids=new EliteRaidService(s);s.eliteRaids.touch(f.a,{foreground:true});s.eliteRaids.touch(f.b,{foreground:true});s.save();s.eliteRaids.ensureDay();s.eliteRaids.rotation(s.eliteRaids.day(),f.now);return f;
}
