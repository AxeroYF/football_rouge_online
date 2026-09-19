import {plate,block,dome,flag,lamp} from './facility-kit.js';

function steps(k,x,z,w){for(let i=0;i<3;i++)k.box(x,.105+i*.025,z-i*.06,w,.026,.20-i*.035,'white','entrance_steps');}
function clock(k,x,y,z,r){
 k.beam([x,y,z-.016],[x,y,z+.016],r,'gold','clock_rim',k.detail(20,12,8));
 k.beam([x,y,z+.017],[x,y,z+.025],r*.82,'white','clock_face',k.detail(20,12,8));
 k.beam([x,y,z+.030],[x,y+r*.57,z+.030],.009,'naval','clock_hands');k.beam([x,y,z+.031],[x+r*.45,y-r*.15,z+.031],.009,'naval','clock_hands');
}
export function buildUniversity(k,L){
 const back=L>=4?-.99:-.71;
 plate(k,[[-.86,back],[.86,back],[.86,.77],[-.86,.77]],{surface:'sand'});
 // The lecture hall, columned entrance and clock survive every expansion and LOD.
 const h=L>=3?.52:.38;
 block(k,0,-.30,1.13,.50,h,{color:'cream',roof:'roof',part:'lecture_hall'});
 const towerH=.62+L*.065;
 block(k,0,-.33,.31,.34,towerH,{y:.1,color:'white',roof:'roof',windows:false,part:'clock_tower'});
 k.box(0,towerH-.12,-.145,.11,.15,.015,'naval','tower_window');clock(k,0,towerH+.01,-.145,.105);
 k.pyramid(0,towerH+.24,-.33,.38,.4,.23,'roof','tower_cap');k.sphere(0,towerH+.50,-.33,.033,'gold','tower_finial');
 for(const x of [-.33,-.11,.11,.33])k.column(x,.13,.16,.026,.30,'white');
 k.box(0,.45,.15,.79,.052,.27,'white','portico');k.roof(0,.477,.15,.84,.28,.13,'roof','portico_pediment');
 k.box(0,.255,-.036,.15,.25,.023,'wood','main_door');steps(k,0,.37,.65);
 k.box(0,.105,.53,.29,.016,.38,'paving','campus_path');
 // An open book on the lectern reads as education even at the smallest level.
 k.box(.56,.18,.45,.20,.15,.18,'stone','book_plinth');
 k.box(.51,.28,.45,.13,.025,.18,'white','open_book',-.22);k.box(.63,.28,.45,.13,.025,.18,'white','open_book',.22);
 if(L>=2){block(k,-.62,.02,.34,.68,.32,{color:'cream',roof:'roof',part:'library_wing'});k.box(-.52,.13,.56,.37,.04,.105,'wood','campus_bench');for(const x of [-.77,.77]){k.box(x,.22,.68,.095,.25,.095,'white','campus_gate');k.sphere(x,.37,.68,.035,'gold','campus_gate');}}
 if(L>=3){block(k,.63,.0,.34,.66,.42,{color:'cream',roof:'roof',part:'science_wing'});k.box(-.20,.12,.55,.17,.025,.18,'grass','quad_garden');k.box(.2,.12,.55,.17,.025,.18,'grass','quad_garden');lamp(k,-.38,.64,.42);}
 if(L>=4){block(k,-.49,-.74,.53,.33,.59,{color:'white',roof:'roof',part:'research_hall'});k.cyl(.52,.49,-.73,.25,.25,.74,'cream','observatory');k.cyl(.52,.88,-.73,.24,.24,.07,'glass','observatory_windows');dome(k,.52,.93,-.73,.28,'copper','observatory_dome',.85);k.box(0,.56,-.75,.55,.15,.17,'glass','research_bridge');}
 if(L===5){for(const x of [-.62,.62]){block(k,x,.02,.35,.59,.29,{y:.54,color:'white',roof:'roof',part:'upper_academy'});flag(k,x,.05,.27,'navy',.93);}k.box(0,towerH+.20,-.33,.39,.055,.41,'gold','clock_balcony');for(const x of [-.155,.155])k.column(x,towerH+.255,-.34,.017,.16,'white');k.box(0,.72,-.70,.19,.18,.22,'white','central_archive');}
}
function workshop(k,x,z,w,d,h,part){
 block(k,x,z,w,d,h,{color:'clay',roof:'iron',flat:true,part,windows:false});
 const bays=3;for(let i=0;i<bays;i++){
  const left=x-w/2+w*i/bays,right=left+w/bays,y=.1+h;
  k.mesh([[left,y,z-d/2],[right,y+.18,z-d/2],[right,y,z-d/2],[left,y,z+d/2],[right,y+.18,z+d/2],[right,y,z+d/2]],[[0,1,3],[1,4,3],[0,2,1],[3,4,5],[1,2,4],[2,5,4]],'iron',part+'_sawtooth');
  k.box(right+.006,y+.085,z,.013,.15,d*.83,'glass',part+'_skylights');
 }
 const n=k.detail(5,3,2);for(let i=0;i<n;i++)k.box(x-w*.38+w*.76*i/(n-1),.1+h*.57,z+d/2+.012,.10,.11,.014,'glass',part+'_windows');
 k.box(x,.235,z+d/2+.019,.23,.27,.025,'naval',part+'_loading_door');
}
function chimney(k,x,z,h){k.cyl(x,.1+h/2,z,.068,.103,h,'clay','chimney',k.detail(16,10,6));for(let i=1;i<=3;i++)k.cyl(x,.1+h*i/4,z,.092-i*.005,.092-i*.005,.045,'cream','chimney_bands',k.detail(16,10,6));k.cyl(x,.1+h+.017,z,.083,.083,.034,'iron','chimney_cap',k.detail(16,10,6));k.cyl(x,.1+h+.036,z,.055,.055,.007,'dark','chimney_opening',k.detail(16,10,6));}
function conveyor(k,x,z,w){k.box(x,.26,z,w,.055,.17,'iron','conveyor');k.box(x,.292,z,w-.02,.015,.11,'dark','conveyor_belt');for(const xx of [x-w*.35,x+w*.35])k.box(xx,.18,z,.035,.16,.15,'ochre','conveyor_legs');for(let i=0;i<k.detail(7,4,2);i++)k.box(x-w*.4+i*w*.8/(k.detail(7,4,2)-1),.306,z,.025,.012,.11,'white','conveyor_rollers');}
export function buildFactory(k,L){
 plate(k,[[-.88,-.79],[.87,-.79],[.87,.75],[-.88,.75]],{surface:'paving',edge:'iron'});
 workshop(k,-.14,-.18,.94,.71,.36+(L>=3?.09:0),'main_workshop');chimney(k,-.67,-.49,.73+L*.065);
 k.box(-.17,.14,.32,.60,.075,.23,'iron','loading_platform');steps(k,-.17,.48,.38);
 for(const x of [-.52,-.32])k.box(x,.18,.63,.15,.15,.14,'wood','supply_crates');
 if(L>=2){block(k,.55,-.29,.35,.40,.29,{color:'clay',roof:'iron',flat:true,part:'warehouse'});conveyor(k,.51,.28,.45);k.cyl(.58,.27,-.63,.12,.12,.35,'iron','supply_tank',k.detail(16,10,6));dome(k,.58,.445,-.63,.12,'white','tank_cap',.5);}
 if(L>=3){workshop(k,.42,-.40,.59,.56,.47,'second_workshop');chimney(k,-.66,-.16,1.12);for(const x of [.53,.73]){k.cyl(x,.26,.61,.075,.075,.32,'iron','material_silos',k.detail(14,9,6));dome(k,x,.42,.61,.075,'white','silo_cap',.6);}k.beam([-.66,.30,-.14],[.30,.30,-.14],.027,'copper','supply_pipe',8);}
 if(L>=4){for(const x of [-.62,.64]){k.box(x,.54,.35,.055,.86,.065,'ochre','gantry_posts');k.box(x,.105,.24,.20,.025,.55,'iron','gantry_foot');}k.box(0,.98,.35,1.37,.10,.10,'ochre','gantry_beam');k.box(.15,.91,.35,.19,.065,.13,'iron','crane_trolley');k.beam([.15,.87,.35],[.15,.56,.35],.009,'dark','crane_cable');k.beam([.15,.56,.35],[.22,.52,.35],.015,'iron','crane_hook');k.cyl(-.59,.18,.62,.105,.105,.15,'iron','robot_base');k.beam([-.59,.25,.62],[-.48,.48,.62],.035,'ochre','robot_arm');k.beam([-.48,.48,.62],[-.31,.38,.62],.035,'ochre','robot_arm');k.sphere(-.48,.48,.62,.05,'iron','robot_joint');}
 if(L===5){block(k,.64,-.61,.35,.27,.82,{color:'clay',roof:'iron',flat:true,part:'process_tower'});k.box(.37,.69,-.04,.71,.15,.20,'iron','logistics_bridge');k.box(.37,.78,-.04,.72,.021,.15,'glass','bridge_roof');for(const x of [.05,.63])k.beam([x,.1,-.04],[x,.62,-.04],.028,'ochre','bridge_supports');k.beam([-.64,.84,-.47],[.64,.84,-.47],.029,'copper','overhead_pipe',k.detail(12,8,6));for(const x of [-.38,-.13,.12])k.box(x,.63,-.35,.13,.045,.16,'naval','roof_ventilation');lamp(k,.79,.67,.54);}
}
