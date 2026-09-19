import {DISTRICT_RULES,districtSiteYield,districtYieldsForOwner} from '../../shared/buildings/district-yields.mjs';
import { facilityEffects, headquartersLevel } from '../../shared/config/facility-levels.mjs';
import { RESOURCE_HOUR_MS, validateTerritoryResources } from '../../shared/config/resources.mjs';

import { INITIAL_FANS, FANS_PER_HOUR, FANS_PER_TERRITORY, rankFanTerritories, allocateFans, fanIncomeIntervals, fanGrowthForTicks } from '../../shared/config/fans.mjs';

const zeroRates = () => ({ gold: 0, production: 0, science: 0, territoryCount: 0 });
const safe = (value, label) => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(label + '数值无效');
  return value;
};

export class TerritoryProductionService {
  constructor({ catalog, territoryIndex, economy, wonders = null }) {
    this.catalog = validateTerritoryResources(catalog, territoryIndex);
    this.economy = economy; this.wonders = wonders;
    this.territoryMetadata = new Map(territoryIndex.territories.map(t => [t.territoryId, t]));
  }

  territories(account, world) {
    if (!account?.setupComplete) return [];
    let territories = Object.entries(world?.territories ?? {}).filter(([,t])=>t.ownerType==='player'&&t.ownerId===account.id).map(([territoryId])=>{
      const metadata=this.territoryMetadata.get(territoryId),profile=this.catalog.territories[territoryId];
      if(!profile)throw new Error('已持有地块缺少资源配置：'+territoryId);
      return {id:'territory:'+territoryId,type:'territory',territoryId,label:[metadata?.country,metadata?.name??territoryId].filter(Boolean).join(' · '),yields:{...profile.yields}};
    });
    const districts=districtYieldsForOwner(account,world,this.territoryMetadata,this.catalog);
    territories=territories.map(t=>{const districtYields=districts.filter(d=>d.territoryId===t.territoryId),yields={...t.yields};for(const d of districtYields)if(d.operating)yields[d.resource]+=d.fullYield;return {...t,districtYields,yields};});
    if(this.wonders){
      territories=this.wonders.adjustTerritories(account,territories);
      if(this.wonders.modifiers(account).idleFanGold)territories.push({id:'wonder:palacio-salvo',type:'wonder',virtual:true,territoryId:'~palacio-salvo',label:'萨尔沃宫 · 闲置球迷',fanRequirement:5000,yields:{gold:500,production:0,science:0}});
    }
    return territories.map(t=>{
      if(t.virtual)return t;
      const shop=world.territories[t.territoryId]?.buildings?.find(b=>b.type==='club-shop'&&b.status==='active');
      const shopGoldFull=shop?facilityEffects('club-shop',shop.level).goldPerHour:0;
      const suppression=world.territories[t.territoryId]?.raidSuppression;
      return {...t,raidSuppression:suppression??null,shopGoldFull,shopLevel:shop?.level??null,yields:suppression?Object.fromEntries(Object.entries(this.catalog.territories[t.territoryId].yields).map(([k,v])=>[k,v*.7])):{...t.yields,gold:(t.yields.gold??0)+shopGoldFull}};
    });
  }

  districtPreview(account,world,territoryId,type,level=1,buildingId=null){
    if(!DISTRICT_RULES[type])return null;
    const id=buildingId??`preview:${type}:${territoryId}`,site=districtSiteYield({type,level,world,territoryId,ownerId:account.id,metadata:this.territoryMetadata,resources:this.catalog,buildingId:id,account});
    const target=world.territories[territoryId],existing=target.buildings??[];
    const building={...(existing.find(b=>b.id===id)??{}),id,type,level,status:'active'};
    const predicted={...world,territories:{...world.territories,[territoryId]:{...target,buildings:[...existing.filter(b=>b.id!==id),building]}}};
    const allocation=this.allocation(account,predicted),source=allocation.sources.find(t=>t.territoryId===territoryId),operating=source?.districtYields.find(d=>d.buildingId===id)?.operating??false;
    const coverage=source?source.fans/source.fanRequirement:0;
    return {...site,operating,coverage,expectedYield:operating?site.fullYield*coverage:0,projectedCapacity:allocation.rates[site.resource],currentCapacity:this.allocation(account,world).rates[site.resource]};
  }

