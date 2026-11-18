import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';import test from 'node:test';
import {A_PLAYER_PROFILE_BY_PLAYER_ID as A} from '../versus/public/a-player-profiles.js';
import {LEGENDARY_PROFILE_BY_PLAYER_ID as S} from '../versus/public/legendary-profiles.js';

test('legacy A/S artwork accepts position-only saves, retaining original image bytes and gameplay fields',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'yffm-legacy-position-'));
 process.env.YDL_PLAYER_CARD_STUDIO_PATH=path.join(dir,'studio.json');
 process.env.YDL_PLAYER_PROFILE_ROOT=path.join(dir,'profiles');
 const {savePlayerCardProfile}=await import('../versus/player-card-studio-store.js');
 const {REAL_PLAYERS}=await import('../versus/player-pool.js');
 const before=structuredClone(REAL_PLAYERS),changed=new Set();
 for(const [grade,map] of [['A',A],['S',S]]){
  const player=REAL_PLAYERS.find(p=>p.grade===grade&&map[p.id]&&!p.cardProfile);assert.ok(player);
  const old=map[player.id],original=await readFile(path.resolve(old.imageUrl.split('?')[0].slice('/versus/'.length)));
  const saved=await savePlayerCardProfile(player.id,{xPercent:63.2});changed.add(player.id);
  assert.equal(saved.xPercent,63.2);assert.equal(saved.yPercent,old.yPercent);assert.equal(saved.widthPercent,old.widthPercent);
  assert.deepEqual(await readFile(path.join(dir,'profiles/webp',saved.optimizedFileName)),original);
  const next=await savePlayerCardProfile(player.id,{yPercent:41.7});
  assert.equal(next.xPercent,63.2);assert.equal(next.yPercent,41.7);assert.equal(next.optimizedFileName,saved.optimizedFileName);
 }
 const missing=REAL_PLAYERS.find(p=>p.grade==='C'&&!p.cardProfile);assert.ok(missing);
 await assert.rejects(savePlayerCardProfile(missing.id,{xPercent:60}),/请先上传/);
 for(let i=0;i<before.length;i++){const old=before[i],now=structuredClone(REAL_PLAYERS[i]);if(changed.has(old.id)){delete old.cardProfile;delete now.cardProfile;}assert.deepEqual(now,old);}
});
