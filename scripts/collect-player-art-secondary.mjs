import fs from 'node:fs';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
const out='outputs/card-art-expansion-20261116';
for(const d of ['secondary','secondary-pages','secondary-sources'])fs.mkdirSync(out+'/'+d,{recursive:true});
const norm=s=>String(s??'').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const slug=s=>s.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replaceAll('ø','o').replaceAll('ł','l').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const hash=s=>createHash('sha256').update(s).digest('hex');
const aliases={Vivian:['Dani Vivian'],Balde:['Alejandro Balde'],Ayoze:['Ayoze Perez'],'Phillip Cocu':['Philip Cocu'],'João Vieira Pinto':['Joao Pinto'],'Luigi Riva':['Gigi Riva']};
const overrides=fs.existsSync(out+'/source-overrides.json')?JSON.parse(fs.readFileSync(out+'/source-overrides.json')):{};
const audit=JSON.parse(fs.readFileSync('outputs/card-art-assessment-20261116/audit.json'));
const missing=audit.missing.filter(p=>p.grade!=='X' && (!fs.existsSync(out+'/records/'+p.id+'.json') ? process.argv.includes('--all') : !JSON.parse(fs.readFileSync(out+'/records/'+p.id+'.json')).candidates.length));
async function get(url,binary=false){const cache=out+'/secondary-pages/'+hash(url)+'.html';if(!binary&&fs.existsSync(cache))return fs.readFileSync(cache,'utf8');const r=await fetch(url,{signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('HTTP '+r.status);const value=binary?Buffer.from(await r.arrayBuffer()):await r.text();if(!binary)fs.writeFileSync(cache,value);return value;}
let cursor=0;
async function worker(){while(cursor<missing.length){const p=missing[cursor++],target=out+'/secondary/'+p.id+'.json';if(fs.existsSync(target)&&JSON.parse(fs.readFileSync(target)).candidates?.length)continue;
 const candidates=[],errors=[];let person=null;
 const names=overrides[p.id]?.secondaryNames??[p.sourceName,...(aliases[p.sourceName]??[]),...(overrides[p.id]?.aliases??[])];
 for(const name of names){const url='https://www.footylogos.com/player-pngs/'+slug(name);try{
  const html=await get(url);const graphs=[...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].flatMap(m=>JSON.parse(m[1])['@graph']??[]);
  person=graphs.find(o=>o['@type']==='Person');
  if(!person||![person.name,...(person.alternateName??[])].some(n=>names.some(a=>norm(a)===norm(n))))throw Error('Identity mismatch: '+person?.name);
  if(p.id==='s4-fc26-266866' && person.birthDate==='1993-08-17')throw Error('Different Ederson: goalkeeper, not Atalanta midfielder');
  const images=graphs.filter(o=>o['@type']==='ImageObject'&&o.contentUrl?.endsWith('.png')&&o.width?.value>=350&&o.height?.value>=500);
  images.sort((a,b)=>score(b)-score(a));
  function score(o){return (/body|cutout/i.test(o.name)?100:0)+(/2025\/26|2024\/25/.test(o.name)?25:0)+Math.min(o.height?.value??0,2000)/1000;}
  for(const img of images.slice(0,3)){const file=out+'/secondary-sources/'+p.id+'-'+hash(img.contentUrl).slice(0,8)+'.png';if(!fs.existsSync(file))fs.writeFileSync(file,await get(img.contentUrl,true));const meta=await sharp(file).metadata(),stats=await sharp(file).stats();if(!meta.hasAlpha||stats.channels.at(-1).min>=250)continue;
   candidates.push({pageUrl:url,imageUrl:img.contentUrl,title:img.name,author:'FootyLogos (source collection)',file,width:meta.width,height:meta.height,sha256:hash(fs.readFileSync(file)),identityMatch:'exact normalized JSON-LD Person name or alias',identity:person});break;
  }if(candidates.length)break;
 }catch(e){errors.push({url,error:e.message});}}
 fs.writeFileSync(target,JSON.stringify({id:p.id,name:p.name,sourceName:p.sourceName,grade:p.grade,candidates,errors},null,2));console.log(candidates.length?'SECONDARY':'UNRESOLVED',p.grade,p.name);
}}
await Promise.all(Array.from({length:4},worker));console.log('Secondary complete',missing.length);
