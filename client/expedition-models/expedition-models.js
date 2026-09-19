import * as T from 'three';
import {ModelKit} from '../wonders/model-kit.js';
import {inspectWonderModel,disposeWonderModel} from '../wonders/wonder-models.js';
import {EXPEDITION_ART_VERSION} from '../../shared/config/expedition-art.mjs';
const C={ivory:'#E7EEE7',teal:'#3B929F',tealLight:'#69B6C0',yellow:'#E1AE3F',yellowLight:'#F2CC6D',rubber:'#293231',dark:'#343E3E',glass:'#344E56',glassLight:'#86ADB3',chrome:'#B4C3BC',gold:'#D1B568',cream:'#E8E5CF',green:'#367E68',red:'#C8483C',redLight:'#E66B53',olive:'#798460',oliveLight:'#9CA77D',oliveDark:'#505C45',lamp:'#F6E4AD',tail:'#AE4337'};
class VehicleKit extends ModelKit{
 material(key){if(!C[key])throw Error('Unknown vehicle material '+key);if(!this.materials.has(key))this.materials.set(key,new T.MeshStandardMaterial({color:C[key],roughness:key==='glass'?.24:key==='chrome'?.32:.68,metalness:key==='chrome'?.45:key==='glass'?.2:.08,name:key,userData:{artVersion:EXPEDITION_ART_VERSION}}));return this.materials.get(key);}
 finish(id){const model=super.finish(id);model.scale.multiplyScalar(2.4);model.position.multiplyScalar(2.4);model.updateMatrixWorld(true);model.userData={assetId:id,lod:this.lod,style:'stylized-expedition-vehicle',artVersion:EXPEDITION_ART_VERSION,units:'strategic scale; 2.4 unit maximum footprint',front:'+Z'};return model;}
 round(x,y,z,w,h,d,c,part='body',r=.06){
  r=Math.min(r,w/4,h/4,d/4);const shape=new T.Shape();shape.moveTo(-w/2+r,-h/2+r);shape.lineTo(w/2-r,-h/2+r);shape.lineTo(w/2-r,h/2-r);shape.lineTo(-w/2+r,h/2-r);shape.closePath();
  const g=new T.ExtrudeGeometry(shape,{depth:d-2*r,bevelEnabled:true,bevelThickness:r,bevelSize:r,bevelSegments:this.detail(3,2,1),steps:1});this.put(g,c,x,y,z-d/2+r,null,null,part);g.dispose();return this;
 }
 plan(points,y,h,c,part){const shape=new T.Shape(points.map(([x,z])=>new T.Vector2(x,-z)));this.extrude(shape,h,c,0,y,0,[-Math.PI/2,0,0],part);}
 side(points,x,w,c,part){const shape=new T.Shape(points.map(([z,y])=>new T.Vector2(-z,y)));this.extrude(shape,w,c,x-w/2,0,0,[0,Math.PI/2,0],part);}
 // Rounded rectangular cross-sections along the forward (+Z) axis.
 shell(sections,c,part='body',power=2){
  const n=this.detail(24,16,12),v=[],f=[];
  for(const [z,y,rx,ry]of sections)for(let i=0;i<n;i++){const a=i/n*Math.PI*2,cs=Math.cos(a),sn=Math.sin(a);v.push([Math.sign(cs)*Math.abs(cs)**(2/power)*rx,y+Math.sign(sn)*Math.abs(sn)**(2/power)*ry,z]);}
  for(let j=0;j<sections.length-1;j++)for(let i=0;i<n;i++){const a=j*n+i,b=j*n+(i+1)%n,d=a+n,e=b+n;f.push([a,b,d],[b,e,d]);}
  v.push([0,sections[0][1],sections[0][0]],[0,sections.at(-1)[1],sections.at(-1)[0]]);for(let i=0;i<n;i++){f.push([v.length-2,(i+1)%n,i]);const a=(sections.length-1)*n;f.push([v.length-1,a+i,a+(i+1)%n]);}
  this.mesh(v,f,c,part);
 }
}
function axle(k,x,y,z,r,width=.24,hub='chrome',part='wheels'){
 const n=k.detail(24,16,10);const g=new T.CylinderGeometry(r,r,width,n);k.put(g,'rubber',x,y,z,[0,0,Math.PI/2],null,part);g.dispose();
 for(const side of [-1,1]){
  const h=new T.CylinderGeometry(r*.62,r*.62,.025,n);k.put(h,hub,x+side*(width/2+.009),y,z,[0,0,Math.PI/2],null,part);h.dispose();
  if(k.lod<2)for(let i=0;i<5;i++){const a=i*Math.PI*2/5;k.beam([x+side*(width/2+.026),y,z],[x+side*(width/2+.026),y+Math.sin(a)*r*.49,z+Math.cos(a)*r*.49],r*.065,'dark',part,5);}
 }
}
function tracks(k,x,length=3.3,width=.43){
 const r=.4,end=length/2-r,pts=[];for(let i=0;i<=k.detail(12,8,6);i++){const a=-Math.PI/2+i*Math.PI/k.detail(12,8,6);pts.push([end+Math.cos(a)*r,.44+Math.sin(a)*r]);}for(let i=0;i<=k.detail(12,8,6);i++){const a=Math.PI/2+i*Math.PI/k.detail(12,8,6);pts.push([-end+Math.cos(a)*r,.44+Math.sin(a)*r]);}
 k.side(pts,x,width,'rubber','tracks');
 for(const z of [-end,-end/2,0,end/2,end])axle(k,x,.44,z,.29,width+.035,'oliveDark','road_wheels');
 if(k.lod<2){for(const y of [.035,.845])for(let z=-end;z<=end+.01;z+=k.detail(.16,.26,.4))k.box(x,y,z,width+.035,.045,.065,'dark','track_links');for(const sign of [-1,1])for(let i=1;i<7;i++){const a=-Math.PI/2+i*Math.PI/7;k.round(x,.44+Math.sin(a)*.41,sign*(end+Math.cos(a)*.41),width+.035,.06,.06,'dark','track_links',.01);}}
}
function airplane(k){
 k.shell([[-2.55,1.17,.06,.07],[-2.05,1.1,.23,.25],[-1.45,1.08,.38,.4],[1.25,1.08,.4,.4],[1.85,1.06,.33,.33],[2.22,1.03,.22,.22],[2.48,1.01,.025,.025]],'ivory','fuselage');
 k.shell([[1.3,1.245,.29,.16],[1.67,1.23,.285,.145],[1.94,1.17,.22,.1],[2.1,1.125,.07,.028]],'glass','cockpit');
 for(const side of [-1,1]){
  k.plan([[side*.28,.6],[side*2.9,-.7],[side*3.12,-1.12],[side*2.96,-1.3],[side*.28,-.5]],.99,.11,'ivory','wings');
  k.plan([[side*.64,-.22],[side*2.66,-1.1],[side*2.88,-1.17],[side*2.72,-1.29],[side*.62,-.42]],1.105,.022,'teal','wing_stripe');
  k.side([[-1.25,1.02],[-.96,1.07],[-1.1,1.48],[-1.35,1.38]],side*3.0,.07,'teal','winglets');
  k.plan([[0,-1.7],[side*1.18,-2.03],[side*1.34,-2.35],[side*.17,-2.29]],1.25,.08,'teal','tailplanes');
  k.round(side*1.12,.85,-.04,.13,.5,.55,'chrome','engine_pylons',.025);
  const rot=[Math.PI/2,0,0],g=new T.CylinderGeometry(.235,.20,.95,k.detail(28,18,12));k.put(g,'teal',side*1.12,.63,.1,rot,null,'engines');g.dispose();
  const hole=new T.CylinderGeometry(.18,.18,.025,k.detail(24,16,10));k.put(hole,'dark',side*1.12,.63,.59,rot,null,'engine_intakes');hole.dispose();
  const ring=new T.TorusGeometry(.206,.035,6,k.detail(28,18,12));k.put(ring,'chrome',side*1.12,.63,.584,null,null,'engine_intakes');ring.dispose();
  if(k.lod<2)for(let i=0;i<8;i++){const a=i*Math.PI/4;k.beam([side*1.12,.63,.611],[side*1.12+Math.cos(a)*.16,.63+Math.sin(a)*.16,.611],.014,'chrome','fan_blades',4);}
  for(let z=-1.28;z<=1.31;z+=.3)k.sphere(side*.377,1.21,z,.05,'glass','cabin_windows',[.18,.8,1.15]);
  k.beam([side*.4,.85,-.55],[side*.54,.23,-.58],.045,'chrome','landing_gear',8);axle(k,side*.54,.17,-.58,.17,.16);
  k.box(side*.404,1.05,.42,.014,.095,2.7,'teal','livery');
 }
 k.side([[-2.38,1.32],[-1.46,1.29],[-2.10,2.28],[-2.43,2.28]],0,.11,'teal','tail_fin');
 k.side([[-2.34,1.58],[-1.97,1.65],[-2.14,1.91],[-2.36,1.84]],.061,.008,'gold','tail_emblem');
 k.beam([0,.76,1.75],[0,.16,1.82],.042,'chrome','landing_gear',8);axle(k,0,.14,1.82,.14,.18);
}
function excavator(k){
 for(const x of [-.86,.86])tracks(k,x,2.9,.47);
 k.round(0,.74,0,1.7,.32,2.05,'dark','undercarriage',.05);k.cyl(0,.99,-.15,.66,.66,.18,'chrome','turntable',k.detail(32,20,12));
 k.round(0,1.17,-.3,1.9,.43,1.83,'yellow','upper_body',.12);k.round(.45,1.51,-.65,.86,.44,1.12,'yellow','counterweight',.14);
 k.round(-.48,1.77,-.31,.89,.95,1.12,'dark','cab',.09);
 k.round(-.48,1.83,.264,.7,.64,.025,'glass','cab_glazing',.012);
 k.round(-.928,1.86,-.29,.025,.62,.86,'glass','cab_glazing',.01);
 k.round(-.48,2.275,-.32,1.02,.1,1.24,'yellow','cab_roof',.04);
 k.box(-.952,1.85,-.22,.022,.66,.045,'yellow','window_frames');k.box(-.952,1.39,-.24,.025,.06,.88,'yellow','window_frames');
 k.box(-.975,1.6,-.63,.02,.035,.13,'chrome','door_handle');
 // Paired plate boom, visible hinge pins and hydraulic ram.
 const boom=[[.13,1.29],[.56,2.13],[1.34,2.96],[1.60,2.91],[.83,1.83],[.43,1.28]];
 for(const x of [.2,.55])k.side(boom,x,.17,'yellow','boom');
 k.side([[1.32,2.88],[1.62,2.91],[2.28,1.12],[2.05,1.01]],.375,.29,'yellowLight','stick');
 for(const [z,y]of [[.32,1.4],[1.48,2.84],[2.15,1.14]]){const g=new T.CylinderGeometry(.1,.1,.6,12);k.put(g,'dark',.375,y,z,[0,0,Math.PI/2],null,'hinge_pins');g.dispose();}
 k.beam([.375,1.38,.62],[.375,2.16,1.10],.085,'dark','hydraulics',12);k.beam([.375,2.12,1.07],[.375,2.65,1.42],.045,'chrome','hydraulics',12);
 k.beam([.375,2.72,1.73],[.375,1.8,2.14],.067,'dark','hydraulics',10);k.beam([.375,1.8,2.14],[.375,1.30,2.30],.037,'chrome','hydraulics',10);
 // Open bucket: curved back, floor, two cheeks, and separate digging teeth.
 k.side([[2.02,1.05],[2.24,.91],[2.7,.49],[2.75,.37],[2.35,.36],[2.00,.60]],.375,.91,'dark','bucket');
 k.side([[2.20,.98],[2.34,.81],[2.63,.50],[2.31,.5],[2.13,.66]],.375,.76,'yellow','bucket_inset');
 for(const x of [-.02,.23,.48,.73])k.side([[2.53,.38],[2.85,.31],[2.88,.39],[2.65,.49]],x,.1,'chrome','bucket_teeth');
 if(k.lod<2)for(let i=0;i<6;i++)k.box(.91,1.49,-.97+i*.12,.025,.16,.035,'dark','engine_vents');
 k.cyl(.66,1.99,-.73,.065,.065,.31,'dark','exhaust',8);k.cyl(-.45,2.39,-.7,.07,.07,.14,'gold','beacon',10);
}
function bus(k){
 k.round(0,.83,0,1.56,.9,4.35,'green','body',.14);k.round(0,1.45,-.015,1.54,.85,4.32,'cream','upper_body',.15);
 k.round(0,1.48,2.166,1.3,.66,.04,'glass','windshield',.018);k.box(0,1.52,2.197,.035,.59,.015,'cream','windshield_divider');
 k.round(0,1.42,-2.171,1.26,.53,.035,'glass','rear_window',.012);
 for(const side of [-1,1]){
  for(let i=0;i<7;i++)k.round(side*.784,1.47,-1.74+i*.55,.024,.56,.46,'glass','passenger_windows',.009);
  k.box(side*.787,.99,0,.028,.075,3.97,'gold','side_stripe');
  for(const z of [-1.4,1.39])axle(k,side*.775,.36,z,.36,.26);
  k.beam([side*.68,1.53,1.97],[side*.98,1.55,2.02],.025,'dark','mirror_arms',6);k.round(side*1.0,1.48,2.03,.11,.24,.1,'dark','mirrors',.025);
  k.round(side*.53,.79,2.175,.33,.13,.04,'lamp','headlights',.028);k.round(side*.63,.88,-2.18,.13,.27,.04,'tail','tail_lights',.02);
 }
 k.round(.793,.95,1.31,.028,1.05,.48,'dark','passenger_door',.007);k.round(.815,1.32,1.31,.025,.44,.37,'glass','door_window',.008);k.box(.831,.94,1.31,.015,.87,.025,'chrome','door_divider');
 k.round(0,.47,2.13,1.49,.15,.16,'chrome','bumpers',.05);k.round(0,.51,-2.13,1.46,.15,.16,'dark','bumpers',.05);
 k.round(0,.72,2.191,.5,.20,.025,'dark','grille',.01);if(k.lod<2)for(let i=0;i<3;i++)k.box(0,.665+i*.055,2.21,.44,.015,.008,'chrome','grille_bars');
 k.round(0,1.995,-.58,1.1,.26,1.3,'cream','roof_ac',.1);for(const z of [-.87,-.29]){k.cyl(0,2.136,z,.22,.22,.02,'dark','ac_fans',k.detail(20,14,10));if(k.lod===0)for(let i=0;i<6;i++){const a=i*Math.PI/3;k.beam([0,2.15,z],[Math.cos(a)*.18,2.15,z+Math.sin(a)*.18],.018,'chrome','ac_grille',5);}}
}
function sportsCar(k){
 k.shell([[-2.05,.54,.66,.15],[-1.75,.53,.91,.24],[-.8,.54,.87,.25],[.55,.49,.84,.22],[1.53,.46,.88,.17],[2.03,.42,.71,.12]],'red','body',5);
 k.shell([[-1.05,.78,.7,.07],[-.56,.98,.62,.19],[.27,1.0,.59,.20],[1.02,.74,.66,.05]],'glass','canopy',4);
 k.round(0,1.185,-.13,.96,.047,.68,'red','roof',.019);
 for(const side of [-1,1]){
  for(const z of [-1.28,1.23])axle(k,side*.85,.32,z,.32,.26);
  k.round(side*.26,.648,1.44,.16,.018,.90,'cream','racing_stripes',.006);k.round(side*.26,1.216,-.13,.14,.01,.65,'cream','racing_stripes',.003);
  k.round(side*.63,.605,1.82,.31,.06,.24,'lamp','headlights',.018);
  k.round(side*.54,.63,-2.03,.42,.07,.045,'tail','tail_lights',.012);
  k.round(side*.76,.4,1.975,.16,.11,.027,'dark','air_intakes',.01);
  k.round(side*.87,.68,.33,.19,.10,.21,'red','mirrors',.035);
  k.box(side*.862,.65,-.25,.018,.023,.18,'chrome','door_handles');
  k.box(side*.81,.3,0,.13,.13,1.66,'dark','side_skirts');
  k.beam([side*.59,.63,-1.70],[side*.59,.93,-1.78],.025,'dark','spoiler_mounts',5);
  const tube=new T.CylinderGeometry(.075,.075,.16,k.detail(16,12,8));k.put(tube,'chrome',side*.49,.31,-2.0,[Math.PI/2,0,0],null,'exhausts');tube.dispose();
 }
 k.round(0,.96,-1.79,1.81,.085,.31,'dark','rear_wing',.035);k.round(0,.31,1.87,1.61,.06,.32,'dark','front_splitter',.025);
 k.round(0,.34,-1.99,1.24,.18,.1,'dark','diffuser',.025);if(k.lod<2)for(let i=-2;i<=2;i++)k.box(i*.2,.31,-2.04,.025,.18,.23,'dark','diffuser_fins');
}
function tank(k){
 for(const x of [-1.03,1.03])tracks(k,x,3.65,.5);
 k.side([[-1.75,.73],[-1.47,1.24],[1.15,1.24],[1.8,.81],[1.74,.68]],0,1.84,'olive','armored_hull');
 for(const side of [-1,1]){
  k.round(side*1.02,1.02,-.1,.53,.12,3.65,'oliveDark','track_guards',.04);
  for(const z of [-1.07,-.37,.33,1.03])k.round(side*.94,1.15,z,.05,.26,.52,'oliveLight','side_armor',.025);
  k.round(side*.64,1.01,1.63,.22,.11,.07,'lamp','headlights',.02);
  k.round(side*.87,1.29,-1.3,.20,.26,.65,'oliveDark','stowage',.04);
 }
 k.cyl(0,1.28,-.1,.69,.73,.16,'dark','turret_ring',k.detail(32,20,12));
 k.plan([[-.74,-.96],[.58,-.96],[.86,-.45],[.64,.55],[-.52,.65],[-.86,-.18]],1.32,.46,'olive','turret');
 k.plan([[-.58,-.83],[.46,-.83],[.65,-.41],[.49,.40],[-.41,.49],[-.66,-.18]],1.78,.05,'oliveLight','turret_roof');
 k.round(0,1.56,.51,.54,.37,.4,'oliveDark','mantlet',.10);
 k.beam([0,1.59,.58],[0,1.63,2.6],.10,'olive','barrel',k.detail(16,12,8));
 const muzzle=new T.CylinderGeometry(.14,.12,.3,k.detail(16,12,8));k.put(muzzle,'oliveDark',0,1.632,2.62,[Math.PI/2,0,0],null,'muzzle');muzzle.dispose();
 const hole=new T.CircleGeometry(.09,k.detail(16,12,8));k.put(hole,'dark',0,1.632,2.778,null,null,'bore');hole.dispose();
 k.cyl(-.28,1.87,-.35,.26,.26,.1,'oliveDark','hatches',k.detail(20,14,10));k.cyl(.32,1.85,-.12,.19,.19,.07,'olive','hatches',k.detail(18,12,8));
 k.round(-.28,1.98,-.35,.2,.14,.09,'dark','periscope',.015);
 if(k.lod<2){k.beam([.47,1.78,-.7],[.47,2.33,-.85],.012,'dark','antenna',5);for(let i=0;i<6;i++)k.box(-.43+i*.17,1.265,-1.30,.065,.018,.33,'dark','engine_grille');}
 k.box(-.866,1.54,-.3,.02,.15,.35,'gold','unit_insignia');
}
const builders={airplane,excavator,bus,'sports-car':sportsCar,tank};
export function createExpeditionModel(id,{lod=0}={}){if(!Object.hasOwn(builders,id))throw Error('Unknown expedition model: '+id);if(![0,1,2].includes(lod))throw Error('LOD must be 0, 1 or 2');const kit=new VehicleKit(lod,id);builders[id](kit);return kit.finish(id);}
export const inspectExpeditionModel=inspectWonderModel,disposeExpeditionModel=disposeWonderModel;
