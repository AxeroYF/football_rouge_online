import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { hydrateCampaignWorld } from '../server/infrastructure/campaign-save-migrations.mjs';
import { assertSafeMapMerge,remapTerritoryReferences } from '../server/infrastructure/map-version-migration.mjs';
import { JsonCampaignRepository } from '../server/infrastructure/json-campaign-repository.mjs';
import { unproject } from '../client/map-three/projection.js';
import { displayPointToTerritory } from '../client/map/campaign-map-geometry.js';
import { facilitySites } from '../client/map-three/facility-layout.js';
import { politicalEdges } from '../client/map-three/campaign-borders.js';
const read=f=>JSON.parse(fs.readFileSync(new URL('../'+f,import.meta.url)));
const index=read('assets/data/territory-index.json'),geo=read('assets/data/campaign-territories.geojson'),coast=read('assets/data/campaign-coastlines.json'),plan=read('assets/data/territory-merge-plan.json');
test('598 territories cover all 1470 original regions exactly once and anchors lie inside',()=>{
 assert.equal(index.territories.length,598);assert.equal(geo.features.length,598);assert.equal(new Set(plan.regions.flatMap(g=>g.members)).size,1470);
 assert.equal(plan.regions.reduce((n,g)=>n+g.members.length,0),1470);
 for(const t of index.territories){const f=geo.features.find(f=>f.properties.territoryId===t.territoryId);assert.ok(booleanPointInPolygon(t.buildAnchor,f),t.name);assert.ok(t.neighbors.length);for(const id of t.neighbors)assert.ok(index.territories.some(v=>v.territoryId===id));}
 assert.equal(index.territories.filter(t=>t.region==='europe').length,433);assert.equal(index.territories.filter(t=>t.region==='south-america').length,165);
 assert.equal(index.territories.flatMap(t=>t.cityIds).length,84);assert.equal(index.territories.flatMap(t=>t.clubIds).length,51);
});
test('new coastline has no artificial Austrian or Swiss ports',()=>{
 for(const t of index.territories.filter(t=>['AUT','CHE'].includes(t.countryCode)))assert.ok(!coast.territories[t.territoryId],t.name);
});
test('merge retains all buildings and capacity checkpoints, remaps nested unit/task references',()=>{
 const group=plan.regions.find(g=>g.members.length>2),[a,b]=group.members,id=group.territoryId;
 const saved={world:{territories:{[a]:{territoryId:a,ownerType:'player',ownerId:'p',capitalOf:'p',buildings:[{id:'one',type:'main-stadium'}]},[b]:{territoryId:b,ownerType:'player',ownerId:'p',buildings:[{id:'two',status:'constructing',productionWork:{required:300000,completed:100000,updatedAt:1000,ownerId:'p'}}]}},players:{p:{territoryIds:[a,b],capitalTerritoryId:a}},constructionEconomy:{schemaVersion:1,settledAt:1000,capacities:{p:20}}}};
 assertSafeMapMerge(saved,index);const w=hydrateCampaignWorld(index,saved.world);assert.equal(w.territories[id].buildings.length,2);assert.equal(w.territories[id].buildings[1].productionWork.completed,100000);
 assert.deepEqual(w.constructionEconomy,saved.world.constructionEconomy);assert.deepEqual(w.players.p.territoryIds,[id]);
 const account={homeTerritoryId:a,expeditionPiece:{territoryId:a,movement:{fromTerritoryId:a,toTerritoryId:b}},scouting:{units:[{territoryId:b}],tasks:{x:{territoryId:a}}},fog:{visibleTerritoryIds:[a,b]}};
 assert.ok(remapTerritoryReferences(account,index.territoryIdAliases));assert.equal(account.scouting.units[0].territoryId,id);assert.deepEqual(account.fog.visibleTerritoryIds,[id]);assert.equal(remapTerritoryReferences(account,index.territoryIdAliases),false);
 saved.world.territories[b].ownerId='q';assert.throws(()=>assertSafeMapMerge(saved,index),/归属冲突/);
});
test('merging an untouched club with neutral neighbors preserves club ownership',()=>{
 const target=index.territories.find(t=>t.initialOwner.type==='club'&&t.mergedSourceTerritoryIds.length>1),[a,b]=target.mergedSourceTerritoryIds;
 const saved={territories:{[a]:{territoryId:a,ownerType:'neutral',ownerId:null,version:10},[b]:{territoryId:b,ownerType:'club',ownerId:'original-club',version:0}},players:{}};
 const w=hydrateCampaignWorld(index,saved);assert.equal(w.territories[target.territoryId].ownerType,'club');assert.equal(w.territories[target.territoryId].ownerId,'original-club');
 saved.territories[a].ownerType='player';saved.territories[a].ownerId='p';assert.equal(hydrateCampaignWorld(index,saved).territories[target.territoryId].ownerId,'p');
});
test('repository backs up pre-migration bytes once and never overwrites the backup',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'world598-migration-')),file=path.join(dir,'save.json'),old=JSON.stringify({accounts:[],world:{territories:{old:{}}}});
 fs.writeFileSync(file,old);const repo=new JsonCampaignRepository({dataPath:file});repo.load();repo.save({accounts:[],world:{mapVersion:index.mapVersion,territories:{}}});
 const backup=file+'.pre-'+index.mapVersion+'.bak';assert.equal(fs.readFileSync(backup,'utf8'),old);repo.save({accounts:[],world:{mapVersion:index.mapVersion,revision:2}});assert.equal(fs.readFileSync(backup,'utf8'),old);
});
test('political edges hide same-owner interior arcs and retain external and rival boundaries',()=>{
 const arcs=[{ids:['a','b'],points:[]},{ids:['a','c'],points:[]},{ids:['a'],points:[]}],states={a:{ownerType:'player',ownerId:'p'},b:{ownerType:'player',ownerId:'p'},c:{ownerType:'player',ownerId:'q'}};
 const edges=politicalEdges(arcs,states);assert.equal(edges.length,2);assert.deepEqual(edges[0].owners,['player:p','player:q']);assert.deepEqual(politicalEdges(arcs,{}),[]);
});
test('every normal three-building layout fits within its new territory on both continents',()=>{
 for(const t of index.territories){const feature=geo.features.find(f=>f.properties.territoryId===t.territoryId),sites=facilitySites(t,feature,[{id:'a',type:'main-stadium'},{id:'b',type:'training-center'},{id:'c',type:'club-shop'}]);assert.equal(sites.length,3,t.name);assert.ok(sites.every(s=>Number.isFinite(s.width)&&s.width>0));for(const site of sites)for(const dx of [-.5,.5])for(const dz of [-.5,.5]){const p=unproject(site.x+dx*site.width,site.z+dz*site.width);assert.ok(booleanPointInPolygon(displayPointToTerritory(p,t.region),feature),t.name+' footprint stays inside');}}
});


test('port icons use real coastal segments in Europe and rotated South America', async()=>{
 const {portMapAnchor}=await import('../client/buildings/port-map-anchor.js');
 let count=0;
 for(const t of index.territories){
  const lines=coast.territories[t.territoryId]?.coastlines??[],anchor=portMapAnchor(t,lines);
  if(!lines.length){assert.equal(anchor,null);continue;}
  assert.ok(anchor,t.name);const point=displayPointToTerritory({lat:anchor[0],lng:anchor[1]},t.region);
  assert.ok(lines.some(line=>line.slice(1).some((b,i)=>Math.abs(point[0]-(line[i][0]+b[0])/2)<1e-9&&Math.abs(point[1]-(line[i][1]+b[1])/2)<1e-9)),t.name+' uses an actual coastline midpoint');
  count++;
 }
 assert.equal(count,327);
});
