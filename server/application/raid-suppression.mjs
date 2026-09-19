import {RAID_RULES} from '../../shared/config/elite-raids.mjs';
const tasks=a=>[...Object.values(a.training?.tasks??{}),...Object.values(a.scouting?.tasks??{}),...Object.values(a.medicalTasks??{})];
function shift(t,delta){for(const key of ['startedAt','completesAt'])if(Number.isFinite(t[key]))t[key]+=delta;}
export function suppressTerritory(c,id,clubId,at){
 const territory=c.world.territories[id];if(!territory||territory.raidSuppression)return false;
 const until=at+RAID_RULES.suppressionMs;
 territory.raidSuppression={clubId,startedAt:at,until,ownerId:territory.ownerId};
 const ids=new Set();
 for(const b of territory.buildings??[]){ids.add(b.id);b.raidSuppressed={status:b.status,paused:b.productionWork?.paused??false};if(b.status==='active')b.status='inactive';if(b.productionWork)b.productionWork={...b.productionWork,paused:true};}
 for(const a of c.accounts.values())for(const t of tasks(a))if(ids.has(t.buildingId)&&!t.completedAt&&!t.claimedAt&&!t.cancelledAt&&!t.closedAt&&t.completesAt>at){t.raidPause={territoryId:id,until,startedAt:at};shift(t,until-at);}
 territory.version=(territory.version??0)+1;c.world.revision++;return true;
}
export function releaseSuppression(c,id,at){
 const territory=c.world.territories[id],s=territory?.raidSuppression;if(!s)return false;
 for(const b of territory.buildings??[])if(b.raidSuppressed){if(b.status==='inactive'&&b.raidSuppressed.status==='active')b.status='active';if(b.productionWork)b.productionWork={...b.productionWork,paused:b.raidSuppressed.paused,updatedAt:at};delete b.raidSuppressed;}
 for(const a of c.accounts.values())for(const t of tasks(a))if(t.raidPause?.territoryId===id){shift(t,-Math.max(0,t.raidPause.until-at));delete t.raidPause;}
 delete territory.raidSuppression;territory.version=(territory.version??0)+1;c.world.revision++;return true;
}
export function suppressionBoundary(world,from,to){return Object.values(world?.territories??{}).reduce((next,t)=>t.raidSuppression?.until>from?Math.min(next,t.raidSuppression.until):next,to);}
export function expireSuppressions(c,at){
 const due=Object.entries(c.world?.territories??{}).filter(([,t])=>t.raidSuppression?.until<=at);
 if(!due.length)return {rollback(){}};
 const snapshots=due.map(([id,t])=>[t,structuredClone(t.raidSuppression),t.version,(t.buildings??[]).map(b=>[b,structuredClone(b)])]),revision=c.world.revision;
 const savedTasks=[...c.accounts.values()].flatMap(a=>tasks(a).filter(t=>t.raidPause).map(t=>[t,structuredClone(t)]));
 for(const [id]of due)releaseSuppression(c,id,at);
 return {rollback(){for(const [t,s,version,buildings]of snapshots){t.raidSuppression=s;t.version=version;for(const [b,old]of buildings){for(const k of Object.keys(b))delete b[k];Object.assign(b,old);}}for(const [v,old]of savedTasks){for(const k of Object.keys(v))delete v[k];Object.assign(v,old);}c.world.revision=revision;}};
}
