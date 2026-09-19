import * as T from 'three';
import { ModelKit } from './model-kit.js';
const STONE='#D1C3A3',DARK='#4F615C',GRASS='#748B5F',GLASS='#64858A';
const base=(k,w,d,c='#B8B49D')=>k.box(0,.018,0,w,.036,d,c,'base');
const cross=(k,x,y,z,s,c)=>{k.box(x,y,z,s*.12,s,.025,c,'roof');k.box(x,y+s*.15,z,s*.62,s*.12,.025,c,'roof');};
function palace(k,{w=1.8,d=1.1,h=.38,c=STONE,roof=DARK,court=true}={}) {
  base(k,w+.16,d+.18);
  k.box(0,h/2+.04,-d/2+.14,w,h,.28,c);
  for(const x of [-w/2+.13,w/2-.13]){k.box(x,h/2+.04,0,.26,h,d,c);k.roof(x,h+.04,0,.3,d+.03,.14,roof,'roof');}
  if(!court){k.box(0,h/2+.04,d/2-.12,w,h,.24,c);k.roof(0,h+.04,d/2-.12,w+.04,.3,.12,roof);}
  k.roof(0,h+.04,-d/2+.14,w+.04,.34,.14,roof);
  k.facade(0,.05,-d/2-.01,w*.92,h,'#6B6A5B',k.lod?1:2,Math.PI);
  for(const x of [-w/2-.006,w/2+.006])k.facade(x,.04,0,d*.86,h,'#6B6A5B',k.lod?1:2,x>0?Math.PI/2:-Math.PI/2);
}
const builders={
'eiffel-tower':k=>{
  const c='#776049',light='#A38A67';base(k,1.2,1.2,'#BCBBA3');
  const levels=[[.08,.48],[.72,.29],[1.28,.16],[2.40,.036]];
  for(const sx of [-1,1])for(const sz of [-1,1]) {
    k.box(sx*.48,.09,sz*.48,.20,.14,.20,'#B9AB8D','base');
    for(let j=0;j<levels.length-1;j++){
      const [y,r]=levels[j],[Y,R]=levels[j+1];k.beam([sx*r,y,sz*r],[sx*R,Y,sz*R],j<2?.036:.022,c);
    }
  }
  for(const [y,r] of [[.74,.34],[1.29,.21]]){k.box(0,y,0,r*2,.055,r*2,c,'platforms');k.ring(0,y+.04,0,r,r,r-.02,r-.02,.045,light,'platforms',4);}
  for(const z of [-.36,.36])k.arch(0,.13,z,.72,.52,.044,c);
  for(const x of [-.36,.36])k.arch(x,.13,0,.72,.52,.044,c,'body',Math.PI/2);
  for(let j=1;j<levels.length-1;j++){
    const [y,r]=levels[j],[Y,R]=levels[j+1],n=k.detail(5,3,2);
    for(let i=0;i<n;i++){
      const t=i/n,T=(i+1)/n,a=r+(R-r)*t,b=r+(R-r)*T,yy=y+(Y-y)*t,YY=y+(Y-y)*T;
      for(const side of [-1,1]){k.beam([-a,yy,side*a],[b,YY,side*b],.012,c);k.beam([side*a,yy,-a],[side*b,YY,b],.012,c);}
      if(k.lod<2)for(const side of [-1,1]){k.beam([a,yy,side*a],[-b,YY,side*b],.01,light);k.beam([side*a,yy,a],[side*b,YY,-b],.01,light);}
    }
  }
  k.cyl(0,2.48,0,.025,.055,.15,c,'roof');k.cyl(0,2.66,0,.008,.009,.25,c,'roof',6);
},
'colosseum':k=>{
  k.disk(0,0,0,1.03,.80,.045,'#B6AE97','base',40);
  const n=k.detail(28,20,12),step=2*Math.PI/n;
  for(let level=0;level<3;level++){
    const keep=level===0?n:level===1?Math.floor(n*.78):Math.floor(n*.53);
    for(let i=0;i<keep;i++){const a=i*step+.25,x=Math.cos(a)*.9,z=Math.sin(a)*.68;
      k.arch(x,.05+level*.22,z,k.detail(.175,.24,.35),.205,.085,level%2?'#C9B993':'#DACAAB','body',Math.PI/2-a);
    }
    k.ring(0,.04+level*.22,0,.94,.72,.84,.62,.035,'#BBA982','body',2,[.25,.25+keep*step]);
  }
  for(let i=0;i<k.detail(5,4,2);i++){const r=.34+i*.075;k.ring(0,.05+i*.042,0,r,r*.72,r-.065,(r-.065)*.72,.036,'#AD9F80','interior');}
  k.disk(0,.047,0,.37,.25,.01,'#B59A71','arena',30);
  if(k.lod<2)for(let j=0;j<8;j++){const a=j*Math.PI/4;k.box(Math.cos(a)*.75,.1,Math.sin(a)*.55,.06,.07,.10,'#A6916C');}
},
'sagrada-familia':k=>{
  const c='#CEB182',hi='#E8D2A6';base(k,1.4,1.6,'#BDB39A');
  k.box(0,.28,0,.78,.48,1.25,c);k.roof(0,.54,0,.88,1.3,.24,hi);
  for(const z of [-.57,.57]) {
    k.arch(0,.045,z,.35,.39,.10,'#AB9069');
    for(const x of [-.50,-.29,.29,.50]){
      const h=Math.abs(x)<.4?1.16:1.0;k.cyl(x,.12+h/2,z,.067,.115,h,c,'towers');
      k.cyl(x,h+.18,z,.023,.065,.24,hi,'towers');k.sphere(x,h+.33,z,.037,'#B49959','towers');
      if(k.lod<2)for(let j=0;j<4;j++)k.ring(x,.4+j*.16,z,.073,.073,.061,.061,.032,'#AC936A','towers');
    }
  }
  for(const [x,z] of [[-.25,-.18],[.25,-.18],[-.25,.18],[.25,.18]]){k.cyl(x,1,z,.045,.105,.88,hi,'central_towers');k.pyramid(x,1.43,z,.12,.12,.25,'#C9B078');}
  k.cyl(0,1.22,0,.075,.17,1.05,c,'central_towers');k.pyramid(0,1.72,0,.15,.15,.24,hi);cross(k,0,2.01,0,.18,'#C6AC6C');
  if(k.lod<2)for(const s of [-1,1])for(let i=0;i<5;i++){k.box(s*.43,.29,(i-2)*.22,.08,.52,.075,'#B99B72');k.pyramid(s*.43,.55,(i-2)*.22,.09,.09,.12,hi);}
},
'elizabeth-tower':k=>{
  const c='#C8B48A',trim='#E3D2AC';base(k,.72,.72);
  k.box(0,.85,0,.42,1.62,.42,c);
  for(const y of [.12,.46,.91,1.38])k.box(0,y,0,.48,.045,.48,trim);
  for(const x of [-.22,.22])for(const z of [-.22,.22])k.box(x,.87,z,.046,1.65,.046,trim);
  for(let f=0;f<4;f++){
    const a=f*Math.PI/2,n=new T.Vector3(Math.sin(a),0,Math.cos(a)),z=.246;
    k.put(new T.CylinderGeometry(.139,.139,.009,k.detail(24,16,12)),'#43514C',n.x*z,1.55,n.z*z,new T.Quaternion().setFromUnitVectors(new T.Vector3(0,1,0),n),null,'clock');
    k.put(new T.CircleGeometry(.116,k.detail(24,16,12)),'#F1E6CC',n.x*(z+.008),1.55,n.z*(z+.008),[0,a,0],null,'clock');
    const p=(u,v)=>[n.x*(z+.012)+Math.cos(a)*u,1.55+v,n.z*(z+.012)-Math.sin(a)*u];
    k.beam(p(0,0),p(0,.08),.006,'#434A42','clock');k.beam(p(0,0),p(-.064,-.028),.006,'#434A42','clock');
    if(k.lod===0)for(let i=0;i<12;i++){const t=i*Math.PI/6;k.beam(p(Math.sin(t)*.088,Math.cos(t)*.088),p(Math.sin(t)*.104,Math.cos(t)*.104),.003,'#726747','clock');}
    k.facade(n.x*.217,.48,n.z*.217,.36,.81,'#536057',3,a);
  }
  k.box(0,1.75,0,.48,.08,.48,trim);k.pyramid(0,1.80,0,.46,.46,.40,'#4D5D56');k.cyl(0,2.24,0,.013,.022,.15,'#AF9660','roof',6);
  for(const x of [-.22,.22])for(const z of [-.22,.22])k.pyramid(x,1.80,z,.055,.055,.16,trim);
},
'brandenburg-gate':k=>{
  base(k,1.95,.86,'#BAB7A3');const c='#D0C19E';
  for(const z of [-.16,.16])for(let i=0;i<6;i++)k.column((i-2.5)*.23,.065,z,.055,.63,c);
  k.box(0,.73,0,1.56,.13,.51,c);k.box(0,.83,0,1.66,.055,.57,'#BBAC8A');
  for(const x of [-.82,.82]){k.box(x,.3,0,.18,.52,.48,c);k.roof(x,.57,0,.28,.54,.08,'#ACA282');}
  k.box(0,.90,0,.48,.1,.28,c,'quadriga');
  for(const x of [-.19,-.063,.063,.19]){
    k.box(x,1.03,.01,.075,.10,.22,'#5E7363','quadriga');k.beam([x,1.04,.1],[x,1.16,.13],.025,'#5E7363','quadriga');
    k.sphere(x,1.17,.16,.036,'#5E7363','quadriga');
    for(const z of [-.07,.07])k.beam([x,.98,z],[x,.91,z+.04],.012,'#5E7363','quadriga');
  }
  k.cyl(0,1.08,-.13,.031,.045,.18,'#526757','quadriga',6);k.sphere(0,1.2,-.13,.035,'#526757','quadriga');k.beam([.025,1.12,-.13],[.05,1.35,-.13],.009,'#526757','quadriga');
},
'versailles-palace':k=>{
  palace(k,{w:2,d:1.15,h:.33,c:'#D3C09D',roof:'#53615C'});
  k.box(0,.26,-.38,.64,.40,.46,'#DDCBA8');k.roof(0,.48,-.38,.73,.51,.2,'#52605E');
  k.box(0,.575,-.11,.16,.08,.02,'#C3A567','detail');
  for(const x of [-1.04,1.04]){k.box(x,.26,.48,.27,.43,.34,'#D6C19A');k.roof(x,.48,.48,.32,.40,.18,'#52605E');}
  k.box(0,.015,-1.0,2.2,.03,.8,'#6D8358','landscape');
  for(const x of [-.77,-.26,.26,.77]){k.box(x,.038,-1.0,.35,.024,.55,'#8C9E6A','landscape');k.box(x,.052,-1,.24,.022,.38,'#536E4B','landscape');}
  k.box(0,.045,-1.0,2.18,.016,.045,'#D3C5A6','landscape');
  if(k.lod<2)for(const x of [-1,1])for(const z of [-1.27,-.98,-.72])k.tree(x,.04,z,.14);
  k.facade(0,.075,-.228,.55,.32,'#716852',2);
},
'louvre':k=>{
  palace(k,{w:2,d:1.45,h:.33,c:'#D8CBB3',roof:'#56646A'});
  k.pyramid(0,.055,.25,.62,.62,.48,'#8FB1B7','pyramid');
  if(k.lod<2){for(let i=1;i<k.detail(5,3,2);i++){const t=i/k.detail(5,3,2),y=.055+.48*t,s=.31*(1-t);
    for(const z of [-s,s])k.beam([-s,y,.25+z],[s,y,.25+z],.006,'#CCDBD3','pyramid');
    for(const x of [-s,s])k.beam([x,y,.25-s],[x,y,.25+s],.006,'#CCDBD3','pyramid');
  }}
  for(const [x,z] of [[-.5,.25],[.5,.25],[0,.76]])k.pyramid(x,.05,z,.20,.20,.14,'#8FB1B7','pyramid');
  for(const x of [-.83,0,.83]){k.box(x,.46,-.59,.30,.14,.36,'#D0C1A5');k.roof(x,.53,-.59,.34,.42,.13,'#56646A');}
},
'british-museum':k=>{
  palace(k,{w:1.9,d:1.36,h:.31,c:'#D8D2BE',roof:'#9BA9A6',court:false});
  k.box(0,.39,0,1.24,.025,.88,'#A9C1BE','glass_court');
  k.cyl(0,.31,0,.30,.30,.50,'#C1B496','reading_room',k.detail(24,16,10));
  k.sphere(0,.52,0,.31,'#A8B9AF','reading_room',[1,.36,1]);
  for(let i=0;i<k.detail(10,8,6);i++){const n=k.detail(10,8,6);k.column((i-(n-1)/2)*1.35/n,.07,.81,.03,.40,'#DCD5C1');}
  k.box(0,.48,.81,1.50,.065,.26,'#CEC5AD');k.roof(0,.51,.81,1.5,.3,.16,'#C1B79E');
  k.stairs(0,.035,.98,1.62,.27,.055,'#BCB49B');
  if(k.lod===0)for(let i=-3;i<=3;i++)k.beam([-.62,.41,i*.10],[.62,.41,i*.10],.007,'#D1DBCD','glass_court');
},
};


