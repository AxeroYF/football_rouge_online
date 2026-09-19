import {buildAirport} from './airport-model.js';
import {buildOilWell} from './oil-well-model.js';
import {buildUniversity,buildFactory} from './industry-academy-models.js';
import {FacilityKit,plate,ovalBase,compass,block,flag,lamp,pitch,dome,pergola,barrel,T} from './facility-kit.js';
import {FACILITY_ART_VERSION,FACILITY_ASSET_ITEMS} from '../../shared/config/facility-art.mjs';
import {buildExpedition,buildScout} from './unit-models.js';
import {inspectWonderModel,disposeWonderModel} from '../wonders/wonder-models.js';

// The LV1 massing is the identity. Expansions retain that massing at every LOD.
function headquarters(k,L){
 plate(k,[[-.9,-.8],[.9,-.8],[.9,.82],[-.9,.82]],{surface:'paving'});
 const h=.45+L*.22,w=.42+L*.045;
 k.box(0,.14,0,1.15,.10,1.08,'cream','headquarters_plinth');
 k.box(0,.2+h/2,-.13,w,h,.48,'glass','office_tower');
 for(const x of [-w/2,w/2])for(const z of [-.38,.12])k.box(x,.2+h/2,z,.035,h+.04,.035,'gold','tower_mullions');
 const floors=k.detail(4+L*2,3+L,2+L);
 for(let i=1;i<=floors;i++)k.box(0,.2+h*i/floors,-.13,w+.035,.018,.51,'white','floor_bands');
 k.box(0,.24+h,-.13,w+.09,.075,.56,'gold','tower_crown');
 k.box(0,.31,.43,.34,.3,.23,'glass','entrance_lobby');k.box(0,.48,.46,.63,.035,.37,'cream','entrance_canopy');
 flag(k,-.62,.57,.62,'gold');
 if(L>=2)block(k,-.48,-.04,.31,.68,.34+L*.03,{color:'cream',roof:'glass',flat:true,part:'office_wing'});
 if(L>=3){block(k,.47,-.17,.32,.59,.48+L*.07,{color:'glass',roof:'gold',flat:true,part:'secondary_tower'});k.box(.32,.65,-.10,.36,.12,.18,'glass','skybridge');}
 if(L>=4){k.box(-.48,.64,.02,.28,.04,.40,'grass','roof_garden');k.cyl(0,h+.44,-.13,.012,.027,.35,'gold','antenna',6);}
 if(L===5){k.box(0,h+.38,-.13,.36,.20,.34,'glass','penthouse');k.box(0,h+.49,-.13,.4,.03,.38,'gold','crown_cap');k.box(.3,.91,-.22,.36,.12,.16,'gold','upper_skybridge');}
}
function stadium(k,L){
 ovalBase(k,.98,1.08,{surface:'sand'});pitch(k,0,0,.72,1.06,.105);
 const range=L===1?[Math.PI*.91,Math.PI*2.09]:null;
 // A blue horseshoe wall is present before any upgrade; no empty square lawn.
 k.ring(0,.10,0,.82,.95,.72,.83,.28+(L>=3?.11:0),'royal','stadium_shell',2.8,range);
 for(let r=0;r<L+2;r++){const t=r/(L+1);k.ring(0,.13+t*(L>=3?.30:.19),0,.44+t*.32,.61+t*.27,.407+t*.32,.575+t*.27,.045,r%2?'white':'royal','seating',2.8,range);}
 const ribs=k.detail(20+L*2,16,10);for(let i=0;i<ribs;i++){const a=range?range[0]+(range[1]-range[0])*i/(ribs-1):i/ribs*Math.PI*2;k.beam([Math.cos(a)*.82,.1,Math.sin(a)*.95],[Math.cos(a)*.83,L>=3?.44:.38,Math.sin(a)*.96],.023,'white','facade_ribs',4);}
 // Twin gate pylons frame the open end even at map icon sizes.
 for(const x of [-.32,.32]){block(k,x,.81,.17,.20,L>=3?.43:.28,{color:'royal',roof:'white',flat:true,windows:false,part:'entrance_pylons'});flag(k,x,.83,.21,'royal',L>=3?.55:.40);}
 k.box(0,L>=3?.47:.34,.84,.50,.09,.13,'royal','entrance_bridge');k.box(0,.11,.99,.42,.022,.16,'white','entrance_steps');
 if(L>=2){for(const xx of [-.78,.78])for(const zz of [-.70,.70])lamp(k,xx,zz,.60);k.box(0,.54,-.87,.42,.20,.065,'naval','scoreboard');k.box(0,.55,-.832,.31,.11,.018,'glass','scoreboard');}
 if(L>=3){k.ring(0,.44,0,.85,.98,.77,.90,.055,'white','upper_concourse',2.8);block(k,0,-.83,.55,.18,.16,{y:.48,color:'glass',roof:'royal',flat:true,part:'media_box'});}
 if(L===4)for(const range of [[-.80,.80],[Math.PI-.80,Math.PI+.80]])k.ring(0,.58,0,.94,1.04,.51,.73,.055,'white','canopy',2.8,range);
 if(L===5){k.ring(0,.61,0,.95,1.045,.46,.66,.058,'white','canopy',2.8);k.ring(0,.668,0,.955,1.05,.916,1.012,.032,'gold','crown',2.8);const n=k.detail(30,20,12);for(let i=0;i<n;i++){const a=i/n*Math.PI*2;k.beam([Math.cos(a)*.47,.673,Math.sin(a)*.68],[Math.cos(a)*.94,.702,Math.sin(a)*1.035],.009,'royal','roof_ribs');}k.box(0,.36,.953,.23,.17,.023,'glass','entrance_glass');}
}
function optics(k,x,y,z,s=1){
 for(const dx of [-.105,.105]){k.beam([x+dx*s,y,z-.09*s],[x+dx*s,y+.10*s,z+.22*s],.077*s,'naval','roof_binoculars',k.detail(12,8,6));k.beam([x+dx*s,y+.10*s,z+.215*s],[x+dx*s,y+.115*s,z+.25*s],.079*s,'gold','optic_rims',k.detail(12,8,6));k.beam([x+dx*s,y+.115*s,z+.251*s],[x+dx*s,y+.119*s,z+.26*s],.059*s,'glass','optic_lenses',k.detail(12,8,6));}
 k.box(x,y-.06*s,z,.26*s,.07*s,.16*s,'gold','optic_mount');
}
function scoutCenter(k,L){
 plate(k,[[-.82,-.67],[.47,-.79],[.90,-.21],[.74,.52],[.20,.90],[-.73,.53]],{surface:'sand'});
 const h=.38+(L>=3?.17:0)+(L===5?.13:0);
 k.cyl(-.12,.1+h/2,-.17,.35,.42,h,'cream','octagonal_office',8);k.cyl(-.12,.14,-.17,.415,.435,.08,'violet','office_plinth',8);
 for(let i=0;i<8;i++){const a=i/8*Math.PI*2;k.box(-.12+Math.sin(a)*.356,.1+h*.57,-.17+Math.cos(a)*.356,.13,.14,.022,'glass','office_windows',a);}
 k.cyl(-.12,.1+h,-.17,.47,.47,.06,'violet','observation_eave',8);k.cyl(-.12,.19+h,-.17,.20,.47,.18,'violet','faceted_roof',8);k.cyl(-.12,.31+h,-.17,.18,.20,.08,'gold','optic_pedestal',8);optics(k,-.12,.40+h,-.12,.95);
 compass(k,-.10,.115,.53,.26,'violet');k.box(-.12,.24,.197,.18,.27,.025,'violet','entrance');k.arch(-.12,.10,.22,.23,.31,.045,'white','entrance_arch');
 // Map display is large enough to survive the distant geometry tier.
 k.box(.53,.29,.37,.30,.29,.045,'violet','map_board');k.box(.53,.30,.398,.255,.235,.012,'cream','map_board');k.beam([.43,.22,.410],[.57,.38,.410],.014,'violet','map_route');
 if(L>=2){block(k,-.59,.23,.36,.50,.30,{roof:'violet',part:'archive_wing'});k.box(-.53,.11,.02,.27,.028,.35,'violetLight','walkway');flag(k,-.72,.61,.49,'violet');}
 if(L>=3){k.ring(-.12,.1+h*.8,-.17,.46,.46,.375,.375,.035,'white','observation_balcony');const n=k.detail(12,8,6);for(let i=0;i<n;i++){const a=i/n*Math.PI*2;k.beam([-.12+Math.cos(a)*.43,.12+h*.8,-.17+Math.sin(a)*.43],[-.12+Math.cos(a)*.43,.24+h*.8,-.17+Math.sin(a)*.43],.009,'gold','balcony_rail');}block(k,.40,-.51,.42,.42,.29,{roof:'violet',part:'analysis_wing'});}
 if(L>=4){block(k,.54,-.12,.42,.36,.37,{color:'cream',roof:'violet',flat:true,part:'communications'});k.cyl(.55,.65,-.13,.022,.034,.36,'gold','antenna',6);k.put(new T.SphereGeometry(.16,k.detail(16,10,8),5,0,Math.PI*2,0,Math.PI*.43),'white',.55,.82,-.13,[.2,0,.65],[1,.32,1],'dish');pergola(k,-.54,.37,.29,.27,.26,'archive_canopy');}
 if(L===5){block(k,-.08,-.65,.42,.32,.94,{color:'cream',roof:'violet',flat:true,part:'global_office'});k.box(-.08,1.02,-.65,.40,.15,.33,'glass','global_office_crown');k.sphere(-.08,1.24,-.65,.14,'violet','globe');for(const ry of [0,Math.PI/2])k.put(new T.TorusGeometry(.153,.012,4,k.detail(24,16,10)),'gold',-.08,1.24,-.65,[0,ry,.2],null,'globe_rings');k.ring(-.08,1.238,-.65,.15,.15,.137,.137,.012,'gold','globe_rings');}
}
function boat(k,x,z,s=1,large=false){
 k.put(new T.CylinderGeometry(1,1,.13,6),'naval',x,.15,z,null,[.14*s,1,.33*s],'vessel');k.put(new T.CylinderGeometry(1,1,.038,6),'white',x,.23,z,null,[.14*s,1,.32*s],'vessel');k.box(x,.29,z-.045,.18*s,.12,.28*s,'white','vessel');k.box(x,.315,z+.1*s,.16*s,.065,.020,'glass','vessel');k.box(x,.36,z-.10,.085*s,.07,.09*s,'ochre','vessel');
 if(large){k.cyl(x,.52,z-.08,.012,.012,.40,'iron','vessel',6);k.box(x,.40,z-.20,.22*s,.025,.17*s,'naval','vessel');}
}
function crane(k,x,z,h=.57){k.box(x,.1+h/2,z,.064,h,.064,'ochre','cranes');k.beam([x,.1+h,z],[x+.35,.1+h,z],.035,'ochre','cranes');k.beam([x,.1+h*.5,z],[x+.24,.1+h,z],.017,'naval','cranes');k.beam([x+.30,.1+h,z],[x+.30,.22,z],.008,'iron','cranes');k.box(x+.30,.20,z,.07,.08,.06,'ochre','crane_hook');}
function port(k,L){
 plate(k,[[-.98,-.77],[.73,-.78],[.99,-.15],[.79,.91],[-.55,1.0],[-.96,.47]],{surface:'water',edge:'slate'});
 plate(k,[[-.95,-.73],[.71,-.73],[.77,-.22],[-.91,-.20]],{surface:'paving',y:.10,h:.06,part:'quay'});
 block(k,.02,-.51,.85,.40,L>=3?.39:.28,{y:.17,color:'cream',roof:'naval',part:'warehouse'});
 const h=.62+L*.085;k.cyl(-.66,.17+h/2,-.43,.115,.165,h,'white','lighthouse',k.detail(16,12,8));for(const t of [.32,.69])k.cyl(-.66,.17+h*t,-.43,.15-t*.028,.15-t*.028,.115,'ochre','lighthouse_bands',k.detail(16,12,8));
 k.cyl(-.66,.17+h,-.43,.17,.17,.07,'naval','lantern_balcony',k.detail(16,12,8));k.cyl(-.66,.28+h,-.43,.125,.125,.16,'glass','lantern',8);k.cyl(-.66,.40+h,-.43,0,.18,.11,'naval','lighthouse_roof',8);
 const dock=L>=3?'stone':'wood';k.box(-.47,.165,.24,.20,.10,.91,dock,'pier');k.box(.43,.165,.24,.20,.10,.91,dock,'pier');k.box(-.02,.165,.73,1.10,.10,.20,dock,'pier');boat(k,-.04,.26,1.13,L>=4);
 if(k.lod<2)for(let i=0;i<7;i++)for(const x of [-.47,.43])k.box(x,.22,-.1+i*.112,.19,.015,.022,'sand','pier_planks');
 for(const x of [-.52,.48])for(const z of [-.07,.7])k.cyl(x,.23,z,.027,.027,.09,'naval','bollards',6);
 if(L>=2){crane(k,.59,-.32,.58);boat(k,.74,.39,.71);k.box(.69,.17,.43,.12,.10,.66,dock,'outer_pier');lamp(k,-.80,-.15,.29,.17);}
 if(L>=3){crane(k,-.73,-.04,.61);block(k,.53,-.55,.29,.37,.34,{y:.17,color:'naval',roof:'naval',part:'warehouse_annex'});for(let i=0;i<3;i++)k.box(-.75+i*.15,.27,.04,.13,.11,.19,i%2?'white':'ochre','cargo');}
 if(L>=4){block(k,.02,-.52,.63,.33,.24,{y:.58,color:'glass',roof:'naval',flat:true,part:'terminal'});barrel(k,.02,-.52,.70,.40,.83,.17,'white','terminal_canopy');k.box(.1,.27,-.19,.47,.20,.035,'glass','terminal_gate');}
 if(L===5){barrel(k,.02,-.52,.72,.43,1.01,.16,'naval','upper_canopy');k.box(.02,.96,-.52,.57,.16,.29,'glass','upper_lounge');for(const x of [-.43,.43])k.beam([x,.24,.60],[x,.66,.60],.024,'ochre','port_gate');k.box(0,.69,.60,.94,.095,.10,'naval','port_gate');flag(k,.62,-.59,.90,'naval',.17);}
 if(k.lod<2)for(let i=0;i<4;i++)k.box(-.58+i*.33,.116,.91,.13,.004,.014,'pool','wavelets');
}
function training(k,L){
 plate(k,[[-.85,-.88],[.15,-.93],[.40,-.77],[.94,-.77],[.94,.51],[.34,.58],[.11,.93],[-.63,.89],[-.88,.50]],{surface:'sand'});
 k.disk(-.28,.1,.02,.54,.84,.025,'orange','running_track',k.detail(32,20,12));
 for(const r of [0,1,2])k.ring(-.28,.128,.02,.52-r*.034,.81-r*.034,.515-r*.034,.805-r*.034,.004,'white','running_lanes');pitch(k,-.28,.02,.59,1.15,.131);
 const h=.32+(L>=3?.16:0);block(k,.56,-.22,.57,.91,h,{color:'cream',roof:'orange',flat:true,part:'training_hall'});barrel(k,.56,-.22,.63,.96,.1+h,.25,'orange','gym_barrel_roof');
 k.box(.56,.28,.244,.45,.25,.032,'glass','gym_front');k.arch(.56,.11,.268,.48,.40,.035,'white','gym_front_arch');
 if(k.lod<2)for(let i=0;i<4;i++)k.cyl(-.42+i*.11,.18,.23,0,.026,.063,'orange','training_cones',5);
 if(L>=2){for(const z of [-.71,.70])lamp(k,-.69,z,.60);for(let i=0;i<3;i++){const zz=.45+i*.13;for(const x of [.26,.65])k.beam([x,.10,zz],[x,.24,zz],.014,'orange','hurdles');k.beam([.26,.24,zz],[.65,.24,zz],.016,'white','hurdles');}k.box(-.28,.39,-.71,.47,.09,.07,'orange','timing_gate');for(const x of [-.5,-.06])k.beam([x,.11,-.71],[x,.39,-.71],.018,'white','timing_gate');}
 if(L>=3){block(k,.48,-.63,.61,.28,.53,{color:'white',roof:'orange',flat:true,part:'performance_block'});pergola(k,-.71,-.23,.18,.56,.26,'coaching_shelter');}
 if(L>=4){block(k,.48,-.63,.59,.28,.28,{y:.64,color:'white',roof:'orange',flat:true,part:'performance_upper_floor'});if(k.lod<2)for(let i=0;i<3;i++)k.box(.31+i*.16,.94,-.63,.135,.022,.23,'glass','solar_panels');k.box(.54,.20,.65,.52,.20,.26,'orange','equipment_platform');k.box(.54,.313,.65,.54,.025,.27,'white','equipment_platform');}
 if(L===5){block(k,-.02,-.67,.26,.34,.91,{color:'orange',roof:'white',flat:true,part:'coaching_tower'});k.box(-.02,1.04,-.67,.36,.23,.40,'glass','observation_box');k.box(-.02,1.17,-.67,.42,.043,.45,'white','observation_canopy');k.box(.20,.71,-.65,.31,.067,.14,'glass','coaching_bridge');for(const z of [-.2,.26])lamp(k,.84,z,.75);}
}
function medicalCross(k,x,y,z,s=.20,part='medical_mark'){k.box(x,y,z,s*.32,s,.035,'jade',part);k.box(x,y,z,s,s*.32,.036,'jade',part);}
function ambulance(k,x,z){k.box(x,.22,z,.22,.19,.40,'white','ambulance');k.box(x,.265,z+.14,.20,.075,.035,'glass','ambulance');k.box(x,.33,z-.04,.15,.036,.052,'jade','ambulance');for(const xx of [-.12,.12])for(const zz of [-.12,.12])k.put(new T.CylinderGeometry(.042,.042,.025,8),'black',x+xx,.155,z+zz,[0,0,Math.PI/2],null,'ambulance');medicalCross(k,x,.21,z+.205,.11,'ambulance_mark');}
function crossBuilding(k,y,h,scale=1){
 const pts=[[-.24,-.76],[.24,-.76],[.24,-.31],[.69,-.31],[.69,.17],[.24,.17],[.24,.63],[-.24,.63],[-.24,.17],[-.69,.17],[-.69,-.31],[-.24,-.31]].map(([x,z])=>[x*scale,z*scale]);
 plate(k,pts,{surface:'jade',edge:'white',y,h,part:'cross_clinic'});
 for(const x of [-.12,.12])k.box(x*scale,y+h*.48,.633*scale,.10*scale,.15,.02,'glass','clinic_windows');for(const x of [-.48,.48])k.box(x*scale,y+h*.48,.174*scale,.22*scale,.15,.02,'glass','clinic_windows');
}
function medical(k,L){
 plate(k,[[-.83,-.82],[.36,-.85],[.36,-.50],[.88,-.50],[.91,.74],[.30,.74],[.30,.90],[-.37,.90],[-.37,.43],[-.86,.40]],{surface:'paving'});
 crossBuilding(k,.10,L>=3?.55:.34);
 const panes=k.detail(4,2,0);for(const sign of [-1,1])for(let i=0;i<panes;i++)k.box(sign*.699,.29,-.31+.48*(i+.5)/panes,.018,.16,.48/panes*.57,'glass','side_clinic_windows');
k.box(0,L>=3?.67:.46,-.07,.30,.024,.30,'white','roof_mark');for(const [w,d]of[[.065,.23],[.23,.065]])k.box(0,L>=3?.685:.475,-.07,w,.016,d,'jade','roof_mark');
 k.box(0,.21,.646,.21,.20,.023,'glass','clinic_entry');k.box(0,.38,.73,.36,.065,.23,'jade','entry_canopy');medicalCross(k,0,.37,.851,.13);k.box(.64,.115,.49,.37,.025,.68,'slate','ambulance_lane');for(const z of [.28,.68])k.box(.64,.135,z,.26,.004,.013,'white','ambulance_lane');
 if(L>=2){ambulance(k,.64,.52);block(k,-.58,-.55,.32,.44,.32,{color:'white',roof:'jade',flat:true,part:'inpatient_wing'});for(const x of [-.17,.17])k.beam([x,.11,.81],[x,.40,.81],.016,'white','dropoff_columns');}
 if(L>=3){block(k,.57,-.59,.31,.44,.42,{color:'white',roof:'jade',flat:true,part:'diagnostics_wing'});for(const x of [-.5,.5])k.box(x,.49,.186,.15,.13,.024,'glass','upper_clinic_windows');}
 if(L>=4){k.cyl(-.55,.28,.17,.28,.29,.35,'glass','diagnostics_rotunda',k.detail(20,12,8));dome(k,-.55,.46,.17,.30,'white','diagnostics_dome',.62);k.box(-.28,.52,.05,.39,.10,.16,'glass','clinical_bridge');block(k,.57,-.59,.31,.44,.25,{y:.52,color:'white',roof:'jade',flat:true,part:'inpatient_upper_floor'});}
 if(L===5){block(k,0,-.53,.44,.43,.57,{y:.66,color:'white',roof:'jade',flat:true,part:'medical_tower'});k.box(0,1.26,-.53,.59,.036,.58,'jade','helipad');k.ring(0,1.281,-.53,.23,.23,.214,.214,.005,'white','helipad_mark');for(const xx of [-.066,.066])k.box(xx,1.29,-.53,.025,.005,.16,'white','helipad_mark');k.box(0,1.29,-.53,.135,.005,.025,'white','helipad_mark');medicalCross(k,0,1.09,-.303,.22);}
}
function recovery(k,L){
 ovalBase(k,.91,.84,{surface:'sand'});
 k.disk(-.10,.10,.21,.56,.49,.09,'white','pool_terrace',k.detail(32,20,12));k.disk(-.10,.191,.21,.49,.42,.012,'pool','water',k.detail(32,20,12));k.ring(-.10,.205,.21,.48,.41,.447,.377,.008,'aqua','pool_mosaic');
 const arc=[Math.PI*.88,Math.PI*2.13],h=.25+(L>=3?.10:0);k.ring(0,.1,-.03,.80,.69,.57,.46,h,'cream','crescent_bathhouse',2,arc);k.ring(0,.12+h,-.03,.84,.73,.53,.42,.055,'aqua','crescent_roof',2,arc);
 const n=k.detail(9,7,5);for(let i=0;i<n;i++){const a=arc[0]+(arc[1]-arc[0])*i/(n-1);k.column(Math.cos(a)*.58,.1,-.03+Math.sin(a)*.47,.025,h,'white');}
 k.stairs(-.1,.10,.74,.36,.20,.10,'white','pool_steps');
 if(L>=2){k.disk(.53,.11,.41,.24,.26,.12,'white','raised_pool',k.detail(20,12,8));k.disk(.53,.233,.41,.195,.21,.014,'water','side_water',k.detail(20,12,8));for(const x of [-.58,-.34]){k.box(x,.15,.66,.12,.06,.24,'wood','sun_loungers');k.box(x,.19,.57,.12,.05,.07,'white','lounger_cushions');}}
 if(L>=3){k.cyl(0,.37,-.49,.28,.32,.35,'cream','recovery_pavilion',12);dome(k,0,.55,-.49,.34,'aqua','recovery_dome',.83);k.cyl(0,.86,-.49,.035,.065,.085,'gold','dome_finial',8);pergola(k,-.58,.13,.27,.35,.34,'recovery_pergola');}
 if(L>=4){block(k,.54,-.30,.43,.45,.43,{color:'glass',roof:'aqua',flat:true,part:'rehabilitation_hall'});barrel(k,.54,-.30,.48,.51,.54,.14,'aqua','rehabilitation_roof');k.box(.30,.27,.02,.37,.04,.14,'white','garden_bridge');for(const x of [.19,.39])k.beam([x,.26,-.04],[x,.37,-.04],.01,'aqua','bridge_rail');}
 if(L===5){k.ring(-.10,.48,.21,.64,.57,.47,.40,.045,'white','pool_canopy',2,[-.05,Math.PI*.90]);for(const a of [.2,1.05,2.1])k.column(-.10+Math.cos(a)*.59,.1,.21+Math.sin(a)*.52,.021,.38,'stone');k.disk(-.10,.207,.21,.11,.11,.035,'white','fountain');k.cyl(-.10,.29,.21,.028,.04,.16,'white','fountain');k.disk(-.10,.37,.21,.10,.10,.025,'water','fountain');}
}
function awning(k,x,z,w,y=.38){const n=k.detail(8,6,4);for(let i=0;i<n;i++){k.box(x-w/2+w*(i+.5)/n,y,z,w/n,.035,.30,i%2?'white':'ochre','awnings');k.box(x-w/2+w*(i+.5)/n,y-.035,z+.145,w/n,.07,.023,i%2?'white':'ochre','awning_valance');}for(const xx of [-w/2,w/2])k.beam([x+xx,.1,z+.12],[x+xx,y,z+.12],.015,'burgundy','awning_posts');}
function jersey(k,x,y,z,s=.32){k.box(x,y,z,s*.55,s,.045,'burgundy','jersey_sign');for(const sign of [-1,1])k.box(x+sign*s*.38,y+s*.27,z,s*.30,s*.36,.045,'burgundy','jersey_sign',sign*.20);k.box(x,y+.015,z+.026,s*.14,s*.50,.014,'white','jersey_number');k.box(x,y+s*.45,z+.025,s*.20,s*.08,.015,'white','jersey_collar');}
function shop(k,L){
 plate(k,[[-.87,-.62],[.86,-.62],[.86,.38],[.43,.38],[.43,.74],[-.86,.74]],{surface:'sand'});
 const h=L>=3?.60:.36;block(k,-.22,-.31,1.12,.44,h,{color:'burgundy',roof:'ochre',part:'market_row'});block(k,.56,-.16,.43,.73,L>=3?.64:.41,{color:'burgundy',roof:'ochre',part:'retail_corner'});
 for(const x of [-.59,-.22,.15]){k.box(x,.24,-.076,.27,.20,.024,'glass','shopfront');k.arch(x,.1,-.057,.29,.25,.045,'white','shopfront_arches');}awning(k,-.22,.13,1.17,.43);awning(k,.56,.35,.46,.46);
 k.box(-.50,h+.29,-.31,.40,.045,.20,'gold','sign_plinth');jersey(k,-.50,h+.50,-.23,.32);k.box(-.60,.11,.56,.40,.025,.13,'burgundy','carpet');
 if(L>=2){for(const x of [-.53,-.05]){k.box(x,.17,.55,.30,.14,.18,'wood','market_stalls');awning(k,x,.55,.31,.40);}k.box(.58,.13,.60,.30,.055,.22,'white','display_plinth');k.cyl(.58,.29,.60,.065,.08,.27,'gold','club_trophy',8);}
 if(L>=3){k.box(-.22,.51,-.055,1.16,.058,.16,'white','shop_balcony');for(const x of [-.68,-.46,-.24,-.02,.20]){k.box(x,.63,-.071,.12,.17,.027,'glass','upper_shop_windows');k.beam([x,.54,.022],[x,.66,.022],.01,'gold','balcony_rail');}k.box(.58,.70,.22,.45,.12,.20,'ochre','corner_gate');}
 if(L>=4){block(k,.48,-.35,.45,.43,.30,{y:.74,color:'glass',roof:'ochre',flat:true,part:'showroom'});barrel(k,.48,-.35,.49,.47,1.05,.12,'ochre','showroom_roof');k.box(-.05,.75,-.30,.46,.024,.36,'white','roof_terrace');for(const x of [-.24,.13])flag(k,x,-.30,.26,'burgundy',.78);}
 if(L===5){k.cyl(-.07,.94,-.35,.24,.28,.40,'cream','flagship_rotunda',12);k.cyl(-.07,1.16,-.35,.24,.24,.10,'glass','clerestory',12);dome(k,-.07,1.22,-.35,.29,'ochre','flagship_dome',.8);k.sphere(-.07,1.53,-.35,.074,'gold','memorial_ball');for(const x of [-.75,.76])flag(k,x,.13,.70,'burgundy');}
}
const BUILDERS={airport:buildAirport,'oil-well':buildOilWell,university:buildUniversity,factory:buildFactory,'club-headquarters':headquarters,'main-stadium':stadium,'scout-center':scoutCenter,port,'training-center':training,'medical-center':medical,'recovery-center':recovery,'club-shop':shop,expedition:buildExpedition,scout:buildScout};
export function createFacilityModel(assetId,{lod=0}={}){
 const item=FACILITY_ASSET_ITEMS.find(i=>i.assetId===assetId);if(!item)throw new Error('Unknown facility asset: '+assetId);if(![0,1,2].includes(lod))throw new Error('LOD must be 0, 1 or 2');
 const k=new FacilityKit(lod);BUILDERS[item.type](k,item.level);const model=k.finish(assetId);model.userData={...model.userData,artVersion:FACILITY_ART_VERSION,type:item.type,level:item.level,kind:item.kind,levelChange:item.change};return model;
}
export const inspectFacilityModel=inspectWonderModel,disposeFacilityModel=disposeWonderModel;
