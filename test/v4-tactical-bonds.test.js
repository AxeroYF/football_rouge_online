import test from 'node:test';
import assert from 'node:assert/strict';
import {TACTICAL_BONDS,evaluateTacticalBonds,applyTacticalBondBonuses} from '../versus/public/tactical-bonds.js';
import {createS4BondCatalog,S4_REGIONAL_BONDS} from '../versus/public/bond-rules.js';
import {REAL_PLAYERS} from '../versus/player-pool.js';
import {compileInput,demoInput} from '../versus/v4/fixtures.js';
import {createMatch,advanceMatch,awardRestart,injurePlayer,penalizeFoul,exportCheckpoint,restoreCheckpoint} from '../versus/v4/engine.js';
import {playerByKey} from '../versus/v4/world.js';
import {YDL_TRAIT_BY_ID} from '../versus/trait-pool.js';

const barca='club:巴塞罗那',spain='nationality:西班牙';
const allStyles=key=>({possessionStyle:key,transitionStyle:key,defensiveBlock:key,duelIntensity:key});

// Independent expectations: a change to the catalog must not silently change the test oracle.
const clubCases = [
  ['皇家马德里','counterAttack','pace','offBall'], ['巴塞罗那','possession','passing','firstTouch'],
  ['拜仁慕尼黑','wingPlay','crossing','acceleration'], ['尤文图斯','lowBlock','positioning','composure'],
  ['阿森纳','possession','offBall','passing'], ['国际米兰','vertical','passing','offBall'],
  ['AC米兰','midBlock','positioning','decisions'], ['曼联','longBall','offBall','pace'],
  ['马德里竞技','lowBlock','marking','tackling'], ['曼城','possession','decisions','vision'],
  ['利物浦','highPress','workRate','stamina'], ['巴黎圣日耳曼','wingPlay','dribbling','acceleration'],
  ['切尔西','midBlock','tackling','strength'], ['那不勒斯','vertical','dribbling','offBall'],
  ['纽卡斯尔联','roughPlay','strength','workRate'], ['多特蒙德','counterAttack','acceleration','finishing'],
  ['托特纳姆热刺','wingPlay','offBall','crossing'], ['本菲卡','highPress','tackling','acceleration'],
  ['阿斯顿维拉','retain','composure','passing'], ['加拉塔萨雷','roughPlay','aggression','heading'],
  ['勒沃库森','vertical','offBall','firstTouch'], ['利雅得新月','wingPlay','heading','positioning'],
];
const nationCases = [
  ['西班牙','possession','vision','composure'], ['法国','counterAttack','acceleration','firstTouch'],
  ['巴西','wingPlay','dribbling','agility'], ['意大利','lowBlock','positioning','decisions'],
  ['阿根廷','possession','dribbling','passing'], ['德国','vertical','decisions','passing'],
  ['荷兰','highPress','positioning','acceleration'], ['葡萄牙','wingPlay','finishing','offBall'],
  ['英格兰','wingPlay','heading','strength'], ['比利时','longBall','firstTouch','strength'],
  ['克罗地亚','retain','composure','firstTouch'], ['哥伦比亚','counterAttack','vision','dribbling'],
];
const regionCases = [
  ['africa','counterAttack','pace','dribbling','摩洛哥'], ['asia-oceania','vertical','offBall','workRate','澳大利亚'],
  ['central-eastern-europe','longBall','firstTouch','longShots','捷克'], ['nordic','longBall','heading','jumping','芬兰'],
  ['north-central-america','midBlock','stamina','tackling','加拿大'],
];
const catalog = createS4BondCatalog(REAL_PLAYERS);
const neutralPlan = {possessionStyle:'balanced',defensiveBlock:'midBlock',transitionStyle:'balanced',duelIntensity:'balanced'};
const axes = {
  possessionStyle:['balanced','possession','vertical','wingPlay','longBall'],
  defensiveBlock:['midBlock','highPress','lowBlock'],
  transitionStyle:['retain','counterAttack'], duelIntensity:['cautious','roughPlay'],
};
function matchInput() {
  const input = compileInput(demoInput());
  input.playerEffects = true;
  for (const team of input.teams) {
    team.sourceBondCatalog = catalog;
    team.sourcePlans = {normal:{bondIds:[]},leading:{bondIds:[]},trailing:{bondIds:[]}};
    for (const p of team.players) {
      p.baseAttributes = {...p.attributes};
      p.baseHeightCm = p.heightCm = 180;
      p.traitDefinitions = [];
      p.upgradeLevel = 1;
    }
  }
  return input;
}