Object.assign(builders,{
'alhambra':k=>{
  const c='#B77B55',light='#CD9B71';k.hill(0,0,2,1.5,.18,'#8B9071');
  k.box(0,.195,0,1.66,.04,1.15,'#C2A27A','base');
  for(const x of [-.78,.78])k.box(x,.40,0,.13,.4,1.16,c);
  for(const z of [-.52,.52])k.box(0,.40,z,1.64,.4,.12,c);
  for(const x of [-.75,.75])for(const z of [-.50,.50]){k.box(x,.50,z,.26,.59,.26,c);k.box(x,.79,z,.29,.03,.29,light);}
  k.box(0,.39,-.22,1.1,.36,.25,light);k.roof(0,.58,-.22,1.15,.3,.08,'#895E45');
  k.box(0,.235,.23,.24,.016,.48,'#679C98','water_court');
  for(const x of [-.32,.32])for(let i=0;i<k.detail(5,4,3);i++)k.arch(x,.225,-.02+i*.11,.095,.20,.035,'#D5AC80','arcades',Math.PI/2);
  k.ring(0,.23,-.33,.17,.17,.1,.1,.023,'#DEC5A0','court');
  if(k.lod<2)for(const x of [-.77,.77])for(let i=0;i<9;i++)k.box(x,.625,(i-4)*.12,.14,.075,.05,light,'battlements');
  if(k.lod<2)for(const x of [-.46,.46])for(const z of [.1,.4])k.tree(x,.23,z,.14);
},
'acropolis':k=>{
  k.hill(0,0,1.95,1.35,.35,'#9C9A7F');k.box(0,.37,0,1.38,.07,.78,'#C2B493','base');
  k.box(0,.425,0,1.3,.05,.69,'#D8C9AA','base');
  const n=k.detail(10,8,6);
  for(const z of [-.27,.27])for(let i=0;i<n;i++)k.column((i-(n-1)/2)*1.13/(n-1),.45,z,.027,.43,'#DED1AF');
  for(const x of [-.565,.565])for(const z of [-.09,.09])k.column(x,.45,z,.027,.43,'#DED1AF');
  k.box(0,.90,0,1.26,.07,.64,'#CDBD99');
  k.roof(-.29,.94,0,.66,.66,.18,'#CAB996');k.box(.29,.935,.20,.54,.025,.20,'#C4B08C','roof');
  k.box(.10,.60,0,.68,.30,.22,'#B5A486');
  k.box(-.62,.31,.52,.37,.045,.21,'#BEAD8F','base');
  for(let i=0;i<4;i++)k.column(-.75+i*.085,.335,.52,.018,.20,'#D6C8A6');
  if(k.lod<2)for(let i=0;i<5;i++)k.box(.65-i*.09,.19,.50,.07,.035,.09,'#CDBF9C','ruins',i*.8);
},
'belem-tower':k=>{
  base(k,1.1,1.45,'#C8B99A');const c='#D5C5A5';
  k.box(0,.17,.23,.93,.28,.85,c);k.box(0,.33,.23,1,.035,.91,'#B9AA8C');
  k.box(0,.68,-.24,.57,.89,.57,c);k.box(0,1.12,-.24,.63,.08,.63,c);
  for(const x of [-.31,.31])for(const z of [-.55,.07]){k.cyl(x,1.04,z,.065,.07,.24,c);k.put(new T.ConeGeometry(.082,.16,k.sides),'#C1B092',x,1.24,z,null,null,'roof');}
  for(const x of [-.42,.42])for(const z of [-.10,.57]){k.cyl(x,.36,z,.09,.10,.23,c);k.cyl(x,.50,z,.015,.105,.14,'#C9BB9C','roof');}
  k.facade(0,.30,.054,.52,.76,'#6E7262',3);
  k.arch(0,.43,.068,.18,.23,.055,'#E6D7B9');
  if(k.lod<2)for(let i=-3;i<=3;i++){k.box(i*.12,.4,.67,.055,.10,.075,c,'battlements');k.box(i*.08,1.22,.09,.038,.09,.075,c,'battlements');}
  k.box(0,.052,.90,.5,.022,.23,'#6A9695','water_edge');
},
'neuschwanstein':k=>{
  k.hill(0,0,1.65,1.5,.38,'#8B937B');const c='#E2D9C3',roof='#526B75';
  k.box(0,.68,-.04,.66,.68,.80,c);k.roof(0,1.02,-.04,.72,.90,.24,roof);
  k.box(-.42,.60,.17,.35,.5,.60,c);k.roof(-.42,.85,.17,.39,.65,.20,roof);
  k.box(.43,.57,.20,.34,.45,.51,'#D1C4A8');k.roof(.43,.80,.20,.38,.57,.18,roof);
  for(const [x,z,h,r] of [[-.36,-.4,1.22,.12],[.37,-.35,1.50,.105],[-.54,.42,.90,.075],[.53,.44,.93,.08]]) {
    k.cyl(x,.32+h/2,z,r,r*1.02,h,c,'towers');k.cyl(x,.32+h,z,r*1.20,r*1.20,.06,c,'towers');k.cyl(x,.32+h+.15,z,.012,r*1.27,.30,roof,'roof');
  }
  k.arch(0,.33,.47,.32,.30,.08,'#BEAD8C');
  k.facade(0,.47,.367,.58,.5,'#607470',3);
  if(k.lod<2){k.facade(-.607,.40,.13,.40,.35,'#607470',2,-Math.PI/2);for(const z of [-.6,.55])k.tree(-.65,.09,z,.25);}
},
'atomium':k=>{
  k.disk(0,0,0,.58,.58,.035,'#9EAA8C','base',32);
  const q=new T.Quaternion().setFromUnitVectors(new T.Vector3(1,1,1).normalize(),new T.Vector3(0,1,0));
  const vertices=[];for(const x of [-1,1])for(const y of [-1,1])for(const z of [-1,1])vertices.push(new T.Vector3(x*.38,y*.38,z*.38).applyQuaternion(q).add(new T.Vector3(0,.82,0)));
  const center=new T.Vector3(0,.82,0),c='#B9C7C9';
  vertices.forEach(p=>{k.sphere(...p.toArray(),.135,c,'spheres');k.beam(center.toArray(),p.toArray(),.032,'#849CA0','connectors',k.detail(8,6,4));});
  k.sphere(...center.toArray(),.135,c,'spheres');
  for(let i=0;i<8;i++)for(let j=i+1;j<8;j++)if(Math.abs(vertices[i].distanceTo(vertices[j])-.76)<.001)k.beam(vertices[i].toArray(),vertices[j].toArray(),.032,'#849CA0','connectors',k.detail(8,6,4));
  [...vertices].sort((a,b)=>a.y-b.y).slice(1,4).forEach(p=>k.beam([p.x*1.07,.03,p.z*1.07],[p.x,p.y-.10,p.z],.025,'#70868B','supports',6));
},
'pont-du-gard':k=>{
  const c='#CBB182',light='#DBC396';k.box(0,.012,0,2.1,.024,.48,'#809887','base');
  k.box(0,.027,0,1.10,.008,.45,'#598D97','river');
  for(const [n,y,h,w,d] of [[6,.04,.36,2,.24],[8,.42,.27,2.08,.21],[16,.72,.16,2.14,.17]]){
    for(let i=0;i<n;i++)k.arch((i-(n-1)/2)*w/n,y,0,w/n*.99,h,d,c);
    k.box(0,y+h+.013,0,w+.045,.026,d+.035,light);
  }
  k.box(0,.915,0,2.19,.035,.20,'#B5A078','roof');
},
'leaning-tower-pisa':k=>{
  const c='#DDD3B7',shade='#BCAD8A';base(k,.94,.94,'#A6B48F');
  k.cyl(0,.18,0,.27,.29,.29,c);
  for(let level=0;level<6;level++){
    const y=.335+level*.17;k.cyl(0,y,0,.32,.32,.028,c);
    k.cyl(0,y+.073,0,.227,.227,.135,'#B3A688');
    const n=k.detail(16,12,8);for(let i=0;i<n;i++){const a=i*2*Math.PI/n;k.column(Math.cos(a)*.282,y+.014,Math.sin(a)*.282,.012,.14,c);}
    k.cyl(0,y+.154,0,.313,.313,.02,'#E7DEC6');
  }
  k.cyl(0,1.47,0,.25,.25,.14,c,'roof');k.cyl(0,1.56,0,.28,.28,.035,shade,'roof');
  const n=k.detail(8,6,4);for(let i=0;i<n;i++){const a=i*Math.PI*2/n;k.arch(Math.cos(a)*.253,1.40,Math.sin(a)*.253,.10,.12,.018,'#A19272','roof',Math.PI/2-a);}
},
'santiago-bernabeu':k=>{
  base(k,2.2,1.77,'#A6ABA0');
  // Genuine open bowl with distinct metallic shell, roof halves, seating and pitch nodes.
  for(let i=0;i<6;i++){
    const t=i/5,rx=.97+.075*Math.sin(t*Math.PI),rz=.75+.05*Math.sin(t*Math.PI),c=i%2?'#B6C0C2':'#A5B1B5';
    k.ring(0,.06+i*.09,0,rx,rz,.84,.61,.088,c,'shell',4);
  }
  for(const y of [.16,.33,.50])k.ring(0,y,0,1.043,.803,1.032,.792,.012,'#657C86','shell',4);
  for(let i=0;i<k.detail(5,4,3);i++){const t=i/k.detail(5,4,3);k.ring(0,.20+t*.25,0,.62+t*.22,.39+t*.20,.57+t*.22,.34+t*.20,.045,i%2?'#596B83':'#849BB4','seating',4);}
  k.ring(0,.603,0,1.04,.80,.72,.49,.047,'#CED5D3','roof_north',4,[0,Math.PI]);
  k.ring(0,.603,0,1.04,.80,.72,.49,.047,'#C2CECD','roof_south',4,[Math.PI,2*Math.PI]);
  for(let i=0;i<6;i++)k.box((i-2.5)*.166,.208,0,.166,.025,.59,i%2?'#659854':'#548543','pitch_'+(i+1));
  k.ring(0,.224,0,.47,.267,.462,.259,.006,'#E7E6CB','pitch_markings',12);
  k.box(0,.229,0,.006,.003,.535,'#E7E6CB','pitch_markings');k.ring(0,.227,0,.079,.079,.073,.073,.003,'#E7E6CB','pitch_markings');
  for(const x of [-.477,.477]){k.box(x,.263,0,.012,.078,.145,'#DEE0CB','goals');}
  if(k.lod===0)for(let i=0;i<30;i++){const a=i/30*Math.PI*2,co=Math.cos(a),si=Math.sin(a),x=Math.sign(co)*Math.sqrt(Math.abs(co))*1.037,z=Math.sign(si)*Math.sqrt(Math.abs(si))*.794;k.beam([x,.10,z],[x,.55,z],.0045,'#D2D8D5','shell_ribs');}
},
});