  growth(account,world){return facilityEffects('club-headquarters',headquartersLevel(account,world)).fanGrowth+((this.wonders?.modifiers(account).fanGrowth??100)-100);}

  allocation(account, world) {
    return allocateFans(rankFanTerritories(this.territories(account,world),account.fanEconomy?.preference??'balanced'),account.resources?.fans??INITIAL_FANS);
  }

  rates(accounts, world) {
    return Object.fromEntries([...accounts.values()].filter(a=>a.setupComplete).map(a=>[a.id,this.allocation(a,world).rates]));
  }

  // Only gold accrues. Saved rates settle the PREVIOUS ownership interval.
  // Production/science are live capacity; legacy stockpiles are audit records only.
  prepare(accounts, world, timestamp) {
    if (!world) return { rollback() {} };
    const now = safe(timestamp, '结算时间'), previous = world.resourceEconomy;
    if (previous && (![1, 2, 3].includes(previous.schemaVersion) || !Number.isSafeInteger(previous.settledAt) || previous.settledAt < 0 || !previous.rates || typeof previous.rates !== 'object')) throw new Error('领地产出存档无效');
    const end = Math.max(now, previous?.settledAt ?? now), start = previous?.settledAt ?? end;
    const denominator = BigInt(RESOURCE_HOUR_MS * FANS_PER_TERRITORY);
    const capacityIntervals = {};
    const snapshots = new Map();
    const rollback = () => {
      if (previous === undefined) delete world.resourceEconomy; else world.resourceEconomy = previous;
      for (const [account, snapshot] of snapshots) for (const [key, entry] of Object.entries(snapshot)) {
        if (!entry.existed) delete account[key]; else account[key] = entry.value;
      }
    };
    try {
      for (const account of accounts.values()) {
        snapshots.set(account, Object.fromEntries(['gold', 'goldLedger', 'resources', 'resourceRemainders', 'resourceLedger', 'retiredResourceStockpiles', 'fanEconomy'].map(key => [key, { existed: Object.hasOwn(account, key), value: Array.isArray(account[key]) ? [...account[key]] : account[key] }])));
        const resources = { ...account.resources }, remainder = { ...account.resourceRemainders };
        resources.fans = safe(resources.fans ?? 0, '球迷');
        const priorFans=account.fanEconomy;
        if (!priorFans) resources.fans=safe(resources.fans+INITIAL_FANS,'初始球迷');
        const growthAt=priorFans?.growthAt??null;
        if(growthAt!==null)safe(growthAt,'球迷增长时间');
        const hours=account.setupComplete&&growthAt!==null?Math.max(0,Math.floor((end-growthAt)/RESOURCE_HOUR_MS)):0;
        resources.fans=safe(resources.fans+fanGrowthForTicks(previous?.fanPlans?.[account.id],hours),'球迷增长');
        account.fanEconomy={schemaVersion:1,cycleGrowth:hours>0?(previous?.fanPlans?.[account.id]?.hourlyGrowth??this.growth(account,world)):(priorFans?.cycleGrowth??this.growth(account,world)),preference:priorFans?.preference??'balanced',growthAt:account.setupComplete?(growthAt===null?end:growthAt+hours*RESOURCE_HOUR_MS):null};
        const retired = { retiredAt: end, balances: {}, remainders: {} };
        for (const key of ['production', 'science']) {
          if (Object.hasOwn(resources, key)) { retired.balances[key] = safe(resources[key], key); delete resources[key]; }
          if (Object.hasOwn(remainder, key)) { retired.remainders[key] = safe(remainder[key], key + '余数'); delete remainder[key]; }
        }
        if (Object.keys(retired.balances).length || Object.keys(retired.remainders).length) {
          account.retiredResourceStockpiles = [...(account.retiredResourceStockpiles ?? []), retired];
        }
        const oldRate = previous?.rates[account.id] ?? zeroRates();
        const legacyCarry = safe(remainder.gold ?? 0, '金币余数');
        if(legacyCarry>=RESOURCE_HOUR_MS)throw new Error('资源余数越界');
        const carry = safe(remainder.goldFanUnits ?? legacyCarry*FANS_PER_TERRITORY, '金币精确余数');
        if (carry >= Number(denominator)) throw new Error('资源余数越界');
        const plan=previous?.fanPlans?.[account.id];
        const phases=plan?fanIncomeIntervals(plan,start,end):[{from:start,to:end,units:{gold:safe((oldRate.gold??0)*FANS_PER_TERRITORY,'金币产速'),science:(oldRate.science??0)*FANS_PER_TERRITORY},capacity:oldRate.production??0}];
        capacityIntervals[account.id]=phases;
        const numerator=phases.reduce((sum,p)=>sum+BigInt(safe(p.units.gold,'金币产速'))*BigInt(p.to-p.from),BigInt(carry));
        const amount = numerator / denominator;
        if (amount > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('金币累计超出安全范围');
        const earned = { gold: Number(amount) };
        const rest=Number(numerator % denominator);
        remainder.gold=Math.floor(rest/FANS_PER_TERRITORY);
        if(rest%FANS_PER_TERRITORY)remainder.goldFanUnits=rest;else delete remainder.goldFanUnits;
        if (earned.gold) this.economy.adjust(account, earned.gold, 'territory-production');
        account.resources = resources; account.resourceRemainders = remainder;
        if (earned.gold) account.resourceLedger = [...(account.resourceLedger ?? []), { from: start, to: end, earned, rateVersion: previous.rateVersion }].slice(-50);
      }
      const fanPlans=Object.fromEntries([...accounts.values()].map(account=>[account.id,{fans:account.resources.fans,hourlyGrowth:this.growth(account,world),firstGrowth:account.fanEconomy.cycleGrowth,growthAt:account.fanEconomy.growthAt,territories:rankFanTerritories(this.territories(account,world),account.fanEconomy.preference)}]));
      world.resourceEconomy = { schemaVersion: 3, rateVersion: this.catalog.version, settledAt: end, rates: this.rates(accounts, world), fanPlans };
      return { rollback, capacityIntervals };
    } catch (error) { rollback(); throw error; }
  }

  due(world, now) {
    return Boolean(world) && (!world.resourceEconomy || now - world.resourceEconomy.settledAt >= 30_000);
  }

  sources(account, world) {
    return this.allocation(account,world).sources.sort((a,b)=>a.territoryId.localeCompare(b.territoryId));
  }

  publicState(account, world) {
    const rate = world?.resourceEconomy?.rates[account.id] ?? zeroRates();
    const allocation=this.allocation(account,world);
    return {
      schemaVersion: 3, version: this.catalog.version,
      balances: { fans: account.resources?.fans ?? INITIAL_FANS },
      fans: {initial:INITIAL_FANS,hourlyGrowth:account.fanEconomy?.cycleGrowth??this.growth(account,world),nextHourlyGrowth:this.growth(account,world),perTerritory:FANS_PER_TERRITORY,
        preference:account.fanEconomy?.preference??'balanced',assigned:allocation.assigned,available:allocation.available,
        required:allocation.sources.filter(t=>!t.virtual).reduce((sum,t)=>sum+t.fanRequirement,0),nextGrowthAt:account.fanEconomy?.growthAt==null?null:account.fanEconomy.growthAt+RESOURCE_HOUR_MS},
      current: { production: rate.production, science: rate.science },
      hourly: { gold: rate.gold },
      sources: allocation.sources.sort((a,b)=>a.territoryId.localeCompare(b.territoryId)),
      territoryCount: rate.territoryCount, settledAt: world?.resourceEconomy?.settledAt ?? null,
    };
  }
}
