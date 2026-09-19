import test from 'node:test';
import assert from 'node:assert/strict';
import { expeditionPanelView, expeditionPanelMarkup } from '../client/map/expedition-panel-controller.js';
import { buildAccountMatchSeat } from '../engine/campaign-match-engine.mjs';
import { analyzeElevenBoardFormation } from '../formation-rules.js';

function fixture(){
 const roster=[],assignments={},squads={};
 const roles=['GK','LB','CB','CB','RB','LM','DM','AM','RM','ST','ST'];
 const points=[[50,90],[17,68],[39,68],[65,68],[85,68],[18,44],[43,44],[59,44],[82,44],[38,20],[66,20]];
 for(const squad of ['expedition','garrison']){
  const starters=roles.map((role,i)=>{const id=squad+'-'+i;roster.push({id,name:squad+' 球员 '+i,role,pool:i===0?'GK':i<5?'DEF':i<9?'MID':'ATT',overall:80+i,grade:'B'});assignments[id]=squad;return id;});
  const positions=Object.fromEntries(starters.map((id,i)=>[id,{x:points[i][0],y:points[i][1]}]));
  squads[squad]={starters,formation:'4-4-2',attackStyle:'balanced',defenseStyle:'possession',positions,planSnapshots:{__s4V2:{starters,captainId:starters[6],positionPresets:{position1:positions},tacticalPlans:{opening:{tactic:squad==='expedition'?'positive':'parkBus',style:squad==='expedition'?'wingPlay':'lowBlock'},leading:{tactic:'defensive',style:'counterAttack'}}}}};
 }
 return {playerId:'panel-test',setupComplete:true,nickname:'经理',draft:{teamName:'远征俱乐部',roster},playerSquads:{schemaVersion:2,assignments},tactics:{activeSquadId:'garrison',squads,...structuredClone(squads.garrison)},expeditionPiece:{territoryId:'home',tokenId:'messi',moving:false}};
}
test('panel resolves the actual expedition opening eleven independently of the active garrison tab',()=>{
 const state=fixture();state.draft.roster[0].state={fitness:0};state.draft.roster[0].fitness=88;state.draft.roster[1].state={fitness:63.4};
 const before=structuredClone(state),view=expeditionPanelView(state);
 const seat=buildAccountMatchSeat({...state,id:state.playerId},'expedition');
 assert.deepEqual(view.players.map(p=>p.id),seat.players.map(p=>p.id));
 assert.equal(view.players.length,11);assert.equal(view.formation,'4-4-2');
 assert.equal(view.formation,analyzeElevenBoardFormation(seat.players,seat.positions,seat.formationLines).name);
 assert.equal(view.players[0].fitness,0);assert.equal(view.players[1].fitness,63);assert.equal(view.players[2].fitness,100);
 assert.equal(view.tactic,'积极进攻');assert.equal(view.style,'两翼齐飞');assert.equal(view.players.find(p=>p.captain).id,'expedition-6');
 assert.deepEqual(state,before);
});
test('panel uses the same training substitute and position as the match engine',()=>{
 const state=fixture();state.draft.roster.find(p=>p.id==='expedition-6').training={taskId:'in-training'};
 state.draft.roster.push({id:'reserve',name:'替补后腰',state:{fitness:44},role:'DM',pool:'MID',overall:85,grade:'B'});state.playerSquads.assignments.reserve='expedition';
 const view=expeditionPanelView(state),seat=buildAccountMatchSeat({...state,id:state.playerId},'expedition');
 assert.deepEqual(view.players.map(p=>p.id),seat.players.map(p=>p.id));assert.ok(view.players.some(p=>p.id==='reserve'));assert.ok(!view.players.some(p=>p.id==='expedition-6'));assert.equal(view.error,'');assert.equal(view.players.find(p=>p.id==='reserve').fitness,44);
});
test('unavailable eleven remains inspectable without borrowing garrison players or blocking travel',()=>{
 const state=fixture();state.draft.roster=state.draft.roster.filter(p=>p.id!=='expedition-0');
 const before=structuredClone(state),view=expeditionPanelView(state);
 assert.equal(view.players.length,10);assert.ok(view.error);assert.ok(view.players.every(p=>p.id.startsWith('expedition-')));assert.equal(view.actions[0].disabled,false);
 assert.match(expeditionPanelMarkup(view),/首发空缺/);assert.deepEqual(state,before);
});
test('travel and challenge block only the move action while preserving inspection',()=>{
 const state=fixture();state.expeditionPiece={...state.expeditionPiece,moving:true,movement:{fromTerritoryId:'home',toTerritoryId:'away'}};
 const view=expeditionPanelView(state,{territoryLabel:id=>({home:'主场',away:'目的地'})[id]});
 assert.equal(view.status,'行军中');assert.equal(view.location,'主场 → 目的地');assert.equal(view.players.length,11);assert.equal(view.actions[0].disabled,true);assert.match(view.actions[0].reason,/抵达/);
 state.expeditionPiece.moving=false;state.activeChallengeId='challenge';assert.match(expeditionPanelView(state).actions[0].reason,/挑战/);
 state.activeChallengeId=null;assert.equal(expeditionPanelView(state).actions[0].disabled,false);
});
test('panel hides for absent sessions and escapes names and location in all markup',()=>{
 assert.equal(expeditionPanelView(null),null);assert.equal(expeditionPanelView({...fixture(),setupComplete:false}),null);
 const state=fixture();state.draft.teamName='<script>evil</script>';state.draft.roster[0].name='"<img onerror=evil>';
 const html=expeditionPanelMarkup(expeditionPanelView(state,{territoryLabel:()=>'<svg onload=evil>'}));
 assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img onerror'));assert.ok(!html.includes('<svg onload'));assert.match(html,/&lt;script&gt;/);
 assert.equal((html.match(/data-expedition-action=/g)||[]).length,1);
});


