import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createBroadcastKeyPlays} from '../versus/public/broadcast-key-plays.js';

test('actual broadcast render path uses the current key-play controller on entry and polling',()=>{
  const source=fs.readFileSync(new URL('../versus/public/app.js',import.meta.url),'utf8');
  const render=source.slice(source.indexOf('function renderBroadcast(broadcast)'),source.indexOf('async function startWatching(code)'));
  const host={},toolbar={},leave={},settings={};
  let content=null,patches=0,mounts=0;
  const contentNode={className:'',querySelectorAll:()=>[],querySelector:selector=>({
    '[data-key-play-host]':host,'[data-key-play-controls]':toolbar,
    '[data-leave-broadcast]':leave,'[data-broadcast-settings]':settings,
  })[selector]??null};
  const overlay={classList:{remove(){}},querySelector:()=>content,replaceChildren:node=>{content=node;}};
  const document={querySelector:()=>overlay,createElement:()=>contentNode,addEventListener(){},hidden:false};
  const controller=createBroadcastKeyPlays({renderCard:()=>'',env:{document,localStorage:{getItem(){return null;}}}});
  // Replace only the DOM-heavy mount; keep the real public lifecycle interface.
  controller.mount=(target,value,controls)=>{assert.strictEqual(target,host);assert.strictEqual(controls,toolbar);assert.equal(value.code,'AI-START');mounts++;};
  const context=vm.createContext({document,broadcastKeyPlays:controller,
    lastBroadcastValue:null,lastBroadcastRenderFingerprint:null,broadcastHighlightTimer:null,broadcastDataTab:'overview',
    broadcastHighlights:{update:()=>({})},uiMotion:{broadcast(){}},clearTimeout(){},
    ensureBroadcastMeteorBackground(){},broadcastRenderFingerprint:value=>value.revision,
    captureEventFeedScroll:()=>null,restoreEventFeedScroll(){},broadcastScreenMarkup:()=>'<section class="broadcast-screen"></section>',
    patchHtmlChildren:(node,html)=>{assert.strictEqual(node,contentNode);assert.match(html,/broadcast-screen/);patches++;},
    closeBroadcast(){},openGameSettings(){},
  });
  vm.runInContext(render,context);
  for(const revision of ['initial','poll'])assert.doesNotThrow(()=>context.renderBroadcast({code:'AI-START',revision,match:{}}));
  assert.equal(patches,2);assert.equal(mounts,2);
  assert.equal(typeof leave.onclick,'function');assert.equal(typeof settings.onclick,'function');
});
