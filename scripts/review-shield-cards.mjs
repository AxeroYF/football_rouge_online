// Offline visual audit using production markup, SVG layers and particle model.
// This is not a browser screenshot and never opens the game or reads saves.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {playerCardMarkup,createPlayerCardViewModel} from '../client/player-card/player-card.js';
import {createCardMotionState,advanceCardMotion,drawCardMotion} from '../client/player-card/card-motion-model.js';
import {cardFlagUrl,cardClubBadgeUrl} from '../client/player-card/card-identities.js';
const require=createRequire(import.meta.url),runtime='C:/Users/11846/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/';
const {createCanvas,loadImage,Path2D}=require(runtime+'@napi-rs/canvas'),sharp=require(runtime+'sharp');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),out=path.join(root,'outputs/card-shield-release');await fs.mkdir(out,{recursive:true});
const catalog=JSON.parse(await fs.readFile(path.join(root,'assets/data/s4-player-catalog.json'),'utf8'));
const ids=['legend-cristiano-ronaldo','s4-fc26-203376','s4-fc26-209889','s4-fc26-243952'];
const outer='M27 77 63 38 260 8 457 38 493 77V610L456 660 260 693 64 660 27 610Z';
const inner='M46 81 78 55 260 27 442 55 474 81V603L443 642 260 673 77 642 46 603Z';
const colors={s:['#edda9b','#192345','#b88a3e'],a:['#d8fff3','#15352f','#5d9c92'],b:['#f0d0b8','#3c2937','#996a56'],c:['#d0d9b8','#2c3b2d','#748069']};
const imageCache=new Map();async function image(relative){if(!imageCache.has(relative))imageCache.set(relative,await loadImage(await fs.readFile(path.join(root,relative))));return imageCache.get(relative);}
const cards=[];
for(let i=0;i<ids.length;i++){
 const source=catalog.find(p=>p.id===ids[i]),player={...source,upgradeLevel:3-i,overall:source.overall+3-i},card=createPlayerCardViewModel(player);
 const markup=playerCardMarkup(player),theme=card.grade.toLowerCase(),asset=`assets/card-frames/shield-v1/${theme}`;
 const info=markup.match(/<svg class="shield-card-information"[\s\S]*?<\/svg>/)[0].replace('<svg ','<svg xmlns="http://www.w3.org/2000/svg" ');
 cards.push({card,theme,markup,info:await loadImage(Buffer.from(info)),base:await image(asset+'-background.svg'),plate:await image(asset+'-plate.svg'),rim:await image(asset+'-frame.svg'),portrait:card.art?await image(card.art.url.replace(/^\//,'')):null,flag:await image(cardFlagUrl(card.nationality).replace(/^\//,'')),club:await image(cardClubBadgeUrl(card.club).replace(/^\//,''))});
}
function paintCard(item,state,width=520){
 const {card,theme}=item,c=createCanvas(width,Math.round(width*700/520)),ctx=c.getContext('2d');ctx.scale(width/520,width/520);
 const draw=img=>ctx.drawImage(img,0,0,520,700);draw(item.base);
 if(state){ctx.save();ctx.clip(new Path2D(inner));drawCardMotion(ctx,state);ctx.restore();}
 const art=()=>{if(!item.portrait)return;const w=520*card.art.width/100,h=w*item.portrait.height/item.portrait.width;ctx.save();ctx.clip(new Path2D(outer));ctx.shadowColor='#0007';ctx.shadowBlur=6;ctx.shadowOffsetY=5;ctx.drawImage(item.portrait,520*card.art.x/100-w/2,700*card.art.y/100-h/2,w,h);ctx.restore();};
 if(item.portrait&&card.grade!=='S')art();
 if(!item.portrait){ctx.save();ctx.globalAlpha=.48;ctx.strokeStyle=colors[theme][2];ctx.fillStyle=colors[theme][0];ctx.beginPath();ctx.arc(280,362,118,0,Math.PI*2);ctx.stroke();ctx.font='142px Georgia';ctx.textAlign='center';ctx.fillText(card.grade,280,407);ctx.restore();}
 draw(item.plate);draw(item.info);ctx.drawImage(item.flag,65,207,61,35);
 const bw=Math.min(64,79*item.club.width/item.club.height),bh=bw*item.club.height/item.club.width;ctx.drawImage(item.club,96-bw/2,267+(79-bh)/2,bw,bh);
 if(card.upgradeLevel){const [accent,ink,metal]=colors[theme];const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="520" height="700"><path d="M390 82H447L457 92V125L447 135H390L384 129V89Z" fill="${ink}" stroke="${metal}" stroke-width="4"/><text x="419" y="119" text-anchor="middle" fill="${accent}" font-family="Arial" font-weight="800" font-size="29">+${card.upgradeLevel}</text></svg>`;item.badgeSvg=svg;}
 // Badge is drawn by the caller once it is cached, exactly under legendary art.
 if(item.badge)draw(item.badge);draw(item.rim);if(card.grade==='S')art();return c;
}
for(const card of cards){paintCard(card,null);if(card.badgeSvg)card.badge=await loadImage(Buffer.from(card.badgeSvg));}
const state=createCardMotionState('meteor',9281),board=createCanvas(1600,970),ctx=board.getContext('2d');
ctx.fillStyle='#112019';ctx.fillRect(0,0,1600,970);ctx.fillStyle='#eee8d6';ctx.font='600 30px "Microsoft YaHei"';ctx.fillText('正式卡框 · 现有球员坐标',48,66);
cards.forEach((item,i)=>{const x=35+i*395;ctx.drawImage(paintCard(item,i===0?state:null,360),x,118);ctx.fillStyle=colors[item.theme][0];ctx.font='20px "Microsoft YaHei"';ctx.fillText(item.card.grade+' · '+item.card.name,x+22,650);ctx.drawImage(paintCard(item,i===0?state:null,118),x+24,696);ctx.drawImage(paintCard(item,i===0?state:null,172),x+174,688);});
ctx.fillStyle='#809886';ctx.font='13px "Microsoft YaHei"';ctx.fillText('离线组合预览：正式 SVG 文字、卡框资源、现有头像定位与粒子代码；不等同于浏览器截图。',48,943);
await fs.writeFile(path.join(out,'production-cards.png'),board.toBuffer('image/png'));await fs.writeFile(path.join(out,'production-cards.jpg'),board.toBuffer('image/jpeg',88));
const states=[createCardMotionState('meteor',137),createCardMotionState('warp',391)];
const fw=780,fh=585,count=100,delay=50,raw=Buffer.alloc(fw*fh*4*count);
for(let n=0;n<count;n++){
 const frame=createCanvas(fw,fh),g=frame.getContext('2d');g.fillStyle='#112019';g.fillRect(0,0,fw,fh);
 states.forEach((motion,i)=>{if(n)advanceCardMotion(motion,delay/1000);g.fillStyle='#cfbf8b';g.font='18px "Microsoft YaHei"';g.fillText(i?'加速星际穿梭':'斜向流星雨',30+i*390,34);g.drawImage(paintCard(cards[0],motion,350),20+i*390,61);});
 Buffer.from(g.getImageData(0,0,fw,fh).data).copy(raw,n*fw*fh*4);
}
await sharp(raw,{raw:{width:fw,height:fh*count,channels:4,pageHeight:fh}}).webp({quality:76,delay:Array(count).fill(delay),loop:0,effort:3}).toFile(path.join(out,'continuous-motion.webp'));
const contexts=['<div class="team-player-item">CARD</div>','<div class="training-seat">CARD</div>','<div class="training-card-list"><div class="training-player">CARD</div></div>','<div class="enhancement-window"><div class="enhancement-card-grid">CARD</div></div>','<div class="yoogle-full-result"><div class="team-player-detail-card">CARD</div></div>','<div class="inventory-choice-card">CARD</div>','<div class="grant-card-preview">CARD</div>'];
await fs.writeFile(path.join(out,'cascade-fixture.html'),'<!doctype html><html data-ui-theme="club"><body>'+contexts.map(context=>cards.map(p=>context.replace('CARD',p.markup)).join('')).join('')+'</body></html>');
console.log('Production card montage, continuous-motion sample and cascade fixture rendered.');
