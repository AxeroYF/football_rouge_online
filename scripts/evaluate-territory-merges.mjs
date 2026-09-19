import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {topology} from 'topojson-server';
import {merge} from 'topojson-client';
import {CORE_COUNTRY_CODES} from '../shared/config/countries.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const index=read('assets/data/territory-index.json'),source=read('assets/data/campaign-territories.geojson'),byId=new Map(index.territories.map(t=>[t.territoryId,t]));
const quotas={GBR:24,ITA:20,FRA:20,TUR:16,ESP:18,HUN:6,ROU:8,MDA:3,COL:12,IRL:6,KOS:2,BGR:5,BRA:24,CHE:5,PER:10,VEN:10,SRB:5,UKR:10,ARG:18,ECU:7,NOR:8,HRV:4,MNE:2,SWE:8,PRT:8,URY:5,BIH:4,FIN:7,PRY:5,CHL:10,DEU:14,POL:10,EST:3,NLD:6,CZE:5,GRC:6,ALB:3,ALD:1,BEL:4,LIE:1,GUY:3,LTU:3,SUR:3,AUT:5,BOL:7,ISL:4,SMR:1,SVK:3,AND:1,BLR:5,CYP:2,DNK:3,LUX:1};
const R=6371.0088,rad=Math.PI/180;
function ringArea(r){let a=0;for(let i=1;i<r.length;i++){let d=(r[i][0]-r[i-1][0])*rad;if(d>Math.PI)d-=Math.PI*2;if(d<-Math.PI)d+=Math.PI*2;a+=d*(2+Math.sin(r[i-1][1]*rad)+Math.sin(r[i][1]*rad));}return Math.abs(a)*R*R/2;}
const polygons=g=>g.type==='Polygon'?[g.coordinates]:g.coordinates;
const area=g=>polygons(g).reduce((s,p)=>s+ringArea(p[0])-p.slice(1).reduce((sum,r)=>sum+ringArea(r),0),0);
const records=source.features.map((f,i)=>({...byId.get(f.properties.territoryId),i,area:area(f.geometry)})),recordById=new Map(records.map(t=>[t.territoryId,t]));
const countries=Object.entries(Object.groupBy(records,t=>t.countryCode)).map(([code,ts])=>({code,name:ts[0].country,region:ts[0].region,original:ts.length,core:CORE_COUNTRY_CODES.includes(code),area:ts.reduce((s,t)=>s+t.area,0),under500:ts.filter(t=>t.area<500).length,target:quotas[code]??1})).sort((a,b)=>b.original-a.original);
function trial({limit=null,factor=1,archipelago=false,protectCities=false}={}){
 let sequence=0;const groups=new Map(records.map(t=>[t.territoryId,{id:t.territoryId,code:t.countryCode,region:t.region,members:[t.territoryId],area:t.area,bounds:[...t.bounds],x:t.centroid[0],y:t.centroid[1]}])),membership=new Map(records.map(t=>[t.territoryId,t.territoryId]));
 const anchors=g=>new Set(g.members.flatMap(id=>{const t=recordById.get(id);return t.cityIds.length||t.initialOwner.type==='club'?[t.initialOwner.type==='club'?t.initialOwner.id:t.territoryId]:[];}));
 const compatible=(a,b)=>{if(!protectCities)return true;const aa=anchors(a),bb=anchors(b);return !aa.size||!bb.size||new Set([...aa,...bb]).size===1;};
 const neighborIds=g=>new Set(g.members.flatMap(id=>recordById.get(id).landNeighbors).map(id=>membership.get(id)).filter(id=>id&&id!==g.id&&groups.get(id)?.code===g.code&&compatible(g,groups.get(id))));
 function join(a,b){
  const sum=a.area+b.area,id='candidate-'+(++sequence),g={id,code:a.code,region:a.region,members:[...a.members,...b.members],area:sum,bounds:[Math.min(a.bounds[0],b.bounds[0]),Math.min(a.bounds[1],b.bounds[1]),Math.max(a.bounds[2],b.bounds[2]),Math.max(a.bounds[3],b.bounds[3])],x:(a.x*a.area+b.x*b.area)/sum,y:(a.y*a.area+b.y*b.area)/sum};
  groups.delete(a.id);groups.delete(b.id);groups.set(id,g);for(const m of g.members)membership.set(m,id);return g;
 }
 for(const c of countries){
  let active=[...groups.values()].filter(g=>g.code===c.code);
  if(archipelago&&c.code==='ALD'){while(active.length>1){join(active[0],active[1]);active=[...groups.values()].filter(g=>g.code===c.code);}continue;}
  const target=limit!==null||c.target===1?1:Math.max(1,Math.round(c.target*factor));
  while(active.length>target){
   const candidates=active.filter(g=>(limit===null||g.area<limit)&&neighborIds(g).size).sort((a,b)=>a.area-b.area||a.members[0].localeCompare(b.members[0]));
   const a=candidates[0];if(!a)break;
   const ownerKeys=g=>new Set(g.members.map(id=>recordById.get(id).initialOwner).filter(o=>o?.type==='club').map(o=>o.id));
   const keys=ownerKeys(a);
   const best=[...neighborIds(a)].map(id=>{
    const b=groups.get(id),lat=(a.y+b.y)/2,dx=(a.x-b.x)*Math.cos(lat*rad)*111.2,dy=(a.y-b.y)*111.2;
    const width=(Math.max(a.bounds[2],b.bounds[2])-Math.min(a.bounds[0],b.bounds[0]))*111.2*Math.cos(lat*rad),height=(Math.max(a.bounds[3],b.bounds[3])-Math.min(a.bounds[1],b.bounds[1]))*111.2;
    const sameGarrison=keys.size&&[...ownerKeys(b)].some(k=>keys.has(k));
    const score=Math.hypot(dx,dy)/Math.sqrt(a.area+b.area)+Math.min(12,width*height/(a.area+b.area))*.22+(sameGarrison?-1.4:0);
    return {b,score};
   }).sort((a,b)=>a.score-b.score||a.b.id.localeCompare(b.b.id))[0];
   join(a,best.b);active=[...groups.values()].filter(g=>g.code===c.code);
  }
 }
 return [...groups.values()].sort((a,b)=>a.code.localeCompare(b.code)||a.members[0].localeCompare(b.members[0]));
}
const scenarios=[
 {id:'current',label:'现有地图',groups:records.map(t=>({code:t.countryCode,region:t.region,area:t.area,members:[t.territoryId]}))},
 {id:'tiny500',label:'仅合并不足 500 km²',groups:trial({limit:500})},
 {id:'small2000',label:'仅合并不足 2,000 km²',groups:trial({limit:2000})},
 {id:'relaxed',label:'约 750 块参照',groups:trial({factor:2.1,archipelago:true,protectCities:true})},
 {id:'recommended',label:'用户目标：约 600 块',groups:trial({factor:1.6,archipelago:true,protectCities:true})},
 {id:'compact',label:'约 400 块参照',groups:trial({archipelago:true,protectCities:true})}
];
const chosen=scenarios.find(s=>s.id==='recommended').groups;
for(const c of countries){c.target=Math.min(c.original,c.target===1?1:Math.max(1,Math.round(c.target*1.6)));c.proposed=chosen.filter(g=>g.code===c.code).length;c.smallOnly=scenarios[1].groups.filter(g=>g.code===c.code).length;}
const top=topology({territories:source},100000),geometryById=new Map(top.objects.territories.geometries.map((g,i)=>[records[i].territoryId,g]));
const features=chosen.map((g,i)=>{
 const members=g.members.map(id=>recordById.get(id)),anchor=[...members].sort((a,b)=>Number(b.cityIds.length>0)-Number(a.cityIds.length>0)||b.area-a.area)[0];
 const geometry=merge(top,g.members.map(id=>geometryById.get(id)));
 const names=members.map(t=>t.name||t.nameEn||t.territoryId),cityIds=[...new Set(members.flatMap(t=>t.cityIds))],clubIds=[...new Set(members.flatMap(t=>t.clubIds))],garrisons=[...new Set(members.map(t=>t.initialOwner).filter(o=>o.type==='club').map(o=>o.id))];
 return {type:'Feature',geometry,properties:{id:'review:'+g.code.toLowerCase()+'-'+String(i+1).padStart(3,'0'),code:g.code,country:anchor.country,region:g.region,name:anchor.name||anchor.nameEn||anchor.country,members:[...g.members].sort(),memberNames:names,sourceCount:g.members.length,areaKm2:+g.area.toFixed(2),cityIds,clubIds,garrisonCount:garrisons.length,archipelagoException:g.code==='ALD',reviewRequired:cityIds.length>1||garrisons.length>1||g.code==='ALD'}};
});
const ids=features.flatMap(f=>f.properties.members);assert.equal(ids.length,1470);assert.equal(new Set(ids).size,1470);
for(const f of features){const p=f.properties;assert.ok(p.members.every(id=>recordById.get(id).countryCode===p.code));if(!p.archipelagoException){const remaining=new Set(p.members),stack=[p.members[0]];while(stack.length){const id=stack.pop();if(!remaining.delete(id))continue;for(const n of recordById.get(id).landNeighbors)if(remaining.has(n))stack.push(n);}assert.equal(remaining.size,0,'Land connectivity '+p.id);}}
const areaBefore=records.reduce((s,t)=>s+t.area,0),areaAfter=features.reduce((s,f)=>s+area(f.geometry),0);
assert.ok(Math.abs(areaAfter-areaBefore)/areaBefore<.001,'Geographic area retained');
const summary=scenarios.map(s=>({id:s.id,label:s.label,count:s.groups.length,perPlayer:+(s.groups.length/8).toFixed(1),reductionPercent:+((1-s.groups.length/records.length)*100).toFixed(1),under500:s.groups.filter(g=>g.area<500).length,regions:Object.fromEntries(Object.entries(Object.groupBy(s.groups,g=>g.region)).map(([r,gs])=>[r,gs.length]))}));
const report={version:'20260908-evaluation-v1',status:'proposal-only',userTarget:600,players:8,areaNote:'Spherical area of existing Natural Earth game polygons, not official country area; small features may be generalized.',scenarios:summary,countries,thresholds:[100,500,1000,2000,5000].map(km2=>({km2,count:records.filter(t=>t.area<km2).length})),countryCount:countries.length,reviewRequired:features.filter(f=>f.properties.reviewRequired).map(f=>f.properties),validation:{completeMembership:ids.length,uniqueMembership:new Set(ids).size,sameCountry:true,landConnectedExceptAland:true,relativeAreaChange:(areaAfter-areaBefore)/areaBefore},originalClubTerritories:records.filter(t=>t.initialOwner.type==='club').length,proposedClubTerritories:features.filter(f=>f.properties.garrisonCount>0).length};
const lightGeom=g=>({type:g.type,coordinates:JSON.parse(JSON.stringify(g.coordinates),(_key,v)=>typeof v==='number'?+v.toFixed(5):v)});
const payload={...report,original:source.features.map(f=>({type:'Feature',geometry:lightGeom(f.geometry),properties:{id:f.properties.territoryId,code:f.properties.countryCode,name:f.properties.name,country:f.properties.country,region:f.properties.region}})),proposed:features.map(f=>({...f,geometry:lightGeom(f.geometry)}))};
fs.mkdirSync(path.join(root,'assets/territory-merge-review'),{recursive:true});fs.mkdirSync(path.join(root,'outputs/territory-merge-review'),{recursive:true});
fs.writeFileSync(path.join(root,'assets/territory-merge-review/proposal.json'),JSON.stringify(payload));
fs.writeFileSync(path.join(root,'outputs/territory-merge-review/report.json'),JSON.stringify(report,null,2));
fs.writeFileSync(path.join(root,'outputs/territory-merge-review/proposed-territories.geojson'),JSON.stringify({type:'FeatureCollection',features}));
console.log(JSON.stringify({scenarios:summary,validation:report.validation,reviewRequired:report.reviewRequired.length,clubTerritories:[report.originalClubTerritories,report.proposedClubTerritories],bytes:fs.statSync(path.join(root,'assets/territory-merge-review/proposal.json')).size},null,2));
