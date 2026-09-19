import {prepareDowntimeRecovery} from './server/application/downtime-recovery-service.mjs';
import {resumeServerEconomy,economicCheckpoint,SERVER_ECONOMY_HEARTBEAT_MS} from './server/infrastructure/server-economy-clock.mjs';
import {AirportService} from './server/application/airport-service.mjs';
import {EliteRaidService} from './server/application/elite-raid-service.mjs';
import {suppressionBoundary,expireSuppressions} from './server/application/raid-suppression.mjs';
import {raidMatchForAccount} from './shared/config/elite-raids.mjs';
import {CoalitionService} from './server/application/coalition-service.mjs';
import {repairHeadquartersWars} from './server/application/war-settlement.mjs';
import {OilService} from './server/application/oil-service.mjs';
import {OperatingCostService} from './server/application/operating-cost-service.mjs';
import { visibleMapUnits } from './server/application/map-unit-visibility.mjs';
import { buildingVisibility } from './shared/buildings/building-visibility.mjs';
import { allianceMembers, playerRelationship } from './shared/config/diplomacy.mjs';
import { initializePositionInheritance } from './shared/config/position-inheritance.mjs';
import { DiplomacyService } from "./server/application/diplomacy-service.mjs";
import {EliteChallengeService} from './server/application/elite-challenge-service.mjs';
import {ShopService} from './server/application/shop-service.mjs';
import { campaignBondCatalog } from './shared/football/campaign-bonds.mjs';
import { MedicalService } from './server/application/medical-service.mjs';
import { facilityEffects } from './shared/config/facility-levels.mjs';
import { FormationResearchService } from './server/application/formation-research-service.mjs';
import { confirmedResearchFormation, matchesResearchFormation } from './shared/config/formation-research.mjs';
import { WonderService } from "./server/application/wonder-service.mjs";
import { fanIncomeIntervals } from "./shared/config/fans.mjs";
import { validFanPreference } from './shared/config/fans.mjs';
import { SponsorshipService } from './server/application/sponsorship-service.mjs';
import { sponsoredTeamName, sponsoredStadiumName, sponsorById, activeSponsorContracts } from './shared/config/sponsorship.mjs';
import { repairSquadTactics, repairTacticsLineups } from "./shared/config/tactics-repair.mjs";
import { FogService } from "./server/application/fog-service.mjs";
import { representativePlayers, representativeTactics } from "./shared/config/representative-players.mjs";
import { ExpeditionFitnessService, activeExpeditionPlayerIds } from './server/application/expedition-fitness-service.mjs';
import { fitnessRedline } from './shared/config/fitness.mjs';
import { EnhancementService } from "./server/application/enhancement-service.mjs";
import { CardManagementService } from "./server/application/card-management-service.mjs";
import { TrainingService } from "./server/application/training-service.mjs";
import { ScoutingService } from "./server/application/scouting-service.mjs";
import crypto from "node:crypto";
import { accountPasswordMatches } from "./server/domain/account-password.mjs";
import {
  canChooseHome,
  claimHome,
  listAttackableTerritoriesFrom,
  OWNER_TYPES,
} from "./territory-model.js";
import { CAMPAIGN_ENGINE } from "./engine/campaign-match-engine.mjs";
import { campaignWeatherHour, createCampaignWeatherSnapshot } from "./engine/campaign-weather.mjs";
import { createTerritoryAiGarrison, publicTerritoryAiIntel, TERRITORY_AI_SCHEMA_VERSION } from "./engine/territory-ai.mjs";
import { analyzeElevenBoardFormation, sanitizeFormationLines } from "./formation-rules.js";
import {
  CAMPAIGN_EXTRA_TIME_LIVE_MS,
  CAMPAIGN_REGULATION_LIVE_MS,
  CHALLENGE_FIRST_LEG_MS,
  CHALLENGE_SECOND_LEG_COOLDOWN_MS,
  CHALLENGE_SECOND_LEG_MS,
  CHALLENGE_TOTAL_DURATION_MS,
} from "./shared/config/challenge.mjs";
import { DRAFT_VERSION, DRAFT_SIZE, LINE_KEYS, draftPositionCounts, draftTargetSize, availableDraftPools, hasCurrentDraftOffer } from "./shared/config/draft.mjs";
import { DraftService } from "./server/application/draft-service.mjs";
import { STARTING_GOLD } from "./shared/config/economy.mjs";
import {
  PLAYER_PACK_DEFINITIONS,
} from "./shared/config/player-packs.mjs";
import { LINE_LABELS } from "./shared/football/labels.js";
import {
  assertExpeditionCapacity,
  autoCompletePlayerSquads,
  isPlayerSquadId,
  normalizePlayerSquads,
  PLAYER_SQUAD_DEFINITIONS,
  PLAYER_SQUAD_IDS,
} from "./shared/config/player-squads.mjs";
import { createPlayerCardViewModel } from "./shared/player-card/player-card-contract.js";
import { ChallengeService, publicChallengeView } from "./server/application/challenge-service.mjs";
import { BuildingService } from "./server/application/building-service.mjs";
import { EconomyService } from "./server/application/economy-service.mjs";
import { PlayerPackService } from "./server/application/player-pack-service.mjs";
import { nextAvailablePlayerMapColor } from "./server/domain/player-map-colors.mjs";
import {
  cancelExpeditionMovement,
  estimateExpeditionMove,
  expeditionAttackSource,
  moveExpeditionPiece,
  normalizeExpeditionPiece,
  placeExpeditionPiece,
  publicExpeditionPiece,
  selectExpeditionStyle,
} from "./server/domain/expedition-piece.mjs";
import { migrateCampaignSave } from "./server/infrastructure/campaign-save-migrations.mjs";
import { JsonCampaignRepository } from "./server/infrastructure/json-campaign-repository.mjs";

export const PLAYER_CATALOG_VERSION = "s4-production-2026-09-01-player-names";
export {
  CHALLENGE_FIRST_LEG_MS,
  CHALLENGE_SECOND_LEG_COOLDOWN_MS,
  CHALLENGE_SECOND_LEG_MS,
  CHALLENGE_TOTAL_DURATION_MS,
  DRAFT_SIZE,
  LINE_KEYS,
  LINE_LABELS,
  STARTING_GOLD,
};
function cleanText(value, label, { min = 1, max = 24 } = {}) {
  const text = String(value ?? "").trim();
  if (text.length < min) throw new Error(`${label}至少需要${min}个字符`);
  if (text.length > max) throw new Error(`${label}不能超过${max}个字符`);
  return text;
}

function defaultTacticsPositions(players = []) {
  const groups = { GK:[], DEF:[], MID:[], ATT:[] };
  players.forEach((player) => (groups[player.pool] ?? groups.MID).push(player));
  const result = {};
  [["GK",90],["DEF",68],["MID",44],["ATT",20]].forEach(([group,y]) => groups[group].forEach((player,index) => {
    result[player.id] = { x:Math.round(((index + 1) / (groups[group].length + 1)) * 76 + 12), y };
  }));
  return result;
}

function sanitizeTacticsPositions(players, positions = {}) {
  const fallback = defaultTacticsPositions(players);
  return Object.fromEntries(players.map((player) => {
    const value = positions?.[player.id] ?? fallback[player.id];
    return [player.id, {
      x:Math.round(Math.max(8, Math.min(92, Number(value?.x) || 50))),
      y:Math.round(Math.max(6, Math.min(94, Number(value?.y) || 50))),
    }];
  }));
}

function defaultTacticsStarters(roster = []) {
  const available = [...roster].sort((left,right) => Number(right.effectiveOverall ?? right.overall ?? 0) - Number(left.effectiveOverall ?? left.overall ?? 0));
  const selected = [];
  const take = (pool,count) => available.filter((player) => player.pool === pool && !selected.includes(player)).slice(0,count).forEach((player) => selected.push(player));
  take("GK",1); take("DEF",4); take("MID",3); take("ATT",3);
  available.filter((player) => player.pool !== "GK" && !selected.includes(player)).forEach((player) => { if (selected.length < 11) selected.push(player); });
  return selected.slice(0,11).map((player) => player.id);
}

function safeAccount(account) {
  return { id: account.id, nickname: account.nickname, createdAt: account.createdAt, wallet:{ gold:Number(account.gold ?? 0) } };
}

