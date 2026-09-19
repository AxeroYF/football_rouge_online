import { BUILDING_RULES } from '../../shared/config/buildings.mjs';
import { advanceConstruction } from '../../shared/buildings/construction-production.mjs';

const fields = ['status', 'builtAt', 'updatedAt', 'completesAt', 'productionWork','level','upgradeTo','upgradeStartedAt','upgradeCompletedAt'];
const capture = (object, keys) => Object.fromEntries(keys.map(key => [key, { exists: Object.hasOwn(object, key), value: object[key] }]));
const restore = (object, snapshot) => { for (const [key, entry] of Object.entries(snapshot)) { if (entry.exists) object[key] = entry.value; else delete object[key]; } };

export class ConstructionProductionService {
  prepare(world, timestamp, capacities, capacityIntervals = {}) {
    if (!world) return { rollback() {} };
    const previous = world.constructionEconomy;
    if (!Number.isSafeInteger(timestamp) || timestamp < 0 || (previous && (previous.schemaVersion !== 1 || !Number.isSafeInteger(previous.settledAt) || previous.settledAt < 0 || !previous.capacities))) throw new Error('建设产能存档无效');
    const end = Math.max(timestamp, previous?.settledAt ?? timestamp), start = previous?.settledAt ?? end;
    const worldSnapshot = capture(world, ['revision', 'constructionEconomy']);
    const snapshots = new Map(), territorySnapshots = new Map(), changedTerritories = new Set();
    const entries = Object.values(world.territories ?? {}).flatMap(territory => (territory.buildings ?? []).filter(b => (b.status === 'constructing' || b.upgradeTo)).map(building => ({ territory, building })));
    for (const { territory, building } of entries) { snapshots.set(building, capture(building, fields)); territorySnapshots.set(territory, capture(territory, ['version'])); }
    const rollback = () => { restore(world, worldSnapshot); for (const [b,s] of snapshots) restore(b,s); for (const [t,s] of territorySnapshots) restore(t,s); };
    const activate = (entry, at) => {
      if(entry.building.upgradeTo){entry.building.level=entry.building.upgradeTo;entry.building.upgradeCompletedAt=at;delete entry.building.upgradeTo;delete entry.building.upgradeStartedAt;}else entry.building.builtAt=at;
      entry.building.status = 'active'; entry.building.completesAt = at; entry.building.updatedAt = end;
      changedTerritories.add(entry.territory);
    };
    const owner = territory => territory.ownerType === 'player' && Object.hasOwn(capacities, territory.ownerId) ? territory.ownerId : null;
    try {
      // Adopt old fixed timers at the migration instant; preserve their elapsed
      // fraction (and already-finished buildings), never reprice past time.
      for (const entry of entries) {
        const b = entry.building;
        if (b.productionWork) continue;
        const oldEnd = Number(b.completesAt), oldStart = Number(b.constructionStartedAt);
        if (oldEnd > 0 && oldEnd <= end) { activate(entry, oldEnd); continue; }
        const fraction = oldEnd > oldStart && Number.isFinite(oldStart) ? Math.max(0, Math.min(1, (end - oldStart) / (oldEnd - oldStart))) : 0;
        b.productionWork = { required: BUILDING_RULES.constructionDurationMs, completed: BUILDING_RULES.constructionDurationMs * fraction, updatedAt: end, ownerId: owner(entry.territory) };
      }
      for(const {building:b} of entries)if(b.productionWork?.paused){b.completesAt=null;b.productionWork={...b.productionWork,allocation:0,schedule:[],updatedAt:end};}
      const oldGroups = new Map();
      for (const entry of entries.filter(e => (e.building.status === 'constructing' || e.building.upgradeTo) && !e.building.productionWork?.paused)) {
        const key = entry.building.productionWork.ownerId;
        if (!oldGroups.has(key)) oldGroups.set(key, []);
        oldGroups.get(key).push(entry);
      }
      for (const [ownerId, group] of oldGroups) {
        let advanced=group.map(({building:b})=>({id:b.id,...b.productionWork,completedAt:null}));
        const phases=capacityIntervals[ownerId]?.length?capacityIntervals[ownerId]:[{from:start,to:end,capacity:previous?.capacities?.[ownerId]??0}];
        for(const phase of phases){
          const from=Math.max(start,phase.from),to=Math.min(end,phase.to);
          if(to<=from)continue;
          const next=advanceConstruction(advanced,phase.capacity,from,to);
          advanced=next.map((work,i)=>({...work,completedAt:advanced[i].completedAt??work.completedAt}));
        }
        for (let i=0;i<group.length;i++) {
          const entry=group[i], work=advanced[i];
          entry.building.productionWork={ required:work.required, completed:work.completed, updatedAt:end, ownerId:owner(entry.territory) };
          if (work.completedAt !== null) activate(entry, work.completedAt);
          else if(entry.building.upgradeTo && work.ownerId!==owner(entry.territory)) {delete entry.building.upgradeTo;delete entry.building.upgradeStartedAt;delete entry.building.productionWork;entry.building.completesAt=null;changedTerritories.add(entry.territory);} 
        }
      }
      const groups = new Map();
      for (const entry of entries.filter(e => (e.building.status === 'constructing' || e.building.upgradeTo) && !e.building.productionWork?.paused)) {
        const key = entry.building.productionWork.ownerId;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(entry);
      }
      for (const [ownerId, group] of groups) {
        const capacity=capacities[ownerId] ?? 0;
        const forecast=advanceConstruction(group.map(({building:b}) => ({id:b.id,...b.productionWork})),capacity,end,Infinity);
        for (let i=0;i<group.length;i++) {
          const b=group[i].building;
          b.completesAt=forecast[i].completedAt;
          b.productionWork={...b.productionWork,allocation:capacity/group.length,schedule:forecast[i].schedule};
        }
      }
      for (const t of changedTerritories) t.version=Number(t.version ?? 0)+1;
      if (changedTerritories.size) world.revision=Number(world.revision ?? 0)+1;
      world.constructionEconomy={schemaVersion:1,settledAt:end,capacities:{...capacities}};
      return {rollback};
    } catch (error) { rollback(); throw error; }
  }
}