Object.assign(builders,{
'christ-the-redeemer':k=>{
  k.hill(0,0,1.45,1.18,.48,'#7D8D70');k.box(0,.50,0,.42,.16,.33,'#ABA991','base');k.box(0,.61,0,.28,.06,.26,'#C5C5B5','base');
  const c='#C8CCC1';
  k.cyl(0,1.05,0,.108,.20,.88,c,'statue',8);
  k.sphere(0,1.54,.005,.088,c,'statue',[.85,1.17,.85]);k.cyl(0,1.45,0,.05,.055,.12,c,'statue',6);
  for(const s of [-1,1]){
    const points=[[s*.07,1.42,-.075],[s*.62,1.44,-.04],[s*.62,1.35,-.04],[s*.14,1.17,-.075],[s*.07,1.42,.075],[s*.62,1.44,.04],[s*.62,1.35,.04],[s*.14,1.17,.075]];
    k.mesh(points,[[0,1,2],[0,2,3],[4,7,6],[4,6,5],[0,4,5],[0,5,1],[3,2,6],[3,6,7],[1,5,6],[1,6,2],[0,3,7],[0,7,4]],c,'statue');
    k.box(s*.67,1.397,0,.13,.037,.067,'#D4D6CB','hands');
  }
  if(k.lod<2){for(const x of [-.07,0,.07])k.beam([x*.6,1.16,.098],[x*1.7,.66,.15],.008,'#B5BCAE','robe_detail');k.box(0,1.54,.078,.032,.036,.034,'#CED2C5','statue');}
},
'machu-picchu':k=>{
  base(k,1.95,1.5,'#667F59');
  k.hill(.18,-.5,1.1,.77,1.02,'#758465');k.hill(-.66,-.56,.50,.5,.68,'#83916C');
  const n=k.detail(7,5,4);
  for(let i=0;i<n;i++){
    const w=1.85-i*.075,z=.60-i*.145,y=.10+i*.065;
    k.box(-.06,y/2,z,w,y,.148,'#A7A181','terrace_walls');
    k.box(-.06,y+.009,z,w-.024,.018,.13,i%2?'#779058':'#889B67','terraces');
  }
  k.box(.08,.36,-.06,1.1,.075,.41,'#9A9B79','plateau');
  const rows=k.lod===2?1:2,cols=k.detail(5,4,3);
  for(let r=0;r<rows;r++)for(let i=0;i<cols;i++){
    const x=-.47+i*.23,z=-.06+r*.20,y=.40;k.box(x,y+.05,z,.15,.10,.12,'#B1AB8B','houses');
    k.roof(x,y+.10,z,.16,.14,.08,'#85876B','houses');if(k.lod===0)k.box(x,y+.03,z+.063,.036,.063,.008,'#555F4C','houses');
  }
  k.box(-.66,.32,-.19,.24,.17,.29,'#ABA98A','temple');
  k.box(-.66,.407,-.19,.20,.007,.24,'#858F6E','temple');
  k.stairs(.68,.04,.23,.10,.86,.31,'#B1AC8C','steps');
},
'la-moneda':k=>{
  palace(k,{w:1.9,d:1.20,h:.30,c:'#E2DBCA',roof:'#A28A6E',court:false});
  k.box(0,.27,.515,.56,.38,.23,'#EBE4D3');k.box(0,.475,.515,.64,.048,.26,'#CDC3AF');
  k.arch(0,.055,.644,.20,.26,.035,'#C5BBA5');
  for(const x of [-.22,.22])k.box(x,.245,.647,.042,.35,.032,'#EFE9D9');
  k.box(0,.145,0,.14,.22,.91,'#DFD8C7');
  for(const x of [-.37,.37]){k.box(x,.06,0,.28,.02,.50,'#7F996B','courtyard');k.sphere(x,.12,0,.075,'#658259','courtyard');}
  if(k.lod<2)for(let i=-5;i<=5;i++)k.box(i*.15,.38,.606,.055,.067,.033,'#D0C7B3','detail');
  k.beam([0,.50,.51],[0,.75,.51],.005,'#8A9290','flagpole');
},
'teatro-colon':k=>{
  const c='#D6C19A';base(k,1.75,1.35);
  k.box(0,.29,0,1.54,.51,1.1,c);k.roof(0,.56,-.06,1.58,1.05,.26,'#748176');
  k.box(0,.26,.64,1.65,.38,.22,'#C4AF89');
  for(let i=0;i<k.detail(9,7,5);i++){const n=k.detail(9,7,5);k.arch((i-(n-1)/2)*1.42/n,.06,.766,1.36/n,.22,.035,'#E3CFAB');}
  for(const x of [-.62,-.21,.21,.62]){k.box(x,.48,.58,.18,.22,.20,'#DEC9A2');k.box(x,.62,.59,.23,.04,.25,'#BDA883');}
  k.box(0,.82,-.22,.66,.17,.66,'#72857C','roof');k.roof(0,.90,-.22,.69,.70,.15,'#607469');
  k.facade(0,.29,.557,1.46,.24,'#657570',1);
  for(const x of [-.78,.78])k.facade(x,.14,-.02,.95,.35,'#63716A',2,x>0?Math.PI/2:-Math.PI/2);
  k.stairs(0,.035,.90,1.7,.20,.06,'#C0B294');
},
'palacio-salvo':k=>{
  const c='#C4B595',hi='#DED0AE';base(k,1.47,1.14);
  k.box(0,.27,0,1.32,.47,.99,c);
  k.box(0,.53,0,1.36,.055,1.03,hi);
  for(const x of [-.55,.55])for(const z of [-.38,.38])k.cyl(x,.58,z,.12,.12,.11,'#B8AA8B');
  k.box(.12,.88,-.03,.65,.72,.59,c);
  k.box(.12,1.24,-.03,.70,.075,.64,hi);
  k.box(.12,1.39,-.03,.48,.26,.44,c);
  for(const x of [-.17,.41])for(const z of [-.27,.21]){k.cyl(x,1.36,z,.073,.088,.17,hi);k.sphere(x,1.47,z,.080,c,'roof',[1,.65,1]);}
  k.box(.12,1.57,-.03,.43,.07,.40,'#DFCFAC');
  k.cyl(.12,1.73,-.03,.14,.19,.28,c,'tower_top');k.sphere(.12,1.90,-.03,.16,'#7E8777','roof',[1,1.2,1]);
  k.cyl(.12,2.10,-.03,.014,.035,.21,'#889482','roof',6);
  k.facade(0,.10,.506,1.2,.37,'#706E5C',3);k.facade(.12,.62,.277,.54,.57,'#776F57',4);
  k.facade(.12,1.29,.201,.37,.22,'#736E58',1);
  if(k.lod<2)for(const x of [-.21,.45])k.box(x,.86,.29,.035,.65,.026,hi,'detail');
},
'las-lajas-sanctuary':k=>{
  k.box(0,.013,0,1.88,.026,1.12,'#688777','base');k.box(0,.03,0,.35,.015,1.1,'#608E96','river');
  k.hill(-.70,0,.54,1.10,.61,'#7B8770');k.hill(.69,0,.56,1.10,.65,'#8A8D74');
  for(let i=0;i<3;i++)k.arch((i-1)*.45,.10,.18,.445,.45,.28,'#A6AA9A','bridge');
  k.box(0,.585,.18,1.55,.08,.42,'#BBBCAA','bridge');
  k.box(.20,.93,-.02,.69,.60,.62,'#B6BCAD');k.roof(.20,1.24,-.05,.74,.67,.28,'#616F66');
  for(const x of [-.16,.56]){
    k.box(x,1.11,.31,.20,.96,.22,'#C6C8B7','towers');
    k.pyramid(x,1.59,.31,.24,.26,.38,'#778174');
    if(k.lod<2)k.arch(x,1.35,.426,.115,.18,.014,'#8A9285','towers');
  }
  k.arch(.20,.64,.316,.23,.40,.05,'#DADACA');
  k.put(new T.CircleGeometry(.09,k.sides),'#728F90',.20,1.18,.338,null,null,'rose_window');
  cross(k,.20,1.60,.14,.13,'#AEB8A7');
  for(const s of [-1,1])k.box(0,.675,.18+s*.215,1.5,.06,.03,'#C3C7B6','bridge');
},
'museum-of-tomorrow':k=>{
  base(k,2.3,1.04,'#A9BFB3');k.box(0,.04,0,2.24,.018,.99,'#6EAAAD','water');
  k.box(0,.065,0,2.18,.04,.59,'#D5DCCF','pier');
  k.box(0,.20,0,1.73,.26,.38,'#759EA0','glazing');
  k.box(0,.345,0,1.91,.045,.44,'#E5E8DC','roof');
  const n=k.detail(17,12,8);
  for(let i=0;i<n;i++){
    const x=(i-(n-1)/2)*1.86/(n-1),width=.32+.16*Math.sin((i/(n-1))*Math.PI);
    for(const s of [-1,1]){
      k.beam([x-.065,.32,0],[x,.51,s*width*.48],.023,'#E7EBDD','canopy',5);
      k.beam([x,.51,s*width*.48],[x+.095,.39,s*width],.019,'#E7EBDD','canopy',5);
      k.beam([x+.095,.39,s*width],[x+.14,.24,s*width*.9],.014,'#CEDACE','canopy',4);
    }
  }
  k.beam([-1.16,.34,0],[1.20,.36,0],.040,'#E3E9DD','spine',8);
  for(const x of [-1,1]){k.beam([x*.92,.11,-.24],[x*1.20,.36,0],.031,'#DDE5D8','support');k.beam([x*.92,.11,.24],[x*1.20,.36,0],.031,'#DDE5D8','support');}
},
'maracana':k=>{
  k.disk(0,0,0,1.1,.89,.045,'#A2B19A','base',k.detail(48,32,20));
  k.ring(0,.055,0,1.01,.80,.89,.68,.18,'#BEC7B9','outer_bowl');
  k.ring(0,.235,0,1.045,.825,.87,.65,.045,'#D7DDCE','rim');
  for(let i=0;i<k.detail(5,4,3);i++){const t=i/k.detail(5,4,3);k.ring(0,.075+t*.15,0,.60+t*.26,.37+t*.27,.55+t*.26,.32+t*.27,.024,i%2?'#A1B8B1':'#799D9C','seating');}
  k.ring(0,.295,0,1.045,.825,.61,.375,.045,'#DDE2D6','roof');
  const n=k.detail(24,16,10);
  for(let i=0;i<n;i++){const a=i*Math.PI*2/n;k.beam([Math.cos(a)*.62,.35,Math.sin(a)*.384],[Math.cos(a)*1.044,.35,Math.sin(a)*.824],.006,'#B4C2B7','roof_ribs');}
  for(let i=0;i<6;i++)k.box((i-2.5)*.166,.086,0,.166,.012,.575,i%2?'#60924D':'#507F40','pitch');
  for(const z of [-.256,.256])k.box(0,.096,z,.92,.004,.006,'#DFE4C7','pitch_lines');
  for(const x of [-.46,.46])k.box(x,.096,0,.006,.004,.52,'#DFE4C7','pitch_lines');
  k.box(0,.096,0,.006,.004,.52,'#DFE4C7','pitch_lines');k.ring(0,.096,0,.077,.077,.071,.071,.003,'#DFE4C7','pitch_lines');
  if(k.lod<2)for(let i=0;i<16;i++){const a=i*Math.PI/8;k.box(Math.cos(a)*1.015,.11,Math.sin(a)*.803,.032,.16,.032,'#778B81','columns');}
}
});

export const WONDER_IDS=Object.freeze(Object.keys(builders));
export function createWonderModel(assetId,{lod=0}={}) {
  if(!builders[assetId])throw new Error('Unknown wonder: '+assetId);
  if(![0,1,2].includes(lod))throw new Error('LOD must be 0, 1 or 2');
  const kit=new ModelKit(lod,assetId);builders[assetId](kit);const root=kit.finish(assetId);
  if(assetId==='leaning-tower-pisa')for(const group of root.children)if(group.name!=='base')group.rotation.z=-.085;

  root.updateMatrixWorld(true);return root;
}
export function disposeWonderModel(root) {
  const geometries=new Set(),materials=new Set();root.traverse(o=>{if(o.isMesh){geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m);}});
  geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());
}
export function inspectWonderModel(root) {
  let triangles=0,meshes=0,vertices=0;const materials=new Set();
  root.traverse(o=>{if(!o.isMesh)return;meshes++;vertices+=o.geometry.attributes.position.count;triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;materials.add(o.material);});
  const box=new T.Box3().setFromObject(root);
  return {triangles,meshes,vertices,materials:materials.size,bounds:{min:box.min.toArray(),max:box.max.toArray()},size:box.getSize(new T.Vector3()).toArray()};
}



