import test from 'node:test';
import assert from 'node:assert/strict';
import { createEnhancementSettingsController } from '../client/settings/enhancement-settings.js';
import { createCampaignStore } from '../client/core/campaign-store.js';

function fixture(storage, playerId='one') {
 const attrs={},events={},toasts=[];
 const trigger={setAttribute:(k,v)=>attrs[k]=v,addEventListener:(k,v)=>events[k]=v};
 const store=createCampaignStore({playerId,setupComplete:true});
 let changes=0;
 const settings=createEnhancementSettingsController({trigger,getState:store.getState,campaignStore:store,storage,showToast:text=>toasts.push(text),onChange:()=>changes++});
 return {trigger,attrs,events,store,settings,toasts,get changes(){return changes;}};
}
test('default protection is opt-in, persists per account, and is restored after reopening the app',()=>{
 const values=new Map(),storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};
 const f=fixture(storage);assert.equal(f.settings.isDefaultProtectionEnabled(),false);
 f.events.click();assert.equal(f.attrs['aria-checked'],'true');assert.equal(f.changes,1);
 assert.equal(fixture(storage).settings.isDefaultProtectionEnabled(),true);
 f.store.setState({playerId:'two',setupComplete:true});assert.equal(f.settings.isDefaultProtectionEnabled(),false);
 f.store.setState({playerId:'one',setupComplete:true});assert.equal(f.settings.isDefaultProtectionEnabled(),true);
 f.events.click();assert.equal(fixture(storage).settings.isDefaultProtectionEnabled(),false);
 f.store.setState(null);assert.equal(f.trigger.hidden,true);f.events.click();assert.equal(f.changes,2);
});
test('storage errors keep the previous preference and report the save failure',()=>{
 const f=fixture({getItem:()=>{throw new Error('blocked');},setItem:()=>{throw new Error('blocked');}});
 f.events.click();assert.equal(f.settings.isDefaultProtectionEnabled(),false);
 assert.equal(f.attrs['aria-checked'],'false');assert.equal(f.changes,0);assert.match(f.toasts[0],/无法保存/);
});
