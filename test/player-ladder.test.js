import test from 'node:test';
import assert from 'node:assert/strict';
import {PlayerLadderService} from '../server/application/player-ladder-service.mjs';
const card=(id,overall,level=0)=>({id,name:id,overall,baseOverall:80,effectiveOverall:overall,upgradeLevel:level,role:'ST',grade:'S',attributes:{finishing:overall},state:{fitness:5,injury:{matchesRemaining:2}},secret:'hidden'});
const account=(id,roster)=>({id,nickname:'经理'+id,setupComplete:true,token:'secret-token',gold:987654321,draft:{teamName:'俱乐部'+id,roster}});
test('rank uses real enhanced overall without double adding or capping at 99',()=>{
 const accounts=new Map([['a',account('a',[card('base',96),card('plus8',109,8),card('plus7',107,7)])]]);
 const view=new PlayerLadderService({accounts,now:()=>0}).get();assert.deepEqual(view.entries.map(e=>e.score),[109,107,96]);assert.equal(view.entries[0].card.overall,109);
 assert.doesNotMatch(JSON.stringify(view),/secret-token|987654321|fitness|injury|hidden/);
});
test('bounded top 100 matches full ordering and duplicate definitions remain independent owned cards',()=>{
 const a=account('a',Array.from({length:2000},(_,i)=>card(String(i),70+i%40,i%9))),b=account('b',[card('0',109,8)]);
 const accounts=new Map([['a',a],['b',b],['c',{...account('c',[card('not-ready',999)]),setupComplete:false}]]);
 a.draft.roster.push(a.draft.roster[0],{id:'bad',overall:NaN});
 const view=new PlayerLadderService({accounts,now:()=>0}).get();assert.equal(view.entries.length,100);assert.equal(view.totalCards,2001);
 assert.ok(view.entries.every((e,i)=>i===0||view.entries[i-1].score>=e.score));assert.equal(new Set(view.entries.map(e=>e.owner.id+'/'+e.cardId)).size,100);
 const scores=[...a.draft.roster.slice(0,2000),...b.draft.roster].map(p=>p.overall).sort((a,b)=>b-a).slice(0,100);assert.deepEqual(view.entries.map(e=>e.score),scores);
});
test('all viewers share minute cache; transfer and enhancement update at next snapshot without writes',()=>{
 let now=0;const a=account('a',[card('same',95)]),b=account('b',[]),accounts=new Map([['a',a],['b',b]]),service=new PlayerLadderService({accounts,now:()=>now});
 const before=structuredClone([...accounts]),first=service.get();assert.deepEqual([...accounts],before);
 const p=a.draft.roster.pop();p.effectiveOverall=108;b.draft.roster.push(p);now=59999;assert.equal(service.get(),first);
 now=60000;const next=service.get();assert.equal(next.entries[0].owner.id,'b');assert.equal(next.entries[0].score,108);assert.equal(next.generatedAt,60000);
 b.draft.roster=[];now=120000;assert.equal(service.get().entries.length,0);
});
test('ties are stable across account map insertion order and cache handles clock rollback',()=>{
 const a=account('a',[card('a',100,2),card('z',100,3)]),b=account('b',[card('a',100,3)]);let now=100;
 const one=new PlayerLadderService({accounts:new Map([['a',a],['b',b]]),now:()=>now}),two=new PlayerLadderService({accounts:new Map([['b',b],['a',a]]),now:()=>now});
 assert.deepEqual(one.get(),two.get());assert.deepEqual(one.get().entries.map(e=>e.owner.id+'/'+e.cardId),['a/z','b/a','a/a']);now=0;assert.equal(one.get().generatedAt,0);
});
