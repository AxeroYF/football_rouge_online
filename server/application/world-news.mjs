import crypto from 'node:crypto';
export function publishWorldNews(world,{key,type,text,createdAt}){
 world.news??=[];if(world.news.some(e=>e.key===key))return;
 world.news.push({id:'news:'+crypto.randomUUID(),key,type,text,createdAt});world.news=world.news.slice(-200);
}
export function publicWorldNews(world,account){
 const read=new Set(account.worldNewsReadIds??[]);return (world?.news??[]).filter(e=>!read.has(e.id)).slice(-50).reverse().map(({id,type,text,createdAt})=>({id,type,text,createdAt}));
}
