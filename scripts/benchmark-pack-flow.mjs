import fs from 'node:fs';
import {performance} from 'node:perf_hooks';
import {coalitionFixture} from '../test/coalition-fixture.mjs';
const compact=process.argv.includes('--compact'),samples=[];
for(const size of [22,522]){
 for(let run=0;run<5;run++){
  const f=coalitionFixture(),type='legendary-player-pack';
  for(let i=22;i<size;i++){const p=structuredClone(f.s.playerDatabase[i%f.s.playerDatabase.length]);p.id='bench-'+i;p.cardDefinitionId=p.id;f.a.draft.roster.push(p);}
  f.s.playerPacks.addPacks(f.a,type,3);f.s.save();f.s.state(f.a);
  let writes=0,views=0;const save=f.s.repository.save.bind(f.s.repository),state=f.s.state.bind(f.s);
  f.s.repository.save=(...args)=>{writes++;return save(...args);};f.s.state=(...args)=>{views++;return state(...args);};
  let start=performance.now();const opened=f.s.openPlayerPack(f.a,type,{compact});const openMs=performance.now()-start,openWrites=writes,openViews=views,openBytes=Buffer.byteLength(JSON.stringify(opened));
  const opening=opened.opening??opened.statePatch?.inventory.pendingOpening??opened.state.inventory.pendingOpening;
  writes=views=0;start=performance.now();const chosen=f.s.choosePlayerPackCard(f.a,opening.id,opening.cards[0].playerId,{compact});const chooseMs=performance.now()-start;
  samples.push({size,run,openMs,chooseMs,openBytes,chooseBytes:Buffer.byteLength(JSON.stringify(chosen)),openWrites,chooseWrites:writes,openViews,chooseViews:views});
 }
}
const mean=(rows,key)=>Math.round(rows.reduce((s,r)=>s+r[key],0)/rows.length*100)/100;
const summary=[22,522].map(size=>{const rows=samples.filter(r=>r.size===size);return {size,...Object.fromEntries(Object.keys(rows[0]).filter(k=>!['size','run'].includes(k)).map(k=>[k,mean(rows,k)]))};});
const result={compact,scope:'Local in-memory repository serializes saves; three accounts, test world; not production latency',summary,samples};const file='outputs/pack-performance-'+(compact?'after':'before')+'.json';fs.writeFileSync(file,JSON.stringify(result,null,2));console.log(JSON.stringify({file,summary}));
