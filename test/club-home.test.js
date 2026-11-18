import assert from 'node:assert/strict';
import test from 'node:test';
import {clubHomeModel, clubHomeStatsMarkup} from '../versus/public/club-home.js';

test('主场按已发布比赛与赛程区分赛前、直播、终场和休赛期', () => {
  const league = {ownTeam:{id:'ours'},season:{status:'active'},serverTime:600000};
  const next = {status:'scheduled',competition:'league',startsAt:900000};
  assert.equal(clubHomeModel(league,[next]).state,'pre');
  league.recentMatches = [{homeId:'ours',awayId:'away',playedAt:590000}];
  assert.equal(clubHomeModel(league,[]).state,'post');
  const fixture = {...next,status:'live',v4MatchId:'this-match'};
  const snapshot = {v4MatchId:'this-match',score:[1,2],minute:62};
  const live = clubHomeModel(league,[fixture],[{v4MatchId:'other',score:[5,0]},snapshot]);
  assert.equal(live.state,'live');
  assert.equal(live.broadcast,snapshot);
  league.serverTime += 300000;
  assert.equal(clubHomeModel(league,[]).state,'off');
});

test('赛事绑定的十一人首发与停赛适用范围决定待办', () => {
  const roster = Array.from({length:11},(_,i)=>({id:String(i),name:String(i),state:{fitness:90}}));
  const team = {id:'home',roster,lineupSchemes:[{id:'main',preferredStarterIds:roster.map(p=>p.id)}],lineupSchemeAssignments:{league:'main',cup:'main'}};
  const league={ownTeam:team,season:{status:'active'}};
  roster[0].state.cupSuspension=1;
  assert.equal(clubHomeModel(league,[{status:'scheduled',competition:'league'}]).todo.length,0);
  assert.equal(clubHomeModel(league,[{status:'scheduled',competition:'cup'}]).todo[0].type,'出场受限');
});

test('赛后摘要区分缺失统计、真实零值与有效控球比例', () => {
  const escape=String;
  assert.match(clubHomeStatsMarkup({teams:[{},{}]},escape),/未记录/);
  const markup=clubHomeStatsMarkup({teams:[{stats:{possession:39,xg:0}},{stats:{possession:61,xg:1.5}}]},escape);
  for(const text of ['39%','61%','0.00','1.50','估算'])assert.ok(markup.includes(text));
});
