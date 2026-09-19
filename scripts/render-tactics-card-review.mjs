// Native-canvas composition of the production card layers at pitch scale.
// This is an offline visual audit, not a browser layout screenshot.
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createPlayerCardViewModel} from '../client/player-card/player-card.js';
import {cardFlagUrl,cardClubBadgeUrl} from '../client/player-card/card-identities.js';
const require=createRequire(import.meta.url);
const {createCanvas,loadImage,Path2D}=require('C:/Users/11846/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@napi-rs/canvas');
const dir='outputs/tactics-card-review',cards=JSON.parse(await fs.readFile(`${dir}/cards.json`,'utf8'));
const catalog=JSON.parse(await fs.readFile('assets/data/s4-player-catalog.json','utf8'));
const cache=new Map();async function image(url){if(!cache.has(url))cache.set(url,await loadImage(await fs.readFile(url.replace(/^\//,''))));return cache.get(url);}
const canvas=createCanvas(860,1220),ctx=canvas.getContext('2d');ctx.fillStyle='#141e18';ctx.fillRect(0,0,860,1220);
ctx.fillStyle='#eee8d6';ctx.font='700 23px Microsoft YaHei';ctx.fillText('场上球员 · 静态盾形卡',40,48);
ctx.fillStyle='#24312a';ctx.fillRect(613,19,188,40);ctx.fillStyle='#b8c3b5';ctx.font='700 14px Microsoft YaHei';ctx.fillText('磁贴',630,46);ctx.fillStyle='#d4b365';ctx.fillRect(686,22,112,34);ctx.fillStyle='#141b16';ctx.fillText('球员卡',720,46);
const x0=40,y0=91,w=780,h=1026;
for(let i=0;i<8;i++){ctx.fillStyle=i%2?'#315637':'#2b4a30';ctx.fillRect(x0+i*w/8,y0,w/8,h);}
ctx.strokeStyle='#aaab97';ctx.lineWidth=2;ctx.strokeRect(x0+20,y0+20,w-40,h-40);ctx.beginPath();ctx.moveTo(x0+20,y0+h/2);ctx.lineTo(x0+w-20,y0+h/2);ctx.stroke();ctx.beginPath();ctx.arc(x0+w/2,y0+h/2,72,0,Math.PI*2);ctx.stroke();for(const bottom of [false,true])ctx.strokeRect(x0+w*.34,bottom?y0+h-159:y0+20,w*.32,139);
const positions=[[50,90],[16,70],[39,70],[61,70],[84,70],[26,48],[50,48],[74,48],[24,22],[50,18],[76,22]];
let index=0;
for(const [id,markup] of Object.entries(cards)){
 const p=catalog.find(p=>p.id===id),card=createPlayerCardViewModel({...p,upgradeLevel:p.grade==='S'?4:1}),theme=card.grade==='X'?'s':card.grade.toLowerCase();
 const [px,py]=positions[index++],cw=Math.max(72,Math.min(110,w*.135)),ch=cw*700/520,c=createCanvas(520,700),g=c.getContext('2d');
 const draw=async(suffix)=>g.drawImage(await image(`/assets/card-frames/shield-v1/${theme}-${suffix}.svg`),0,0,520,700);
 const portrait=card.art?await image(card.art.url):null;
 const art=()=>{if(!portrait)return;const aw=520*card.art.width/100,ah=aw*portrait.height/portrait.width;g.save();g.clip(new Path2D('M27 77 63 38 260 8 457 38 493 77V610L456 660 260 693 64 660 27 610Z'));g.drawImage(portrait,520*card.art.x/100-aw/2,700*card.art.y/100-ah/2,aw,ah);g.restore();};
 await draw('background');if(!['S','X'].includes(card.grade))art();if(!portrait){g.fillStyle='#d0d9b87a';g.font='142px Georgia';g.textAlign='center';g.fillText(card.grade,280,407);}
 await draw('plate');const info=markup.match(/<svg class="shield-card-information"[\s\S]*?<\/svg>/)[0].replace('<svg ','<svg xmlns="http://www.w3.org/2000/svg" ');g.drawImage(await loadImage(Buffer.from(info)),0,0,520,700);
 const flag=cardFlagUrl(card.nationality);if(flag)g.drawImage(await image(flag),65,207,61,35);
 const club=cardClubBadgeUrl(card.club);if(club){const badge=await image(club),bw=Math.min(64,79*badge.width/badge.height),bh=bw*badge.height/badge.width;g.drawImage(badge,96-bw/2,267+(79-bh)/2,bw,bh);}
 g.fillStyle='#192345';g.fillRect(384,82,72,53);g.strokeStyle='#b88a3e';g.lineWidth=3;g.strokeRect(384,82,72,53);g.fillStyle='#edda9b';g.font='700 29px Arial';g.textAlign='center';g.fillText('+'+card.upgradeLevel,420,120);await draw('frame');if(['S','X'].includes(card.grade))art();
 const x=x0+w*px/100-cw/2,y=y0+h*py/100-ch/2;ctx.drawImage(c,x,y,cw,ch);
 ctx.fillStyle='#0b1712';ctx.fillRect(x+cw*.22,y-14,cw*.56,15);ctx.fillStyle='#d4e7cc';ctx.font='10px Arial';ctx.textAlign='center';ctx.fillText(card.role,x+cw/2,y-3);
 ctx.fillStyle='#55df8b';ctx.fillRect(x+cw*.09,y+ch+1,cw*.82,3);ctx.fillStyle='#0b1712';ctx.fillRect(x+(cw-96)/2,y+ch+10,96,22);ctx.strokeStyle='#b7a067';ctx.lineWidth=1;ctx.strokeRect(x+(cw-96)/2,y+ch+10,96,22);ctx.fillStyle='#f1efe1';ctx.font='11px Microsoft YaHei';ctx.fillText(card.role==='GK'?'门线门将':'◀  默认职责  ▶',x+cw/2,y+ch+25);
}
ctx.textAlign='left';ctx.fillStyle='#829787';ctx.font='13px Microsoft YaHei';ctx.fillText('离线排布检查：真实卡框、卡画与模板；非浏览器截图。',40,1180);
await fs.writeFile(`${dir}/pitch-cards.jpg`,canvas.toBuffer('image/jpeg',90));console.log('Static field-card composition rendered.');
