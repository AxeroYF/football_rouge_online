import test from 'node:test';import assert from 'node:assert/strict';
import {warehouseEntries,warehouseFilters,cardWarehouseMarkup} from '../client/cards/social-card-warehouse.js';
const cards=[{id:'a',name:'Keeper',role:'GK',grade:'S',upgradeLevel:4,nationality:'德国',club:'拜仁',ownerName:'甲'}, {id:'b',name:'Striker',role:'ST',grade:'A',upgradeLevel:0,nationality:'法国',blocked:'训练中'}, {id:'c',name:'Wingback',role:'LWB',grade:'S',upgradeLevel:4,nationality:'德国',ownerName:'乙'}];
test('warehouse filters compose by grade, base role, level, nationality and operability',()=>{
 assert.deepEqual(warehouseEntries(cards,{grade:'S',position:'DEF',upgradeLevel:'4',nationality:'德国'}).map(p=>p.id),['c']);
 assert.deepEqual(warehouseEntries(cards,{usable:true}).map(p=>p.id),['a','c']);
 assert.deepEqual(warehouseEntries(cards,{search:'拜仁'}).map(p=>p.id),['a']);
 assert.deepEqual(warehouseEntries(cards,{search:'乙'}).map(p=>p.id),['c']);
 assert.deepEqual(warehouseEntries(cards,{search:'keeper'}).map(p=>p.id),['a']);
 assert.equal(warehouseEntries(cards,{grade:'C'}).length,0);
});
test('warehouses have independent filter state and preserve selected count outside filter',()=>{
 const states={mine:{...warehouseFilters(),grade:'S'}},html=cardWarehouseMarkup(cards,{key:'mine',states,selected:p=>p.id==='b'});
 assert.match(html,/已选 1 张/);assert.doesNotMatch(html,/data-ui-key="b"/);
 cardWarehouseMarkup(cards,{key:'theirs',states});assert.equal(states.theirs.grade,'all');assert.equal(states.mine.grade,'S');
});
test('warehouse renders original deferred shield cards in batches and escapes user metadata',()=>{
 const list=Array.from({length:60},(_,i)=>({...cards[0],id:String(i),name:'<img onerror=bad>'}));
 const states={},first=cardWarehouseMarkup(list,{key:'batch',states});
 assert.equal([...first.matchAll(/data-player-card-id=/g)].length,24);assert.match(first,/data-card-render=/);assert.match(first,/加载更多/);assert.doesNotMatch(first,/<img onerror=bad>/);
 states.batch.count=48;assert.equal([...cardWarehouseMarkup(list,{key:'batch',states}).matchAll(/data-player-card-id=/g)].length,48);
});

test('only operable uses pane permissions, not just card status',()=>{assert.deepEqual(warehouseEntries(cards,{usable:true},p=>p.id==='c').map(p=>p.id),['c']);assert.equal(warehouseEntries(cards,{usable:true},()=>false).length,0);});
