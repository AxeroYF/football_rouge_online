import fs from 'node:fs/promises';
import {existsSync, realpathSync, rmSync} from 'node:fs';
import path from 'node:path';
import {gzipSync} from 'node:zlib';
import {decodeFrames} from '../v4-stream/codec.js';
import {replaceCommittedFile} from '../v4-stream/atomic-file.js';
import {openArchive} from '../v4-stream/archive.js';
import {readSettledMetrics} from './settled-tactical-review.js';
import {isGoalEvent} from '../public/goal-event.js';

const DAY = 86_400_000;
export function historyDayStart(now) {
  const offset = 8 * 3_600_000;
  return Math.floor((now + offset) / DAY) * DAY - offset;
}

export function stripHistoricalReplay(report) {
  let changed = false;
  for (const field of ['dotReplay','dotReplayFrames','keyPlays','v4Replay']) {
    if (report?.[field] != null) {
      delete report[field];
      changed = true;
    }
  }
  return changed;
}

export function trimMatchReplays(state, cutoff) {
  let changed = false;
  for (const m of [...state.matches ?? [], ...state.seasonFinalTournament?.matches ?? []]) {
    if (Number(m.playedAt ?? state.archivedAt ?? 0) < cutoff && stripHistoricalReplay(m.report)) changed = true;
  }
  return changed;
}

export function completedRounds(state) {
  return [...Object.values(state.v4LocalLeagueRounds?.rounds ?? {}), ...Object.values(state.v4LocalCupEvents?.events ?? {})].filter(r=>r.status==='complete');
}

function jobFor(root,record,id) {
  const kind=record.competition ?? 'league';
  if(!['cup','league'].includes(kind)||!/^[a-f0-9]{64}$/.test(record.key)||!/^v4-(?:cup-)?[a-f0-9]{32}-\d+$/.test(id))throw new Error('无效的比赛录像索引');
  return path.join(root,kind+'-queue-'+record.key,'jobs',id);
}

export function appendGoalFrames(clip,frames) {
  for(const f of frames){
    if(f.time<clip.replayTime-13||f.time>clip.replayTime+2||f.time<(clip.frames.at(-1)?.time??-1))continue;
    // A restart can emit a dead-ball frame and the kick at the same timestamp.
    if (f.time === clip.frames.at(-1)?.time) clip.frames.pop();
    clip.frames.push({time:f.time,ball:{x:f.ball.y/68*100,y:(1-f.ball.x/105)*100},players:f.players.filter(p=>p.active).map(p=>({id:p.key.slice(2),teamIndex:p.side,name:p.name,x:p.y/68*100,y:(1-p.x/105)*100}))});
  }
}

export async function collectGoalClips(reader,events) {
  const goals=events.filter(e=>isGoalEvent(e) && Number.isFinite(e.replayTime));
  if(!goals.length)return [];
  const clips=goals.map(e=>({eventId:e.id,type:'goal',replayTime:e.replayTime,frames:[]}));
  reader.publishUntil(reader.producedThrough);
  let previous=0;
  for(const segment of reader.publishedHead().segments){
    const active=clips.filter(c=>previous<=c.replayTime+2 && segment.through>=c.replayTime-13);
    previous=segment.through;
    if(!active.length)continue;
    const packet=await reader.read(segment.index,null);
    const frames=decodeFrames(packet.frames);
    for(const c of active)appendGoalFrames(c,frames);
  }
  if(clips.some(c=>c.frames.length<2))throw new Error('进球片段不完整，保留原录像供重试');
  return clips;
}

