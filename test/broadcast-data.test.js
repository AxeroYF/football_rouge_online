import test from 'node:test';
import assert from 'node:assert/strict';
import {broadcastDataMarkup,broadcastDataModel,broadcastShotSeries} from '../versus/public/broadcast-data.js';

const match = () => ({minute:60,teams:[{name:'主队',stats:{possession:60,shots:2,xg:.5}},{name:'客队',stats:{possession:40,shots:1,xg:.2}}],events:[
  {id:'a',type:'save',teamIndex:1,minute:10,xg:.1},
  {id:'b',type:'block',teamIndex:0,attackingTeamIndex:1,minute:25,xg:.2},
  {id:'c',type:'goal',teamIndex:0,minute:55,xg:.4},
]});

test('扑救与封堵归属进攻方，进球计入一次，点球大战不进入射门走势', () => {
  const value=match();
  value.events.push(value.events[0],{id:'kick',type:'penaltyShootoutKick',teamIndex:0,minute:120,xg:.76});
  const result=broadcastShotSeries(value);
  assert.equal(result.complete,true);
  assert.deepEqual(result.totals,[.5,.2]);
  assert.deepEqual(result.shots.map(list=>list.length),[2,1]);
  assert.equal(result.shots[0][1].goal,true);
  assert.equal(result.end,60);
});

test('缺失或不完整的历史记录不伪造累计曲线，未知统计不显示为零', () => {
  const value=match();value.events.pop();
  assert.equal(broadcastShotSeries(value).complete,false);
  assert.match(broadcastDataMarkup(value,'trends'),/缺少完整射门记录/);
  assert.doesNotMatch(broadcastDataMarkup(value,'trends'),/<svg/);
  assert.match(broadcastDataMarkup(value),/—/);
  value.teams[0].stats.xg=null;
  assert.equal(broadcastDataModel(value).pair('xg')[0],null);
});

test('开场零控球不展示虚构比例，射门为空但完整时绘制零基线', () => {
  const value={minute:0,events:[],teams:[0,1].map(()=>({stats:{possession:0,shots:0,xg:0}}))};
  assert.deepEqual(broadcastDataModel(value).possession,[null,null]);
  assert.match(broadcastDataMarkup(value,'trends'),/尚未产生射门/);
  assert.doesNotMatch(broadcastDataMarkup(value),/NaN|Infinity|50%/);
});

test('中途入场与重复快照结果一致，加时扩展时间轴', () => {
  const value=match();value.minute=120;value.events[2].minute=117;
  assert.deepEqual(broadcastShotSeries(value),broadcastShotSeries(structuredClone(value)));
  assert.equal(broadcastShotSeries(value).horizon,120);
  assert.match(broadcastDataMarkup(value,'trends'),/105–120′/);
  assert.deepEqual(broadcastDataModel(value).possession,[60,40]);
  const paths=[...broadcastDataMarkup(value,'trends').matchAll(/<path[^>]+d="([^"]+)"/g)].map(match=>match[1]);
  assert.equal(paths.length,2);
  paths.forEach(path=>{ assert.match(path,/ L/); assert.doesNotMatch(path,/[HV]/); });
});

test('射门累计与权威 xG 不一致时不绘图，允许显示精度舍入差', () => {
  const value=match();value.teams[0].stats.xg=.51;
  assert.equal(broadcastShotSeries(value).complete,true);
  value.teams[0].stats.xg=.9;
  assert.equal(broadcastShotSeries(value).complete,false);
});

test('球队和事件文本转义，页签有完整的键盘及面板语义', () => {
  const value=match();value.teams[0].name='<img onerror="bad">';value.events[0].text='</title><script>bad</script>';
  const markup=broadcastDataMarkup(value,'trends');
  assert.doesNotMatch(markup,/<script>|<img/);
  assert.match(markup,/&lt;script&gt;/);
  assert.match(markup,/role="tabpanel" aria-labelledby="broadcast-data-tab-trends"/);
  assert.match(markup,/data-broadcast-data-tab="trends" aria-selected="true"/);
});
