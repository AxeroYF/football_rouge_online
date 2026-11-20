import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {shieldCardContent} from '../versus/public/player-card-shield.js';
import {cardFlagUrl,cardClubBadgeUrl} from '../versus/public/card-identities.js';
import {REAL_PLAYER_BY_ID} from '../versus/player-pool.js';
import {A_PLAYER_PROFILE_BY_PLAYER_ID} from '../versus/public/a-player-profiles.js';
import {LEGENDARY_PROFILE_BY_PLAYER_ID} from '../versus/public/legendary-profiles.js';
import {createBroadcastSummary} from '../versus/v4-host/broadcast-summary.js';
import {spectatorCardPlayer} from '../versus/public/spirit-form.js';
import {demoInput} from '../versus/v4/fixtures.js';

const root = new URL('../', import.meta.url);
const esc = value => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
const token = value => String(value ?? '').replace(/[^a-z0-9_-]/gi,'');
const sample = {playerId:'fixture-player',cardInstanceId:'fixture-card',name:'球员',sourceName:'Player',grade:'S',role:'ST',overall:93,upgradeLevel:0,traits:[],club:'皇家马德里',nationality:'阿根廷',art:null};
const app = fs.readFileSync(new URL('versus/public/app.js',root),'utf8');
const rendererSource = app.match(/function s4PlayerCardMarkup\(player, options = \{\}\) \{[\s\S]*?\n\}/)?.[0];
const profile = player => player.fixtureProfile ?? null;
const render = new Function('shieldCardContent','legendaryProfileForPlayer','aPlayerProfileForPlayer','xPlayerProfileForPlayer','s4UpgradeBand','ROLE_LABELS','escapeHtml',rendererSource+';return s4PlayerCardMarkup;')(shieldCardContent,profile,profile,profile,level=>level>=8?'max':level>=5?'high':level>=1?'mid':'base',{ST:'前锋'},esc);

