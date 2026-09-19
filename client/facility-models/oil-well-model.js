import {plate,T} from './facility-kit.js';
export function buildOilWell(k){
 plate(k,[[-.9,-.53],[.85,-.53],[.94,.35],[.55,.65],[-.9,.55]],{surface:'sand',edge:'stoneDark'});
 k.box(-.05,.15,0,1.38,.13,.57,'slate','pump_foundation');
 for(const z of [-.18,.18]){
  k.beam([-.39,.20,z],[-.08,1.12,z],.052,'naval','a_frame_legs',4);
  k.beam([.25,.20,z],[-.08,1.12,z],.052,'naval','a_frame_legs',4);
  k.beam([-.27,.52,z],[.12,.52,z],.036,'iron','a_frame_bracing',4);
 }
 k.beam([-.08,1.10,-.26],[-.08,1.10,.26],.085,'iron','saddle_bearing',k.detail(16,12,8));
 k.beam([-.69,.91,0],[.53,1.38,0],.086,'naval','walking_beam',4);
 k.beam([-.68,.98,-.06],[.5,1.44,-.06],.017,'white','beam_highlight',4);
 // Broad curved horsehead follows the reference silhouette, facing the polished rod.
 const s=new T.Shape();s.moveTo(.39,1.56);s.bezierCurveTo(.77,1.44,.84,1.12,.77,.85);s.lineTo(.59,.88);s.lineTo(.53,1.21);s.lineTo(.33,1.38);s.closePath();
 k.extrude(s,.18,'iron',0,0,-.09,null,'curved_horsehead');
 k.beam([.76,1.17,0],[.76,.26,0],.013,'white','polished_rod',6);
 k.cyl(.76,.23,0,.065,.095,.20,'ochre','wellhead',k.detail(12,8,6));
 k.box(-.61,.33,0,.28,.24,.29,'naval','gearbox');
 for(const z of [-.23,.23]){
  k.beam([-.61,.42,z],[-.38,.61,z],.036,'iron','crank_arm',4);
  k.box(-.72,.32,z,.26,.12,.095,'iron','counterweight',-.6);
  k.beam([-.38,.61,z],[-.64,.94,z],.023,'gold','pitman',4);
 }
 k.cyl(-.67,.24,.40,.10,.10,.26,'naval','motor',k.detail(12,8,6));
 k.cyl(.20,.29,-.38,.16,.16,.36,'iron','storage_tank',k.detail(20,12,8));
 k.cyl(.20,.48,-.38,.17,.17,.035,'cream','tank_lid',k.detail(20,12,8));
 k.beam([.76,.15,0],[.76,.15,-.38],.028,'ochre','pipeline',6);
 k.beam([.76,.15,-.38],[.20,.15,-.38],.028,'ochre','pipeline',6);
 for(const x of [-.6,-.25,.1,.45])k.box(x,.222,.30,.16,.01,.055,'ochre','safety_stripes');
}