function checkOnPitch(input, id, style, members, expectedBonus, fits) {
  const axis = Object.keys(axes).find(key => axes[key].includes(style));
  const team = input.teams[0];
  team.sourcePlans.normal = {...neutralPlan, [axis]:style, bondIds:[id]};
  const {state} = createMatch(input, {recording:false});
  const rows = state.activeBonds[0];
  assert.deepEqual(rows.map(b => b.id), fits ? [id] : []);
  if (fits) {
    assert.deepEqual(rows[0].memberIds, members);
    assert.deepEqual(rows[0].add, expectedBonus);
  }
  for (const player of state.players) {
    const expected = {...player.baseAttributes};
    if (fits && player.side === 0 && members.includes(player.id)) {
      for (const [attr, points] of Object.entries(expectedBonus)) expected[attr] += points;
    }
    assert.deepEqual(player.attributes, expected, player.key);
  }
}
for (const [type, cases] of [['club',clubCases], ['nationality',nationCases], ['nationality-region',regionCases]]) {
  for (const [key, style, primary, secondary, country] of cases) {
    const id = type + ':' + key;
    test('V4 开球逐卡验证 ' + id, () => {
      const input = matchInput(), players = input.teams[0].players;
      const field = type === 'club' ? 'club' : 'nationality';
      const members = players.slice(0, 7);
      for (const p of members) p[field] = country ?? key;
      const ids = members.map(p => p.id), bonus = {[primary]:5,[secondary]:4};
      checkOnPitch(input, id, style, ids, bonus, true);
      // Change only the dimension that gates this card.
      const axis = Object.keys(axes).find(k => axes[k].includes(style));
      const other = axes[axis].find(value => value !== style);
      checkOnPitch(input, id, other, ids, bonus, false);
    });
  }
}
const structureCases = [
  ['united',['balanced'],11,'workRate','discipline',5],
  ['small-quick-skillful',['possession'],5,'agility','firstTouch',4],
  ['aerial-bombardment',['longBall','wingPlay'],5,'heading','jumping',4],
  ['steel-defense',['lowBlock'],6,'positioning','strength',5],
  ['blow-them-up',['vertical'],5,'finishing','offBall',5],
  ['mahjong-together',['possession'],6,'passing','firstTouch',5],
];
for (const [key, styles, count, primary, secondary, points] of structureCases) {
  test('V4 开球逐卡验证 structure:' + key, () => {
    const input = matchInput(), players = input.teams[0].players;
    const members = key === 'united' ? players : players.slice(1, count + 1);
    const role = {'steel-defense':'CB','blow-them-up':'ST','mahjong-together':'CM'}[key];
    for (const player of players) {
      const member = members.includes(player);
      if (key === 'united') player.upgradeLevel = 0;
      if (key === 'small-quick-skillful') player.baseHeightCm = player.heightCm = member ? 174 : 175;
      if (key === 'aerial-bombardment') player.baseHeightCm = player.heightCm = member ? 186 : 185;
      if (role && player.role !== 'GK') player.role = member ? role : (role === 'CB' ? 'CM' : 'CB');
    }
    const id = 'structure:' + key, ids = members.map(p => p.id), bonus = {[primary]:points,[secondary]:points-1};
    for (const style of styles) checkOnPitch(input, id, style, ids, bonus, true);
    const wrongStyle = styles.includes('balanced') ? 'vertical' : 'balanced';
    checkOnPitch(input, id, wrongStyle, ids, bonus, false);
  });
}
test('39 identity bonds cover each tier, eligible players and the attribute cap',()=>{
  const identities=TACTICAL_BONDS.filter(b=>b.type!=='structure');
  assert.equal(identities.length,39);assert.equal(new Set(TACTICAL_BONDS.map(b=>b.id)).size,45);
  for(const b of identities){
    const region=S4_REGIONAL_BONDS.find(r=>'nationality-region:'+r.id===b.id);
    const entry={id:b.id,memberNationalities:region?.memberNationalities};
    for(const [count,expected] of [[4,0],[5,4],[6,4],[7,5],[8,5],[9,6],[10,6],[11,6]]){
      const players=Array.from({length:11},(_,i)=>({id:String(i),upgradeLevel:1,role:'GK',club:i<count?b.name:'other',nationality:i<count?(region?.memberNationalities[0]??b.name):'other',
        attributes:{[b.primary]:70,[b.secondary]:98,discipline:60}}));
      const rows=evaluateTacticalBonds(players,[entry],{...allStyles(b.styles[0]),bondIds:[b.id]});
      const row=rows.find(r=>r.id===b.id);
      assert.equal(row.active,Boolean(expected),b.id);assert.equal(row.count,count);
      if(expected)assert.deepEqual(row.add,{[b.primary]:expected,[b.secondary]:expected-1});
      const values=applyTacticalBondBonuses(players,rows);
      for(const [i,p] of values.entries()){
        assert.equal(p.attributes[b.primary],70+(i<count?expected:0),b.id);
        assert.equal(p.attributes[b.secondary],i<count&&expected?99:98);
      }
    }
  }
});

