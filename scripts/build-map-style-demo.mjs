import fs from 'node:fs';
import {topology} from 'topojson-server';
import {mesh} from 'topojson-client';
import {ReliefField} from '../client/map-three/relief-field.js';
import {roundedMountainHeights} from '../client/map-three/atlas-mountains.js';
import {project} from '../client/map-three/projection.js';
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const meta=read('assets/map-relief/relief-mesh/europe.json'),bytes=fs.readFileSync(meta.file),field=new ReliefField(meta,bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
field.heights=roundedMountainHeights(field);
const center=project(9.6,45.35),nw=project(3,50),se=project(16.5,41),step=.17,width=Math.ceil((se.x-nw.x)/step)+1,height=Math.ceil((se.z-nw.z)/step)+1;
const heights=[],elevations=[],mask=[];
function raw(x,z,array){const a=(x-meta.origin[0])/meta.step,b=(z-meta.origin[1])/meta.step,c=Math.floor(a),r=Math.floor(b),fx=a-c,fz=b-r;const at=(xx,zz)=>array[Math.max(0,Math.min(meta.height-1,zz))*meta.width+Math.max(0,Math.min(meta.width-1,xx))];return at(c,r)*(1-fx)*(1-fz)+at(c+1,r)*fx*(1-fz)+at(c,r+1)*(1-fx)*fz+at(c+1,r+1)*fx*fz;}
for(let z=0;z<height;z++)for(let x=0;x<width;x++){const wx=nw.x+x*step,wz=nw.z+z*step;heights.push(+field.sample(wx,wz).toFixed(3));elevations.push(Math.round(raw(wx,wz,field.elevations)));mask.push(Math.round(raw(wx,wz,field.mask)));}
const index=read('assets/data/territory-index.json'),byId=new Map(index.territories.map(t=>[t.territoryId,t]));
const source=read('assets/data/campaign-territories.geojson').features.filter(f=>{const t=byId.get(f.properties.territoryId);return t&&t.region==='europe'&&t.bounds[2]>3&&t.bounds[0]<16.5&&t.bounds[3]>41&&t.bounds[1]<50;});
for(const f of source){const t=byId.get(f.properties.territoryId);f.properties={id:t.territoryId,name:t.name,owner:t.countryCode==='ITA'?(t.centroid[0]<11.75?'jade':'gold'):null};}
const top=topology({territories:{type:'FeatureCollection',features:source}},100000);
const toLocal=p=>{const q=project(p[0],p[1]);return [+(q.x-center.x).toFixed(4),+(q.z-center.z).toFixed(4)];};
const boundary=owner=>mesh(top,top.objects.territories,(a,b)=>owner?(a.properties.owner===owner&&(a===b||b.properties.owner!==owner)||b.properties.owner===owner&&a.properties.owner!==owner):a!==b).coordinates.map(line=>line.map(toLocal));
const territories=source.map(f=>({...f.properties,polygons:(f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.coordinates).map(poly=>poly.map(ring=>ring.map(toLocal)))}));
const lakes=read('assets/data/map-nature.json').regions.europe.lakes.filter(l=>l.rings[0].some(p=>p[0]>nw.x&&p[0]<se.x&&p[1]>nw.z&&p[1]<se.z)).map(l=>({name:l.name,rings:l.rings.map(r=>r.map(p=>[+(p[0]-center.x).toFixed(4),+(p[1]-center.z).toFixed(4)]))}));
const data={version:'20260908-map-style-demo-v1',source:'Existing Europe DEM and Natural Earth administrative geometry; sample ownership and facility layout only.',center:{lng:9.6,lat:45.35},grid:{origin:[+(nw.x-center.x).toFixed(4),+(nw.z-center.z).toFixed(4)],step,width,height,heights,elevations,mask},territories,lakes,boundaries:{internal:boundary(null),jade:boundary('jade'),gold:boundary('gold')}};
fs.writeFileSync('assets/map-style-demo/north-italy.json',JSON.stringify(data));console.log(JSON.stringify({width,height,territories:territories.length,bytes:fs.statSync('assets/map-style-demo/north-italy.json').size}));
