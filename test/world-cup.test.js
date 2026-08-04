import test from "node:test";
import assert from "node:assert/strict";
import { YellowDogsLeagueService } from "../versus/league-service.js";

function worldCupService(nowValue = "2026-08-04T14:00:00+08:00") {
  let now = Date.parse(nowValue);
  const service = new YellowDogsLeagueService({ statePath:null, now:() => now });
  service.state.teams.slice(0, 9).forEach((team, index) => {
    team.ownerId = `owner-${index + 1}`;
    team.ownerName = `Player ${index + 1}`;
  });
  service.state.cup.status = "completed";
  return { service, advance:(milliseconds) => { now += milliseconds; }, now:() => now };
}

test("daily reset prepares assignments and fixtures before the cup final sets kickoff", () => {
  const { service } = worldCupService("2026-08-04T09:51:00+08:00");
  service.state.cup.status = "waiting";

  service.resetDailyCompetitions({
    manual:false,
    skipArchive:true,
    skipBackup:true,
    skipRewardCheck:true,
    skipSave:true,
    skipView:true,
  });

  assert.equal(service.state.worldCup.status, "preparation");
  assert.equal(service.state.worldCup.startsAt, null);
  assert.equal(service.state.worldCup.nextEventAt, null);
  assert.equal(service.state.worldCup.teams.length, 12);
  assert.equal(service.state.worldCup.groups.length, 3);
  assert.equal(service.state.worldCup.fixtures.length, 18);
  assert.equal(service.worldCupRosterDeadline(), Infinity);
  assert.equal(service.teamSchedule(service.state.teams[0].id).some((fixture) => fixture.competition === "worldcup"), false);
});

test("cup final schedules round one in 20 minutes and locks rosters 10 minutes before kickoff", () => {
  const { service, advance, now } = worldCupService();
  service.createWorldCupPreparation(null);
  const assignments = service.state.worldCup.teams.map((team) => [team.id, team.ownerId, team.groupId]);
  const cupTeams = service.state.teams.slice(0, 2);
  const finalFixture = { id:"cup-final-fixture", winnerId:cupTeams[0].id };
  const finalEvent = { id:"cup-final", stage:"final", round:7, leg:1, status:"running", fixtureIds:[finalFixture.id] };
  service.state.cup = {
    status:"active",
    stage:"final",
    participants:cupTeams.map((team) => team.id),
    table:{},
    swissRounds:[],
    knockout:{ quarterfinals:[], semifinals:[], final:[{ teams:cupTeams.map((team) => team.id), legs:[finalFixture], winnerId:null }] },
    events:[finalEvent],
    playerStats:{},
    nextRoundAt:now(),
    championId:null,
    startedAt:now(),
    completedAt:null,
  };
  service.distributePredictionProfit = () => {};
  service.grantCupReward = () => {};

  const finalCompletedAt = now();
  service.completeCupEvent(finalEvent);

  assert.equal(service.state.cup.status, "completed");
  assert.equal(service.state.worldCup.startsAt, finalCompletedAt + 20 * 60 * 1000);
  assert.equal(service.state.worldCup.nextEventAt, finalCompletedAt + 20 * 60 * 1000);
  assert.equal(service.worldCupRosterDeadline(), finalCompletedAt + 10 * 60 * 1000);
  assert.deepEqual(service.state.worldCup.teams.map((team) => [team.id, team.ownerId, team.groupId]), assignments);

  assert.equal(service.schedulePreparedWorldCupAfterCupFinal(), false);
  assert.deepEqual(service.state.worldCup.teams.map((team) => [team.id, team.ownerId, team.groupId]), assignments);
  advance(10 * 60 * 1000 - 1);
  assert.equal(now() < service.worldCupRosterDeadline(), true);
  advance(1);
  assert.equal(now() >= service.worldCupRosterDeadline(), true);
});

test("admin can bootstrap today's World Cup after the cup final already completed", () => {
  const { service, now } = worldCupService();
  service.bootstrapWorldCup(now() + 5 * 60 * 1000);

  assert.equal(service.state.worldCup.status, "preparation");
  assert.equal(service.state.worldCup.teams.length, 12);
  assert.equal(service.state.worldCup.groups.length, 3);
  assert.equal(service.state.worldCup.events.length, 3);
  assert.equal(service.state.worldCup.fixtures.length, 18);
  assert.equal(service.state.worldCup.teams.filter((team) => team.isAi).length, 3);
  service.state.worldCup.groups.forEach((group) => {
    const teams = group.teamIds.map((id) => service.worldCupTeam(id));
    assert.equal(teams.filter((team) => team.isAi).length, 1);
    assert.equal(teams.filter((team) => !team.isAi).length, 3);
  });

  const colombia = service.state.worldCup.teams.find((team) => team.country === "哥伦比亚");
  assert.equal(colombia.roster.length, 23);
  assert.equal(colombia.startingIds.length, 11);
  assert.ok(colombia.roster.some((player) => player.id.includes("-filler-")));
});

