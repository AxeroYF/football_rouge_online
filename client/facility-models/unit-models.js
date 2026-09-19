import {base,T} from './facility-kit.js';
function football(k,x,y,z,r=.09){k.put(new T.IcosahedronGeometry(r,1),'white',x,y,z,null,null,'football');for(const [a,b,c]of[[0,0,1],[.84,.38,.45],[-.62,.58,.55],[.12,.96,.17]])k.put(new T.IcosahedronGeometry(r*.25,0),'dark',x+a*r*.87,y+b*r*.87,z+c*r*.87,[0,.4,.2],[1,1,.38],'football_panels');}
function person(k,x,z,s,{scout=false,skin='skin',step=0,part='person'}={}){
 const p=([a,b,c])=>[x+a*s,.18+b*s,z+c*s];
 const box=(a,b,c,w,h,d,col,name=part,rotation=0)=>k.box(...p([a,b,c]),w*s,h*s,d*s,col,name,rotation);
 const sphere=(a,b,c,r,col,name=part,scale=[1,1,1])=>k.sphere(...p([a,b,c]),r*s,col,name,scale);
 const beam=(a,b,r,col,name=part)=>k.beam(p(a),p(b),r*s,col,name,k.detail(8,6,5));
 // Relaxed bent legs and offset boots retain a readable silhouette at map scale.
 for(const side of [-1,1]){
  const footZ=side===1?step:0;beam([side*.075,.37,0],[side*.095,.20,footZ*.4],.040,scout?'olive':'navy',part+'_legs');beam([side*.095,.2,footZ*.4],[side*.10,.05,footZ],.034,scout?'olive':skin,part+'_legs');
  box(side*.1,.026,footZ+.036,.09,.054,.145,scout?'leather':'black',part+'_boots');if(!scout)box(side*.098,.14,footZ*.8,.068,.13,.069,'white',part+'_socks');
 }
 k.cyl(...p([0,.48,0]),.13*s,(scout?.17:.115)*s,.28*s,scout?'khaki':'crimson',part+'_torso',k.detail(10,8,6));
 box(0,.62,0,.25,.085,.18,scout?'khaki':'crimson',part+'_shoulders');
 beam([0,.65,0],[0,.74,0],.038,skin,part+'_neck');sphere(0,.795,.012,.100,skin,part+'_head',[.86,1.05,.88]);
 k.put(new T.SphereGeometry(.099*s,k.detail(12,8,6),4,0,Math.PI*2,0,Math.PI*.51),'hair',...p([0,.815,0]),null,[.88,.8,.90],part+'_hair');
 sphere(0,.785,.099,.019,skin,part+'_face',[.7,.9,1]);if(k.lod<2)for(const side of [-1,1])sphere(side*.036,.812,.085,.007,'black',part+'_eyes');
 if(scout){
  // Broad green travelling mantle reads as one shape at distant map zooms.
  k.mesh([p([-.18,.66,-.055]),p([.18,.66,-.055]),p([.25,.30,-.15]),p([-.25,.30,-.15]),p([-.20,.59,.065]),p([.20,.59,.065])],[[0,1,2],[0,2,3],[2,1,0],[3,2,0],[0,4,3],[3,4,0],[1,2,5],[5,2,1]],'olive','travelling_mantle');
  box(0,.64,.115,.09,.046,.025,'gold','mantle_clasp');
  k.cyl(...p([0,.89,.012]),.20*s,.20*s,.032*s,'olive',part+'_hat',k.detail(16,12,8));k.cyl(...p([0,.925,.012]),.087*s,.106*s,.066*s,'olive',part+'_hat',k.detail(12,8,6));k.cyl(...p([0,.902,.012]),.106*s,.109*s,.017*s,'leather',part+'_hat',k.detail(12,8,6));
  beam([-.135,.63,0],[-.23,.51,.03],.039,'khaki',part+'_arms');beam([-.23,.51,.03],[-.17,.46,.19],.033,'khaki',part+'_arms');sphere(-.17,.46,.19,.034,skin,part+'_hands');
  beam([.135,.63,0],[.22,.52,.02],.039,'khaki',part+'_arms');beam([.22,.52,.02],[.10,.59,.17],.03,'khaki',part+'_arms');sphere(.10,.59,.17,.033,skin,part+'_hands');
  // Twin optical tubes face forward, distinct from the rolled travel map.
  for(const xx of [.065,.145]){k.put(new T.CylinderGeometry(.049*s,.038*s,.17*s,k.detail(10,8,6)),'dark',...p([xx,.60,.20]),[Math.PI/2,0,0],null,'binoculars');k.put(new T.CylinderGeometry(.044*s,.044*s,.013*s,k.detail(10,8,6)),'glass',...p([xx,.60,.292]),[Math.PI/2,0,0],null,'binocular_lenses');}box(.105,.60,.18,.085,.025,.04,'gold','binoculars');
  k.put(new T.BoxGeometry(.37*s,.25*s,.025*s),'cream',...p([-.16,.43,.25]),[-.32,0,-.18],null,'map');beam([-.25,.43,.264],[-.12,.47,.257],.007,'glass','map_route');beam([-.12,.47,.257],[-.06,.41,.28],.007,'glass','map_route');
  box(.17,.39,-.025,.12,.18,.15,'leather','satchel');box(.17,.46,.052,.125,.062,.018,'wood','satchel_flap');beam([-.1,.67,.097],[.17,.36,.087],.016,'leather','satchel_strap');
  box(-.05,.53,.112,.04,.08,.01,'olive','coat_trim');box(.05,.53,.112,.04,.08,.01,'olive','coat_trim');
 }else{
  beam([-.145,.62,0],[-.20,.46,.025],.04,'crimson',part+'_arms');beam([-.20,.46,.025],[-.18,.33,.06],.031,skin,part+'_arms');sphere(-.18,.33,.06,.034,skin,part+'_hands');
  beam([.145,.62,0],[.24,.47,.02],.04,'crimson',part+'_arms');beam([.24,.47,.02],[.28,.59,.10],.03,skin,part+'_arms');sphere(.28,.59,.10,.034,skin,part+'_hands');
  box(0,.655,.058,.21,.037,.11,'white',part+'_collar');box(-.045,.565,.121,.033,.16,.012,'gold',part+'_kit');box(.07,.59,.119,.034,.047,.012,'white',part+'_badge');
 }
}
export function buildExpedition(k){
 base(k,{round:true,unit:'expedition'});person(k,-.39,.20,.61,{skin:'skinDark',step:.08,part:'squad_left'});person(k,.29,-.17,.65,{skin:'skin',step:-.02,part:'squad_right'});person(k,0,.13,.90,{skin:'skin',step:.09,part:'captain'});football(k,.17,.24,.40,.075);
 const x=-.37,z=-.25;k.cyl(x,.82,z,.011,.015,1.29,'iron','banner_pole',8);k.sphere(x,1.48,z,.025,'gold','banner_finial');
 const vs=[[x,1.40,z],[x+.30,1.38,z+.06],[x+.48,1.40,z],[x+.44,1.12,z+.06],[x+.29,1.13,z+.09],[x,1.16,z]];k.mesh(vs,[[0,1,5],[1,4,5],[1,2,4],[2,3,4],[5,1,0],[5,4,1],[4,2,1],[4,3,2]],'crimson','team_banner');
 for(const [a,b]of [[[x,1.40,z],[x+.30,1.38,z+.06]],[[x+.30,1.38,z+.06],[x+.48,1.40,z]],[[x,1.16,z],[x+.29,1.13,z+.09]],[[x+.29,1.13,z+.09],[x+.44,1.12,z+.06]]])k.beam(a,b,.012,'gold','banner_trim');
 k.mesh([[x+.09,1.34,z+.078],[x+.24,1.34,z+.078],[x+.23,1.23,z+.086],[x+.165,1.19,z+.087],[x+.10,1.23,z+.086]],[[0,1,2],[0,2,3],[0,3,4],[2,1,0],[3,2,0],[4,3,0]],'gold','banner_emblem');
}
export function buildScout(k){base(k,{round:true});person(k,0,0,1.07,{scout:true,skin:'skin',step:.07,part:'scout'});k.box(-.30,.22,-.21,.13,.08,.11,'leather','travel_case');k.box(-.30,.27,-.21,.09,.025,.06,'gold','travel_case');}
