import {plate,flag,lamp,T} from './facility-kit.js';

function aircraft(k,x,z){
  k.put(new T.SphereGeometry(1,k.detail(16,10,8),k.detail(8,6,4)),'white',x,.176,z,null,[.044,.039,.235],'aircraft_fuselage');
  k.mesh([[x-.045,.18,z+.04],[x+.045,.18,z+.04],[x+.25,.17,z-.10],[x+.24,.17,z-.15],[x,.18,z-.065],[x-.24,.17,z-.15],[x-.25,.17,z-.10]],[[0,1,4],[1,2,3],[1,3,4],[0,4,5],[0,5,6]],'white','aircraft_wings');
  for(const s of [-1,1]){
    k.box(x+s*.238,.178,z-.125,.024,.013,.06,'airportTeam','aircraft_wingtips');
    k.put(new T.CylinderGeometry(.023,.026,.086,k.detail(12,8,6)),'iron',x+s*.096,.155,z-.005,[Math.PI/2,0,0],null,'aircraft_engines');
    k.box(x+s*.075,.19,z-.18,.125,.012,.045,'airportTeam','aircraft_tailplane');
  }
  k.mesh([[x-.008,.19,z-.18],[x-.008,.315,z-.22],[x-.008,.32,z-.25],[x-.008,.18,z-.24]],[[0,1,2],[0,2,3],[2,1,0],[3,2,0]],'airportTeam','aircraft_tail');
  k.box(x,.204,z+.155,.052,.014,.045,'glass','aircraft_cockpit');
  if(k.lod<2)for(const s of [-1,1])for(let i=0;i<5;i++)k.box(x+s*.043,.185,z+.085-i*.034,.005,.011,.012,'naval','aircraft_windows');
}
function runwayDigit(k,x,z,digit){
 const bars={0:'ab cdef'.replaceAll(' ',''),2:'abged',7:'abc',9:'abfgcd'};
 const positions={a:[0,-.053,.048,.009],b:[.026,-.026,.008,.045],c:[.026,.026,.008,.045],d:[0,.053,.048,.009],e:[-.026,.026,.008,.045],f:[-.026,-.026,.008,.045],g:[0,0,.048,.009]};
 for(const key of bars[digit]){const [dx,dz,w,h]=positions[key];k.box(x+dx,.118,z+dz,w,.003,h,'white','runway_numbers');}
}
export function buildAirport(k){
  plate(k,[[-1.74,-.84],[1.47,-.84],[1.73,-.60],[1.73,.91],[-1.74,.91]],{surface:'grass',edge:'stoneDark',h:.075});
  // The long, broad runway owns the horizontal silhouette at every LOD.
  k.box(0,.092,.47,3.26,.02,.64,'airportAsphalt','runway');
  for(const z of [.167,.773])k.box(0,.106,z,3.17,.005,.014,'white','runway_edge_lines');
  const n=k.detail(13,11,9);
  for(let i=0;i<n;i++)k.box(-1.02+i*2.04/(n-1),.108,.47,.105,.005,.019,'white','runway_centerline');
  for(const x of [-1.44,1.44])for(let i=0;i<8;i++)k.box(x,.108,.22+i*.071,.18,.005,.027,'white','runway_threshold');
  runwayDigit(k,-1.23,.47,0);runwayDigit(k,-1.13,.47,9);runwayDigit(k,1.13,.47,2);runwayDigit(k,1.23,.47,7);
  for(const x of [-.89,.89])for(const z of [.295,.645])k.box(x,.108,z,.16,.005,.062,'white','runway_aiming_marks');
  for(const z of [.135,.805])for(let i=0;i<k.detail(19,13,9);i++)k.box(-1.56+i*3.12/(k.detail(19,13,9)-1),.114,z,.018,.018,.018,'airportLights','runway_lights');
  k.box(-.72,.093,-.30,1.68,.023,.46,'paving','apron');
  k.box(0,.093,-.015,2.95,.023,.125,'airportAsphalt','taxiway');
  k.box(0,.108,-.015,2.83,.005,.012,'ochre','taxiway_centerline');
  for(const x of [-1.36,1.36]){k.box(x,.094,.092,.11,.024,.23,'airportAsphalt','taxiway_links');k.box(x,.11,.092,.014,.005,.22,'ochre','taxiway_centerline');}

  // A compact, low terminal is subordinate to the runway and control tower.
  const hx=-1.12,hz=-.565;
  k.box(hx,.119,hz,.86,.055,.35,'white','terminal_plinth');
  k.box(hx,.235,hz,.79,.19,.30,'glass','terminal');
  k.box(hx,.327,hz,.85,.044,.36,'airportTeam','terminal_team_fascia');
  k.box(hx,.357,hz,.89,.026,.38,'white','terminal_roof');
  for(let i=0;i<k.detail(6,4,3);i++)k.box(hx-.35+i*.70/(k.detail(6,4,3)-1),.235,-.407,.016,.18,.015,'white','terminal_mullions');
  k.box(hx,.272,-.387,.68,.10,.024,'naval','airport_nameplate');
  k.box(hx,.195,-.368,.17,.16,.04,'glass','terminal_entrance');
  k.box(hx,.292,-.345,.33,.024,.14,'airportTeam','entrance_canopy');
  k.box(-.73,.195,-.28,.10,.10,.30,'cream','jet_bridges');
  k.box(-.61,.195,-.15,.33,.10,.08,'cream','jet_bridges');
  k.box(-.61,.252,-.15,.34,.019,.09,'airportTeam','bridge_roofs');
  aircraft(k,-.39,-.33);
  if(k.lod<2)for(const x of [-.69,-.09])k.box(x,.109,-.30,.012,.004,.32,'ochre','parking_marks');

  // Tall tapered shaft, an oversized glazed cab and ring balcony define the landmark.
  const tx=.77,tz=-.40;
  k.box(tx,.135,tz,.64,.10,.47,'white','control_tower_base');
  k.box(tx,.215,tz,.43,.09,.32,'airportTeam','tower_podium');
  k.cyl(tx,.66,tz,.12,.19,.88,'cream','control_tower',8);
  for(const z of [tz-.136,tz+.136])k.box(tx,.64,z,.058,.79,.018,'airportTeam','tower_vertical_stripes');
  k.cyl(tx,1.01,tz,.16,.14,.09,'airportTeam','tower_team_stripe',8);
  k.cyl(tx,1.105,tz,.305,.22,.17,'white','control_room_support',8);
  k.cyl(tx,1.245,tz,.315,.266,.23,'glass','control_room',8);
  k.cyl(tx,1.378,tz,.346,.346,.038,'airportTeam','control_room_roof',8);
  k.cyl(tx,1.132,tz,.367,.367,.031,'white','tower_balcony',8);
  const frames=k.detail(8,8,4);
  for(let i=0;i<frames;i++){const a=i*Math.PI*2/frames;
    k.beam([tx+Math.cos(a)*.273,1.138,tz+Math.sin(a)*.273],[tx+Math.cos(a)*.318,1.357,tz+Math.sin(a)*.318],.018,'white','tower_frames',4);
    if(k.lod<2)k.beam([tx+Math.cos(a)*.352,1.146,tz+Math.sin(a)*.352],[tx+Math.cos(a)*.352,1.216,tz+Math.sin(a)*.352],.008,'iron','balcony_posts',4);
  }
  if(k.lod<2)k.ring(tx,1.208,tz,.36,.36,.35,.35,.014,'iron','balcony_rail');
  k.beam([tx,1.397,tz],[tx,1.55,tz],.010,'iron','tower_antenna',6);k.sphere(tx,1.57,tz,.022,'red','tower_beacon');
  k.box(tx,1.419,tz,.11,.04,.12,'white','tower_roof_equipment');

  k.box(-.18,.098,-.76,2.85,.016,.075,'airportAsphalt','access_road');
  if(k.lod<2){for(const x of [-1.35,-.95,-.55,-.15,.25,.65,1.05])k.box(x,.11,-.76,.07,.003,.009,'white','road_markings');lamp(k,-1.57,-.27,.30);}
  flag(k,-1.60,-.59,.34,'airportTeam');
  k.box(1.30,.153,-.30,.23,.12,.20,'cream','operations_annex');k.box(1.30,.223,-.30,.25,.022,.22,'airportTeam','annex_roof');
  if(k.lod===0){k.box(-.01,.14,-.45,.16,.065,.075,'ochre','baggage_tug');k.box(-.05,.188,-.45,.055,.055,.075,'glass','baggage_tug');for(const x of [-.06,.04])for(const z of [-.49,-.41])k.sphere(x,.113,z,.016,'black','tug_wheels');}
}