test('expedition panel takes live fitness by player id instead of stale full-fitness roster cards',()=>{
 const state=fixture();state.expeditionFitness={players:Object.fromEntries(state.draft.roster.map(p=>[p.id,{fitness:p.id.startsWith('expedition')?47.6:100,recoveryPerMinute:0.5}]))};
 for(const p of state.draft.roster){p.state={fitness:100};p.card={status:{fitness:100}};}
 const before=structuredClone(state),view=expeditionPanelView(state);
 assert.ok(view.players.every(p=>p.id.startsWith('expedition')&&p.fitness===48));assert.deepEqual(state,before);
 state.expeditionFitness.players['expedition-1'].fitness=59.2;assert.equal(expeditionPanelView(state).players.find(p=>p.id==='expedition-1').fitness,59);
});
test('live fitness drives pre-match expedition rotation without borrowing a fit garrison player',()=>{
 const state=fixture();state.draft.roster.push({id:'reserve',name:'远征替补',role:'LB',pool:'DEF',overall:85,grade:'B',state:{fitness:20}});state.playerSquads.assignments.reserve='expedition';
 state.expeditionFitness={players:{'expedition-1':{fitness:40},reserve:{fitness:90}}};
 const view=expeditionPanelView(state);assert.ok(view.players.some(p=>p.id==='reserve'&&p.fitness===90));assert.ok(!view.players.some(p=>p.id==='expedition-1'||p.id.startsWith('garrison')));
});
test('legacy garrison tactics never auto-transfer garrison players into a short expedition',()=>{
 const state=fixture();state.tactics={...state.tactics.squads.garrison,activeSquadId:'garrison'};
 state.draft.roster=state.draft.roster.filter(p=>p.id!=='expedition-0');
 // Enough garrison reserves to trigger the old auto-completion path.
 state.draft.roster.push({id:'extra-keeper',name:'留守替补门将',role:'GK',pool:'GK',overall:99,grade:'B',state:{fitness:100}});state.playerSquads.assignments['extra-keeper']='garrison';
 const before=structuredClone(state),view=expeditionPanelView(state);assert.equal(view.players.length,10);assert.ok(view.players.every(p=>p.id.startsWith('expedition')));assert.deepEqual(state,before);
});
