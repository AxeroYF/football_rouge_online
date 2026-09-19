export const RAID_RULES=Object.freeze({startHour:20,endHour:24,clubsPerDay:2,suppressionMs:24*3600000,yieldPercent:70,activeWindowMs:72*3600000,claimMs:10*60000,standbyMs:5*60000,offlineMs:15*60000,maxRoster:18});
export function raidDay(at){return new Date(at+8*3600000).toISOString().slice(0,10);}
export function raidWindow(at){const day=raidDay(at),midnight=Date.parse(day+'T00:00:00+08:00'),startsAt=midnight+20*3600000,endsAt=midnight+24*3600000;return {day,startsAt,endsAt,open:at>=startsAt&&at<endsAt};}
export const raidPackType=id=>'elite-interception:'+id;
export function raidMatchForAccount(world,id){return Object.values(world?.eliteRaids?.matches??{}).find(m=>m.defenderId===id||m.contributors?.includes(id));}
export function raidActiveAccount(a,at){return Boolean(a?.setupComplete&&a.homeTerritoryId&&a.raidActivity?.activeAt>0&&at-a.raidActivity.activeAt<=RAID_RULES.activeWindowMs);}
