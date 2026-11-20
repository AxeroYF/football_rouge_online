import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {YellowDogsLeagueService} from '../versus/league-service.js';
import {CLUB_BADGES,COUNTRY_BADGES} from '../versus/cosmetic-items.js';
import {computeSummary, computePlayerLeaderboards, computeHeadToHead,computePlayerCareer,computeHonorsAndRecords,filterMatches} from '../versus/public/club-history-core.js';

const midnight = Date.parse('2026-11-20T00:00:00+08:00');
const account = {id:'history-owner',nickname:'队史验证'};
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'club-history-test-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const options = {statePath:path.join(dir,'league-state'),backupDir:null,now:()=>midnight+5000,rng:()=>.37};
  const reopen = () => new YellowDogsLeagueService(options);
  const service = reopen();
  service.beginDraft(account,'本队');
  service.autoDraft(account);
  service.finishDraft(account);
  const team = service.accountTeam(account.id), rival = service.state.teams.find(t=>t.id!==team.id);
  Object.assign(team,{joinedAt:midnight-50_000,division:'B'});
  rival.name='对手';
  const match = (id,at,score=[2,1]) => ({id,playedAt:at,round:1,competition:'league',division:'B',homeId:team.id,
    awayId:rival.id,homeName:team.name,awayName:rival.name,score,report:{keyPlays:[{eventId:'g',frames:[{},{}]}],
      dotReplay:{frames:[{}]},teams:[{players:[{id:'striker',name:'前锋',role:'ST',rating:8,startedMatch:true,
        stats:{goals:2,assists:0,saves:0}}]},{players:[]}]}});
  return {service,team,rival,match,reopen,dir,options};
}

test('队史按身份、赛季与赛事汇总，接管前比赛、重放结算均不重复入账',t=>{
  const {service,team,rival,match}=fixture(t), state=service.state;
  state.matches.push(match('ai-before-join',midnight-60_000));
  const old=match('old',midnight-1);
  state.matches.push(old);
  state.season.status='completed';
  service.archiveSeason('completed');
  state.season={...state.season,id:'second',name:'S2',status:'active'};
  team.division='A'; rival.name='对手新名称'; team.rosterIds=[];
  const cup={...match('cup',midnight,[1,1]),competition:'cup',cupStage:'final',penalties:[4,3]};
  const missing={...match('friendly',midnight+1),competition:'friendly',report:null};
  state.matches=[cup,cup,missing];
  let data=service.clubHistoryView(account);
  const official=filterMatches(data.matches), summary=computeSummary(official);
  assert.deepEqual([summary.total,summary.wins,summary.draws,summary.winRate],[2,1,1,'50.0%']);
  assert.equal(data.matches.find(m=>m.id==='cup').penalties.label,'点球 4 : 3');
  assert.equal(filterMatches(data.matches,{competition:'league_B'}).length,1);
  assert.equal(data.matches.find(m=>m.id==='friendly').hasPlayerDetails,false);
  const rivals=computeHeadToHead(official,data.opponents);
  assert.equal(rivals.length,1); assert.ok(rivals[0].opponent.previousNames.includes('对手'));
  const scorer=computePlayerLeaderboards(official,data.players)[0];
  assert.deepEqual([scorer.goals,scorer.appearances,scorer.player.status],[4,2,'departed']);
  assert.equal(computePlayerCareer(official,data.seasons,scorer.player).seasonRows.length,2);
  assert.equal(computeHonorsAndRecords(data.seasons,official).longestUnbeatenStreak.count,2);
  team.rosterIds.push('striker');
  data=service.clubHistoryView(account);
  assert.equal(data.players.find(p=>p.id==='striker').status,'active');
});

