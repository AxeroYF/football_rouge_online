import test from 'node:test';
import assert from 'node:assert/strict';
import {benchFilterOptions,filterBenchPlayers,benchFiltersMarkup} from '../client/tactics/bench-filters.js';
const players=[{id:'a',role:'LB',secondaryRole:'LWB',club:'甲',nationality:'中国'},{id:'b',role:'LWB',club:'乙',nationality:'中国'},{id:'c',role:'LB',club:'甲',nationality:'法国'}];
test('bench filters combine exact primary or secondary position, club and nationality without mutating the roster',()=>{
 assert.deepEqual(filterBenchPlayers(players,{position:'LWB'}).map(p=>p.id),['a','b']);
 assert.deepEqual(filterBenchPlayers(players,{position:'LWB',club:'甲',nationality:'中国'}).map(p=>p.id),['a']);
 assert.deepEqual(filterBenchPlayers(players,{club:'乙',nationality:'法国'}),[]);
 assert.equal(filterBenchPlayers(players,{}).length,3);assert.equal(players.length,3);
});
test('filter choices are unique concrete roles and escaped when rendered',()=>{
 const options=benchFilterOptions([...players,{role:'ST',club:'<球队>',nationality:'中国'}]);
 assert.deepEqual(options.position,['LB','LWB','ST']);assert.equal(options.nationality.length,2);
 const html=benchFiltersMarkup(options,{club:'<球队>'},{shown:1,total:4});
 assert.ok(html.includes('&lt;球队&gt;'));assert.ok(!html.includes('<球队>'));assert.ok(html.includes('1 / 4 人'));
});
