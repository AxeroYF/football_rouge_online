import fs from 'node:fs/promises';
import { topology } from 'topojson-server';
import { simplifyCoastlineSegment } from '../client/map/coastline-lod.js';
import { projectTerritoryPoint } from '../client/map-three/projection.js';
const collection=JSON.parse(await fs.readFile(new URL('../assets/data/campaign-territories.geojson',import.meta.url),'utf8'));
const top=topology({territories:collection}),usage=new Map();
for(const g of top.objects.territories.geometries)for(const signed of new Set(g.arcs.flat(Infinity))){
 const id=signed<0?~signed:signed;if(!usage.has(id))usage.set(id,{ids:[],region:g.properties.region});
 if(!usage.get(id).ids.includes(g.properties.territoryId))usage.get(id).ids.push(g.properties.territoryId);
}
const arcs=[...usage].map(([id,{ids,region}])=>({ids,points:simplifyCoastlineSegment(top.arcs[id].map(p=>{const q=projectTerritoryPoint(p,region);return [q.x,q.z];}),.012)})).filter(a=>a.points.length>1);
await fs.writeFile(new URL('../assets/data/campaign-boundaries.json',import.meta.url),JSON.stringify({version:'20260908-world598-v1',arcs}));
console.log(JSON.stringify({arcs:arcs.length,territories:collection.features.length}));
