import test from "node:test";
import assert from "node:assert/strict";
import { YellowDogsLeagueService } from "../versus/league-service.js";

const NOW = Date.parse("2026-08-22T12:00:00+08:00");
const account = { id:"club-owner", nickname:"俱乐部经理" };

function createClub(teamName = "海岸竞技", rng = () => .37) {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng });
  service.beginDraft(account, teamName);
  service.autoDraft(account);
  service.finishDraft(account);
  return service;
}

test("club management initializes a 30000-seat stadium and persists stadium settings without a fan subsystem", () => {
  const service = createClub();
  const initial = service.view(account).ownTeam.clubManagement;
  assert.equal(initial.stadium.capacity, 30_000);
  assert.equal(initial.stadium.name, "海岸竞技主场");
  assert.equal(initial.stadium.standStyle, "none");
  assert.equal(initial.supporters, undefined);
  assert.equal(initial.sponsorship.offers.filter((offer) => offer.status === "pending").length, 1);
  assert.equal(initial.sponsorship.offers[0].type, "normal");

  service.updateClubStadium(account, { name:"海岸之光球场", standStyle:"steep", pitchStyle:"checker", backgroundEffect:"none" });
  const updated = service.view(account).ownTeam.clubManagement;
  assert.equal(updated.stadium.name, "海岸之光球场");
  assert.equal(updated.stadium.standStyle, "steep");
  assert.equal(updated.stadium.pitchStyle, "checker");
});

test("meteor item costs 20000 coins, unlocks a persistent broadcast background and guarantees home attendance", () => {
  const service = createClub("星穹竞技");
  service.wallet(account.id).balance = 60_000;
  assert.throws(() => service.updateClubStadium(account, { backgroundEffect:"meteor" }), /商店购买流星雨看台/);
  const before = service.wallet(account.id).balance;
  service.buyMeteorStand(account);
  const club = service.view(account).ownTeam.clubManagement;
  assert.equal(service.wallet(account.id).balance, before - 20_000);
  assert.equal(service.shopView(account.id).meteorStand.owned, true);
  assert.ok(club.stadium.unlockedBackgroundEffects.includes("meteor"));
  assert.equal(club.stadium.attendanceRate, 1);
  service.updateClubStadium(account, { backgroundEffect:"meteor" });
  assert.equal(service.view(account).ownTeam.clubManagement.stadium.backgroundEffect, "meteor");
  const team = service.accountTeam(account.id);
  const away = service.state.teams.find((entry) => entry.id !== team.id);
  const ticket = service.settleHomeTicketIncome({ id:"meteor-full-house", round:1, homeId:team.id, awayId:away.id });
  assert.equal(ticket.attendance, team.clubManagement.stadium.capacity);
  assert.equal(ticket.attendanceRate, 1);
  assert.throws(() => service.buyMeteorStand(account), /已经拥有/);
});

test("stadium expansion is limited to 5000 seats per purchase with rising stage costs", () => {
  const service = createClub("门票联队");
  const team = service.accountTeam(account.id);
  const beforeExpansion = service.wallet(account.id).balance;
  service.expandClubStadium(account);
  assert.equal(team.clubManagement.stadium.capacity, 35_000);
  assert.equal(service.wallet(account.id).balance, beforeExpansion - 4_000);
  service.expandClubStadium(account);
  assert.equal(team.clubManagement.stadium.capacity, 40_000);
  assert.equal(service.wallet(account.id).balance, beforeExpansion - 9_000);

  const away = service.state.teams.find((entry) => entry.id !== team.id);
  service.state.season.startedAt = 0;
  service.state.matches.push({ id:"club-ticket-match", round:1, homeId:team.id, awayId:away.id, score:[2, 0] });
  const beforeTickets = service.wallet(account.id).balance;
  service.payRewards(1);
  const ticket = service.state.ledger.find((entry) => entry.type === "home-ticket-income" && entry.matchId === "club-ticket-match");
  assert.equal(ticket.capacity, 40_000);
  service.createRoundInbox(1);
  const homeReport = service.view(account).inbox.find((message) => message.id === `matchweek:${service.state.season.id}:1`);
  assert.equal(homeReport.payload.homeTicketIncome.amount, ticket.amount);
  assert.equal(homeReport.payload.homeTicketIncome.attendance, ticket.attendance);
  assert.match(homeReport.summary, /主场门票收入/);
  assert.match(homeReport.body, /名观众入场/);
  assert.ok(service.wallet(account.id).balance > beforeTickets);
  service.payRewards(1);
  assert.equal(service.state.ledger.filter((entry) => entry.type === "home-ticket-income" && entry.matchId === "club-ticket-match").length, 1);
  assert.equal(service.settleHomeTicketIncome({ id:"club-friendly-home", competition:"friendly", homeId:team.id, awayId:away.id }), null);
});

