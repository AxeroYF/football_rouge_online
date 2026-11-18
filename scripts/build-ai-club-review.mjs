import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const root=process.cwd(),out=path.join(root,process.argv.find(a=>a.startsWith('--out='))?.slice(6)??'outputs/ai-clubs-20261116');fs.mkdirSync(out,{recursive:true});
const files=['data/ydl-content-overrides.json','data/ydl-player-card-studio.json','data/yellowdogs-league.json'].filter(f=>fs.existsSync(f));
const hash=f=>createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const before=Object.fromEntries(files.map(f=>[f,hash(f)]));
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'yffm-ai-club-review-'));
for(const [env,file] of [['YDL_CONTENT_OVERRIDES_PATH','ydl-content-overrides.json'],['YDL_PLAYER_CARD_STUDIO_PATH','ydl-player-card-studio.json']]){
 process.env[env]=path.join(temp,file);fs.copyFileSync(path.join(root,'data',file),process.env[env]);
}
process.env.YELLOWDOGS_LEAGUE_PATH=path.join(temp,'league.json');
process.env.VERSUS_ACCOUNTS_PATH=path.join(temp,'accounts.json');
const {REAL_PLAYERS}=await import('../versus/player-pool.js');
const {flushContentWrites}=await import('../versus/ydl-content-store.js');await flushContentWrites();
const {YellowDogsLeagueService}=await import('../versus/league-service.js');
const {planAiClub}=await import('../versus/ai-clubs.js');
const {positionFitScore}=await import('../shared/football/schema.js');
const {inferElevenBoardRoles}=await import('../versus/public/formation-rules.js');
const s=new YellowDogsLeagueService({statePath:null,now:()=>Date.parse('2026-11-16T10:00:00+08:00'),rng:()=>.37});
const clubs=s.state.teams.map(team=>{
 const detail=s.teamDetail({id:'review'},team.id);
 detail.roster=team.rosterIds.map(id=>{const p=REAL_PLAYERS.find(p=>p.id===id);return {id,name:p.name,role:p.role,secondaryRole:p.secondaryRole,grade:p.grade,overall:p.overall,club:p.club};});
 for(const scheme of detail.aiSchemes){
  const roles=inferElevenBoardRoles(scheme.starters.map(p=>({id:p.id,position:p.position})),scheme.formationLinePresets.position1);
  scheme.assignedRoles=roles;
  scheme.minimumFit=Math.min(...scheme.starters.map(p=>positionFitScore(REAL_PLAYERS.find(x=>x.id===p.id),roles[p.id])));
 }
 assert.equal(new Set(team.rosterIds).size,23);assert.equal(detail.aiSchemes.length,2);
 return detail;
});
fs.writeFileSync(path.join(out,'clubs.json'),JSON.stringify({generatedAt:new Date().toISOString(),clubs},null,2));
const json=JSON.stringify(clubs).replace(/</g,'\\u003c');
fs.writeFileSync(path.join(out,'index.html'),`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AI俱乐部 · 双战术评审</title><style>
*{box-sizing:border-box}body{margin:0;background:#071711;color:#e6f2e9;font:15px system-ui}main{max-width:1250px;margin:auto;padding:28px}h1{font-size:27px}p{color:#aac1b2}select,button{padding:10px;background:#17382b;border:1px solid #416453;color:inherit;border-radius:6px}header{display:flex;gap:12px;flex-wrap:wrap;margin:20px 0}.grid{display:grid;grid-template-columns:1fr 1fr;gap:22px}.panel{padding:18px;background:#10261c;border:1px solid #284939;border-radius:12px}.pitch{position:relative;aspect-ratio:0.85;background:repeating-linear-gradient(0deg,#163c29 0 12%,#19432e 12% 24%);border:2px solid #799b88;margin:15px 0}.pitch:before{content:'';position:absolute;inset:50% 0 auto;border-top:1px solid #799b88}.player{position:absolute;transform:translate(-50%,-50%);text-align:center;max-width:95px;font-size:11px}.player b{display:block;background:#c5ed5b;color:#182a12;border-radius:8px;padding:4px}.player small{background:#112a1d;color:#c1d6c7}table{width:100%;border-collapse:collapse;font-size:12px}td,th{text-align:left;padding:9px 4px;border-bottom:1px solid #2a4435}.added{color:#efbf73}.badge{font-size:11px;padding:3px 6px;border:1px solid #72d5bd;color:#72d5bd}li{line-height:1.8}footer{padding:20px 0;color:#aac1b2;font-size:12px}@media(max-width:760px){main{padding:14px}.grid{grid-template-columns:1fr}.player{font-size:10px;max-width:75px}}
</style><main><h1>欧洲俱乐部 AI · 名单与战术板</h1><p>${clubs.length}队 · 每队23人 · 独立球员副本 · X排除。历史与现役混编，依据游戏球员库，不代表现实某届参赛名单。</p><header><select id="club"></select><select id="scheme"><option value="0">方案1</option><option value="1">方案2</option></select><select id="phase"><option value="opening">默认</option><option value="leading">领先</option><option value="trailing">落后</option></select></header><div id="content"></div><footer>定位、职责及战术原则均来自实际运行配置。此页为审阅快照，运行中的体能、伤停和首发会随赛程变化。</footer></main><script>
const clubs=${json};const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const select=document.querySelector('#club');select.innerHTML=clubs.map((c,i)=>'<option value="'+i+'">'+esc(c.name)+'</option>').join('');
function render(){const t=clubs[+select.value],s=t.aiSchemes[+document.querySelector('#scheme').value],phase=document.querySelector('#phase').value,p=s.tacticalPlans[phase],pos=s.positionPresets[p.positionPreset],added=new Set(t.aiClub.additions.map(a=>a.playerId));
document.querySelector('#content').innerHTML='<div class="grid"><section class="panel"><h2>'+esc(t.name)+' <span class="badge">AI</span></h2><p>'+esc(t.aiClub.label)+' · '+esc(s.name)+'</p><div class="pitch">'+s.starters.map(x=>'<div class="player" style="left:'+pos[x.id].x+'%;top:'+pos[x.id].y+'%"><b>'+esc(x.name)+'</b><small>'+esc(s.assignedRoles[x.id])+' · '+x.overall+'</small></div>').join('')+'</div><p>战术原则：'+esc(p.possessionStyle)+' / '+esc(p.defensiveBlock)+' / '+esc(p.transitionStyle)+'</p><p>60分钟后：体能低于75或黄牌时优先对位换人。当前方案最低位置适配 '+Math.round(s.minimumFit*100)+'%。</p></section><section class="panel"><h2>23人大名单</h2><table><thead><tr><th>球员</th><th>位置</th><th>评级</th><th>来源</th></tr></thead><tbody>'+t.roster.map(x=>'<tr class="'+(added.has(x.id)?'added':'')+'"><td>'+esc(x.name)+'</td><td>'+esc(x.role+(x.secondaryRole?'/'+x.secondaryRole:''))+'</td><td>'+x.grade+' '+x.overall+'</td><td>'+esc(added.has(x.id)?x.club+' · 补员':'本队')+'</td></tr>').join('')+'</tbody></table><h3>补员记录</h3><ul>'+t.aiClub.additions.map(a=>'<li>'+esc(a.name+'：'+a.reason)+'</li>').join('')+'</ul></section></div>';}
document.querySelectorAll('select').forEach(x=>x.onchange=render);render();</script>`);
console.log('Review ready: '+out+` (${clubs.length} clubs, ${clubs.length*23} roster entries, ${clubs.length*2} boards)`);
if(process.argv.includes('--season')){
 const originalRosters=s.state.teams.map(t=>JSON.stringify(t.rosterIds));const records=[];
 for(const round of s.state.rounds){
  s.roundNewUnavailable=new Set();
  for(const fixture of round.fixtures){
   const record=s.simulateFixture(fixture,round.number);
   assert.ok(record.report);records.push({round:round.number,home:record.homeId,away:record.awayId,score:record.report.score});
  }
  s.state.season.currentRound=round.number;s.advanceAvailability();
  for(const [i,t] of s.state.teams.entries()){assert.equal(JSON.stringify(t.rosterIds),originalRosters[i]);assert.ok(Object.values(t.playerState).every(p=>p.fitness>=0&&p.fitness<=100));}
  console.log('Season verified round '+round.number+'/'+s.state.rounds.length);
 }
 assert.equal(records.length,s.state.rounds.reduce((n,r)=>n+r.fixtures.length,0));
 assert.ok(Object.values(s.state.playerStats).every(p=>p.isAi));
 fs.writeFileSync(path.join(out,'season-verification.json'),JSON.stringify({passed:true,matches:records.length,rounds:s.state.rounds.length,rostersStable:true,aiStatsSeparated:true,records,standings:s.standings().map(x=>({...x,name:s.state.teams.find(t=>t.id===x.id).name}))},null,2));
}
assert.deepEqual(Object.fromEntries(files.map(f=>[f,hash(f)])),before);
fs.writeFileSync(path.join(out,'source-verification.json'),JSON.stringify({liveFilesUnchanged:true,hashes:before},null,2));