test("bootstrap is idempotent and read views do not rebuild temporary players", () => {
  const { service, now } = worldCupService();
  const startsAt = now() + 5 * 60 * 1000;
  service.bootstrapWorldCup(startsAt);
  const worldCup = service.state.worldCup;
  const fillerIds = worldCup.teams.flatMap((team) => team.roster).filter((player) => player.id.includes("-filler-")).map((player) => player.id);

  service.worldCupView("owner-1");
  service.worldCupView("owner-1");
  service.bootstrapWorldCup(startsAt);

  assert.equal(service.state.worldCup, worldCup);
  assert.deepEqual(service.state.worldCup.teams.flatMap((team) => team.roster).filter((player) => player.id.includes("-filler-")).map((player) => player.id), fillerIds);
});

test("World Cup matches enter television and closing clears generated fillers", () => {
  const { service, now } = worldCupService();
  service.bootstrapWorldCup(now() + 5 * 60 * 1000);
  service.startScheduledWorldCupEvent();

  assert.ok(service.broadcasts().length > 0);
  assert.equal(service.broadcasts().every((broadcast) => broadcast.competition === "YellowDogs World Cup"), true);

  service.state.liveWorldCupRound = null;
  service.closeWorldCup();
  assert.equal(service.state.worldCup.status, "closed");
  assert.equal(service.state.worldCup.teams.flatMap((team) => team.roster).some((player) => player.id.includes("-filler-")), false);
  assert.ok(service.state.worldCup.fillersCleanedAt);
});

test("player roster and national-team tactics are persisted before kickoff", () => {
  const { service, advance, now } = worldCupService();
  service.bootstrapWorldCup(now() + 20 * 60 * 1000);
  const account = { id:"owner-1" };
  const team = service.state.worldCup.teams.find((entry) => entry.ownerId === account.id);
  const selectedIds = team.roster.slice(0, 22).map((player) => player.id);
  assert.equal(selectedIds.length, 22);

  service.saveWorldCupRoster(account, selectedIds);
  const starters = team.startingIds;
  const positions = Object.fromEntries(starters.map((id, index) => [id, { x:10 + index * 7, y:20 + index * 5 }]));
  service.saveWorldCupTactics(account, {
    starterIds:starters,
    positions,
    positionPresets:{ position1:positions, position2:positions, position3:positions },
    tacticalPlans:{ opening:{ tactic:"positive", style:"highPress", positionPreset:"position1" } },
    attackFocus:"left",
    defenseFocus:"balanced",
  });

  assert.ok(team.rosterSubmittedAt);
  assert.equal(team.tactics.tacticalPlans.opening.style, "highPress");
  assert.equal(team.tactics.attackFocus, "left");

  advance(10 * 60 * 1000 - 1);
  assert.doesNotThrow(() => service.saveWorldCupRoster(account, selectedIds));
  advance(1);
  assert.throws(() => service.saveWorldCupRoster(account, selectedIds), /大名单已经锁定/);
});

test("all World Cup knockout rounds enable extra time and penalties", () => {
  const { service, now } = worldCupService();
  service.bootstrapWorldCup(now() + 20 * 60 * 1000);
  const [home, away] = service.state.worldCup.teams;
  for (const stage of ["quarterfinal", "semifinal", "final"]) {
    const event = { id:`test-${stage}`, stage, round:4, fixtureIds:[`fixture-${stage}`] };
    const fixture = { id:`fixture-${stage}`, homeId:home.id, awayId:away.id };
    const created = service.createWorldCupMatch(fixture, event, now());
    assert.equal(created.match.regulationOnly, false, `${stage} must allow extra time and penalties`);
    assert.equal(created.match.scheduledDurationMinutes, 120);
  }
});

test("club next-match context never selects a World Cup fixture", () => {
  const { service } = worldCupService();
  service.teamSchedule = () => [
    { status:"scheduled", competition:"worldcup", startsAt:1, opponentName:"国家队对手" },
    { status:"scheduled", competition:"friendly", competitionName:"YDL友谊赛", label:"友谊赛", startsAt:2, opponentName:"俱乐部对手", opponentId:"club-rival", weather:null, referee:null },
  ];

  assert.equal(service.nextOpponent("ydl-team-1").competition, "friendly");
  service.teamSchedule = () => [{ status:"scheduled", competition:"worldcup", startsAt:1, opponentName:"国家队对手" }];
  assert.equal(service.nextOpponent("ydl-team-1"), null);
});