test('shield SVG layers are the pinned original Rougelite assets',()=>{
  const manifest = JSON.parse(fs.readFileSync(new URL('reference/rougelite-card-frames/SOURCE-MANIFEST.json',root)));
  const assets = manifest.files.filter(item=>item.path.startsWith('assets/card-frames/shield-v1/')&&item.path.endsWith('.svg'));
  assert.equal(assets.length,16);
  for(const asset of assets){
    const bytes=fs.readFileSync(new URL('versus/public/'+asset.path,root));
    assert.equal(bytes.length,asset.bytes,asset.path);
    assert.equal(createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex'),asset.gitBlobSha1,asset.path);
  }
});

for(const [grade,theme] of [['S','s'],['X','s'],['A','a'],['B','b'],['C','c']]){
  test(grade+' uses its original shield theme, with no canvas or continuous card animation',()=>{
    const html=shieldCardContent({...sample,grade},{animated:false},esc,token);
    for(const layer of ['background','plate','frame']) assert.ok(html.includes(`/versus/assets/card-frames/shield-v1/${theme}-${layer}.svg`));
    assert.doesNotMatch(html,/<canvas|shield-card-sheen|shield-card-enhancement-gloss/);
    assert.match(html,new RegExp('>'+grade+'</text>'));
  });
}

test('card instance stats, actions, traits and awards survive the renderer change',()=>{
  const player={id:'same-player',name:'同名球员',grade:'X',role:'ST',overall:80,effectiveOverall:82,club:'测试俱乐部',nationality:'测试国家'};
  const card={id:'instance-two',upgradeLevel:8,effectiveOverall:97,ballonDorWins:7,traits:[{name:'组织核心'},'精准射门']};
  const before=structuredClone({player,card});
  const html=render(player,{card,attributes:'draggable="true" data-enhancement-card="instance-two" disabled',className:'honor-history-card'});
  assert.match(html,/data-player-card-skin="shield-v1"/);
  assert.match(html,/data-player-card-id="same-player"/);
  assert.match(html,/draggable="true" data-enhancement-card="instance-two" disabled/);
  assert.match(html,/>97<\/text>/); assert.match(html,/>\+8<\/span>/);
  assert.match(html,/组织核心/); assert.match(html,/精准射门/);
  assert.match(html,/7次赛季金球奖/); assert.equal((html.match(/<i aria-hidden="true">/g)??[]).length,5); assert.match(html,/>\+2<\/b>/);
  assert.match(html,/honor-history-card/); assert.match(html,/测试俱乐部 \/ 测试国家/);
  assert.deepEqual({player,card},before);
});

test('local portrait profile and loading preference reach the shield without promoting every image',()=>{
  const player={...sample,id:'portrait',cardProfile:{imageUrl:'/versus/assets/portrait.webp',xPercent:52.5,yPercent:46,widthPercent:174}};
  const lazy=render(player,{lazyImage:true});
  assert.match(lazy,/--profile-x:52.5%;--profile-y:46%;--profile-width:174%/);
  assert.match(lazy,/data-player-card-art src="\/versus\/assets\/portrait.webp"[^>]*loading="lazy"/);
  assert.doesNotMatch(lazy,/fetchpriority="high"|<canvas/);
  assert.match(render(player),/data-player-card-art[^>]*loading="eager"/);
});

test('直播从球员 ID 恢复已有卡画，双方、替补及请神卡使用对应的手调定位',async t=>{
  const input=demoInput();
  const id='s4-fc26-201024',owner=REAL_PLAYER_BY_ID[id];
  const previous=owner.cardProfile;
  t.after(()=>{if(previous)owner.cardProfile=previous;else delete owner.cardProfile;});
  const profile={imageUrl:'/versus/player_profiles/webp/fixture.webp?v=2',xPercent:40.2,yPercent:93,widthPercent:108};
  owner.cardProfile={...profile,sourceFileName:'studio-source.png'};
  Object.assign(input.teams[0].players[0],{id,grade:'B'});
  input.teams[1].bench=[{...input.teams[1].players[1],id,grade:'B'}];
  const oldId=Object.keys(A_PLAYER_PROFILE_BY_PLAYER_ID).find(key=>!REAL_PLAYER_BY_ID[key]?.cardProfile);
  Object.assign(input.teams[1].players[0],{id:oldId,grade:'C'});
  const legendId=Object.keys(LEGENDARY_PROFILE_BY_PLAYER_ID).find(key=>!REAL_PLAYER_BY_ID[key]?.cardProfile);
  input.teams[1].players[1].spiritForm={id:legendId,name:'请神形态',role:'ST'};
  input.teams[1].players[1].cardProfile=profile;
  const summary=createBroadcastSummary(input);
  const read=async()=> (await summary(null,{segments:[]})).match.teams;
  const teams=await read();
  for(const player of [teams[0].players[0],teams[1].players.at(-1)]){
    assert.deepEqual(player.cardProfile,profile);
    const html=render(player);
    assert.match(html,/data-player-card-art src="\/versus\/player_profiles\/webp\/fixture.webp\?v=2"/);
    assert.match(html,/--profile-x:40.2%;--profile-y:93%;--profile-width:108%/);
  }
  const spirit=spectatorCardPlayer(teams[1].players[1]);
  assert.equal(spirit.id,legendId);
  assert.equal(spirit.cardProfile.imageUrl,LEGENDARY_PROFILE_BY_PLAYER_ID[legendId].imageUrl);
  assert.equal(teams[1].players[0].cardProfile.imageUrl,A_PLAYER_PROFILE_BY_PLAYER_ID[oldId].imageUrl);
  assert.equal(teams[1].players[0].grade,'C');
  owner.cardProfile={...profile,xPercent:45};
  assert.equal((await read())[0].players[0].cardProfile.xPercent,45);
  assert.equal(input.teams[0].players[0].cardProfile,undefined);
});

test('unknown identities fall back to text; all resolved URLs point at existing local assets',()=>{
  assert.equal(cardFlagUrl('不存在的国家'),null); assert.equal(cardClubBadgeUrl('不存在的俱乐部'),null);
  for(const url of [cardFlagUrl('阿根廷'),cardClubBadgeUrl('皇家马德里')]){
    assert.ok(url?.startsWith('/versus/')); assert.ok(fs.existsSync(new URL('versus/public/'+url.slice('/versus/'.length),root)));
  }
  const html=shieldCardContent({...sample,club:'不存在的俱乐部',nationality:'不存在的国家'},{animated:false},esc,token);
  assert.match(html,/shield-card-flag is-missing/); assert.match(html,/shield-card-club is-missing/);
});

test('player-controlled names and traits remain escaped in SVG, attributes and labels',()=>{
  const html=render({...sample,id:'evil"',name:'<img onerror="bad()">',club:'<club>',nationality:'"country"'},{traits:['<script>bad()</script>']});
  assert.doesNotMatch(html,/<script>|<img onerror=|data-player-card-id="evil""/);
  assert.match(html,/&lt;img onerror=&quot;bad\(\)&quot;&gt;/);
  assert.match(html,/&lt;script&gt;bad\(\)&lt;\/script&gt;/);
});

test('new stylesheet is loaded after opening and legacy card styles, preserving shield proportions',()=>{
  const index=fs.readFileSync(new URL('versus/public/index.html',root),'utf8');
  assert.ok(index.indexOf('/versus/player-card-shield.css')>index.indexOf('/versus/pack-opening.css'));
  const css=fs.readFileSync(new URL('versus/public/player-card-shield.css',root),'utf8');
  assert.match(css,/aspect-ratio:26\/35!important/); assert.match(css,/border-radius:0!important/);
  for(const color of ['#edda9b','#0c625b','#513650','#354f3e'])assert.ok(css.includes(color));
  assert.match(css,/shield-card-plate\{z-index:9\}/); assert.match(css,/shield-card-information\{z-index:10\}/);
  assert.match(css,/\.player-card-shield:is\(\.grade-s,\.grade-x\) \.shield-card-portrait\{z-index:8;clip-path:none\}/);
  assert.match(css,/\.player-card-shield:not\(:is\(\.grade-s,\.grade-x\)\) \.shield-card-plate\{z-index:9\}/);
});
