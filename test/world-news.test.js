import test from 'node:test';
import assert from 'node:assert/strict';
import {publicWorldNews,WORLD_NEWS_MAX_AGE_MS} from '../server/application/world-news.mjs';
test('world broadcast excludes historical, future, invalid and pre-account news without deleting history',()=>{
 const now=Date.parse('2026-09-20T05:00:00Z'),entry=(id,createdAt)=>({id,createdAt,text:id,type:'alliance'});
 const world={news:[entry('sep13',Date.parse('2026-09-13T05:00:00Z')),entry('boundary',now-WORLD_NEWS_MAX_AGE_MS),entry('recent',now-1),entry('future',now+1),entry('invalid',null)]};
 assert.deepEqual(publicWorldNews(world,{},now).map(e=>e.id),['recent']);assert.equal(world.news.length,5);
 assert.deepEqual(publicWorldNews(world,{worldNewsReadIds:['recent']},now),[]);
 assert.deepEqual(publicWorldNews(world,{createdAt:now},now),[]);
 assert.deepEqual(publicWorldNews(world,{},now+WORLD_NEWS_MAX_AGE_MS).map(e=>e.id),['future']);
});
