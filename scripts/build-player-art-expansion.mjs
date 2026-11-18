import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {assessArt} from './player-art-quality.mjs';
import {initialArtPosition,playerArtPreviewContent,artPositionStyle,escapeArtHtml as esc} from '../versus/public/player-art-preview.js';
const out='outputs/card-art-expansion-20261116';
const audit=JSON.parse(fs.readFileSync(out+'/baseline-audit.json'));
const visualNotes=JSON.parse(fs.readFileSync(out+'/visual-notes.json'));
const players=JSON.parse(fs.readFileSync('outputs/card-art-assessment-20261116/effective-players.json'));
const overrides=fs.existsSync(out+'/selection-overrides.json')?JSON.parse(fs.readFileSync(out+'/selection-overrides.json')):{};
const hash=b=>createHash('sha256').update(b).digest('hex');
const batch=[],missing=[],byHash=new Map(),duplicates=[];
fs.mkdirSync(out+'/preview',{recursive:true});
const assetCache=new Map();
function inline(markup){return markup.replace(/src="([^"]+)"/g,(m,url)=>{if(!url.startsWith('/versus/'))return m;if(!assetCache.has(url)){const f='versus/public/'+url.split('?')[0].slice(8);if(!fs.existsSync(f))return m;assetCache.set(url,'data:'+(f.endsWith('.svg')?'image/svg+xml':'image/webp')+';base64,'+fs.readFileSync(f).toString('base64'));}return `src="${assetCache.get(url)}"`;});}
for(const row of audit.missing.filter(p=>p.grade!=='X')){
 const p=players.find(p=>p.id===row.id);let all=[];
 for(const dir of ['manual','records','secondary','sportsdb']){const f=out+'/'+dir+'/'+p.id+'.json';if(fs.existsSync(f))all.push(...JSON.parse(fs.readFileSync(f)).candidates.map(c=>({...c,collection:dir})));}
 all.sort((a,b)=>priority(b)-priority(a));
 function priority(c){return c.edit?10:c.qualityNote?15:c.collection==='manual'?100:c.collection==='records'?80:c.collection==='secondary'?70:60;}
 const chosen=overrides[p.id]?.file?all.find(c=>c.file===overrides[p.id].file):all[0];
 if(!chosen||overrides[p.id]?.exclude){missing.push({id:p.id,name:p.name,grade:p.grade,sourceName:p.sourceName,reason:overrides[p.id]?.reason??'No verified transparent candidate'});continue;}
 const c=chosen,original=await sharp(c.file).metadata();const previewFile=out+'/preview/'+p.id+'.webp';
 if(!fs.existsSync(previewFile)||fs.statSync(c.file).mtimeMs>fs.statSync(previewFile).mtimeMs)await sharp(c.file).resize({width:1000,height:1200,fit:'inside',withoutEnlargement:true}).webp({quality:88,alphaQuality:100}).toFile(previewFile);
 const {data,info}=await sharp(c.file).resize({width:400,height:400,fit:'inside',withoutEnlargement:true}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 let left=info.width,top=info.height,right=0,bottom=0,clear=0;
 for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++){if(data[(y*info.width+x)*4+3]>24){left=Math.min(left,x);right=Math.max(right,x+1);top=Math.min(top,y);bottom=Math.max(bottom,y+1);}else clear++;}
 if(clear<info.width*info.height*.01){missing.push({id:p.id,name:p.name,grade:p.grade,reason:'Not actually transparent'});continue;}
 const sourceMeta=c.originalFile?await sharp(c.originalFile).metadata():original;
 const reasons=[];if(c.edit)reasons.push('AI 抠图，需复核人物细节及边缘');
 if(Math.max(sourceMeta.width,sourceMeta.height)<800)reasons.push('原素材长边低于 800px');
 if(Math.min(sourceMeta.width,sourceMeta.height)<350)reasons.push('原素材短边低于 350px');
 if(c.qualityNote)reasons.push(c.qualityNote);
 const quality=c.edit||Math.max(sourceMeta.width,sourceMeta.height)<500?'Q3':Math.max(sourceMeta.width,sourceMeta.height)>=1000&&Math.min(sourceMeta.width,sourceMeta.height)>=500?'Q1':'Q2';
 let file=c.file;if(fs.statSync(file).size>11*1024*1024){file=out+'/preview/'+p.id+'-import.webp';await sharp(c.file).resize({width:1600,height:1600,fit:'inside',withoutEnlargement:true}).webp({quality:95,alphaQuality:100}).toFile(file);}
 const sha256=hash(fs.readFileSync(file));if(byHash.has(sha256))duplicates.push({id:p.id,name:p.name,sameAs:byHash.get(sha256)});byHash.set(sha256,{id:p.id,name:p.name,sourceName:p.sourceName});
 const position=initialArtPosition({width:info.width,height:info.height,left,top,right,bottom});
 batch.push({id:p.id,name:p.name,sourceName:p.sourceName,grade:p.grade,overall:p.overall,role:p.role,club:p.club,nationality:p.nationality,
 imageFile:file,imageUrl:'/versus/player_profiles/pending/'+p.id+'.png',sha256,position,
 source:{...c,width:sourceMeta.width,height:sourceMeta.height},
 quality:await assessArt({file:c.file,source:c,visualNote:visualNotes[p.id]}),previewFile});
}
fs.writeFileSync(out+'/batch.json',JSON.stringify({schemaVersion:2,frame:'shield-v1',players:batch},null,2));
fs.writeFileSync(out+'/pending.json',JSON.stringify({ready:batch.length,missing,duplicates},null,2));
const css=fs.readFileSync('versus/public/player-card-shield.css','utf8');
for(let start=0;start<batch.length;start+=40){const slice=batch.slice(start,start+40),page=Math.floor(start/40)+1;
 const cards=slice.map((p,i)=>{const url='data:image/webp;base64,'+fs.readFileSync(p.previewFile).toString('base64');return `<article><b>${start+i+1}. ${esc(p.name)} · ${p.grade} · ${p.quality.level}</b><small>${esc(p.sourceName)}</small><div class="pair"><div class="s4-player-card ydl-player-card player-card-shield player-card-static grade-${p.grade.toLowerCase()} band-base" style="${artPositionStyle(p.position)}">${inline(playerArtPreviewContent(p,url,p.position))}</div><img class="raw" src="${url}"></div><small>${esc(p.source.title)}<br>${p.quality.sourceResolution.width}×${p.quality.sourceResolution.height} · ${esc(p.source.collection)}<br>${esc(p.id)}</small></article>`;}).join('');
 fs.writeFileSync(out+`/review-${page}.html`,`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>卡画审阅 ${page}</title><style>${css}*{box-sizing:border-box}body{background:#10231d;color:#eef7ef;font:13px sans-serif;margin:20px}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:20px}article{min-width:0;border-bottom:1px solid #456;padding-bottom:12px}small{display:block;color:#a8bcb4;font-size:11px}b{display:block;margin:8px 0}.pair{display:flex;gap:5px;align-items:center}.s4-player-card{width:155px;flex:0 0 155px}.raw{width:125px;height:210px;object-fit:contain;background:#293d37}</style><h1>候选审阅 ${page} / ${Math.ceil(batch.length/40)}</h1><div class="grid">${cards}</div></html>`);
}
console.log(JSON.stringify({ready:batch.length,missing:missing.length,duplicates,pages:Math.ceil(batch.length/40)}));
