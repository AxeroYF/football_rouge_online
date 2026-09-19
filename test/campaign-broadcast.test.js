import assert from "node:assert/strict";
import test from "node:test";
import { CAMPAIGN_LIVE_POLL_MS, campaignPlaybackTickMs, broadcastMagnet, combinedPitchMarkup } from "../campaign-broadcast.js";

test("campaign television uses a fixed S4-style server snapshot cadence", () => {
  assert.equal(CAMPAIGN_LIVE_POLL_MS,1000);
  for (const eventCount of [0,24,80,180,360]) {
    assert.equal(campaignPlaybackTickMs(eventCount),CAMPAIGN_LIVE_POLL_MS);
  }
});


const legend = {id:'same-player',name:'C罗',role:'ST',grade:'S',overall:99,upgradeLevel:4,active:true,fitness:73,rating:8.2,
  card:{playerId:'same-player',sourceName:'Cristiano Ronaldo',club:'皇家马德里',nationality:'葡萄牙',art:{url:'/assets/portrait.webp',x:58.1,y:52.9,width:188}}};

test('live shields render snapshot art and retain match statistics without card animations', () => {
  const html = broadcastMagnet({...legend,captain:true,matchStats:{goals:2,assists:1,yellowCards:1}});
  assert.match(html,/broadcast-shield-card/);assert.match(html,/player-card-static/);assert.match(html,/src="\/assets\/portrait.webp"/);
  assert.match(html,/--profile-x:58.1%/);assert.match(html,/Cristiano Ronaldo/);assert.match(html,/>\+4<\/span>/);
  for(const token of ['league-captain-badge','status-goal','status-assist','status-yellow','体力 73','评分 8.2'])assert.ok(html.includes(token),token);
  assert.doesNotMatch(html,/<canvas|data-card-motion=|shield-card-sheen/);
  const unavailable=broadcastMagnet({...legend,active:false,sentOff:true,injury:true});
  assert.match(unavailable,/inactive unavailable/);assert.match(unavailable,/status-red/);assert.match(unavailable,/status-injury/);
  const plain=broadcastMagnet({id:'no-art',name:'基础球员',role:'GK',grade:'C',overall:70,active:true});
  assert.match(plain,/shield-card-emblem/);assert.doesNotMatch(plain,/data-player-card-art src=/);
});

test('both sides keep their mirrored coordinates and only eligible match players appear', () => {
  const teams=[0,1].map(side=>({name:'球队'+side,formation:'4-3-3',players:[{...legend,position:{x:20,y:20}},
    {...legend,id:'sent-off',active:false,sentOff:true},{...legend,id:'unused-bench',active:false}]}));
  const html=combinedPitchMarkup(teams);
  assert.equal((html.match(/data-broadcast-card-key=/g)||[]).length,4);
  assert.match(html,/broadcast-side-0/);assert.match(html,/broadcast-side-1/);
  assert.match(html,/left:20%;top:60%/);assert.match(html,/left:80%;top:40%/);assert.doesNotMatch(html,/unused-bench/);
});

import {broadcastCardFace,captureBroadcastCardFaces,restoreBroadcastCardFaces} from '../client/player-card/broadcast-card.js';
function face(player){const html=broadcastCardFace(player);return {dataset:{broadcastCardKey:html.match(/data-broadcast-card-key="([^"]+)"/)[1],broadcastCardSignature:html.match(/data-broadcast-card-signature="([^"]+)"/)[1]},replaceWith(old){this.reused=old;}};}
test('one-second snapshots reuse static faces, isolate both teams and replace changed artwork',()=>{
  const old=[face({...legend,broadcastTeamIndex:0}),face({...legend,broadcastTeamIndex:1})];
  const captured=captureBroadcastCardFaces({querySelectorAll:()=>old});assert.equal(captured.size,2);
  const next=[face({...legend,broadcastTeamIndex:0,fitness:52,rating:9.2}),face({...legend,broadcastTeamIndex:1,fitness:44,captain:true})];
  restoreBroadcastCardFaces({querySelectorAll:()=>next},captured);assert.equal(next[0].reused,old[0]);assert.equal(next[1].reused,old[1]);
  const changed=face({...legend,broadcastTeamIndex:0,card:{...legend.card,art:{...legend.card.art,url:'/new-portrait.webp'}}});
  restoreBroadcastCardFaces({querySelectorAll:()=>[changed]},captured);assert.equal(changed.reused,undefined);
});
