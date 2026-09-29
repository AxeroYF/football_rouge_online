import {suppressionBoundary, expireSuppressions} from './raid-suppression.mjs';
import {fanIncomeIntervals} from '../../shared/config/fans.mjs';
import {prepareDowntimeRecovery} from './downtime-recovery-service.mjs';
import {prepareOrphanBondRefunds} from './pvp-attack-bond.mjs';

// Settle each time boundary before committing; unwind in reverse on failure.
export function settleAndPersistCampaign(campaign) {
    const rollbacks=[];
    try {
      const now=campaign.now();
      if(campaign.airports)rollbacks.push(campaign.airports.prepare(now).rollback);
      if(campaign.coalitions)rollbacks.push(campaign.coalitions.prepare(now).rollback);
      if(campaign.territoryProduction){
        let cursor=campaign.world?.resourceEconomy?.settledAt??now;
        let first=true;
        while(first||cursor<now){
          first=false;
          // Probe construction against the saved production plan, then rewind.
          // Settle at each actual completion so new auras never affect earlier hours.
          const candidates=Object.values(campaign.world?.territories??{}).flatMap(t=>(t.buildings??[]).filter(b=>(b.status==='constructing'||b.upgradeTo)&&!b.productionWork?.paused));
          let boundary=suppressionBoundary(campaign.world,cursor,campaign.oil.nextSupplyBoundary(campaign.accounts,cursor,now));
          if(candidates.length&&cursor<now){
            const economy=campaign.world.resourceEconomy;
            const intervals=Object.fromEntries(Object.entries(economy?.fanPlans??{}).map(([id,plan])=>[id,fanIncomeIntervals(plan,cursor,now)]));
            const capacities=Object.fromEntries(Object.entries(economy?.rates??{}).map(([id,r])=>[id,r.production]));
            const probe=campaign.constructionProduction.prepare(campaign.world,now,capacities,intervals);
            try{for(const b of candidates)if(b.status==='active'){const completedAt=b.upgradeCompletedAt??b.builtAt;if(completedAt>cursor)boundary=Math.min(boundary,completedAt);};}finally{probe.rollback();}
          }
          rollbacks.push(campaign.oil.prepare(campaign.accounts,campaign.world,boundary).rollback);
          if(campaign.fitness)rollbacks.push(campaign.fitness.prepare(boundary).rollback);
          const production=campaign.territoryProduction.prepare(campaign.accounts,campaign.world,boundary);rollbacks.push(production.rollback);
          const research=campaign.formationResearch.prepare(campaign.accounts,production.capacityIntervals,boundary);rollbacks.push(research.rollback);
          const rates=campaign.world.resourceEconomy.rates;
          const construction=campaign.constructionProduction.prepare(campaign.world,boundary,Object.fromEntries(Object.entries(rates).map(([id,r])=>[id,r.production])),production.capacityIntervals);rollbacks.push(construction.rollback);
          const sponsorship=campaign.sponsorship.prepare(campaign.accounts,boundary);rollbacks.push(sponsorship.rollback);
          rollbacks.push(campaign.operatingCosts.prepare(campaign.accounts,campaign.world,boundary).rollback);
          const beforeAccounts=new Map([...campaign.accounts.values()].map(a=>[a,{gold:a.gold,goldLedger:structuredClone(a.goldLedger),wonderRewards:structuredClone(a.wonderRewards),pendingNeutralRewards:structuredClone(a.pendingNeutralRewards),wonderCompetitionNotices:structuredClone(a.wonderCompetitionNotices)}]));
          const beforeBuildings=Object.values(campaign.world.territories??{}).flatMap(t=>(t.buildings??[]).filter(b=>b.wonderId).map(b=>[b,structuredClone(b)]));
          const versions=Object.values(campaign.world.territories??{}).map(t=>[t,t.version,[...(t.buildings??[])]]);const revision=campaign.world.revision;
          rollbacks.push(()=>{for(const [a,b] of beforeAccounts)for(const [k,v]of Object.entries(b)){if(v===undefined)delete a[k];else a[k]=v;}for(const [b,v]of beforeBuildings){for(const k of Object.keys(b))delete b[k];Object.assign(b,v);}for(const [t,v,buildings]of versions){t.version=v;t.buildings=buildings;}campaign.world.revision=revision;});
          campaign.wonders.synchronize(boundary);
          rollbacks.push(expireSuppressions(campaign,boundary).rollback);
          // Refresh plans and forecasts after completion, without accruing time twice.
          rollbacks.push(campaign.oil.prepare(campaign.accounts,campaign.world,boundary).rollback);
          const refreshed=campaign.territoryProduction.prepare(campaign.accounts,campaign.world,boundary);rollbacks.push(refreshed.rollback);
          const current=campaign.world.resourceEconomy.rates;
          const forecast=campaign.constructionProduction.prepare(campaign.world,boundary,Object.fromEntries(Object.entries(current).map(([id,r])=>[id,r.production])));rollbacks.push(forecast.rollback);
          rollbacks.push(campaign.oil.prepare(campaign.accounts,campaign.world,boundary).rollback);
          if(campaign.fitness)rollbacks.push(campaign.fitness.prepare(boundary).rollback);
          rollbacks.push(campaign.operatingCosts.prepare(campaign.accounts,campaign.world,boundary).rollback);
          if(boundary<=cursor)break;cursor=boundary;
        }
      }else{const sponsorship=campaign.sponsorship.prepare(campaign.accounts,now);rollbacks.push(sponsorship.rollback);rollbacks.push(campaign.operatingCosts.prepare(campaign.accounts,campaign.world,now).rollback);}
      rollbacks.push(expireSuppressions(campaign,now).rollback);
      rollbacks.push(campaign.oil.prepare(campaign.accounts,campaign.world,now).rollback);
      if(campaign.fitness)rollbacks.push(campaign.fitness.prepare(now).rollback);
      if(campaign.medical)rollbacks.push(campaign.medical.prepare(now).rollback);
      rollbacks.push(campaign.launchRewards.prepare(campaign.accounts,campaign.world,now).rollback);
      const recovery=prepareDowntimeRecovery({accounts:campaign.accounts,world:campaign.world,economy:campaign.economy,now});rollbacks.push(recovery.rollback);
      if(recovery.changed){
        rollbacks.push(campaign.oil.prepare(campaign.accounts,campaign.world,now).rollback);
        if(campaign.territoryProduction){
          rollbacks.push(campaign.territoryProduction.prepare(campaign.accounts,campaign.world,now).rollback);
          const rates=campaign.world.resourceEconomy.rates;
          rollbacks.push(campaign.constructionProduction.prepare(campaign.world,now,Object.fromEntries(Object.entries(rates).map(([id,r])=>[id,r.production]))).rollback);
        }
      }
      rollbacks.push(prepareOrphanBondRefunds(campaign.world,campaign.accounts,now).rollback);
      campaign.fog?.refreshAll(campaign.accounts,campaign.world);
      campaign.persist();
    }catch(error){for(const rollback of rollbacks.reverse())rollback();throw error;}
}
