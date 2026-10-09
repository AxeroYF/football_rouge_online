import {publicExpeditionPiece, expeditionAttackSource} from '../domain/expedition-piece.mjs';
import {campaignBondCatalog} from '../../shared/football/campaign-bonds.mjs';
import {sponsoredTeamName} from '../../shared/config/sponsorship.mjs';
import {PLAYER_SQUAD_DEFINITIONS} from '../../shared/config/player-squads.mjs';
import {listAttackableTerritoriesFrom} from '../../territory-model.js';
import {pendingLiberations} from './territory-liberation.mjs';
import {battleSummary} from '../infrastructure/history-archive.mjs';
import {CAMPAIGN_ENGINE} from '../../engine/campaign-match-engine.mjs';
import {publicDraft} from './draft-view.mjs';

// A coastal survey changes map visibility, not the roster, inventory or every panel.
export function composeCampaignMapState(campaign, account) {
  const now = campaign.now(), fog = campaign.fogView(account);
  const visible = new Set(fog.visibleTerritoryIds), canSee = id => !fog.enabled || visible.has(id);
  const expeditionPiece = publicExpeditionPiece(account, campaign.world, now);
  const activeChallenge = Object.values(campaign.world?.activeChallenges ?? {}).find(challenge => challenge.attackerId === account.id && !challenge.coalitionId);
  const canExpand = Boolean(account.setupComplete && account.homeTerritoryId && campaign.world?.players?.[account.id] && !activeChallenge && !expeditionPiece?.moving);
  return {playerId: account.id, fog, world: campaign.publicWorld(account, fog), expeditionPiece,
    activeChallengeId: activeChallenge?.id ?? null,
    attackableTerritoryIds: canExpand ? listAttackableTerritoriesFrom(campaign.territoryIndex, campaign.world, account.id, expeditionAttackSource(account, campaign.world, now), now).filter(id => canSee(id) && !campaign.world.activeChallenges?.[id]) : [],
    coastalTerritoryIds: (campaign.maritimePlanner?.coastalTerritoryIds ?? []).filter(canSee)};
}

// Compose the response after explicit maintenance. Domain views may still settle
// due work; do not memoize this whole response using world revision alone.
export function composeCampaignState(campaign, account, {now, setupComplete, normalizedPlayerSquads}) {
    const activeChallenge=Object.values(campaign.world?.activeChallenges ?? {}).find((challenge)=>challenge.attackerId===account.id&&!challenge.coalitionId) ?? null;
    const expeditionPiece = setupComplete ? publicExpeditionPiece(account, campaign.world, now) : null;
    const fog = campaign.fogView(account);
    const visible = new Set(fog.visibleTerritoryIds);
    const canSee = (id) => !fog.enabled || visible.has(id);
    const resources = campaign.resourceState(account, now);
    const canExpand = Boolean(campaign.world && setupComplete && account.homeTerritoryId && campaign.world.players[account.id] && !activeChallenge && !expeditionPiece?.moving);
    const expeditionTerritoryId = canExpand ? expeditionAttackSource(account, campaign.world, now) : null;
    return {
      modeName: "黄狗风云",
      bondCatalog:campaignBondCatalog(campaign.playerDatabase),
      interactions:campaign.diplomacy.summary(account),
      eliteRaids:setupComplete?campaign.eliteRaids?.view(account):null,
      coalition:campaign.coalitions?.view(account,{detail:false}),
      playerId: account.id,
      nickname: account.nickname,
      playerColor: account.mapColor,
      wallet:{ gold:Number(account.gold ?? 0) },
      ...(resources ? { resources } : {}),
      sponsorship:campaign.sponsorship.publicState(account, now),
      dailyLeague:campaign.dailyLeague?.summary(account)??null,
      leagueRegistration:campaign.dailyLeague?.registrationView(account)??null,
      eliteChallenge:{activeId:campaign.eliteChallenges?.active(account)?.id??null,pendingReward:Boolean(account.elite?.reward&&!account.elite.reward.claimedId)},
      neutralRewards:campaign.neutralRewards.publicState(account),
      conquest:campaign.challenges.conquestState(account, now),
      development:{enabled:campaign.developmentTools,fogEnabled:!campaign.developmentTools || !account.developmentFogDisabled},
      inventory: campaign.playerPacks.publicInventory(account),
      scouting: campaign.scouting.publicState(account, campaign.world),
      training: campaign.training.publicState(account),
      enhancement: campaign.enhancement.publicState(account),
      wonders: campaign.wonders.publicState(account),
      formationResearch:campaign.formationResearch.publicState(account),
      expeditionFitness:campaign.fitness.publicState(account),
      buildings: setupComplete && campaign.world
        ? campaign.buildings.accountView(account, campaign.world)
        : { rules:null, catalog:campaign.buildings.catalog(), territories:{} },
      setupComplete,
      pvpNotices:account.pvpNotices??[],
      pvpNoticeReadIds:account.pvpNoticeReadIds??[],
      homeSelectionRequired: Boolean(campaign.world && setupComplete && !account.homeTerritoryId),
      homeTerritoryId: account.homeTerritoryId ?? null,
      expeditionPiece,
      draft: account.draft ? { ...campaign.fitness.draftView(account,publicDraft(account)), baseTeamName:account.draft.teamName, teamName:sponsoredTeamName(account, now) } : null,
      playerSquads: {
        ...normalizedPlayerSquads,
        squads:PLAYER_SQUAD_DEFINITIONS.map((squad) => ({ ...squad })),
      },
      tactics: account.tactics ?? null,
      fog,
      world: setupComplete ? campaign.publicWorld(account, fog) : null,
      activeChallengeId:activeChallenge?.id ?? null,
      attackableTerritoryIds: canExpand ? listAttackableTerritoriesFrom(campaign.territoryIndex, campaign.world, account.id, expeditionTerritoryId, now).filter((territoryId) => canSee(territoryId) && !campaign.world.activeChallenges?.[territoryId]) : [],
      coastalTerritoryIds: (campaign.maritimePlanner?.coastalTerritoryIds ?? []).filter(canSee),
      coalitionLoanRequests: campaign.coalitions.loanNotices(account),
      coalitionTargetRequests: campaign.coalitions.targetNotices(account),
      coalitionCommandRequests: campaign.coalitions.commandNotices(account),
      pendingLiberations: pendingLiberations(campaign.world,campaign.accounts,account),
      battleReportReadIds: account.battleReportReadIds??[],
      battleHistory: (account.battleHistory ?? []).slice(-20).reverse().map(battleSummary),
      primaryMatchEngine: CAMPAIGN_ENGINE,
    };
}
