import {ATTRIBUTE_NAMES} from '../game/public/schema.js';
import {inferElevenBoardRoles,DEFAULT_FORMATION_LINES} from '../versus/public/formation-rules.js';

export const layouts={
 '4-3-3':[['GK',50,92],['LB',16,72],['CB',38,72],['CB',62,72],['RB',84,72],['DM',50,54],['AM',34,42],['AM',66,42],['LW',16,20],['ST',50,18],['RW',84,20]],
 '4-2-3-1':[['GK',50,92],['LB',16,72],['CB',38,72],['CB',62,72],['RB',84,72],['DM',37,54],['DM',63,54],['LM',17,40],['AM',50,38],['RM',83,40],['ST',50,18]],
 '4-4-2':[['GK',50,92],['LB',16,72],['CB',38,72],['CB',62,72],['RB',84,72],['LM',16,46],['DM',39,49],['DM',61,49],['RM',84,46],['ST',39,18],['ST',61,18]],
 '4-1-4-1':[['GK',50,92],['LB',16,72],['CB',38,72],['CB',62,72],['RB',84,72],['DM',50,57],['LM',16,41],['AM',38,41],['AM',62,41],['RM',84,41],['ST',50,18]],
 '3-5-2':[['GK',50,92],['CB',28,72],['CB',50,72],['CB',72,72],['LM',12,46],['DM',34,52],['DM',66,52],['AM',50,37],['RM',88,46],['ST',39,18],['ST',61,18]],
 '3-4-3':[['GK',50,92],['CB',28,72],['CB',50,72],['CB',72,72],['LM',12,48],['DM',38,51],['DM',62,51],['RM',88,48],['LW',16,20],['ST',50,18],['RW',84,20]],
 '2-2-6':[['GK',50,92],['CB',38,72],['CB',62,72],['DM',38,47],['DM',62,47],['LW',10,20],['ST',28,18],['ST',43,18],['ST',57,18],['ST',72,18],['RW',90,20]],
};
export const profiles={
 balanced:{tactic:'balanced',style:'possession'},
 patient:{tactic:'balanced',style:'possession',tacticalDimensions:{tempo:35,directness:20,attackingWidth:52,defensiveLine:52,pressing:52,compactness:62,counterAttack:35,timeWasting:20}},
 press:{tactic:'positive',style:'highPress',tacticalDimensions:{tempo:68,directness:50,attackingWidth:58,defensiveLine:78,pressing:85,compactness:62,counterAttack:60,timeWasting:5}},
 counter:{tactic:'balanced',style:'counterAttack',tacticalDimensions:{tempo:62,directness:78,attackingWidth:55,defensiveLine:38,pressing:38,compactness:68,counterAttack:85,timeWasting:15}},
 lowBlock:{tactic:'defensive',style:'lowBlock',tacticalDimensions:{tempo:35,directness:65,attackingWidth:40,defensiveLine:22,pressing:24,compactness:82,counterAttack:70,timeWasting:40}},
 allOut:{tactic:'allOutAttack',style:'highPress',tacticalDimensions:{tempo:90,directness:55,attackingWidth:70,defensiveLine:90,pressing:95,compactness:55,counterAttack:70,timeWasting:0}},
};
export function makeAssessmentTeam(name,options={}){
 const layout=structuredClone(layouts[options.formation??'4-3-3']);
 const positions=Object.fromEntries(layout.map(([,x,y],index)=>[name+index,{x,y}]));
 if(options.mutatePositions)options.mutatePositions(positions);
 const formationLines=options.boardLines?DEFAULT_FORMATION_LINES:null;
 const roles=inferElevenBoardRoles(Object.entries(positions).map(([id,position])=>({id,position})),formationLines);
 const ability=options.ability??80;
 const players=layout.map(([,x,y],index)=>({id:name+index,name:name+index,role:roles[name+index],overall:ability,grade:'B',attributes:Object.fromEntries(ATTRIBUTE_NAMES.map(key=>[key,ability])),heightCm:182,traits:[],club:'unique-club-'+name+index,nationality:'unique-country-'+name+index,state:{fitness:100}}));
 const plan={...structuredClone(profiles[options.profile??'balanced']),...structuredClone(options.plan??{}),positionPreset:'position1'};
 if(options.duties)plan.playerDuties=Object.fromEntries(players.filter(p=>options.duties[p.role]).map(p=>[p.id,options.duties[p.role]]));
 const tacticalPlans={opening:plan};
 if(options.holdScorePlans){tacticalPlans.leading=structuredClone(plan);tacticalPlans.trailing=structuredClone(plan);}
 return {name,players,positions,...(formationLines?{formationLines,formationLinePresets:{position1:formationLines}}:{}),tactic:plan.tactic,style:plan.style,tacticalPlans,attackFocus:'balanced',defenseFocus:'balanced'};
}

export const fullMatchScenarios=[
 {id:'equal-433',a:{},b:{},pairs:16},
 {id:'strength-88-vs-80',a:{ability:88},b:{},pairs:12},
 {id:'433-vs-442',a:{},b:{formation:'4-4-2'},pairs:8},
 {id:'433-vs-4231',a:{},b:{formation:'4-2-3-1'},pairs:8},
 {id:'patient-vs-press',a:{profile:'patient'},b:{profile:'press'},pairs:8},
 {id:'counter-vs-press',a:{profile:'counter'},b:{profile:'press'},pairs:8},
 {id:'counter-vs-lowblock',a:{profile:'counter'},b:{profile:'lowBlock'},pairs:8},
];