test('all six structure bonuses use actual height, level and assigned role, with eleven on field',()=>{
  const players=Array.from({length:11},(_,i)=>({id:String(i),upgradeLevel:0,role:'GK',assignedRole:'CB',heightCm:180,traits:[]}));
  const profiles=[
    ['united','balanced',11,'workRate',5],['small-quick-skillful','possession',5,'agility',4],
    ['aerial-bombardment','wingPlay',5,'heading',4],['steel-defense','lowBlock',6,'positioning',5],
    ['blow-them-up','vertical',5,'finishing',5],['mahjong-together','possession',6,'passing',5]
  ];
  for(const [key,style,n,attr,amount] of profiles){
    const id='structure:'+key,plan={...allStyles(style),bondIds:[id]};
    const lineup=structuredClone(players);
    lineup.forEach((p,i)=>{
      p.assignedRole=i>=n?'GK':({'steel-defense':'LWB','blow-them-up':'RW','mahjong-together':'DM'}[key]??'CB');
      if(key==='small-quick-skillful'){p.heightCm=i<n?179:180;p.traits=['custom-2c1cb6a5-becb-47d2-bad7-1f52b3716c20'];}
      if(key==='aerial-bombardment'){p.heightCm=i<n?166:165;p.traits=['aerial-beacon'];}
    });
    const result=()=>evaluateTacticalBonds(lineup,[],plan).find(r=>r.id===id);
    assert.equal(result().count,n,id);assert.equal(result().add[attr],amount);assert.ok(result().active);
    lineup[10].active=false;assert.equal(result().active,false);
  }
});

test('V4 carries a wildcard through a real injury substitution, score-plan switch and checkpoint',()=>{
  const input=structuredClone(createMatch(demoInput()).state.input);input.playerEffects=true;
  for(const t of input.teams){
    const normal={possessionStyle:'possession',bondIds:[barca,spain]};
    t.sourcePlans={normal,leading:{...normal,possessionStyle:'vertical'},trailing:normal};
    t.scorePlans={leading:{directness:.9}};t.sourceBondCatalog=[{id:barca},{id:spain}];
    for(const [i,p] of t.players.entries()){
      p.baseAttributes={...p.attributes};p.baseHeightCm=p.heightCm;p.club=i<6?'巴塞罗那':'其他';p.nationality=i<4?'西班牙':'其他';
      p.traitDefinitions=i===6?[YDL_TRAIT_BY_ID['lone-finisher']]:[];p.upgradeLevel=1;
    }
  }
  const t=input.teams[0];
  t.bench=[{...structuredClone(t.players[2]),id:'bench',number:15,club:'其他',nationality:'其他'}];
  const match=createMatch(input),s=match.state;
  const delta=(key,attr)=>{const p=playerByKey(s,key);return p.attributes[attr]-p.baseAttributes[attr];};
  assert.deepEqual(s.activeBonds[0].map(b=>[b.id,b.count,b.tier]),[[barca,7,7],[spain,5,5]]);
  assert.equal(delta('0:p7','passing'),5);assert.equal(delta('0:p7','vision'),4);assert.equal(delta('0:p8','passing'),0);
  awardRestart(match,'throwIn',0,{x:45,y:0},'测试换人');injurePlayer(match,playerByKey(s,'0:p3'));
  assert.equal(delta('0:p7','passing'),4);
  advanceMatch(match);
  assert.equal(playerByKey(s,'0:bench').active,true);assert.equal(delta('0:bench','passing'),0);
  assert.deepEqual(s.activeBonds[0].map(b=>[b.id,b.count,b.tier]),[[barca,6,5]]);
  assert.equal(delta('0:p7','passing'),4);assert.equal(delta('0:p7','vision'),0);assert.equal(delta('0:p3','passing'),0);
  s.score=[1,0];advanceMatch(match);assert.equal(s.activePlans[0],'leading');assert.equal(delta('0:p7','passing'),0);
  s.score=[1,1];advanceMatch(match);assert.equal(delta('0:p7','passing'),4);
  const resumed=restoreCheckpoint(exportCheckpoint(match));advanceMatch(match);advanceMatch(resumed);assert.deepEqual(match,resumed);
});

