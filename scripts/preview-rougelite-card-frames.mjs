import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {shieldCardContent} from '../reference/rougelite-card-frames/source/client/player-card/card-shield-markup.js';
import {REAL_PLAYERS} from '../versus/player-pool.js';
import {LEGENDARY_PROFILE_BY_PLAYER_ID} from '../versus/public/legendary-profiles.js';
import {A_PLAYER_PROFILE_BY_PLAYER_ID} from '../versus/public/a-player-profiles.js';

const root=fileURLToPath(new URL('../',import.meta.url));
const reference=path.join(root,'reference/rougelite-card-frames');
const out=path.join(root,'outputs/rougelite-card-frames');
const manifest=JSON.parse(await fs.readFile(path.join(reference,'SOURCE-MANIFEST.json'),'utf8'));
for(const entry of manifest.files){
  const bytes=await fs.readFile(path.join(reference,'source',entry.path));
  const sha=createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex');
  if(sha!==entry.gitBlobSha1)throw new Error('Reference source changed: '+entry.path);
}
const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
const token=value=>String(value??'').replace(/[^a-z0-9_-]/gi,'');
const mime={'.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png'};
const embedded=new Map();
async function dataUrl(url){
  if(embedded.has(url))return embedded.get(url);
  const pathname=url.split('?')[0];
  let file;
  if(pathname.startsWith('/assets/card-frames/'))file=path.join(reference,'source',pathname.slice(1));
  else if(pathname.startsWith('/assets/flags/'))file=path.join(root,'versus/public/world-cup-flags',path.basename(pathname));
  else if(pathname.startsWith('/assets/'))file=path.join(root,'versus/public',pathname.slice(1));
  else if(pathname.startsWith('/versus/A_profile/'))file=path.join(root,'A_profile',pathname.slice('/versus/A_profile/'.length));
  else if(pathname.startsWith('/versus/legendary_profile/'))file=path.join(root,'legendary_profile',pathname.slice('/versus/legendary_profile/'.length));
  else throw new Error('Unexpected preview asset '+pathname);
  const bytes=await fs.readFile(file);
  const data='data:'+mime[path.extname(file)]+';base64,'+bytes.toString('base64');
  embedded.set(url,data);return data;
}
async function inlineImages(markup){
  for(const url of new Set([...markup.matchAll(/src="([^"]+)"/g)].map(m=>m[1])))markup=markup.replaceAll('src="'+url+'"','src="'+await dataUrl(url)+'"');
  return markup;
}
const messi=REAL_PLAYERS.find(p=>p.id==='legend-messi');
const aPlayer=REAL_PLAYERS.find(p=>p.grade==='A'&&A_PLAYER_PROFILE_BY_PLAYER_ID[p.id]&&['阿根廷','法国','葡萄牙','西班牙','英格兰','巴西','德国','荷兰','意大利','克罗地亚','比利时'].includes(p.nationality));
if(!messi||!aPlayer)throw new Error('Missing local preview players');
const samples=[
  {label:'S · 原始传奇卡',player:messi,level:0},
  {label:'A · 青绿银框',player:aPlayer,level:0},
  {label:'B · 梅紫铜框',player:REAL_PLAYERS.find(p=>p.grade==='B'&&['阿根廷','法国','葡萄牙','西班牙','英格兰','巴西','德国','荷兰','意大利','克罗地亚','比利时'].includes(p.nationality)),level:0},
  {label:'C · 松绿灰框',player:REAL_PLAYERS.find(p=>p.grade==='C'&&['阿根廷','法国','葡萄牙','西班牙','英格兰','巴西','德国','荷兰','意大利','克罗地亚','比利时'].includes(p.nationality)),level:0},
  {label:'S +9 · 独立强化边框',player:messi,level:9},
  {label:'S +10 · 独立强化边框',player:messi,level:10},
];
const cards=[];
for(const sample of samples){
  const p=sample.player;
  if(!p)throw new Error('Missing preview grade');
  const profile=LEGENDARY_PROFILE_BY_PLAYER_ID[p.id]??A_PLAYER_PROFILE_BY_PLAYER_ID[p.id];
  const card={playerId:p.id,cardInstanceId:'preview-'+p.id+'-'+sample.level,name:p.name,sourceName:p.sourceName??'',overall:p.overall,role:p.role,grade:p.grade,upgradeLevel:sample.level,traits:sample.level?['卡框示例','静态预览']:[],club:p.club,nationality:p.nationality,art:profile?{url:profile.imageUrl,x:profile.xPercent,y:profile.yPercent,width:profile.widthPercent}:null};
  // Preview only: overall stays at the source value; this does not calculate game upgrades.
  const style=card.art?`--profile-x:${card.art.x}%;--profile-y:${card.art.y}%;--profile-width:${card.art.width}%`:'';
  const content=await inlineImages(shieldCardContent(card,{animated:false,eager:true},esc,token));
  cards.push(`<article><h2>${esc(sample.label)}</h2><div class="s4-player-card ydl-player-card player-card-shield player-card-static grade-${p.grade.toLowerCase()} ${profile?'has-player-profile':''} ${sample.level>=9?'enhancement-'+sample.level:''}" style="${style}" role="img" aria-label="${esc(sample.label+' '+p.name)}">${content}</div></article>`);
}
let css=await fs.readFile(path.join(reference,'source/styles/player-card-shield.css'),'utf8');
const mask=await dataUrl('/assets/card-frames/shield-v1/enhancement-mask.svg');
css=css.replaceAll("url('../assets/card-frames/shield-v1/enhancement-mask.svg')",`url('${mask}')`);
const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>YFFM1 · Rougelite 卡框参考</title><style>
${css}
*{box-sizing:border-box}body{margin:0;background:#0c1520;color:#e9edf2;font-family:"Microsoft YaHei",sans-serif}main{max-width:1440px;margin:auto;padding:30px 32px 44px}header{margin-bottom:24px}h1{font-size:27px;margin:0 0 12px}header p{color:#a8b6c6;font-size:14px;line-height:1.7;margin:5px 0}.grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:20px}article{min-width:0}article h2{font-size:12px;color:#a8b6c6;min-height:32px;margin:0 0 8px;line-height:1.5}.s4-player-card{width:100%}.s4-player-card-upgrade{display:grid;place-items:center}footer{margin-top:28px;font-size:13px;color:#a8b6c6;line-height:1.8}@media(max-width:1000px){.grid{grid-template-columns:repeat(3,minmax(0,1fr))}}@media(max-width:540px){main{padding:22px 16px}.grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}h1{font-size:22px}}
</style><main><header><h1>Rougelite 盾形卡框 · YFFM1 接入参考</h1><p>原仓库 codex/rougelite · shield-v1 · 提交 ${manifest.commit.slice(0,7)}</p><p>使用原始 SVG、原卡面生成函数及盾形 CSS；人物来自本地 YFFM1。本页为原始卡框的独立参考预览；正式游戏已通过本地适配层接入盾形卡框。</p></header><section class="grid">${cards.join('')}</section><footer>+9/+10 仅示范边框，显示总评沿用原始球员数据；特性文字为演示占位。此页沿用原始图层与本地人物坐标，不含正式游戏已加入的信息层保护。预览无网络请求、粒子画布或循环动画。</footer></main></html>`;
await fs.mkdir(out,{recursive:true});
await fs.writeFile(path.join(out,'index.html'),html);
await fs.writeFile(path.join(out,'preview-manifest.json'),JSON.stringify({sourceCommit:manifest.commit,verifiedFiles:manifest.files.length,samples:samples.map(s=>({playerId:s.player.id,grade:s.player.grade,previewUpgradeLevel:s.level})),embeddedAssets:embedded.size,htmlBytes:Buffer.byteLength(html),note:'Static reference, no live gameplay changes or upgraded-overall calculation.'},null,2));
console.log(JSON.stringify({file:path.join(out,'index.html'),cards:cards.length,embeddedAssets:embedded.size,verifiedSourceFiles:manifest.files.length}));
