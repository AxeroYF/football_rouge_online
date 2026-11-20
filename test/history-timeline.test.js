import test from 'node:test';
import assert from 'node:assert/strict';
import {historyTimelineEvents} from '../versus/public/history-timeline.js';
import {broadcastMinuteLabel} from '../versus/public/broadcast-key-plays.js';

test('比赛详情合并新旧事件表并保留同一分钟的伤退和换人',()=>{
  const injury={id:'i',type:'injury',minute:48.44};
  const sub={id:'s',type:'substitution',minute:48.44};
  const goal={id:'g',type:'goal',minute:'45+2'};
  const detail={events:[{type:'pass',minute:10},goal,injury,sub],importantEvents:[
    {...goal,replayTime:70}, {id:'r',type:'redCard',minute:46},injury]};
  const rows=historyTimelineEvents(detail);
  assert.deepEqual(rows.map(e=>e.id),['g','r','i','s']);
  assert.deepEqual(rows.map(e=>broadcastMinuteLabel(e.minute)),['45+2','46','48','48']);
  assert.equal(rows[0].replayTime,70);
  assert.equal(historyTimelineEvents({importantEvents:[injury,sub]}).length,2);
  assert.deepEqual(historyTimelineEvents({}),[]);
});