test('同一属性叠加两项羁绊封顶99，掉一项后按剩余档位重算', () => {
  const input = matchInput(), team = input.teams[0];
  const club = 'club:阿森纳', nation = 'nationality:阿根廷';
  team.sourcePlans.normal = {possessionStyle:'possession',bondIds:[club,nation]};
  for (const [i, player] of team.players.entries()) {
    if (i < 5) player.club = '阿森纳';
    if (i >= 3 && i < 8) player.nationality = '阿根廷';
    player.attributes.passing = player.baseAttributes.passing = 94;
  }
  const match = createMatch(input), state = match.state;
  const passing = i => playerByKey(state,'0:' + team.players[i].id).attributes.passing;
  assert.deepEqual([0,3,7,8].map(passing), [97,99,97,94]);
  const defender = playerByKey(state,'0:' + team.players[1].id);
  penalizeFoul(match, defender, playerByKey(state,'1:p9'), {speed:0}, {card:'red'});
  assert.deepEqual(state.activeBonds[0].map(b => b.id), [nation]);
  assert.deepEqual([0,1,3,7,8].map(passing), [94,94,97,97,94]);
});

test('变色龙退场立即撤销身份羁绊；结构羁绊按实际身高计数，红牌后要求满员', () => {
  const input = matchInput(), team = input.teams[0];
  const small = 'structure:small-quick-skillful';
  team.sourcePlans.normal = {possessionStyle:'possession',bondIds:[barca,small]};
  team.players.slice(0,4).forEach(p => { p.club = '巴塞罗那'; });
  team.players.slice(1,5).forEach(p => { p.heightCm = p.baseHeightCm = 174; });
  const wildcard = team.players[6];
  wildcard.traitDefinitions = [YDL_TRAIT_BY_ID['lone-finisher']];
  const start = () => createMatch(input, {recording:false});
  assert.deepEqual(start().state.activeBonds[0].map(b => b.id), [barca]);
  team.players[5].heightCm = team.players[5].baseHeightCm = 174;
  const match = start(), state = match.state;
  const [club, structure] = state.activeBonds[0];
  assert.deepEqual(club.wildcardIds, [wildcard.id]);
  assert.deepEqual(structure.memberIds, team.players.slice(1,6).map(p => p.id));
  const defender = playerByKey(state, '0:' + wildcard.id);
  assert.equal(defender.attributes.passing, defender.baseAttributes.passing + 4);
  assert.equal(defender.attributes.agility, defender.baseAttributes.agility);
  penalizeFoul(match, defender, playerByKey(state, '1:p9'), {speed:0}, {card:'red'});
  assert.equal(defender.status, 'sentOff');
  assert.deepEqual(state.activeBonds[0], []);
  for (const p of state.players.filter(p => p.side === 0)) assert.deepEqual(p.attributes, p.baseAttributes);
});

test('旧存档的空槽和手选羁绊均按当前阵容自动激活，国家和地域共用一位',()=>{
  const region='nationality-region:nordic';
  const players=Array.from({length:11},(_,i)=>({id:String(i),club:'曼联',nationality:'比利时',upgradeLevel:1}));
  const catalog=[{id:'club:曼联'},{id:'nationality:比利时'},{id:region,memberNationalities:['比利时']}];
  for(const bondIds of [undefined,[],[region]]){
    const rows=evaluateTacticalBonds(players,catalog,{possessionStyle:'longBall',bondIds});
    assert.deepEqual(rows.filter(b=>b.active).map(b=>b.id),['club:曼联','nationality:比利时']);
  }
});
