import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {playerCardMarkup} from '../client/player-card/player-card.js';
import {CARD_CLUB_BADGES,cardFlagUrl} from '../client/player-card/card-identities.js';
const catalog=JSON.parse(fs.readFileSync(new URL('../assets/data/s4-player-catalog.json',import.meta.url),'utf8'));
test('all catalog cards render the shield, live English identity and intact profile coordinates',()=>{
 for(const p of catalog)for(const variant of ['mini','compact','standard','detail','art-only']){
  const html=playerCardMarkup(p,{variant});assert.match(html,/data-player-card-skin="shield-v1"/);assert.match(html,/shield-card-information/);
  assert.ok(html.includes(p.sourceName.replaceAll('&','&amp;').replaceAll("'",'&#039;')));
  assert.equal(html.includes('data-card-motion='),['S','X'].includes(p.grade));
  assert.equal(html.includes('data-player-card-art src='),Boolean(p.portrait));
  if(p.portrait){assert.ok(html.includes(`--profile-x:${p.portraitPosition.x}%`));assert.ok(html.includes(`--profile-y:${p.portraitPosition.y}%`));assert.ok(html.includes(`--profile-width:${p.portraitPosition.width}%`));}
  const flag=cardFlagUrl(p.nationality);assert.ok(flag,p.nationality);assert.ok(fs.existsSync(new URL('..'+flag,import.meta.url)),flag);
 }
});
test('all advertised club badges exist; unknown clubs have readable text without a broken request',()=>{
 for(const id of Object.values(CARD_CLUB_BADGES))assert.ok(fs.existsSync(new URL(`../assets/club-badges/${id}.webp`,import.meta.url)));
 const html=playerCardMarkup({id:'custom',name:'自定义',sourceName:'Custom',club:'未知俱乐部',nationality:'自定义国籍',grade:'C'});
 assert.match(html,/shield-card-club is-missing/);assert.match(html,/title="未知俱乐部"/);assert.doesNotMatch(html,/\/assets\/club-badges\/undefined/);
});
test('repeated markup stays stable and motion identity follows the independent player card',()=>{
 const p={...catalog.find(p=>p.grade==='S'),cardInstanceId:'instance-one'};
 assert.equal(playerCardMarkup(p),playerCardMarkup(p));assert.match(playerCardMarkup(p),/data-card-motion="instance-one"/);
 const next=playerCardMarkup({...p,upgradeLevel:3,effectiveOverall:98});assert.match(next,/data-card-motion="instance-one"/);assert.match(next,/>98<\/text>/);assert.match(next,/>\+3<\/span>/);
});
