import crypto from 'node:crypto';
export function publishWorldNews(world,{key,type,text,createdAt}){
 world.news??=[];if(world.news.some(e=>e.key===key))return;
 world.news.push({id:'news:'+crypto.randomUUID(),key,type,text,createdAt});world.news=world.news.slice(-200);
}
export const WORLD_NEWS_MAX_AGE_MS=24*60*60*1000;
export function publicWorldNews(world,account,now=Date.now()){
 const read=new Set(account.worldNewsReadIds??[]);return (world?.news??[]).filter(e=>!read.has(e.id)&&Number.isFinite(e.createdAt)&&e.createdAt<=now&&e.createdAt>now-WORLD_NEWS_MAX_AGE_MS&&e.createdAt>=(Number(account.createdAt)||0)).slice(-50).reverse().map(({id,type,text,createdAt})=>({id,type,text,createdAt}));
}
