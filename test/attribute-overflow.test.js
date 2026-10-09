import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveOfflineAttributeSettings,offlineDisplayAttributeValue} from '../engine/s4-v2.1/versus/offline-attribute-settings.js';
import {v2EngineAttributeValue} from '../engine/s4-v2.1/versus/v2/match-parameters-v2.js';
import {buildV2TeamSnapshots} from '../engine/s4-v2.1/versus/v2/team-snapshot-v2.js';
import {normalizeAttributes} from '../engine/s4-v2.1/game/public/schema.js';
import {presentPlayerTraits} from '../shared/config/player-trait-presentation.mjs';
import {createPlayerCardViewModel} from '../shared/player-card/player-card-contract.js';
import {createPlayerCardInstance} from '../server/domain/player-card-instance.mjs';
import {EnhancementService} from '../server/application/enhancement-service.mjs';
import {refreshTrainingGrowth} from '../shared/football/training-growth.mjs';
import {CampaignService} from '../campaign-service.mjs';

test('online display remains uncapped; V2 keeps only 20 percent of the excess',()=>{
 assert.equal(resolveOfflineAttributeSettings({}).overflowRate,.2);
 for(const [raw,effective] of [[80,80],[99,99],[100,99.2],[109,101],[199,119]]){assert.equal(offlineDisplayAttributeValue(raw),raw);assert.equal(v2EngineAttributeValue(raw),effective);}
 assert.equal(v2EngineAttributeValue(Infinity),1);assert.equal(v2EngineAttributeValue(NaN),1);
 const p={id:'p',name:'test',role:'ST',attributes:{finishing:109,pace:80},traits:[]};
 assert.equal(normalizeAttributes(p).finishing,109);assert.equal(presentPlayerTraits(p).effectiveAttributes.finishing,109);assert.equal(createPlayerCardViewModel(p).attributes.finishing,109);
 const team={name:'A',players:[p],positions:{p:{x:50,y:20}}};
 for(let i=0;i<3;i++){const player=buildV2TeamSnapshots([team])[0].players[0];assert.equal(player.displayAttributes.finishing,109);assert.equal(player.attributes.finishing,101);assert.equal(player.attributes.pace,80);}
 assert.equal(p.attributes.finishing,109);
});
test('new enhanced cards and subsequent levels preserve raw overflow without compounding it',()=>{
 const p=createPlayerCardInstance({id:'base',name:'test',role:'ST',overall:95,attributes:{finishing:99}},3);
 assert.equal(p.attributes.finishing,102);const service=new EnhancementService({});service.applyLevel(p,4);assert.equal(p.attributes.finishing,104);service.applyLevel(p,3);assert.equal(p.attributes.finishing,102);
});
test('legacy clipped enhancements restore known base growth idempotently and survive reload',()=>{
 const p={id:'p',playerId:'p',cardInstanceId:'p',name:'test',role:'ST',overall:102,upgradeLevel:4,attributes:{finishing:99},referenceAttributes:{finishing:97}};
 refreshTrainingGrowth(p);assert.equal(p.attributes.finishing,102);refreshTrainingGrowth(p);assert.equal(p.attributes.finishing,102);
 let saved={accounts:{a:{id:'a',setupComplete:false,draft:{roster:[p]}}},world:null};const repository={load:()=>structuredClone(saved),save:v=>{saved=structuredClone(v);}};
 for(let i=0;i<2;i++){const service=new CampaignService({catalog:[],repository});assert.equal(service.accounts.get('a').draft.roster[0].attributes.finishing,102);}
});
