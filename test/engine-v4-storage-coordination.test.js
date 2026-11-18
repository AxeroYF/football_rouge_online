import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {YellowDogsLeagueService,S4_BOND_CATALOG} from '../versus/league-service.js';
import {REAL_PLAYERS} from '../versus/player-pool.js';
import {openCanonicalLocalStorageSettlement} from '../versus/v4-host/canonical-storage-settlement.js';

const account={id:'storage-read-owner',nickname:'已读协调测试'},at=1794934800000,createService=options=>new YellowDogsLeagueService(options);
async function setup(storage){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'v4-read-coordination-'));await fs.writeFile(path.join(root,'v4-local-storage.json'),JSON.stringify({format:'yffm-v4-canonical-local-settlement-1'}));
  const options={statePath:path.join(root,storage==='json'?'league.json':'league-shards'),backupDir:null,pagedInbox:true,now:()=>at,rng:()=>.5};
  let service=createService(options);service.beginDraft(account,'协调测试');service.autoDraft(account);service.finishDraft(account);
  service.pushInbox(service.accountTeam(account.id),{id:'read-proof',type:'notice',title:'已读测试'});service.save({skipDailyBackup:true});service=createService(options);service.save({skipDailyBackup:true});
  const bridge=await openCanonicalLocalStorageSettlement({root,service,createService,now:()=>at,sourceCatalog:{catalog:REAL_PLAYERS,traitCatalog:[],bondCatalog:S4_BOND_CATALOG}});
  return {service,options,bridge,request:{seasonId:service.state.season.id,roundNumber:1,duration:60}};
}
for(const storage of ['json','shards']){
  test(`${storage}: a pending canonical inbox read is saved before a round transaction replaces state`,async()=>{
    const {service,options,bridge,request}=await setup(storage);
    try{
      service.readInbox(account,'read-proof',{compact:true});assert.ok(service.inboxReadPersistTimer);
      await bridge.beginRound(request);assert.equal(service.inboxReadPersistTimer,null);
      const reopened=createService(options),team=reopened.accountTeam(account.id);
      assert.equal(reopened.state.inbox[team.id].find(m=>m.id==='read-proof').readAt,at);assert.equal(reopened.state.rounds[0].status,'running');
    }finally{clearTimeout(service.inboxReadPersistTimer);}
  });
  test(`${storage}: pending reads never authorize an unrelated memory or external-disk overwrite`,async()=>{
    for(const change of ['wallet','message','external']){
      const {service,options,bridge,request}=await setup(storage);
      try{
        service.readInbox(account,'read-proof',{compact:true});
        if(change==='wallet')service.wallet(account.id).balance++;
        if(change==='message')service.state.inbox[service.accountTeam(account.id).id].find(m=>m.id==='read-proof').title='unexpected change';
        if(change==='external'){const other=createService(options);other.wallet(account.id).balance+=123;other.save({skipDailyBackup:true});}
        await assert.rejects(bridge.beginRound(request),/内存状态不同/);
        clearTimeout(service.inboxReadPersistTimer);service.inboxReadPersistTimer=null;
        const disk=createService(options);assert.equal(disk.state.rounds[0].status,'pending');
        assert.equal(disk.state.inbox[disk.accountTeam(account.id).id].find(m=>m.id==='read-proof').readAt,null);
        if(change==='external')assert.equal(disk.wallet(account.id).balance,service.wallet(account.id).balance+123);
      }finally{clearTimeout(service.inboxReadPersistTimer);}
    }
  });
  test(`${storage}: read-state save failures preserve the pending read and permit a safe round retry`,async()=>{
    for(const point of ['before','after']){
      const {service,options,bridge,request}=await setup(storage),save=service.save.bind(service);
      try{
        service.readInbox(account,'read-proof',{compact:true});
        service.save=options=>{if(point==='after')save(options);throw new Error('read-flush-'+point);};
        await assert.rejects(bridge.beginRound(request),new RegExp('read-flush-'+point));
        assert.equal(service.state.rounds[0].status,'pending');assert.ok(service.inboxReadPersistTimer);
        const disk=createService(options);assert.equal(disk.state.inbox[disk.accountTeam(account.id).id].find(m=>m.id==='read-proof').readAt,point==='after'?at:null);
        service.save=save;await bridge.beginRound(request);
        const restored=createService(options);assert.equal(restored.state.rounds[0].status,'running');assert.equal(restored.state.inbox[restored.accountTeam(account.id).id].find(m=>m.id==='read-proof').readAt,at);
      }finally{service.save=save;clearTimeout(service.inboxReadPersistTimer);}
    }
  });
}
