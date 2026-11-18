import {shieldCardContent} from './player-card-shield.js';

export const ART_GRADES = Object.freeze(['S', 'A', 'B', 'C']);
export const DEFAULT_ART_POSITION = Object.freeze({xPercent:50,yPercent:52,widthPercent:200});
export const escapeArtHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function normalizedArtPosition(value = {}) {
  const ranges={xPercent:[-50,150],yPercent:[-50,150],widthPercent:[40,360]};
  return Object.fromEntries(Object.entries(ranges).map(([key,[min,max]])=>{
    const n=Number(value[key] ?? DEFAULT_ART_POSITION[key]);
    if(!Number.isFinite(n))throw new Error('卡画定位必须为有效数字');
    return [key,Math.round(Math.max(min,Math.min(max,n))*10)/10];
  }));
}

// Both authoring surfaces use exactly the game's shield content and layer order.
export function playerArtPreviewContent(player, imageUrl, position, {imageId='',level=0}={}) {
  const p=normalizedArtPosition(position);
  return shieldCardContent({playerId:player.id??'art-preview',name:player.name??'球员',sourceName:player.sourceName??'',
    grade:player.grade??'A',overall:player.overall??player.requestedOverall??86,role:player.role??'ST',
    club:player.club??'',nationality:player.nationality??'',upgradeLevel:level,traits:[],
    art:imageUrl?{url:imageUrl,x:p.xPercent,y:p.yPercent,width:p.widthPercent}:null},
    {imageId,showArtPlaceholder:true,animated:false,eager:true},escapeArtHtml,value=>String(value).replace(/[^a-z0-9_-]/gi,''));
}

export function artPositionStyle(position) {
  const p=normalizedArtPosition(position);
  return `--profile-x:${p.xPercent}%;--profile-y:${p.yPercent}%;--profile-width:${p.widthPercent}%;`;
}

// Alpha bounds give a useful first placement; a person must still review the face/pose.
export function initialArtPosition({width,height,left,top,right,bottom}) {
  const bw=right-left,bh=bottom-top;
  if(![width,height,left,top,right,bottom].every(Number.isFinite)||width<=0||height<=0||bw<=0||bh<=0)throw new Error('图片没有可定位的人物区域');
  const targetHeight=bw/bh<.7?1.35:.9;
  const scale=targetHeight*(700/520)/bh;
  return normalizedArtPosition({widthPercent:width*scale*100,
    xPercent:58+(width/2-(left+right)/2)*scale*100,
    yPercent:13+(height/2-top)*scale/(700/520)*100});
}

export function normalizeArtBatch(payload) {
  if(!Array.isArray(payload.players)||!payload.players.length)throw new Error('批次必须包含球员列表');
  const ids=new Set();
  const players=payload.players.map(p=>{
    if(!p.id||ids.has(p.id))throw new Error('球员 ID 缺失或重复');
    ids.add(p.id);
    if(!ART_GRADES.includes(p.grade))throw new Error('仅支持 S/A/B/C 球员批次');
    const imageUrl=p.imageUrl??p.cardProfile?.imageUrl;
    if(!imageUrl||!/^(?:\/(?!\/)|https?:\/\/|blob:|data:image\/(?:png|webp);base64,)/i.test(imageUrl))throw new Error('卡画地址无效');
    return {...p,imageUrl,position:normalizedArtPosition(p.position??p.cardProfile??p)};
  });
  return players;
}