test('队史随玩家换徽更新；席位更换主人后按身份取归档队徽，旧 AI 记录按队名恢复',t=>{
  const {service,rival,match}=fixture(t), other={id:'badge-rival'};
  service.equipCosmetic(account,CLUB_BADGES[0].id,'clubBadge',{compact:true});
  Object.assign(rival,{ownerId:other.id,joinedAt:midnight-20});
  // Use equipment IDs as stored in a season save, independently of draft assets.
  service.state.s4Assets.cosmetics.equipped[other.id]={teamBadge:COUNTRY_BADGES[0].id,clubBadge:CLUB_BADGES[1].id};
  service.state.matches=[{...match('before-takeover',midnight-21),awayName:'巴塞罗那'},match('after-takeover',midnight)];
  let data=service.clubHistoryView(account);
  assert.equal(data.club.equippedClubBadge.id,CLUB_BADGES[0].id);
  assert.equal(data.opponents.find(o=>o.id.startsWith('ai-')).equippedClubBadge.clubName,'巴塞罗那');
  const byOwner=()=>data.opponents.find(o=>o.id==='club-'+other.id);
  assert.equal(byOwner().equippedBadge.id,COUNTRY_BADGES[0].id);
  assert.equal(byOwner().equippedClubBadge.id,CLUB_BADGES[1].id);
  service.archiveSeason('completed');
  service.state.matches=[];
  service.state.s4Assets.cosmetics.equipped[other.id].clubBadge=CLUB_BADGES[2].id;
  data=service.clubHistoryView(account);
  assert.equal(byOwner().equippedClubBadge.id,CLUB_BADGES[2].id);
  rival.ownerId='new-owner';
  data=service.clubHistoryView(account);
  assert.equal(byOwner().equippedClubBadge.id,CLUB_BADGES[1].id);
  assert.equal(byOwner().equippedBadge.id,COUNTRY_BADGES[0].id);
});

test('分片重启后回填旧赛季，超过十二条归档后仍保留逐场摘要和球员贡献',t=>{
  const {service,match,reopen}=fixture(t);
  service.state.matches=[match('first',midnight)];
  service.archiveSeason('legacy'); delete service.state.clubHistory;
  service.save();
  const next=reopen();
  assert.ok(next.clubHistoryView(account).matches.some(m=>m.id==='first'));
  next.state.matches=[];
  for(let i=0;i<13;i++) {
    next.state.season={...next.state.season,id:'season-'+i};
    next.archiveSeason('completed');
  }
  next.save();
  const last=reopen(), data=last.clubHistoryView(account);
  assert.equal(last.state.archives.length,12);
  assert.equal(data.matches.length,1);
  assert.equal(data.matches[0].hasDetail,false);
  assert.equal(data.matches[0].playerStats[0].goals,2);
});

test('北京时间午夜淘汰昨日内嵌、归档、广播与已结算外部录像，统计和今日片段可重载',t=>{
  const {service,match,reopen,options}=fixture(t);
  const old=match('before',midnight-1), today=match('today',midnight);
  const jobId='v4-'+'1'.repeat(32)+'-1', key='2'.repeat(64);
  Object.assign(old.report,{fixtureId:jobId,metricDefinitions:{model:'recorded'}});
  service.state.matches=[old];
  service.archiveSeason('archive');
  service.state.matches.push(today);
  service.state.completedBroadcasts=[{completedAt:midnight-1,match:{dotReplayFrames:[1],report:{keyPlays:[1]}}}];
  service.state.v4LocalLeagueRounds={rounds:{one:{status:'complete',key,competition:'league',tasks:[{fixture:{id:jobId}}]}}};
  service.save();
  const file=path.join(options.statePath+'.v4-schedule','league-queue-'+key,'jobs',jobId,'goal-clips.json.gz');
  fs.mkdirSync(path.dirname(file),{recursive:true}); fs.writeFileSync(file,'old');
  const next=reopen();
  next.trimOldClubReplays(); next.trimOldClubReplays();
  const last=reopen(), data=last.clubHistoryView(account);
  assert.equal(fs.existsSync(file),false);
  assert.equal(last.state.matches[0].report.keyPlays,undefined);
  assert.equal(last.state.matches[0].report.dotReplay,undefined);
  assert.equal(last.state.matches[1].report.keyPlays.length,1);
  assert.equal(last.state.completedBroadcasts[0].match.dotReplayFrames,undefined);
  const archive=last.shardStore.readFullArchive(last.state.archives[0]);
  assert.equal(archive.matches[0].report.dotReplay,undefined);
  assert.equal(archive.matches[0].report.teams[0].players[0].stats.goals,2);
  assert.deepEqual(data.matches.map(m=>[m.id,m.hasDetail,m.hasReplay]),[['before',true,false],['today',true,true]]);
});
