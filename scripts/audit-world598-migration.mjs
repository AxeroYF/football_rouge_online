import fs from 'node:fs';
import assert from 'node:assert/strict';
import { CampaignService } from '../campaign-service.mjs';
import { createMaritimeRoutePlanner } from '../maritime-routes.mjs';
const read=f=>JSON.parse(fs.readFileSync(new URL('../'+f,import.meta.url),'utf8'));
const originalBytes=fs.readFileSync(new URL('../data/campaign-accounts.json',import.meta.url)),saved=JSON.parse(originalBytes);
const territoryIndex=read('assets/data/territory-index.json'),territoryGeoJson=read('assets/data/campaign-territories.geojson'),territoryResources=read('assets/data/territory-resources.json'),coastlineData=read('assets/data/campaign-coastlines.json');
let memorySave;
const repository={load:()=>structuredClone(saved),save:value=>{memorySave=structuredClone(value);}};
const service=new CampaignService({repository,catalog:read('assets/data/s4-player-catalog.json'),territoryIndex,territoryGeoJson,territoryResources,maritimePlanner:createMaritimeRoutePlanner({coastlineData,territoryGeoJson,territoryIndex})});
assert.equal(Object.keys(service.world.territories).length,598);
const ids=new Set(territoryIndex.territories.map(t=>t.territoryId));
for(const account of service.accounts.values()){
 if(account.homeTerritoryId)assert.ok(ids.has(account.homeTerritoryId));
 if(account.expeditionPiece?.territoryId)assert.ok(ids.has(account.expeditionPiece.territoryId));
 for(const unit of Object.values(account.scouting?.units??{}))if(unit.territoryId)assert.ok(ids.has(unit.territoryId));
}
const beforeBuildings=Object.values(saved.world?.territories??{}).flatMap(t=>t.buildings??[]),afterBuildings=Object.values(service.world.territories).flatMap(t=>t.buildings??[]);
for(const b of beforeBuildings)assert.ok(afterBuildings.some(x=>x.id===b.id),'existing building retained');
assert.deepEqual(fs.readFileSync(new URL('../data/campaign-accounts.json',import.meta.url)),originalBytes);
const report={sourceTerritories:Object.keys(saved.world?.territories??{}).length,targetTerritories:598,accounts:service.accounts.size,buildingsBefore:beforeBuildings.length,buildingsAfter:afterBuildings.length,sourceSaveUntouched:true,mapVersion:memorySave.world.mapVersion};
fs.writeFileSync(new URL('../outputs/world598-migration-audit.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
