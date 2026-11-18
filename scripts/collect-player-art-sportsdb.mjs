import fs from 'node:fs';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
const out='outputs/card-art-expansion-20261116';
for(const d of ['sportsdb','sportsdb-pages','sportsdb-sources'])fs.mkdirSync(out+'/'+d,{recursive:true});
const norm=s=>String(s??'').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replaceAll('ø','o').replaceAll('ł','l').replace(/[^a-z0-9]/g,'');
const hash=s=>createHash('sha256').update(s).digest('hex');
const overrides=JSON.parse(fs.readFileSync(out+'/source-overrides.json'));
const missing=JSON.parse(fs.readFileSync('outputs/card-art-assessment-20261116/audit.json')).missing.filter(p=>p.grade!=='X').filter(p=>{
 return !['records','secondary','manual'].some(d=>{const f=out+'/'+d+'/'+p.id+'.json';return fs.existsSync(f)&&JSON.parse(fs.readFileSync(f)).candidates?.some(c=>!c.edit&&!c.qualityNote);});
});
let last=0;
async function api(url){const f=out+'/sportsdb-pages/'+hash(url)+'.json';if(fs.existsSync(f))return JSON.parse(fs.readFileSync(f));for(let attempt=0;attempt<3;attempt++){await new Promise(r=>setTimeout(r,Math.max(0,6500-(Date.now()-last))));last=Date.now();const r=await fetch(url,{signal:AbortSignal.timeout(15000)});if(r.status===429){console.log('API rate limit: waiting before retry');await new Promise(r=>setTimeout(r,65000));continue;}if(!r.ok)throw Error('API '+r.status);const j=await r.json();fs.writeFileSync(f,JSON.stringify(j,null,2));return j;}throw Error('API rate limited after backoff');}
for(const p of missing){const record=out+'/sportsdb/'+p.id+'.json';if(fs.existsSync(record)&&JSON.parse(fs.readFileSync(record)).candidates?.length)continue;
 const names=[p.sourceName,...(overrides[p.id]?.aliases??[]),...({'Wim van Hanegem':['Willem van Hanegem'],'João Vieira Pinto':['Joao Pinto'],'Luigi Riva':['Gigi Riva']}[p.sourceName]??[])];
 const candidates=[],errors=[],matches=[];
 try{for(const name of names){const j=await api('https://www.thesportsdb.com/api/v1/json/123/searchplayers.php?p='+encodeURIComponent(name));const found=(j.player??[]).filter(o=>o.strSport==='Soccer'&&names.some(n=>norm(n)===norm(o.strPlayer)));
  for(const match of found){matches.push(match);const detail=(await api('https://www.thesportsdb.com/api/v1/json/123/lookupplayer.php?id='+match.idPlayer)).players?.[0];if(!detail)continue;
   for(const [type,url] of [['render',detail.strRender],['cutout',detail.strCutout]]){if(!url)continue;try{
    const file=out+'/sportsdb-sources/'+p.id+'-'+type+'.png';if(!fs.existsSync(file)){const r=await fetch(url,{signal:AbortSignal.timeout(18000)});if(!r.ok)throw Error('Image '+r.status);fs.writeFileSync(file,Buffer.from(await r.arrayBuffer()));}
    const m=await sharp(file).metadata(),s=await sharp(file).stats();if(!m.hasAlpha||s.channels.at(-1).min>=250||Math.max(m.width,m.height)<350)continue;
    candidates.push({file,pageUrl:'https://www.thesportsdb.com/player/'+detail.idPlayer,imageUrl:url,title:detail.strPlayer,author:'TheSportsDB community',width:m.width,height:m.height,sha256:hash(fs.readFileSync(file)),identityMatch:'exact normalized database player name; national/era metadata retained for visual review',identity:{name:detail.strPlayer,nationality:detail.strNationality,dateBorn:detail.dateBorn,position:detail.strPosition,status:detail.strStatus,description:detail.strDescriptionEN?.slice(0,1200)},imageType:type});break;
   }catch(e){errors.push(e.message);}}
  }if(candidates.length)break;
 }}catch(e){errors.push(e.message);}
 fs.writeFileSync(record,JSON.stringify({id:p.id,name:p.name,grade:p.grade,candidates,matches,errors},null,2));console.log(candidates.length?'SPORTSDB':'NO DB ART',p.grade,p.name,candidates[0]?.imageType??'');
}
