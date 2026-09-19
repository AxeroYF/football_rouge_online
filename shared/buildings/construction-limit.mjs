import {BUILDING_RULES} from '../config/buildings.mjs';
export function constructionProjectState(account, world) {
  const activeProjects=Object.values(world?.territories??{})
    .filter(t=>t.ownerType==='player'&&t.ownerId===account?.id)
    .flatMap(t=>t.buildings??[]).filter(b=>b.status==='constructing'||b.upgradeTo).length;
  const projectLimit=BUILDING_RULES.concurrentProjectLimit;
  return {activeProjects,projectLimit,remainingProjectSlots:Math.max(0,projectLimit-activeProjects)};
}
export function assertConstructionSlot(account, world) {
  const state=constructionProjectState(account,world);
  if(!state.remainingProjectSlots)throw Object.assign(new Error(`同时施工上限为 ${state.projectLimit} 项，请等待完工或中止一个项目`),{statusCode:409,code:'construction-project-limit'});
}
