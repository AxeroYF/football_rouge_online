import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
import {ELITE_CLUBS} from '../shared/config/elite-clubs.mjs';
const sharp=createRequire('C:/Users/11846/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/build.cjs')('sharp');
await fs.mkdir('assets/player-packs',{recursive:true});
for(const club of ELITE_CLUBS){
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="280" height="360" viewBox="0 0 280 360"><defs><linearGradient id="body" x2="1" y2="1"><stop stop-color="#47614d"/><stop offset=".45" stop-color="#142b23"/><stop offset="1" stop-color="#07180f"/></linearGradient><linearGradient id="gold" x2="1" y2="1"><stop stop-color="#fff4c8"/><stop offset=".5" stop-color="#d0a74a"/><stop offset="1" stop-color="#6d5124"/></linearGradient></defs><path d="M36 18 L228 18 248 42 248 322 224 344 33 344 16 320 16 43Z" fill="#05130b" opacity=".4"/><path d="M34 10 H226 L244 30 V322 L225 341 H34 L20 322 V30Z" fill="url(#body)" stroke="url(#gold)" stroke-width="4"/><path d="M22 30 H243 M22 322 H243" stroke="#b59553" stroke-width="4"/><path d="M35 39 H230 V312 H35Z" fill="none" stroke="#719779" opacity=".6"/><path d="M35 70 L230 276 M35 94 L230 300" stroke="#acba90" opacity=".12" stroke-width="15"/><path d="M52 108 Q134 62 213 108 L207 225 Q136 280 58 225Z" fill="#091a14" stroke="#ad965b" stroke-width="2"/><text x="132" y="63" text-anchor="middle" fill="#f3deb0" font-family="sans-serif" font-size="15" letter-spacing="2">ELITE CLUB</text><path d="M58 278 H207 L198 306 H66Z" fill="url(#gold)"/><text x="133" y="300" text-anchor="middle" fill="#173026" font-family="sans-serif" font-size="27" font-weight="bold">+1</text></svg>`;
 const crest=await sharp('assets/club-badges/'+club.id+'.webp').resize({width:125,height:139,fit:'inside'}).toBuffer();const info=await sharp(crest).metadata();
 await sharp(Buffer.from(svg)).composite([{input:crest,left:Math.round(133-info.width/2),top:Math.round(177-info.height/2)}]).webp({quality:92}).toFile('assets/player-packs/elite-'+club.id+'.webp');
}
console.log('Built '+ELITE_CLUBS.length+' elite interception pack icons');
