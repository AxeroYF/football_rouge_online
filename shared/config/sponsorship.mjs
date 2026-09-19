export const SPONSOR_HOUR_MS = 3_600_000;
export const SPONSOR_DAY_MS = 24 * SPONSOR_HOUR_MS;
export const SPONSORSHIP_VERSION = '20260908-sponsorship-v1';
const brand = (id,name,icon=id+'.svg',surface='light') => Object.freeze({id,name,icon:'/assets/sponsors/'+(icon.endsWith('.svg')?'display/':'')+icon,surface});
export const SPONSORS = Object.freeze([
 brand('microsoft','微软'),brand('apple','苹果'),brand('emirates','阿联酋航空'),
 brand('nike','耐克'),brand('adidas','阿迪达斯'),brand('jissbon','杰士邦','jissbon.png'),
 brand('samsung','三星'),brand('sony','索尼','sony.svg','dark'),brand('mizuno','美津浓'),
 brand('zhuren','主任株式会社','zhuren-kabushiki-kaisha.png'),
 brand('bmw','宝马'),brand('mercedes','奔驰'),brand('audi','奥迪'),brand('tesla','特斯拉'),
 brand('mcdonalds','麦当劳','mcdonalds.svg','dark'),brand('honda','本田'),brand('toyota','丰田'),brand('ferrari','法拉利'),
]);
export const SPONSOR_CONTRACT_TYPES = Object.freeze({
 normal:Object.freeze({id:'normal',name:'普通赞助',durationDays:1,hourlyGold:200,limit:3,benefit:'比赛场边展示品牌'}),
 stadium:Object.freeze({id:'stadium',name:'球场冠名',durationDays:2,hourlyGold:300,limit:1,benefit:'主场使用品牌冠名'}),
 team:Object.freeze({id:'team',name:'球队冠名',durationDays:2,hourlyGold:600,limit:1,benefit:'球队名称追加品牌后缀'}),
});
export const NEUTRAL_SPONSOR_REWARD = Object.freeze({chance:.35,weights:Object.freeze({normal:70,stadium:20,team:10})});
export const sponsorById = id => SPONSORS.find(s=>s.id===id) ?? null;
export const activeSponsorContracts = (account,now=Date.now()) => (account?.sponsorship?.contracts ?? [])
 .filter(c=>c.status==='active' && c.signedAt<=now && now<c.expiresAt);
export function sponsoredTeamName(account,now=Date.now()) {
 const base=account?.draft?.teamName || account?.nickname || '玩家球队';
 const sponsor=sponsorById(activeSponsorContracts(account,now).find(c=>c.type==='team')?.sponsorId);
 return sponsor ? base+'-'+sponsor.name : base;
}
export function sponsoredStadiumName(account,base,now=Date.now()) {
 const sponsor=sponsorById(activeSponsorContracts(account,now).find(c=>c.type==='stadium')?.sponsorId);
 return sponsor ? sponsor.name+'竞技场' : base;
}