function passwordDigest(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

function rosterCounts(roster) {
  return Object.fromEntries(LINE_KEYS.map((line) => [line, roster.filter((player) => player.pool === line).length]));
}

function publicDraft(account) {
  const draft = account.draft;
  if (!draft) return null;
  const playerWithCard = (player) => ({ ...player, card:createPlayerCardViewModel(player) });
  return {
    teamName: draft.teamName,
    roster: draft.roster.map(playerWithCard),
    offer: (hasCurrentDraftOffer(draft) ? draft.offer : []).map(playerWithCard),
    offerId: hasCurrentDraftOffer(draft) ? draft.offerId : null,
    offerPool: hasCurrentDraftOffer(draft) ? draft.offerPool : null,
    availablePools: account.setupComplete ? [] : availableDraftPools(draft),
    positionCounts: draftPositionCounts(draft.roster),
    pickNumber: draft.roster.length + (account.setupComplete ? 0 : 1),
    totalPicks: account.setupComplete ? draft.totalPicks ?? 22 : draftTargetSize(draft),
    counts: rosterCounts(draft.roster),
    complete: account.setupComplete === true,
  };
}

import { ConstructionProductionService } from './server/application/construction-production-service.mjs';
import { TerritoryProductionService } from "./server/application/territory-production-service.mjs";

import { LaunchRewardService } from './server/application/launch-reward-service.mjs';

import { NeutralRewardService } from './server/application/neutral-reward-service.mjs';

export class CampaignService {
  constructor({ pauseEconomyWhenStopped = true, developmentTools = false, dataPath, repository = null, economy = null, playerPacks = null, buildings = null, challenges = null, catalog, territoryIndex = null, territoryGeoJson = null, territoryResources = null, maritimePlanner = null, random = Math.random, now = Date.now } = {}) {
    this.repository = repository ?? new JsonCampaignRepository({ dataPath });
    this.dataPath = this.repository.dataPath ?? dataPath ?? null;
    this.developmentTools = developmentTools === true && process.env.NODE_ENV !== "production";
    this.pauseEconomyWhenStopped = pauseEconomyWhenStopped;
    this.random = random;
    this.now = now;
    this.economy = economy ?? new EconomyService({ now });
    this.territoryIndex = territoryIndex;
    this.territoryProduction = territoryResources ? new TerritoryProductionService({ catalog: territoryResources, territoryIndex, economy: this.economy }) : null;
    this.constructionProduction = this.territoryProduction ? new ConstructionProductionService() : null;
    this.maritimePlanner = maritimePlanner;
    this.playerLibrary = Array.isArray(catalog) ? catalog : [];
    this.playerDatabase = this.playerLibrary.filter((player) => LINE_KEYS.includes(player.pool) && player.isX !== true);
    this.catalog = this.playerDatabase.filter((player) => ["A", "B", "C"].includes(player.grade));
    this.playerPacks = playerPacks ?? new PlayerPackService({
      playerDatabase: this.playerDatabase,
      random: this.random,
      now: this.now,
    });
    this.launchRewards = new LaunchRewardService({ economy: this.economy, playerPacks: this.playerPacks });
    this.drafting = new DraftService({ catalog: this.playerDatabase, random: this.random, save: () => this.save() });
    const saved = this.repository.load();
    this.economyResume = this.pauseEconomyWhenStopped ? resumeServerEconomy(saved, this.now()) : null;
    const migration = migrateCampaignSave({
      saved,
      territoryIndex: this.territoryIndex,
      playerDatabase: this.playerDatabase,
      playerCatalogVersion: PLAYER_CATALOG_VERSION,
      economy: this.economy,
    });
    this.accounts = migration.accounts;
    this.fog = new FogService({ territoryIndex, territoryGeoJson, accounts:this.accounts, now });
    this.world = migration.world;
    this.wonders = new WonderService({world:this.world,accounts:this.accounts,territoryIndex,resources:territoryResources,players:this.playerLibrary,economy:this.economy,now:this.now,save:()=>this.save()});
    if(this.territoryProduction)this.territoryProduction.wonders=this.wonders;
    this.oil=new OilService(this);
    this.operatingCosts=new OperatingCostService({economy:this.economy,now:this.now,wonders:this.wonders});
    this.formationResearch=new FormationResearchService({campaign:this});
    this.playerPacks.wonders=this.wonders;
    this.sponsorship = new SponsorshipService({ economy:this.economy, now:this.now, save:()=>this.save() });
    let sponsorsChanged = false;
    let inventoriesChanged = false;
    for (const account of this.accounts.values()) {
      inventoriesChanged = this.playerPacks.migrateAccount(account) || inventoriesChanged;
      sponsorsChanged = this.sponsorship.migrateAccount(account) || sponsorsChanged;
    }
    this.weatherSnapshots = new Map();
    this.buildings = buildings ?? new BuildingService({
      getAccount: id => this.accounts.get(id),
      getProduction: this.territoryProduction ? (account, world) => this.territoryProduction.publicState(account, world).current.production : null,
      economy: this.economy,
      now: this.now,
      isCoastal: (territoryId) => this.maritimePlanner?.isCoastal?.(territoryId) === true,
      save: () => this.save(),
    });
    this.buildings.wonders=this.wonders;
    if(this.territoryProduction)this.buildings.getDistrictPreview=(account,world,id,type,level,buildingId)=>this.territoryProduction.districtPreview(account,world,id,type,level,buildingId);
    this.sponsorship.wonders=this.wonders;
    this.neutralRewards = new NeutralRewardService({world:this.world,economy:this.economy,playerPacks:this.playerPacks,sponsorship:this.sponsorship,buildings:this.buildings,now:this.now,save:()=>this.save()});
    const rewardsChanged = this.neutralRewards.initialize();
    const buildingsChanged = this.buildings.migrate({ accounts: this.accounts, world: this.world });
    this.enhancement = new EnhancementService({ economy: this.economy, now: this.now, random: this.random, save: () => this.save() });
    this.shop=new ShopService({world:this.world,oil:this.oil,playerDatabase:this.playerDatabase,economy:this.economy,playerPacks:this.playerPacks,enhancement:this.enhancement,now:this.now,random:this.random,save:()=>this.save()});
    this.cardManagement = new CardManagementService({ accounts: this.accounts, world: this.world, catalog: this.playerLibrary, economy: this.economy, now: this.now, random: this.random, save: () => this.save() });
    const cardHistoryChanged = this.cardManagement.migrateHistory();
    this.training = new TrainingService({ economy: this.economy, buildings: this.buildings, territoryIndex: this.territoryIndex, now: this.now, random: this.random, save: () => this.save() });
    this.scouting = new ScoutingService({ playerDatabase: this.playerDatabase, buildings: this.buildings, economy: this.economy, territoryIndex: this.territoryIndex, now: this.now, random: this.random, save: () => this.save() });
    this.scouting.fog=this.fog;
    const scoutingChanged = this.scouting.migrate(this.accounts, this.world);
    this.challenges = challenges ?? new ChallengeService({
      world: this.world,
      accounts: this.accounts,
      territoryIndex: this.territoryIndex,
      maritimePlanner: this.maritimePlanner,
      playerDatabase: this.playerDatabase,
      ensureAiGarrison: (territoryId) => this.ensureAiGarrison(territoryId),
      awardNeutralCapture: (context) => this.awardNeutralCapture(context),
      getMatchVenue: (account, at) => this.sponsorMatchVenue(account, at),
      getTerritoryWeather: (territoryId, timestamp) => this.territoryWeather(territoryId, timestamp),
      save: () => this.save(),
      now: this.now,
    });
    for(const service of [this.training,this.scouting,this.enhancement,this.challenges])service.wonders=this.wonders;
    this.eliteChallenges=new EliteChallengeService({campaign:this});
    this.diplomacy=new DiplomacyService({campaign:this});
    this.coalitions=new CoalitionService(this);this.challenges.coalitions=this.coalitions;
    this.medical=new MedicalService({world:this.world,accounts:this.accounts,buildings:this.buildings,economy:this.economy,now:this.now,save:()=>this.save(),wonders:this.wonders});
    this.buildings.medical=this.medical;
    this.fitness=new ExpeditionFitnessService({world:this.world,accounts:this.accounts,territoryIndex:this.territoryIndex,now:this.now});
    this.challenges.fitness=this.fitness;
    this.eliteRaids=new EliteRaidService(this);
    this.airports=new AirportService(this);
    this.scouting.oil=this.oil;
    this.buildings.getRuntimeEffect=(account,territoryId,building)=>{
      if(building.status!=='active')return '';
      if(building.type==='club-shop'){
        const source=this.territoryProduction?.sources(account,this.world).find(t=>t.territoryId===territoryId);
        return source?`球迷覆盖 ${Math.round(source.fans/source.fanRequirement*100)}% · 当前商店收入 ${Number(source.shopGold.toFixed(2))} 金币/小时`:'';
      }
      if(building.type==='recovery-center'){
        const at=this.now();
        const plans=this.fitness.plans(account,at),current=this.fitness.publicState(account,at).players;
        const count=Object.entries(plans).filter(([id,p])=>p.centerId===building.id&&p.boostFrom!=null&&p.boostFrom<=at&&current[id]?.recoveryPerMinute>.5).length;
        return count?`当前 ${count} 名远征球员享受范围恢复加成`:'当前没有远征球员享受范围恢复加成';
      }
      return '';
    };
    this.enhancement.world=this.world;
    repairHeadquartersWars(this.world,this.accounts,this.now());
    this.challenges.restoreActiveChallenges();
    const fogChanged = this.fog.refreshAll(this.accounts, this.world);
    if (rewardsChanged || sponsorsChanged || migration.changed || inventoriesChanged || buildingsChanged || fogChanged || cardHistoryChanged || scoutingChanged || this.territoryProduction || this.fitness) this.save();
  }


  economyDue(now = this.now()) {
    return Boolean((this.pauseEconomyWhenStopped && now-(this.world?.serverEconomyClock?.lastPersistedAt??0)>=SERVER_ECONOMY_HEARTBEAT_MS) || this.airports?.due(now) || this.oil?.due(this.accounts,now) || this.operatingCosts?.due(this.accounts,now) || this.medical?.due(now) || this.fitness?.due(now) || this.territoryProduction?.due(this.world, now) || this.sponsorship.due(this.accounts, now));
  }

  resourceState(account, now = this.now()) {
    const sources = this.sponsorship.resourceSources(account, now);
    const base = this.territoryProduction?.publicState(account, this.world);
    const expenses=this.operatingCosts?.costs(account,this.world);
    if (!base && !sources.length && !expenses?.total) return null;
    const state = base ?? {schemaVersion:2,balances:{fans:account.resources?.fans??0},current:{production:0,science:0},hourly:{gold:0},sources:[],territoryCount:0,settledAt:now};
    const income=state.hourly.gold+sources.reduce((sum,s)=>sum+s.yields.gold,0);
    const expenseSources=expenses?[{id:'club-wages',type:'expense',label:'球员工资',yields:{gold:-expenses.wages},details:expenses.wageGroups},{id:'club-maintenance',type:'expense',label:'设施养护',yields:{gold:-expenses.maintenance},details:expenses.maintenanceGroups}]:[];
    const oil=this.oil.view(account);
    return {...state,oil,balances:{...state.balances,oil:oil.balance},expenses,hourly:{oil:oil.hourly,gold:income-(expenses?.total??0)},sources:[...state.sources,...sources,...expenseSources.filter(s=>s.yields.gold)]};
  }

  sponsorMatchVenue(account, at = this.now()) {
    if (!account) return null;
    const stadium=Object.values(this.world?.territories??{}).filter(t=>t.ownerId===account.id).flatMap(t=>t.buildings??[]).find(b=>b.type==='main-stadium'&&b.status==='active');
    const view = stadium ? this.buildings.publicBuilding(stadium) : null;
    return {ownerId:account.id,stadiumId:stadium?.id??null,seatingCapacity:view?.seatingCapacity??0,name:sponsoredStadiumName(account, view?.name ?? sponsoredTeamName(account,at)+'主场', at),
      sponsors:activeSponsorContracts(account,at).filter(c=>c.type==='normal').map(c=>({...sponsorById(c.sponsorId),expiresAt:c.expiresAt}))};
  }

  shopView(account){return {shop:this.shop.publicState(account)};}
  buyShop(account,body){this.save();const purchase=this.shop.buy(account,body);return {purchase,shop:this.shop.publicState(account),state:this.state(account)};}

  respondSponsorship(account, offerId, action) {
    this.buildings.settleConstructions(this.world);
    this.sponsorship.respond(account, offerId, action);
    return {state:this.state(account)};
  }

  setFanPreference(account, preference) {
    if(!validFanPreference(preference))throw new Error('球迷分配偏好无效');
    if(!account.setupComplete||!this.territoryProduction)throw new Error('请先完成球队创建');
    const previous=account.fanEconomy;
    account.fanEconomy={...previous,preference};
    try{this.save();}catch(error){if(previous===undefined)delete account.fanEconomy;else account.fanEconomy=previous;throw error;}
    return {state:this.state(account)};
  }

  nextMapColor() {
    return nextAvailablePlayerMapColor(this.accounts);
  }

  persist() {
    const previous=this.world?.serverEconomyClock;
    try{
      if(this.pauseEconomyWhenStopped&&this.world)this.world.serverEconomyClock=economicCheckpoint(this.world,this.now());
      this.repository.save({accounts:Object.fromEntries(this.accounts),world:this.world});
    }catch(error){
      if(this.world){if(previous===undefined)delete this.world.serverEconomyClock;else this.world.serverEconomyClock=previous;}
      error.campaignPersistenceFailure=true;throw error;
    }
  }

  save() {
    const rollbacks=[];
    try {
      const now=this.now();
      if(this.airports)rollbacks.push(this.airports.prepare(now).rollback);
      if(this.coalitions)rollbacks.push(this.coalitions.prepare(now).rollback);
      if(this.territoryProduction){
        let cursor=this.world?.resourceEconomy?.settledAt??now;
        let first=true;
        while(first||cursor<now){
          first=false;
          // Probe construction against the saved production plan, then rewind.
          // Settle at each actual completion so new auras never affect earlier hours.
          const candidates=Object.values(this.world?.territories??{}).flatMap(t=>(t.buildings??[]).filter(b=>(b.status==='constructing'||b.upgradeTo)&&!b.productionWork?.paused));
          let boundary=suppressionBoundary(this.world,cursor,this.oil.nextSupplyBoundary(this.accounts,cursor,now));
          if(candidates.length&&cursor<now){
            const economy=this.world.resourceEconomy;
            const intervals=Object.fromEntries(Object.entries(economy?.fanPlans??{}).map(([id,plan])=>[id,fanIncomeIntervals(plan,cursor,now)]));
            const capacities=Object.fromEntries(Object.entries(economy?.rates??{}).map(([id,r])=>[id,r.production]));
            const probe=this.constructionProduction.prepare(this.world,now,capacities,intervals);
            try{for(const b of candidates)if(b.status==='active'){const completedAt=b.upgradeCompletedAt??b.builtAt;if(completedAt>cursor)boundary=Math.min(boundary,completedAt);};}finally{probe.rollback();}
          }
          rollbacks.push(this.oil.prepare(this.accounts,this.world,boundary).rollback);
          if(this.fitness)rollbacks.push(this.fitness.prepare(boundary).rollback);
          const production=this.territoryProduction.prepare(this.accounts,this.world,boundary);rollbacks.push(production.rollback);
          const research=this.formationResearch.prepare(this.accounts,production.capacityIntervals,boundary);rollbacks.push(research.rollback);
          const rates=this.world.resourceEconomy.rates;
          const construction=this.constructionProduction.prepare(this.world,boundary,Object.fromEntries(Object.entries(rates).map(([id,r])=>[id,r.production])),production.capacityIntervals);rollbacks.push(construction.rollback);
          const sponsorship=this.sponsorship.prepare(this.accounts,boundary);rollbacks.push(sponsorship.rollback);
          rollbacks.push(this.operatingCosts.prepare(this.accounts,this.world,boundary).rollback);
          const beforeAccounts=new Map([...this.accounts.values()].map(a=>[a,{gold:a.gold,goldLedger:structuredClone(a.goldLedger),wonderRewards:structuredClone(a.wonderRewards),pendingNeutralRewards:structuredClone(a.pendingNeutralRewards),wonderCompetitionNotices:structuredClone(a.wonderCompetitionNotices)}]));
          const beforeBuildings=Object.values(this.world.territories??{}).flatMap(t=>(t.buildings??[]).filter(b=>b.wonderId).map(b=>[b,structuredClone(b)]));
          const versions=Object.values(this.world.territories??{}).map(t=>[t,t.version,[...(t.buildings??[])]]);const revision=this.world.revision;
          rollbacks.push(()=>{for(const [a,b] of beforeAccounts)for(const [k,v]of Object.entries(b)){if(v===undefined)delete a[k];else a[k]=v;}for(const [b,v]of beforeBuildings){for(const k of Object.keys(b))delete b[k];Object.assign(b,v);}for(const [t,v,buildings]of versions){t.version=v;t.buildings=buildings;}this.world.revision=revision;});
          this.wonders.synchronize(boundary);
          rollbacks.push(expireSuppressions(this,boundary).rollback);
          // Refresh plans and forecasts after completion, without accruing time twice.
          rollbacks.push(this.oil.prepare(this.accounts,this.world,boundary).rollback);
          const refreshed=this.territoryProduction.prepare(this.accounts,this.world,boundary);rollbacks.push(refreshed.rollback);
          const current=this.world.resourceEconomy.rates;
          const forecast=this.constructionProduction.prepare(this.world,boundary,Object.fromEntries(Object.entries(current).map(([id,r])=>[id,r.production])));rollbacks.push(forecast.rollback);
          rollbacks.push(this.oil.prepare(this.accounts,this.world,boundary).rollback);
          if(this.fitness)rollbacks.push(this.fitness.prepare(boundary).rollback);
          rollbacks.push(this.operatingCosts.prepare(this.accounts,this.world,boundary).rollback);
          if(boundary<=cursor)break;cursor=boundary;
        }
      }else{const sponsorship=this.sponsorship.prepare(this.accounts,now);rollbacks.push(sponsorship.rollback);rollbacks.push(this.operatingCosts.prepare(this.accounts,this.world,now).rollback);}
      rollbacks.push(expireSuppressions(this,now).rollback);
      rollbacks.push(this.oil.prepare(this.accounts,this.world,now).rollback);
      if(this.fitness)rollbacks.push(this.fitness.prepare(now).rollback);
      if(this.medical)rollbacks.push(this.medical.prepare(now).rollback);
      rollbacks.push(this.launchRewards.prepare(this.accounts,this.world,now).rollback);
      const recovery=prepareDowntimeRecovery({accounts:this.accounts,world:this.world,economy:this.economy,now});rollbacks.push(recovery.rollback);
      if(recovery.changed){
        rollbacks.push(this.oil.prepare(this.accounts,this.world,now).rollback);
        if(this.territoryProduction){
          rollbacks.push(this.territoryProduction.prepare(this.accounts,this.world,now).rollback);
          const rates=this.world.resourceEconomy.rates;
          rollbacks.push(this.constructionProduction.prepare(this.world,now,Object.fromEntries(Object.entries(rates).map(([id,r])=>[id,r.production]))).rollback);
        }
      }
      this.fog?.refreshAll(this.accounts,this.world);
      this.persist();
    }catch(error){for(const rollback of rollbacks.reverse())rollback();throw error;}
  }

  adjustGold(account, deltaValue, reasonValue = "system") {
    const result = this.economy.adjust(account, deltaValue, reasonValue);
    this.save();
    return result;
  }

  spendGold(account, amountValue, reasonValue) {
    const result = this.economy.spend(account, amountValue, reasonValue);
    this.save();
    return result;
  }

  wonderPreview(account) {
    this.save();
    return this.wonders.preview(account);
  }

  accountByNickname(nickname) {
    return [...this.accounts.values()].find((account) => account.nickname === nickname) ?? null;
  }

  register(nicknameValue, passwordValue) {
    const nickname = cleanText(nicknameValue, "昵称", { min: 2, max: 16 });
    const password = cleanText(passwordValue, "密码", { min: 6, max: 72 });
    if (this.accountByNickname(nickname)) throw new Error("该昵称已经注册");
    const id = `YF-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
    const salt = crypto.randomBytes(16).toString("hex");
    const account = {
      id,
      nickname,
      passwordSalt: salt,
      passwordHash: passwordDigest(password, salt),
      token: crypto.randomBytes(24).toString("base64url"),
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
      setupComplete: false,
      homeTerritoryId: null,
      mapColor: this.nextMapColor(),
      draft: null,
      playerSquads: normalizePlayerSquads(null, []),
      expeditionPiece: null,
    };
    this.economy.migrateAccount(account);
    this.playerPacks.migrateAccount(account);
    this.accounts.set(id, account);
    this.save();
    return this.session(account);
  }

  login(nicknameValue, passwordValue) {
    if (typeof nicknameValue !== "string" || !nicknameValue.length || nicknameValue.length > 128 ||
        typeof passwordValue !== "string" || !passwordValue.length || passwordValue.length > 4096) throw new Error("昵称或密码错误");
    const account = this.accountByNickname(nicknameValue) ?? this.accountByNickname(nicknameValue.trim());
    const password = String(account?.passwordHash).startsWith("scrypt$") ? passwordValue : passwordValue.trim();
    if (!account || !accountPasswordMatches(password, account)) throw new Error("昵称或密码错误");
    account.token = crypto.randomBytes(24).toString("base64url");
    account.lastSeenAt = Date.now();
    this.eliteRaids?.touch(account,{foreground:true});
    account.mapColor ??= this.nextMapColor();
    account.homeTerritoryId ??= null;
    this.save();
    return this.session(account);
  }

  authenticate(tokenValue) {
    const account = [...this.accounts.values()].find((candidate) => candidate.token === String(tokenValue ?? ""));
    if (!account) throw Object.assign(new Error("登录已失效，请重新登录"), { statusCode: 401 });
    account.lastSeenAt = Date.now();
    return account;
  }

  session(account) {
    return { token: account.token, profile: safeAccount(account), state: this.state(account) };
  }

  battleForChallenge(challenge) {
    return this.challenges.battleForChallenge(challenge);
  }

  settleChallenge(challenge) {
    return this.challenges.settleChallenge(challenge);
  }

  settleDueChallenges() {
    for (const account of this.accounts.values()) this.training.settle(account);
    return this.challenges.settleDueChallenges();
  }

  challengeStatus(account, challengeIdValue) {
    const challenge = Object.values(this.world?.activeChallenges ?? {}).find((entry) => entry.id === challengeIdValue);
    let spectatorFog = null;
    if (challenge && challenge.attackerId !== account.id && challenge.defenderId !== account.id && !challenge.coalitionContributors?.includes(account.id)) {
      this.assertTerritoryVisible(account, challenge.territoryId);
      spectatorFog = this.fogView(account);
      const playerDefender = challenge.previousOwner?.type === OWNER_TYPES.PLAYER || this.accounts.has(challenge.defenderId);
      const participants = [challenge.attackerId, ...(playerDefender ? [challenge.defenderId] : [])];
      if (spectatorFog.enabled && participants.some((id) => id && !spectatorFog.metPlayerIds.includes(id))) {
        throw Object.assign(new Error("尚未获得该场比赛的情报"), { statusCode: 403 });
      }
    }
    const result = this.challenges.status(account, challengeIdValue);
    if (result.challenge && spectatorFog?.enabled && !spectatorFog.visibleTerritoryIds.includes(result.challenge.sourceTerritoryId)) {
      result.challenge.sourceTerritoryId = null;
    }
    return result;
  }

  advanceActiveChallenges(now = this.now(), { maximumMatches = 1, maximumChainsPerMatch = 1 } = {}) {
    const raidChanged=this.eliteRaids?.advance(now,{maximumChainsPerMatch})??false;
    const coalitionChanged=this.coalitions?.advance()??false;
    const friendlyChanged=this.diplomacy?.advance(now,{maximumMatches,maximumChainsPerMatch})??false;
    const eliteChanged=this.eliteChallenges?.advance(now,{maximumMatches,maximumChainsPerMatch})??false;
    return this.challenges.advance(now, { maximumMatches, maximumChainsPerMatch })||eliteChanged||friendlyChanged||coalitionChanged||raidChanged;
  }

  completeTerritoryChallenge(account, challengeIdValue) {
    const result = this.challenges.complete(account, challengeIdValue);
    return {
      state: this.state(account),
      battle: result.battle,
      ...(result.alreadyCompleted ? { alreadyCompleted: true } : {}),
    };
  }

  awardNeutralCapture({ account, challenge }) {
    const reward = this.neutralRewards.award(account, challenge);
    if (challenge.previousOwner?.type === 'neutral') this.launchRewards.recordConquest(account, challenge.territoryId);
    return reward;
  }

  openPlayerPack(account, packTypeValue) {
    this.buildings.settleConstructions(this.world);
    const before=structuredClone(account);
    try{const opening=this.playerPacks.open(account,packTypeValue);this.save();return {state:this.state(account),opening};}
    catch(error){for(const k of Object.keys(account))delete account[k];Object.assign(account,before);throw error;}
  }

  choosePlayerPackCard(account, openingIdValue, playerIdValue) {
    this.buildings.settleConstructions(this.world);
    const before=structuredClone(account);
    try{const player=this.playerPacks.choose(account,openingIdValue,playerIdValue);this.save();return {state:this.state(account),player};}
    catch(error){for(const k of Object.keys(account))delete account[k];Object.assign(account,before);throw error;}
  }

  adminPlayerPackAccount(account) {
    const inventory = this.playerPacks.publicInventory(account);
    return {
      id:account.id,
      nickname:account.nickname,
      teamName:account.draft?.teamName ?? "尚未建队",
      setupComplete:account.setupComplete === true,
      createdAt:account.createdAt ?? null,
      lastSeenAt:account.lastSeenAt ?? null,
      totalPacks:inventory.totalPacks,
      packs:inventory.packs.map(({ type,name,count }) => ({ type,name,count })),
    };
  }

  adminPlayerPackManagement() {
    const players = [...this.accounts.values()]
      .map((account) => this.adminPlayerPackAccount(account))
      .sort((left,right) => (Number(right.lastSeenAt) || 0) - (Number(left.lastSeenAt) || 0)
        || left.nickname.localeCompare(right.nickname,"zh-CN"));
    const packTypes = Object.values(PLAYER_PACK_DEFINITIONS).map((definition) => ({
      type:definition.type,
      name:definition.name,
      description:definition.description,
    }));
    return { players,packTypes,maxGrantCount:999 };
  }

  grantPlayerPacksToAccount(accountIdValue, packTypeValue, countValue) {
    const accountId = String(accountIdValue ?? "");
    const account = this.accounts.get(accountId);
    if (!account) throw Object.assign(new Error("玩家不存在"),{ statusCode:404 });
    const grant = this.playerPacks.addPacks(account,String(packTypeValue ?? ""),countValue);
    this.save();
    return { player:this.adminPlayerPackAccount(account),grant };
  }

  grantPlayerPacksToAllAccounts(packTypeValue, countValue) {
    const accounts = [...this.accounts.values()];
    if (!accounts.length) throw new Error("服务器暂无可发放的玩家账户");
    const packType = String(packTypeValue ?? "");
    if (!PLAYER_PACK_DEFINITIONS[packType]) throw new Error("未知球员卡包");
    let grant = null;
    for (const account of accounts) grant = this.playerPacks.addPacks(account,packType,countValue);
    this.save();
    return {
      grant,
      recipientCount:accounts.length,
      totalPacksGranted:accounts.length * grant.count,
    };
  }

  campaignWeather(timestamp = this.now()) {
    const clock = campaignWeatherHour(timestamp);
    const cached = this.weatherSnapshots.get(clock.hourKey);
    if (cached) return cached;
    const snapshot = createCampaignWeatherSnapshot({
      territoryIndex: this.territoryIndex,
      timestamp: clock.observedAt,
      seed: `${this.world?.seasonId ?? "season"}:${this.world?.aiGenerationSeed ?? "ydl"}`,
    });
    this.weatherSnapshots.set(clock.hourKey, snapshot);
    while (this.weatherSnapshots.size > 3) this.weatherSnapshots.delete(this.weatherSnapshots.keys().next().value);
    return snapshot;
  }

  territoryWeather(territoryId, timestamp = this.now()) {
    return this.campaignWeather(timestamp).territories[String(territoryId)]
      ?? { type:"sunny", label:"晴朗", icon:"☀", precipitation:0 };
  }

  fogView(account) {
    const result = this.fog.update(account, this.world);
    if (result.changed) this.save();
    return this.developmentTools && account.developmentFogDisabled ? {...result.view,enabled:false,developmentOverride:true} : result.view;
  }

  setDevelopmentFog(account, enabled) {
    if (!this.developmentTools) throw Object.assign(new Error('开发工具未启用'),{statusCode:403});
    if (typeof enabled !== 'boolean') throw Object.assign(new Error('迷雾状态无效'),{statusCode:400});
    const before=account.developmentFogDisabled;
    account.developmentFogDisabled=!enabled;
    try{this.save();}catch(error){account.developmentFogDisabled=before;throw error;}
    return {state:this.state(account)};
  }

  assignNeutralResearch(account,options){const result=this.formationResearch.assignReward(account,options);return {...result,state:this.state(account)};}

  assignNeutralProduction(account, options) {
    const result=this.neutralRewards.assignProduction(account,options);
    return {...result,state:this.state(account)};
  }

  assertTerritoryVisible(account, territoryId) {
    const fog = this.fogView(account);
    if (fog.enabled && !fog.visibleTerritoryIds.includes(String(territoryId ?? ""))) {
      throw Object.assign(new Error("该地块尚未进入当前视野"), { statusCode: 403 });
    }
  }

  publicWorld(account = null, fog = account ? this.fogView(account) : null) {
    if (!this.world) return null;
    const now = this.now();
    const visible = new Set(fog?.visibleTerritoryIds ?? []);
    const met = new Set(fog?.metPlayerIds ?? []);
    const canSee = (id) => !fog?.enabled || visible.has(id);
    const knows = (id) => !id || !fog?.enabled || id === account?.id || met.has(id);
    const territories = Object.fromEntries(Object.entries(this.world.territories)
      .filter(([id]) => canSee(id))
      .map(([id, state]) => [id, {
        territoryId: id, ownerType: state.ownerType, ownerId: state.ownerId,
        neutralReward: state.ownerType === OWNER_TYPES.NEUTRAL ? this.neutralRewards.preview(id) : null,
        raidSuppression:state.raidSuppression??null,
        capitalOf: state.capitalOf, protectedUntil: state.protectedUntil, version: state.version,
        buildings: (state.buildings ?? []).map((building) => buildingVisibility(this.buildings.publicBuilding(building, this.accounts.get(state.ownerId)),this.world,account?.id,state.ownerId)).filter(Boolean),
      }]));
    const players = Object.fromEntries(Object.entries(this.world.players).filter(([id]) => knows(id)).map(([playerId, player]) => {
      const owner = this.accounts.get(playerId);
      const homeId = owner?.homeTerritoryId ?? player.capitalTerritoryId ?? null;
      return [playerId, {
        playerId, nickname: owner?.nickname ?? playerId, teamName: owner ? sponsoredTeamName(owner, now) : "未命名球队",
        color: owner?.mapColor ?? "#4fa86d",
        homeTerritoryId: playerId === account?.id || canSee(homeId) ? homeId : null,
        territoryIds: (player.territoryIds ?? []).filter((id) => playerId === account?.id || canSee(id)),
      }];
    }));
    const activeChallenges = Object.fromEntries(Object.entries(this.world.activeChallenges ?? {})
      .filter(([id, challenge]) => canSee(id) || challenge.attackerId === account?.id || challenge.defenderId === account?.id)
      .map(([id, challenge]) => {
        const view = publicChallengeView(challenge, now);
        if (!canSee(view.sourceTerritoryId)) view.sourceTerritoryId = null;
        if (!knows(challenge.attackerId)) { view.attackerId = null; view.attackerTeamName = "未相遇球队"; view.id = null; }
        if ((challenge.previousOwner?.type === OWNER_TYPES.PLAYER || this.accounts.has(challenge.defenderId)) && !knows(challenge.defenderId)) { view.defenderId = null; view.defenderName = "未相遇球队"; view.id = null; }
        return [id, view];
      }));
    const weather = this.campaignWeather(now);
    return { units:visibleMapUnits({account,world:this.world,accounts:this.accounts,territoryIndex:this.territoryIndex,fog,spatial:this.fog.spatial,now}), revision: this.world.revision, territories, players, activeChallenges, viewerId:account?.id,conquestHostIds:allianceMembers(this.world,account?.id).filter(id=>this.diplomacy.relationship(account?.id,id).conquestPermissions?.[id]),alliedPlayerIds:allianceMembers(this.world,account?.id).filter(id=>id!==account?.id),
      weather: { ...weather, territories: Object.fromEntries(Object.entries(weather.territories).filter(([id]) => canSee(id))) } };
  }

  territoryMetadata(territoryId) {
    const territory = this.territoryIndex?.territories.find((candidate) => candidate.territoryId === territoryId);
    if (!territory) throw new Error("目标地块不存在");
    return territory;
  }

  ensureAiGarrison(territoryId) {
    const territory = this.territoryMetadata(territoryId);
    const territoryState = this.world?.territories?.[territoryId];
    if (!territoryState) throw new Error("目标地块不存在");
    if (territoryState.ownerType === OWNER_TYPES.PLAYER) return null;
    const current = this.world.aiGarrisons?.[territoryId];
    if (current?.schemaVersion === TERRITORY_AI_SCHEMA_VERSION && current.generatedForSeason === this.world.seasonId) return current;
    this.world.aiGarrisons ??= {};
    this.world.aiGarrisons[territoryId] = createTerritoryAiGarrison({ catalog:this.playerDatabase,territory,territoryState,seasonId:this.world.seasonId,generationSeed:this.world.aiGenerationSeed });
    this.save();
    return this.world.aiGarrisons[territoryId];
  }

  territoryIntel(account, territoryIdValue) {
    if (!this.world || !account.setupComplete) throw new Error("请先完成初始建队");
    const territoryId=String(territoryIdValue??"");
    this.assertTerritoryVisible(account, territoryId);
    const state=this.world.territories[territoryId];
    if (!state) throw new Error("目标地块不存在");
    if (state.ownerType===OWNER_TYPES.PLAYER) return {territoryId,ownerType:state.ownerType,ai:null};
    const eliteId=this.territoryMetadata(territoryId).eliteClubIds?.[0];
    if(eliteId){const t=this.eliteChallenges.team(eliteId);return {territoryId,ownerType:'club',ai:{difficulty:5,coreCountry:true,averageOverall:t.average,targetAverageOverall:t.average,formation:t.club.formation,mentality:'全员 +5',playStyle:t.club.styleLabel,lineup:t.preview.map(p=>({id:p.player.playerId,name:p.player.name,role:p.role,overall:p.player.overall}))}};}

    return {territoryId,ownerType:state.ownerType,ai:publicTerritoryAiIntel(this.ensureAiGarrison(territoryId),this.playerDatabase)};
  }

  buildingCatalog() {
    return this.buildings.catalog();
  }

  playerDirectory(account) {
    const rosterIds = new Set((account?.draft?.roster ?? []).map((player) => String(player.cardDefinitionId ?? player.id)));
    const players = this.playerLibrary
      .filter((player) => LINE_KEYS.includes(player.pool))
      .map((player) => {
        const card = createPlayerCardViewModel(player);
        return {
          ...card,
          id: card.playerId,
          secondaryRole: player.secondaryRole ?? null,
          heightCm: Number(player.heightCm) || null,
          preferredFoot: player.preferredFoot ?? null,
          weakFoot: Number.isFinite(Number(player.weakFoot)) ? Number(player.weakFoot) : null,
          skillMoves: Number.isFinite(Number(player.skillMoves)) ? Number(player.skillMoves) : null,
          isX: player.isX === true,
          legendary: player.legendary === true,
          librarySource: "YDL",
          inRoster: rosterIds.has(String(player.id)),
        };
      });
    return { catalogVersion: PLAYER_CATALOG_VERSION, total: players.length, players };
  }

  assignPlayerSquad(account, playerIdValue, squadIdValue) {
    if(account.draft?.roster?.find(p=>p.id===playerIdValue)?.coalitionLoan)throw new Error("球员已借调联军，归队后才能调动");
    this.training.settle(account);
    if (!account.setupComplete || !account.draft?.roster?.length) throw new Error("请先完成初始建队");
    const playerId = String(playerIdValue ?? "");
    if (!account.draft.roster.some((player) => String(player.id) === playerId)) throw new Error("球员不在你的球队中");
    if(account.draft.roster.find(player=>String(player.id)===playerId)?.medical)throw new Error("治疗结束后才能变更该球员的编队");
    if (account.draft.roster.find((player) => String(player.id) === playerId)?.training) throw new Error("训练、治疗或联军借调结束后才能变更该球员的编队");
    const squadId = squadIdValue === null || squadIdValue === undefined
      ? PLAYER_SQUAD_IDS.GARRISON
      : String(squadIdValue);
    if (!isPlayerSquadId(squadId)) throw new Error("编队不存在");
    if(activeExpeditionPlayerIds(this.world,account.id).has(playerId))throw Object.assign(new Error("远征比赛进行中，参赛球员暂时不能变更编队"),{statusCode:409});
    const playerSquads = normalizePlayerSquads(account.playerSquads, account.draft.roster);
    playerSquads.assignments[playerId] = squadId;
    if (squadId === PLAYER_SQUAD_IDS.EXPEDITION) assertExpeditionCapacity(playerSquads, account.draft.roster);
    const previousPlayerSquads = account.playerSquads, previousTactics = account.tactics;
    try {
      account.playerSquads = playerSquads;
      account.tactics = repairTacticsLineups(account.tactics, account.draft.roster, playerSquads);
      this.save();
    } catch (error) {
      account.playerSquads = previousPlayerSquads;
      account.tactics = previousTactics;
      throw error;
    }
    return this.state(account);
  }

  cardManagementDetails(account) {
    this.settleDueChallenges();
    return this.cardManagement.details(account);
  }

  previewCardManagement(account, options) {
    this.settleDueChallenges();
    return this.cardManagement.preview(account, options);
  }

  mutateCardManagement(account, action, options) {
    this.settleDueChallenges();
    const result = action === "buy" ? this.cardManagement.buy(account, options)
      : action === "cancel" ? this.cardManagement.cancel(account, options)
      : this.cardManagement.consume(account, options, action);
    // The committed reveal does not wait for the full map and warehouse snapshots.
    if (action === "trade-up" && options.resultOnly === true) return { result };
    return { result, state: this.state(account), view: this.cardManagement.details(account) };
  }

  enhancementDetails(account) {
    this.buildings.settleConstructions(this.world);
    this.training.settle(account);
    return this.enhancement.details(account, this.world);
  }

  mutateEnhancement(account, action, options) {
    this.buildings.settleConstructions(this.world);
    this.training.settle(account);
    const result = action === "trait" ? this.enhancement.chooseTrait(account, options)
      : action === "batch" ? this.enhancement.batch(account, this.world, options)
      : this.enhancement.enhance(account, this.world, options);
    return { result, state: this.state(account), view: this.enhancementDetails(account) };
  }

  trainingDetails(account, territoryId, buildingId) {
    return this.training.details(account, this.world, territoryId, buildingId);
  }

  finishTraining(account, taskId) {
    const task = this.training.finish(account, taskId);
    return { task, state: this.state(account) };
  }

  cancelTraining(account, taskId) {
    const task = this.training.cancel(account, taskId);
    return { task, state: this.state(account) };
  }

  startTraining(account, options) {
    this.buildings.settleConstructions(this.world);
    const task = this.training.start(account, this.world, options);
    return { task, state: this.state(account) };
  }

  scoutingDetails(account, territoryId, buildingId) {
    return this.scouting.details(account, this.world, territoryId, buildingId);
  }

  scoutUnitDetails(account, scoutId) { return this.scouting.unitDetails(account, this.world, scoutId); }
  scoutingTaskDetails(account, taskId) { return this.scouting.taskDetails(account, taskId); }
  recruitScouts(account, options) {
    const scouts = this.scouting.recruit(account, this.world, options);
    return { scouts, state: this.state(account) };
  }
  renameScout(account, options) {
    const scout = this.scouting.rename(account,this.world,options);
    return {scout,state:this.state(account)};
  }
  estimateScoutMove(account, options) { return { estimate: this.scouting.estimate(account, this.world, options) }; }
  moveScout(account, options) {
    this.save();
    const scout = this.scouting.move(account, this.world, options);
    return { scout, state: this.state(account) };
  }
  cancelScoutMove(account, scoutId, movementId) {
    const scout = this.scouting.cancelMove(account, this.world, scoutId, movementId);
    return { scout, state: this.state(account) };
  }

  startScouting(account, options) {
    this.buildings.settleConstructions(this.world);
    const task = this.scouting.start(account, this.world, options);
    return { task, state: this.state(account) };
  }

  claimScoutingQueue(account,taskId,cardIds){const players=this.scouting.claimQueue(account,taskId,cardIds);return {players,state:this.state(account)};}

  chooseScoutingPlayer(account, taskId, cardId) {
    const player = this.scouting.choose(account, taskId, cardId);
    return { player, state: this.state(account) };
  }

  startMedical(account,options){this.save();const task=this.medical.start(account,options);return {task,state:this.state(account),territory:this.buildings.territoryView(account,this.world,options.territoryId)};}
  cancelMedical(account,options){this.save();const task=this.medical.cancel(account,options.taskId);return {task,state:this.state(account),territory:this.buildings.territoryView(account,this.world,task.territoryId)};}

  territoryBuildings(account, territoryIdValue) {
    this.assertTerritoryVisible(account, territoryIdValue);
    this.buildings.settleConstructions(this.world);
    return this.buildings.territoryView(account, this.world, territoryIdValue);
  }

  buildTerritoryBuilding(account, territoryIdValue, typeValue, buildMethod) {
    const result = this.buildings.build(account, this.world, territoryIdValue, typeValue, buildMethod);
    return { state: this.state(account), ...result };
  }

  acknowledgeWonderCompetition(account,id) {
    this.wonders.acknowledgeCompetition(account,String(id??''));return {state:this.state(account)};
  }

  cancelWonderConstruction(account, territoryId, buildingId) {
    const result=this.wonders.cancel(account,String(territoryId??''),String(buildingId??''));
    return {...result,state:this.state(account),territory:this.buildings.territoryView(account,this.world,territoryId)};
  }

  upgradeTerritoryBuilding(account, territoryIdValue, buildingIdValue, options) {
    this.save();
    const result = this.buildings.upgrade(account, this.world, territoryIdValue, buildingIdValue, options);
    return { state: this.state(account), ...result };
  }

  cancelBuildingUpgrade(account,territoryId,buildingId){this.save();const result=this.buildings.cancelUpgrade(account,this.world,territoryId,buildingId);return {...result,state:this.state(account)};}

  previewBuildingDemolition(account, territoryId, buildingId) {
    this.save?.();
    this.training.settle(account);
    return this.buildings.demolitionPreview(account, this.world, territoryId, buildingId);
  }

  demolishTerritoryBuilding(account, options) {
    // Settle income, recovery, research and construction at the old rates first.
    this.save?.();
    this.training.settle(account);
    const result = this.buildings.demolish(account, this.world, options);
    return { state: this.state(account), ...result };
  }

  renameTerritoryBuilding(account, territoryIdValue, buildingIdValue, nameValue) {
    const result = this.buildings.rename(account, this.world, territoryIdValue, buildingIdValue, nameValue);
    return { state: this.state(account), ...result };
  }

  state(account) {
    if (account.draft && !account.setupComplete && account.draft.version !== DRAFT_VERSION) {
      this.drafting.start(account, account.draft.teamName);
    }
    this.settleDueChallenges();
    this.buildings.settleConstructions(this.world);
    const now = this.now();
    if (this.economyDue(now)) this.save();
    this.scouting.settle(account, this.world);
    const expeditionNormalization = normalizeExpeditionPiece(account, this.world, now);
    if (expeditionNormalization.changed) this.save();
    const setupComplete = account.setupComplete === true;
    const normalizedPlayerSquads = normalizePlayerSquads(account.playerSquads, account.draft?.roster ?? []);
    if (JSON.stringify(account.playerSquads ?? null) !== JSON.stringify(normalizedPlayerSquads)) {
      account.playerSquads = normalizedPlayerSquads;
      this.save();
    }
    const repairedTactics = repairTacticsLineups(account.tactics, account.draft?.roster ?? [], account.playerSquads);
    if (JSON.stringify(repairedTactics) !== JSON.stringify(account.tactics)) {
      account.tactics = repairedTactics;
      this.save();
    }
    const activeChallenge=Object.values(this.world?.activeChallenges ?? {}).find((challenge)=>challenge.attackerId===account.id&&!challenge.coalitionId) ?? null;
    const expeditionPiece = setupComplete ? publicExpeditionPiece(account, this.world, now) : null;
    const fog = this.fogView(account);
    const visible = new Set(fog.visibleTerritoryIds);
    const canSee = (id) => !fog.enabled || visible.has(id);
    const resources = this.resourceState(account, now);
    const canExpand = Boolean(this.world && setupComplete && account.homeTerritoryId && this.world.players[account.id] && !activeChallenge && !expeditionPiece?.moving);
    const expeditionTerritoryId = canExpand ? expeditionAttackSource(account, this.world, now) : null;
    return {
      modeName: "黄狗风云",
      bondCatalog:campaignBondCatalog(this.playerDatabase),
      interactions:this.diplomacy.summary(account),
      eliteRaids:setupComplete?this.eliteRaids?.view(account):null,
      coalition:this.coalitions?.view(account,{detail:false}),
      playerId: account.id,
      nickname: account.nickname,
      playerColor: account.mapColor,
      wallet:{ gold:Number(account.gold ?? 0) },
      ...(resources ? { resources } : {}),
      sponsorship:this.sponsorship.publicState(account, now),
      eliteChallenge:{activeId:this.eliteChallenges?.active(account)?.id??null,pendingReward:Boolean(account.elite?.reward&&!account.elite.reward.claimedId)},
      neutralRewards:this.neutralRewards.publicState(account),
      conquest:this.challenges.conquestState(account, now),
      development:{enabled:this.developmentTools,fogEnabled:!this.developmentTools || !account.developmentFogDisabled},
      inventory: this.playerPacks.publicInventory(account),
      scouting: this.scouting.publicState(account, this.world),
      training: this.training.publicState(account),
      enhancement: this.enhancement.publicState(account),
      wonders: this.wonders.publicState(account),
      formationResearch:this.formationResearch.publicState(account),
      expeditionFitness:this.fitness.publicState(account),
      buildings: setupComplete && this.world
        ? this.buildings.accountView(account, this.world)
        : { rules:null, catalog:this.buildings.catalog(), territories:{} },
      setupComplete,
      homeSelectionRequired: Boolean(this.world && setupComplete && !account.homeTerritoryId),
      homeTerritoryId: account.homeTerritoryId ?? null,
      expeditionPiece,
      draft: account.draft ? { ...this.fitness.draftView(account,publicDraft(account)), baseTeamName:account.draft.teamName, teamName:sponsoredTeamName(account, now) } : null,
      playerSquads: {
        ...normalizedPlayerSquads,
        squads:PLAYER_SQUAD_DEFINITIONS.map((squad) => ({ ...squad })),
      },
      tactics: account.tactics ?? null,
      fog,
      world: setupComplete ? this.publicWorld(account, fog) : null,
      activeChallengeId:activeChallenge?.id ?? null,
      attackableTerritoryIds: canExpand ? listAttackableTerritoriesFrom(this.territoryIndex, this.world, account.id, expeditionTerritoryId, now).filter((territoryId) => canSee(territoryId) && !this.world.activeChallenges?.[territoryId]) : [],
      coastalTerritoryIds: (this.maritimePlanner?.coastalTerritoryIds ?? []).filter(canSee),
      battleHistory: (account.battleHistory ?? []).slice(-20).reverse().map(({broadcasts,...battle})=>({...battle,hasDetailedReport:Boolean(broadcasts?.length)})),
      primaryMatchEngine: CAMPAIGN_ENGINE,
    };
  }

  saveTactics(account, value = {}) {
    this.training.settle(account);
    if (!account.setupComplete || !account.draft?.roster?.length) throw new Error("请先完成初始建队");
    const submittedPlayerSquads = value.playerSquads && typeof value.playerSquads === "object" ? value.playerSquads : account.playerSquads;
    for (const player of account.draft.roster.filter((entry) => entry.training || entry.medical || entry.coalitionLoan)) {
      if ((submittedPlayerSquads?.assignments?.[player.id] ?? "garrison") !== (account.playerSquads?.assignments?.[player.id] ?? "garrison")) throw new Error("训练、治疗或联军借调结束后才能变更该球员的编队");
    }
    for(const id of activeExpeditionPlayerIds(this.world,account.id))if(submittedPlayerSquads?.assignments?.[id]!==account.playerSquads?.assignments?.[id])throw Object.assign(new Error("远征比赛进行中，参赛球员暂时不能变更编队"),{statusCode:409});
    const completed = autoCompletePlayerSquads(submittedPlayerSquads,account.draft.roster,{allowTransfers:!account.tactics?.squads});
    assertExpeditionCapacity(completed.playerSquads, account.draft.roster);
    if (!completed.ready) throw new Error("远征与留守编队都需要至少11人，并各自包含门将、后卫、中场和前锋");
    const nextPlayerSquads = completed.playerSquads;
    for(const id of activeExpeditionPlayerIds(this.world,account.id))if(nextPlayerSquads.assignments[id]!==account.playerSquads?.assignments?.[id])throw Object.assign(new Error("远征比赛进行中，参赛球员暂时不能变更编队"),{statusCode:409});
    value = representativeTactics(value,account.draft.roster);
    const providedSquads = value.squads && typeof value.squads === "object" ? value.squads : null;
    const existingSquads = repairTacticsLineups(account.tactics,account.draft.roster,nextPlayerSquads)?.squads ?? {};
    const sanitizeSquad = (squadId,sourceValue = {}) => {
      const eligible = representativePlayers(account.draft.roster).filter((player) => nextPlayerSquads.assignments[player.id] === squadId);
      sourceValue = repairSquadTactics(sourceValue, eligible, { previousRoster:account.draft.roster });
      const eligibleIds = new Set(eligible.map((player) => player.id));
      const requested = [...new Set((Array.isArray(sourceValue.starters) ? sourceValue.starters : []).map(String).filter((id) => eligibleIds.has(id)))];
      const starters = requested.length ? requested : defaultTacticsStarters(eligible);
      if (starters.length !== 11) throw new Error(`${squadId === PLAYER_SQUAD_IDS.EXPEDITION ? "远征" : "留守"}编队必须选择恰好11名首发球员`);
      const players = starters.map((id) => eligible.find((player) => player.id === id));
      const planSnapshots = sourceValue.planSnapshots && typeof sourceValue.planSnapshots === "object" ? structuredClone(sourceValue.planSnapshots) : {};
      const embedded = planSnapshots.__s4V2 && typeof planSnapshots.__s4V2 === "object" ? planSnapshots.__s4V2 : {};
      const basePositions = sanitizeTacticsPositions(players, embedded.positionPresets?.position1 ?? sourceValue.positions);
      const baseLines = sanitizeFormationLines(embedded.formationLinePresets?.position1 ?? sourceValue.formationLines);
      const inherited = initializePositionInheritance({
        customPositionPresets:embedded.customPositionPresets,
        positionPresets:{position1:basePositions,position2:embedded.positionPresets?.position2,position3:embedded.positionPresets?.position3},
        formationLinePresets:{position1:baseLines,position2:sanitizeFormationLines(embedded.formationLinePresets?.position2 ?? baseLines),position3:sanitizeFormationLines(embedded.formationLinePresets?.position3 ?? baseLines)},
        researchFormationIds:embedded.researchFormationIds,
        researchFormationBackups:embedded.researchFormationBackups,
      }, {generatedPositions:defaultTacticsPositions(eligible),defaultLines:sanitizeFormationLines()});
      Object.assign(embedded,inherited);
      const presetKeys = ["position1","position2","position3"];
      const formationLinePresets = Object.fromEntries(presetKeys.map((key) => [key,sanitizeFormationLines(embedded.formationLinePresets?.[key] ?? sourceValue.formationLines)]));
      const positionPresets = Object.fromEntries(presetKeys.map((key) => {
        const source = embedded.positionPresets?.[key] ?? sourceValue.positions;
        const sanitized = sanitizeTacticsPositions(players,source);
        const formation = analyzeElevenBoardFormation(players,sanitized,formationLinePresets[key]);
        const validOutfieldLines = [formation.counts.DEF,formation.counts.MID,formation.counts.ATT].every((count) => count >= 1);
        if (formation.counts.GK !== 1 || (key === "position1" && !validOutfieldLines)) {
          const planLabel = key === "position1" ? "默认站位" : key === "position2" ? "领先站位" : "落后站位";
          const squadLabel = squadId === PLAYER_SQUAD_IDS.EXPEDITION ? "远征" : "留守";
          throw new Error(`${squadLabel}${planLabel}：门将必须且只能有一人${key === "position1" ? "，并保留前场、中场、后场三条外场线" : ""}`);
        }
        return [key,sanitized];
      }));
      const researchFormationIds=Object.fromEntries(presetKeys.map(key=>{
        const id=embedded.researchFormationIds?.[key]??null;
        if(id&&!matchesResearchFormation(confirmedResearchFormation(account,id),positionPresets[key],formationLinePresets[key]))throw new Error('研究阵型站位已锁定，请重新导入或解除使用');
        return [key,id];
      }));
      const captainId = String(embedded.captainId ?? "");
      if (captainId && !starters.includes(captainId)) throw new Error("队长必须来自当前11人首发阵容");
      planSnapshots.__s4V2 = { ...embedded,fitnessThreshold:fitnessRedline(embedded.fitnessThreshold),researchFormationIds,starters:[...starters],positionPresets,formationLinePresets,captainId:captainId || starters[0] };
      const bench = eligible.map((player) => player.id).filter((id) => !starters.includes(id));
      const openingFormation = analyzeElevenBoardFormation(players,positionPresets.position1,formationLinePresets.position1);
      return { formation:openingFormation.name,attackStyle:String(sourceValue.attackStyle || "balanced"),defenseStyle:String(sourceValue.defenseStyle || "possession"),starters,bench,positions:positionPresets.position1,formationLines:formationLinePresets.position1,tacticalBars:sourceValue.tacticalBars && typeof sourceValue.tacticalBars === "object" ? sourceValue.tacticalBars : {},planSnapshots,activePlan:String(sourceValue.activePlan || "opening"),updatedAt:Date.now() };
    };
    const squads = Object.fromEntries(PLAYER_SQUAD_DEFINITIONS.map((squad) => {
      const fallback = squad.id === PLAYER_SQUAD_IDS.EXPEDITION ? value : {};
      return [squad.id,sanitizeSquad(squad.id,providedSquads?.[squad.id] ?? existingSquads[squad.id] ?? fallback)];
    }));
    const activeSquadId = isPlayerSquadId(value.activeSquadId) ? String(value.activeSquadId) : PLAYER_SQUAD_IDS.EXPEDITION;
    const previousPlayerSquads=account.playerSquads,previousTactics=account.tactics;
    account.playerSquads = nextPlayerSquads;
    account.tactics = { schemaVersion:2,activeSquadId,squads,...squads[PLAYER_SQUAD_IDS.EXPEDITION],updatedAt:Date.now() };
    try{this.save();}catch(error){account.playerSquads=previousPlayerSquads;account.tactics=previousTactics;throw error;}
    return this.state(account);
  }

  beginDraft(account, teamNameValue) {
    if (account.setupComplete) return this.state(account);
    this.drafting.start(account, account.draft?.teamName ?? cleanText(teamNameValue, "球队名称", { min: 2, max: 20 }));
    return this.state(account);
  }

  openDraftPool(account, pool, pickNumber) {
    this.drafting.open(account, pool, pickNumber);
    return this.state(account);
  }

  choose(account, playerIdValue, offerId) {
    this.drafting.choose(account, playerIdValue, offerId);
    return this.state(account);
  }

  chooseHome(account, territoryIdValue) {
    if (!this.world || !this.territoryIndex) throw new Error("共享世界尚未初始化");
    if (!account.setupComplete) throw new Error("请先完成初始球员选择");
    if (account.homeTerritoryId) throw new Error("总部所在地已经确定，无法更改");
    const territoryId = String(territoryIdValue ?? "");
    const permission = canChooseHome(this.territoryIndex, this.world, account.id, territoryId);
    if (!permission.allowed) {
      const messages = {
        "player-already-has-territory": "你已经拥有总部，无法再次选择",
        "territory-not-spawnable": "该地块属于豪门中立势力，不能建立总部",
        "territory-not-neutral": "该地块已经被其他势力占据",
        "adjacent-to-neutral-club": "总部不能与黄色豪门中立区域直接接壤",
      };
      throw new Error(messages[permission.reason] ?? "该地块不能建立总部");
    }
    claimHome(this.territoryIndex, this.world, account.id, territoryId);
    account.homeTerritoryId = territoryId;
    placeExpeditionPiece(account, territoryId);
    this.buildings.ensureCapitalHeadquarters(account, this.world, territoryId);
    this.save();
    return this.state(account);
  }

  surveyMaritimeRoutes(account, sourceTerritoryIdValue, pointValue) {
    const result = this.challenges.maritimeRoutes(account, sourceTerritoryIdValue, pointValue);
    const preview = this.fog.survey(account, this.world, result);
    this.save();
    return { ...result, previewId: preview?.id, expiresAt: preview?.expiresAt };
  }

  maritimePreview(account, id, action) {
    if (action === "keepalive") return this.fog.renewPreview(account, id);
    if (action !== "close") throw new Error("未知的测绘操作");
    this.fog.clearPreview(account, id);
    return { state: this.state(account) };
  }

  maritimeRoutes(account, sourceTerritoryIdValue, pointValue) {
    const result = this.surveyMaritimeRoutes(account, sourceTerritoryIdValue, pointValue);
    return { ...result, state: this.state(account) };
  }

  ensureExpeditionCanMove(account) {
    if (!this.world || !this.territoryIndex) throw new Error("共享世界尚未初始化");
    if (!account.setupComplete || !account.homeTerritoryId) throw new Error("请先完成建队并选择总部所在地");
    const activeChallenge = Object.values(this.world.activeChallenges ?? {})
      .find((challenge) => challenge.attackerId === account.id&&!challenge.coalitionId);
    if (activeChallenge) {
      throw Object.assign(new Error("板块挑战进行中，远征队暂时不能调动"), { statusCode: 409 });
    }
  }

  selectExpeditionAppearance(account, tokenId) {
    if (!this.world || !account.setupComplete) throw new Error("请先完成建队并选择总部所在地");
    const previous=structuredClone(account.expeditionPiece);
    let expeditionPiece;
    try { expeditionPiece=selectExpeditionStyle(account,this.world,tokenId,this.now()); this.save(); }
    catch(error) { account.expeditionPiece=previous; throw error; }
    return {state:this.state(account),expeditionPiece};
  }

  estimateExpedition(account, territoryIdValue, options = {}) {
    this.ensureExpeditionCanMove(account);
    const base=estimateExpeditionMove({account,world:this.world,territoryIndex:this.territoryIndex,targetTerritoryId:territoryIdValue,now:this.now()});
    if(!this.wonders.isSeaJourney(base.fromTerritoryId,base.toTerritoryId))return {estimate:this.oil.estimate(account,{...base,mode:'land'},'expedition',options)};
    const territory=this.world.territories[base.fromTerritoryId];
    const port=territory.ownerId===account.id?territory.buildings?.find(b=>b.type==='port'&&b.status==='active'):null;
    const sea=this.wonders.seaTravel(account,base);
    return {estimate:this.oil.estimate(account,{...sea,durationMs:Math.max(60000,Math.ceil(sea.durationMs*(port?facilityEffects('port',port.level).timeMultiplier:1))),mode:'sea'},'expedition',options)};
  }

  moveExpedition(account, territoryIdValue, options = {}) {
    this.save();
    this.ensureExpeditionCanMove(account);
    const before=structuredClone(account);
    try {
    const estimate=this.estimateExpedition(account,territoryIdValue,options).estimate;
    moveExpeditionPiece({
      account,
      world: this.world,
      territoryIndex: this.territoryIndex,
      targetTerritoryId: territoryIdValue,
      now: this.now(),
    });
    this.oil.spend(account,estimate);
    account.expeditionPiece.movement={...account.expeditionPiece.movement,...estimate,arrivesAt:this.now()+estimate.durationMs};
    const expeditionPiece=publicExpeditionPiece(account,this.world,this.now());
    this.save();
    return { state: this.state(account), expeditionPiece };
    }catch(e){for(const key of Object.keys(account))delete account[key];Object.assign(account,before);throw e;}
  }

  cancelExpedition(account) {
    if (!this.world) throw new Error("共享世界尚未初始化");
    const result=cancelExpeditionMovement(account,this.world,this.now());
    this.save();
    return {state:this.state(account),expeditionPiece:result.piece,canceledMovement:result.canceledMovement};
  }

  challengeTerritory(account, territoryIdValue, options = {}) {
    this.challenges.settleDueChallenges();
    this.save();
    if (options.maritimeRoute) {
      // Recompute from the real expedition location and coastline; client
      // supplied target lists or a stale survey never authorize conquest.
      this.surveyMaritimeRoutes(account, options.maritimeRoute.sourceTerritoryId, options.maritimeRoute.sourcePoint);
    }
    this.assertTerritoryVisible(account, territoryIdValue);
    this.challenges.assertAttackAvailable(account, territoryIdValue);
    for (const entry of this.accounts.values()) this.training.settle(entry);
    if([...this.accounts.values()].some(a=>a.formationResearch?.active))this.save();
    const result = this.challenges.begin(account, territoryIdValue, options);
    if (options.maritimeRoute) this.fog.clearPreview(account);
    return { state: this.state(account), ...this.challengeStatus(account, result.challengeId) };
  }
}