test("post-match sponsor offers can be accepted or rejected and enforce contract type limits", () => {
  const service = createClub("北境城", () => .1);
  const team = service.accountTeam(account.id);
  team.table.points = 99;
  const initial = service.view(account).ownTeam.clubManagement.sponsorship.offers.find((offer) => offer.status === "pending");
  service.respondClubSponsorOffer(account, { offerId:initial.id, action:"accept" });
  for (let index = 0; index < 2; index += 1) {
    const offer = service.createClubSponsorOffer(team, { type:"normal", durationSeasons:index + 1, force:true });
    service.respondClubSponsorOffer(account, { offerId:offer.id, action:"accept" });
  }
  const fourth = service.createClubSponsorOffer(team, { type:"normal", force:true });
  assert.throws(() => service.respondClubSponsorOffer(account, { offerId:fourth.id, action:"accept" }), /最多同时签约三家公司/);
  service.respondClubSponsorOffer(account, { offerId:fourth.id, action:"reject" });

  const stadiumOffer = service.createClubSponsorOffer(team, { type:"stadium", durationSeasons:2, force:true });
  const beforeBonus = service.wallet(account.id).balance;
  service.respondClubSponsorOffer(account, { offerId:stadiumOffer.id, action:"accept" });
  assert.equal(service.view(account).ownTeam.clubManagement.stadium.displayName, `${stadiumOffer.sponsorName}竞技场`);
  assert.equal(service.wallet(account.id).balance, beforeBonus + stadiumOffer.bonus);
  assert.throws(() => service.updateClubStadium(account, { name:"另一个球场" }), /无法修改主场名称/);
  const broadcastSponsors = service.clubBroadcastVenue(team).sponsors;
  assert.equal(broadcastSponsors.length, 3);
  assert.equal(broadcastSponsors.some((sponsor) => sponsor.id === stadiumOffer.sponsorId), false);

  const matchOffersBefore = team.clubManagement.sponsorship.offers.length;
  const away = service.state.teams.find((entry) => entry.id !== team.id);
  service.rollClubSponsorOffersAfterMatch({ id:"official-finish", competition:"cup", homeId:team.id, awayId:away.id });
  assert.equal(team.clubManagement.sponsorship.offers.length, matchOffersBefore + 1);
  assert.equal(team.clubManagement.sponsorship.offers[0].sourceMatchId, "official-finish");
});
test("sponsor contracts survive real season rollovers, settle once per season and ignore current-season restarts", () => {
  const service = createClub("跨季联队", () => .1);
  const team = service.accountTeam(account.id);
  const normalOffer = service.createClubSponsorOffer(team, { type:"normal", durationSeasons:3, force:true });
  service.respondClubSponsorOffer(account, { offerId:normalOffer.id, action:"accept" });
  const namingOffer = service.createClubSponsorOffer(team, { type:"team", durationSeasons:1, force:true });
  service.respondClubSponsorOffer(account, { offerId:namingOffer.id, action:"accept" });
  const normalContract = team.clubManagement.sponsorship.activeContracts.find((contract) => contract.offerId === normalOffer.id);
  assert.equal(normalContract.remainingSeasons, 3);
  assert.equal(team.name, `${team.clubManagement.baseTeamName}-${namingOffer.sponsorName}`);

  service.restartSeason();
  assert.equal(normalContract.remainingSeasons, 3);
  assert.ok(team.clubManagement.sponsorship.activeContracts.some((contract) => contract.offerId === namingOffer.id));

  const completedSeasonId = service.state.season.id;
  service.resetDailyCompetitions({ manual:true, skipRewardCheck:true, skipBackup:true, skipHonorRoomUpdate:true, skipArchive:true, skipSave:true, skipView:true });
  assert.equal(normalContract.remainingSeasons, 2);
  assert.equal(normalContract.lastSettledSeasonId, completedSeasonId);
  assert.equal(team.clubManagement.sponsorship.activeContracts.some((contract) => contract.offerId === namingOffer.id), false);
  assert.equal(team.name, team.clubManagement.baseTeamName);
  assert.equal(service.settleClubSponsorContractsForSeason(team, completedSeasonId), false);
  assert.equal(normalContract.remainingSeasons, 2);

  service.startNewSeason();
  assert.equal(normalContract.remainingSeasons, 1);
  assert.ok(team.clubManagement.sponsorship.activeContracts.includes(normalContract));
});

test("pending sponsor offers stop at five until the player accepts or rejects one", () => {
  const service = createClub("邀约联队", () => .1);
  const team = service.accountTeam(account.id);
  for (let index = 0; index < 4; index += 1) {
    assert.ok(service.createClubSponsorOffer(team, { type:"normal", durationSeasons:1, force:true }));
  }
  const pendingOffers = () => team.clubManagement.sponsorship.offers.filter((offer) => offer.status === "pending");
  assert.equal(pendingOffers().length, 5);
  assert.equal(service.createClubSponsorOffer(team, { type:"normal", durationSeasons:1, force:true }), null);
  service.respondClubSponsorOffer(account, { offerId:pendingOffers()[0].id, action:"reject" });
  assert.equal(pendingOffers().length, 4);
  assert.ok(service.createClubSponsorOffer(team, { type:"normal", durationSeasons:1, force:true }));
  assert.equal(pendingOffers().length, 5);
});
