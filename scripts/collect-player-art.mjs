import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {CARD_CLUB_BADGES} from '../versus/public/card-identities.js';

const option=(key,fallback)=>process.argv.find(a=>a.startsWith(key+'='))?.slice(key.length+1)??fallback;
const out=option('--out','outputs/card-art-expansion-20261116');
const grades=option('--grades','A').split(',');
const missing=JSON.parse(fs.readFileSync('outputs/card-art-assessment-20261116/audit.json')).missing.filter(p=>grades.includes(p.grade)&&p.grade!=='X').filter(p=>!process.argv.includes('--unresolved-only')||!['secondary','manual'].some(d=>{const f=out+'/'+d+'/'+p.id+'.json';return fs.existsSync(f)&&JSON.parse(fs.readFileSync(f)).candidates?.length;}));
for(const d of ['pages','sources','records'])fs.mkdirSync(path.join(out,d),{recursive:true});
const overrides=fs.existsSync(out+'/source-overrides.json')?JSON.parse(fs.readFileSync(out+'/source-overrides.json')):{};
const aliases={Vivian:['Dani Vivian','Daniel Vivian'],Ayoze:['Ayoze Perez'],'Paco Buyo':['Francisco Buyo','Buyo'],'Phillip Cocu':['Phillip Cocu','Philip Cocu'],
 'João Vieira Pinto':['Joao Pinto'],'Luigi Riva':['Gigi Riva'],'Canário':['Canario','Darcy Silveira dos Santos']};
const norm=s=>String(s??'').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const decode=s=>s.replaceAll('&amp;','&').replaceAll('&#039;',"'").replaceAll('&quot;','"').replaceAll('&nbsp;',' ');
const hash=s=>createHash('sha256').update(s).digest('hex');
const pagePath=url=>path.join(out,'pages',hash(url)+'.html');
async function get(url,binary=false){
 const cache=pagePath(url);if(!binary&&fs.existsSync(cache))return fs.readFileSync(cache,'utf8');
 for(let attempt=0;attempt<2;attempt++){
  try{const r=await fetch(url,{signal:AbortSignal.timeout(25000),headers:{'User-Agent':'Mozilla/5.0 (compatible; personal football artwork research)'}});if(!r.ok)throw Error('HTTP '+r.status);const data=binary?Buffer.from(await r.arrayBuffer()):await r.text();if(!binary)fs.writeFileSync(cache,data);return data;}
  catch(e){if(attempt===1||/HTTP 40[034]/.test(e.message))throw e;await new Promise(r=>setTimeout(r,1000));}
 }
}
function linksFrom(html){return [...html.matchAll(/<div class="renderDetails">\s*<a href="([^"]+)"[\s\S]*?<h3[^>]*>([^<]+)<\/h3>/g)].map(m=>({url:decode(m[1]),title:decode(m[2])}));}
const pathsFor=(p,name)=>[...new Set([name,name.split(/\s+/).at(-1)])].map(q=>'https://www.footyrenders.com/?s='+encodeURIComponent(q));
async function collect(p){
 const recordFile=path.join(out,'records',p.id+'.json');
 if(fs.existsSync(recordFile)&&!process.argv.includes('--retry')){const existing=JSON.parse(fs.readFileSync(recordFile));if(existing.candidates?.length){console.log('CACHED',p.grade,p.name);return;}}
 const names=[p.sourceName,...(aliases[p.sourceName]??[]),...(overrides[p.id]?.aliases??[])];
 const canonical=names.map(norm).filter(Boolean);let found=[];const searches=[];
 try{
  if(overrides[p.id]?.pages)found=overrides[p.id].pages.map(url=>({url,title:p.sourceName,explicit:true}));
  for(const name of names){if(found.length>=2)break;for(const url of pathsFor(p,name)){if(found.length>=2)break;searches.push(url);const html=await get(url);const links=linksFrom(html);found.push(...links.filter(l=>canonical.includes(norm(l.title))));}}
  found=[...new Map(found.map(l=>[l.url,l])).values()];
  const club=CARD_CLUB_BADGES[p.club];
  found.sort((a,b)=>score(b)-score(a));
  function score(l){return (club&&l.url.includes('/'+club+'/')?20:0)+(l.explicit?100:0)-(/\/awards\/|\/managers\/|the-best|ballon-dor/.test(l.url)?50:0);}
  const candidates=[];const rejected=[];
  for(const l of found.slice(0,6)){
   if(score(l)<0)continue;
   try{
    const html=await get(l.url),imageUrl=decode(html.match(/href="([^"]+\.png)" id="renderDL"/)?.[1]??'');if(!imageUrl)continue;
    const file=path.join(out,'sources',p.id+'-'+hash(imageUrl).slice(0,8)+'.png');if(!fs.existsSync(file))fs.writeFileSync(file,await get(imageUrl,true));
    const m=await sharp(file).metadata();if(!m.hasAlpha||Math.max(m.width,m.height)<500){rejected.push({url:l.url,reason:'not transparent or too small'});continue;}
    const stats=await sharp(file).stats();if(stats.channels.at(-1).min>=250){rejected.push({url:l.url,reason:'opaque alpha'});continue;}
    candidates.push({pageUrl:l.url,imageUrl,title:l.title,author:html.match(/<span class="renderAuthor">Cut by:&nbsp;([^<]+)/)?.[1]??null,file,width:m.width,height:m.height,sha256:hash(fs.readFileSync(file)),identityMatch:l.explicit?'reviewed override':'exact normalized source name or alias'});
    if(candidates.length>=Number(option('--candidates',p.grade==='A'?'2':'1')))break;
   }catch(e){rejected.push({url:l.url,reason:e.message});}
  }
  fs.writeFileSync(recordFile,JSON.stringify({id:p.id,name:p.name,sourceName:p.sourceName,grade:p.grade,club:p.club,nationality:p.nationality,searches,matchedLinks:found,candidates,rejected},null,2));
  console.log(candidates.length?'FOUND':'MISSING',p.grade,p.name,candidates.length);
 }catch(e){fs.writeFileSync(recordFile,JSON.stringify({id:p.id,name:p.name,sourceName:p.sourceName,grade:p.grade,searches,candidates:[],error:e.message},null,2));console.log('ERROR',p.grade,p.name,e.message);}
}
let cursor=0;async function worker(){while(cursor<missing.length){const p=missing[cursor++];await collect(p);}}
await Promise.all(Array.from({length:Number(option('--workers','3'))},worker));
const records=fs.readdirSync(out+'/records').filter(f=>f.endsWith('.json')).map(f=>JSON.parse(fs.readFileSync(out+'/records/'+f)));
fs.writeFileSync(out+'/candidates.json',JSON.stringify(records,null,2));
console.log(JSON.stringify({requested:missing.length,grades,found:records.filter(p=>grades.includes(p.grade)&&p.candidates.length).length,missing:records.filter(p=>grades.includes(p.grade)&&!p.candidates.length).map(p=>({id:p.id,name:p.name,sourceName:p.sourceName}))}));
