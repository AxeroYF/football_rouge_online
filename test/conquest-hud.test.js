import test from 'node:test';
import assert from 'node:assert/strict';
import {createConquestHud} from '../client/challenge/conquest-hud.js';
import {conquestState} from '../shared/config/conquest.mjs';
test('an open HUD enters curfew at midnight and resets quota at 08:00 without a reload',async()=>{
 const midnight=Date.parse('2026-09-18T16:00:00Z'),morning=midnight+8*3600000;let now=midnight-1;
 const count={},cooldown={},root={classList:{toggle(){}},querySelector:s=>s==='[data-conquest-count]'?count:cooldown};
 const state={setupComplete:true,homeTerritoryId:'a',conquest:conquestState({conquest:{day:'2026-09-18',used:8,resetHour:8}},now)};
 const hud=createConquestHud({root,store:{getState:()=>state,subscribe:()=>()=>{}},now:()=>now});
 try{
  assert.equal(count.textContent,'0/8');assert.equal(cooldown.hidden,true);assert.match(root.title,/08:00 刷新/);assert.doesNotMatch(root.title,/含奇观额外次数/);
  now=midnight;await new Promise(r=>setTimeout(r,1100));assert.equal(count.textContent,'0/8');assert.equal(cooldown.hidden,false);assert.match(cooldown.textContent,/宵禁/);
  now=morning;await new Promise(r=>setTimeout(r,1100));assert.equal(count.textContent,'8/8');assert.equal(cooldown.hidden,true);
 }finally{hud.destroy();}
});

test('wonder quota remains nine across 08:00 and updates on ownership change',async()=>{
 const reset=Date.parse('2026-09-21T00:00:00Z');let now=reset-1,listener;
 const count={},cooldown={},root={classList:{toggle(){}},querySelector:s=>s==='[data-conquest-count]'?count:cooldown};
 const account={conquest:{schemaVersion:2,resetHour:8,day:'2026-09-20',used:8,playerUsed:4}};
 const view=bonus=>({setupComplete:true,homeTerritoryId:'a',conquest:conquestState(account,now,bonus)});
 const hud=createConquestHud({root,store:{getState:()=>view(1),subscribe:f=>(listener=f,()=>{})},now:()=>now});
 try{assert.equal(count.textContent,'1/9');assert.match(root.title,/含奇观额外次数/);now=reset;await new Promise(r=>setTimeout(r,1100));assert.equal(count.textContent,'9/9');listener({state:view(0)});assert.equal(count.textContent,'8/8');}finally{hud.destroy();}
});