export async function compactRound(root,service,record) {
  const matches=new Map(service.state.matches.map(m=>[m.report?.fixtureId,m]));
  for(const task of record.tasks){
    const id=task.fixture.id,job=jobFor(root,record,id),archive=path.join(job,'archive'),trash=path.join(job,'archive-finished');
    if(!existsSync(job))continue;
    if(await fs.realpath(job)!==job)throw new Error('录像目录不可重定向');
    await fs.rm(trash,{recursive:true,force:true,maxRetries:3});
    if(!existsSync(archive)||existsSync(path.join(archive,'retired.json')))continue;
    const match=matches.get(id),report=match?.report,receipt=service.state.v4LocalSettlements?.receipts?.[id];
    if(!report||!receipt||receipt.context?.binding?.roundKey!==record.key||report.inputFingerprint!==receipt.inputFingerprint||receipt.releaseAt>service.now())continue;
    if(await fs.realpath(archive)!==archive)throw new Error('录像目录不可重定向');
    const reader=await openArchive(archive,{cacheBytes:0}),manifest=reader.manifest;
    if(!manifest.complete||manifest.matchId!==id||manifest.inputFingerprint!==receipt.inputFingerprint||manifest.sourceDigest!==receipt.sourceDigest)throw new Error('录像与结算回执不一致');
    if(!report.metricDefinitions?.model){
      const metrics=await readSettledMetrics({...report.v4ReviewArchive,statePath:service.statePath,fixtureId:id,engineVersion:report.engineVersion,inputFingerprint:report.inputFingerprint,teamIds:[match.homeId,match.awayId],side:null});
      const total=metrics.stats.reduce((n,t)=>n+t.possession,0);
      report.teams.forEach((t,i)=>Object.assign(t.stats,{possessionSeconds:metrics.stats[i].possession,possession:total?Number((metrics.stats[i].possession*100/total).toFixed(1)):null,xg:metrics.stats[i].xg}));
      report.metricDefinitions={...report.metricDefinitions,...metrics.metricDefinitions};
      const old=report.importantEvents;report.importantEvents=[...metrics.events.map(e=>({...e,...old.find(o=>o.id===e.id)})),...old.filter(o=>!metrics.events.some(e=>e.id===o.id))].sort((a,b)=>a.minute-b.minute);
      service.save({forceFull:true,skipDailyBackup:true});
    }
    if (match.playedAt < historyDayStart(service.now())) {
      removeSeasonReplayFiles(service.statePath,[{...record,tasks:[task]}]);
      continue;
    }
    const clips=await collectGoalClips(reader,report.importantEvents);
    const target=path.join(job,'goal-clips.json.gz'),tmp=target+'.pending';
    const data=gzipSync(JSON.stringify({version:1,fixtureId:id,inputFingerprint:report.inputFingerprint,clips}));
    const file=await fs.open(tmp,'w');
    try{await file.writeFile(data);await file.sync();}finally{await file.close();}
    await replaceCommittedFile(tmp,target);
    await fs.rename(archive,trash);
    await fs.rm(trash,{recursive:true,force:true,maxRetries:3});
  }
}

// The small fixture index can survive a full reset and be retried after a crash.
export function seasonReplayJobs(state, seasonId) {
  return completedRounds(state).filter(record => record.seasonId === seasonId).map(record => ({
    competition:record.competition, key:record.key, tasks:record.tasks.map(task => ({fixture:{id:task.fixture.id}})),
  }));
}

export function expireSeasonReplays(service, seasonId) {
  removeSeasonReplayFiles(service.statePath, seasonReplayJobs(service.state, seasonId));
}

export function removeSeasonReplayFiles(statePath, records) {
  if (!statePath || !existsSync(statePath)) return;
  const root=realpathSync.native(statePath)+'.v4-schedule';
  for (const record of records) {
    for (const task of record.tasks) {
      const job=jobFor(root,record,task.fixture.id);
      if(!existsSync(job))continue;
      if(realpathSync.native(job)!==job)throw new Error('录像目录不可重定向');
      for(const name of ['goal-clips.json.gz','goal-clips.json.gz.pending','archive-finished','archive']){
        const target=path.join(job,name);
        if(!existsSync(target))continue;
        if(realpathSync.native(target)!==target)throw new Error('录像路径不可重定向');
        rmSync(target,{force:true,recursive:name.startsWith('archive'),maxRetries:3});
      }
    }
  }
}

export function removeInlineSeasonReplays(state) {
  const reports=[...state.matches,...(state.seasonFinalTournament?.matches??[])].map(match=>match.report);
  for(const broadcast of state.completedBroadcasts??[])reports.push(broadcast.match,broadcast.match?.report);
  for(const report of reports) if(report?.keyPlays) delete report.keyPlays;
}
