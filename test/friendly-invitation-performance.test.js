import test from "node:test";
import assert from "node:assert/strict";
import { YellowDogsLeagueService } from "../versus/league-service.js";

const NOW = Date.parse("2026-08-07T11:00:00+08:00");
const account = (id, nickname) => ({ id, nickname });

function join(service, user, teamName) {
  service.beginDraft(user, teamName);
  service.autoDraft(user);
  return service.finishDraft(user);
}

test("accepting a friendly invitation returns a compact receipt without building the full league view", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const inviter = account("friendly-performance-a", "邀请方");
  const receiver = account("friendly-performance-b", "接收方");
  const observer = account("friendly-performance-c", "观众");
  join(service, inviter, "邀请方球队");
  join(service, receiver, "接收方球队");
  join(service, observer, "观众球队");
  service.createFriendlyInvitation(inviter, service.accountTeam(receiver.id).id, { compact:true });
  const invitation = service.state.friendlyInvitations.at(-1);

  service.view = () => { throw new Error("compact friendly response must not build the full league view"); };
  const receipt = service.resolveFriendlyInvitation(receiver, invitation.id, "accept", { compact:true });

  assert.equal(receipt.compact, true);
  assert.equal(receipt.friendlyInvitations.at(-1).status, "accepted");
  assert.ok(receipt.schedule.fixtures.some((fixture) => fixture.competition === "friendly"));
  assert.ok(receipt.inbox.some((message) => message.payload?.friendlyFixtureId === invitation.fixtureId));
  assert.ok(service.state.inbox[service.accountTeam(observer.id).id].some((message) => message.payload?.friendlyFixtureId === invitation.fixtureId));
  assert.equal(Object.hasOwn(receipt, "playerDirectory"), false);
  assert.equal(Object.hasOwn(receipt, "teams"), false);
});

test("rejecting a friendly invitation uses the same compact response without schedule generation", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const inviter = account("friendly-reject-a", "邀请方");
  const receiver = account("friendly-reject-b", "接收方");
  join(service, inviter, "邀请方球队");
  join(service, receiver, "接收方球队");
  service.createFriendlyInvitation(inviter, service.accountTeam(receiver.id).id, { compact:true });
  service.view = () => { throw new Error("compact friendly response must not build the full league view"); };

  const receipt = service.resolveFriendlyInvitation(receiver, service.state.friendlyInvitations.at(-1).id, "reject", { compact:true });
  assert.equal(receipt.compact, true);
  assert.equal(receipt.friendlyInvitations.at(-1).status, "rejected");
  assert.equal(Object.hasOwn(receipt, "schedule"), false);
});
