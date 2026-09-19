import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ReliefField } from '../client/map-three/relief-field.js';
import { roundedMountainHeights } from '../client/map-three/atlas-mountains.js';
import { prepareNatureFields, natureWeights, insideRing } from '../client/map-three/atlas-nature-model.js';
import { projectTerritoryPoint } from '../client/map-three/projection.js';
import { RESOURCE_VERSION, RESOURCE_HOUR_MS, TERRAIN_LABELS, resourceBudget, validateTerritoryResources } from '../shared/config/resources.mjs';
const root=path.dirname(fileURLToPath(new URL('../package.json',import.meta.url)));
const read=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
const index=read('assets/data/territory-index.json'),geo=read('assets/data/campaign-territories.geojson'),coasts=read('assets/data/campaign-coastlines.json'),nature=read('assets/data/map-nature.json');
const sources=['assets/data/territory-index.json','assets/data/campaign-territories.geojson','assets/data/campaign-coastlines.json','assets/data/map-nature.json','client/map-three/atlas-nature-model.js','client/map-three/atlas-mountains.js'];
const fields=new Map(['europe','south-america','svalbard'].map(region=>{
 const meta=read(`assets/map-relief/relief-mesh/${region}.json`),buffer=fs.readFileSync(path.join(root,meta.file));sources.push(`assets/map-relief/relief-mesh/${region}.json`,meta.file);
 const field=new ReliefField(meta,buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength));field.heights=roundedMountainHeights(field);return [region,field];
}));
prepareNatureFields([...fields.values()],nature);
const byFeature=new Map(geo.features.map(f=>[f.properties.territoryId,f]));
const hash=id=>crypto.createHash('sha256').update(RESOURCE_VERSION+':'+id).digest().readUInt32LE(0)/2**32;
const inside=(x,z,polys)=>polys.some(rings=>insideRing(x,z,rings[0])&&!rings.slice(1).some(ring=>insideRing(x,z,ring)));
function terrainProfile(t){
 const geometry=byFeature.get(t.territoryId)?.geometry;if(!geometry)throw new Error('No polygon: '+t.territoryId);
 const field=fields.get(t.territoryId==='adm1:nor-901'?'svalbard':t.region);
 const polys=(geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates).map(poly=>poly.map(ring=>ring.map(point=>{const p=projectTerritoryPoint(point,t.region);return[p.x,p.z];})));
 const points=polys.flatMap(poly=>poly[0]),xs=points.map(p=>p[0]),zs=points.map(p=>p[1]);
 const x0=Math.max(0,Math.floor((Math.min(...xs)-field.origin[0])/field.step)),x1=Math.min(field.width-1,Math.ceil((Math.max(...xs)-field.origin[0])/field.step));
 const z0=Math.max(0,Math.floor((Math.min(...zs)-field.origin[1])/field.step)),z1=Math.min(field.height-1,Math.ceil((Math.max(...zs)-field.origin[1])/field.step));
 const stride=Math.max(1,Math.ceil(Math.sqrt(Math.max(1,(x1-x0)*(z1-z0))/700)));
 const samples=[];let method='polygon-grid';
 function sample(col,row){
  const i=row*field.width+col,x=field.origin[0]+col*field.step,z=field.origin[1]+row*field.step;
  const local=[];for(const [dx,dz]of [[-2,0],[2,0],[0,-2],[0,2],[0,0]]){const c=Math.max(0,Math.min(field.width-1,col+dx)),r=Math.max(0,Math.min(field.height-1,row+dz));if(field.mask[r*field.width+c]>32)local.push(field.elevations[r*field.width+c]);}
  samples.push({metres:field.elevations[i],forest:natureWeights(field,x,z)[0]>.22,roughness:local.length?Math.max(...local)-Math.min(...local):0});
 }
 for(let row=z0;row<=z1;row+=stride)for(let col=x0;col<=x1;col+=stride){const x=field.origin[0]+col*field.step,z=field.origin[1]+row*field.step;if(field.mask[row*field.width+col]>32&&inside(x,z,polys))sample(col,row);}
 if(!samples.length){
  method='small-polygon-nearest-land';
  const center=projectTerritoryPoint(t.centroid,t.region);let nearest=null;
  for(let row=Math.max(0,z0-3);row<=Math.min(field.height-1,z1+3);row++)for(let col=Math.max(0,x0-3);col<=Math.min(field.width-1,x1+3);col++){
   if(field.mask[row*field.width+col]<=32)continue;const d=(field.origin[0]+col*field.step-center.x)**2+(field.origin[1]+row*field.step-center.z)**2;if(!nearest||d<nearest.d)nearest={col,row,d};
  }
  if(nearest)sample(nearest.col,nearest.row);else method='small-island-no-dem';
 }
 const n=samples.length,mean=n?samples.reduce((s,p)=>s+p.metres,0)/n:0,forest=n?samples.filter(p=>p.forest).length/n:0,high=n?samples.filter(p=>p.metres>=900).length/n:0,rough=n?samples.reduce((s,p)=>s+p.roughness,0)/n:0;
 const terrain=[mean>=850||high>=.4?'mountain':mean>=280||rough>=240?'hills':'plains'];if(forest>=.18)terrain.push('forest');if(coasts.territories[t.territoryId]?.coastlines?.length)terrain.push('coastal');
 return {terrain,survey:{samples:n,sampling:method,meanElevation:Math.round(mean),localRelief:Math.round(rough),forestShare:Math.round(forest*1000)/1000}};
}
const regionSlots=new Map();for(const region of ['europe','south-america']){
 const list=index.territories.filter(t=>t.region===region).sort((a,b)=>hash('mix:'+a.territoryId)-hash('mix:'+b.territoryId));list.forEach((t,i)=>regionSlots.set(t.territoryId,(i+.5)/list.length));
}
const territories={},records=[];
for(const t of index.territories){
 const p=terrainProfile(t),preferProduction=p.terrain.some(k=>['forest','mountain','hills'].includes(k));
 const primary=preferProduction?'production':'gold',other=preferProduction?'gold':'production';
 const slot=regionSlots.get(t.territoryId),budget=8+Math.floor(hash('budget:'+t.territoryId)*5),units={gold:0,production:0,science:0};let mode;
 if(slot<.1){units.science=budget;mode='science';}
 else if(slot<.43){units[primary]=budget;mode='single';}
 else if(slot<.73){units[primary]=Math.ceil(budget*.65);units[other]=budget-units[primary];mode='economic-mix';}
 else if(slot<.92){units[primary]=Math.ceil(budget*.6);units.science=budget-units[primary];mode='science-mix';}
 else {units.science=2;units[primary]=Math.ceil((budget-2)*.6);units[other]=budget-2-units[primary];mode='triple';}
 const yields={gold:units.gold*12,production:units.production,science:units.science};
 territories[t.territoryId]={terrain:p.terrain,yields};
 records.push({territoryId:t.territoryId,name:t.name??t.nameEn??t.territoryId,country:t.country,countryCode:t.countryCode,region:t.region,...p,mode,budget,yields});
}
const catalog={schemaVersion:1,version:RESOURCE_VERSION,periodMs:RESOURCE_HOUR_MS,territoryCount:index.territories.length,source:'Existing map relief, coastline and procedural atlas vegetation; science allocation is authored game balance, not a real-world research map.',territories};validateTerritoryResources(catalog,index);
const summarize=items=>({count:items.length,single:items.filter(t=>Object.values(t.yields).filter(Boolean).length===1).length,double:items.filter(t=>Object.values(t.yields).filter(Boolean).length===2).length,triple:items.filter(t=>Object.values(t.yields).filter(Boolean).length===3).length,terrain:Object.fromEntries(Object.keys(TERRAIN_LABELS).map(k=>[k,items.filter(t=>t.terrain.includes(k)).length])),totalHourly:items.reduce((s,t)=>{for(const k of Object.keys(s))s[k]+=t.yields[k];return s;},{gold:0,production:0,science:0}),meanBudget:Number((items.reduce((s,t)=>s+resourceBudget(t.yields),0)/items.length).toFixed(3)),fallbackSamples:items.filter(t=>t.survey.sampling!=='polygon-grid').length});
const report={version:RESOURCE_VERSION,summary:summarize(records),regions:Object.fromEntries(['europe','south-america'].map(region=>[region,summarize(records.filter(t=>t.region===region))])),allocation:{singleShare:.43,doubleShare:.49,tripleShare:.08,minBudget:8,maxBudget:12,weights:{gold:12,production:1,science:1}},sources:Object.fromEntries(sources.map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(path.join(root,f))).digest('hex')])),records};
const target=path.join(root,'assets/data/territory-resources.json'),text=JSON.stringify(catalog);
if(process.argv.includes('--check')){if(fs.readFileSync(target,'utf8')!==text)throw new Error('Resource catalog is stale');console.log('Verified '+index.territories.length+' stable resource profiles.');}
else {fs.mkdirSync(path.join(root,'outputs/territory-resources-20260908'),{recursive:true});fs.writeFileSync(target,text);fs.writeFileSync(path.join(root,'outputs/territory-resources-20260908/survey.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({summary:report.summary,regions:report.regions},null,2));}
