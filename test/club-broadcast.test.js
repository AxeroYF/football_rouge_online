import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { YellowDogsLeagueService } from "../versus/league-service.js";

const NOW = Date.parse("2026-08-23T12:00:00+08:00");
const account = { id:"broadcast-club-owner", nickname:"转播经理" };

function createClub() {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  service.beginDraft(account, "转播联队");
  service.autoDraft(account);
  service.finishDraft(account);
  return service;
}

test("AI television receives current stadium settings and meteor background without fan fields", () => {
  const service = createClub();
  service.wallet(account.id).balance = 60_000;
  service.buyMeteorStand(account);
  service.updateClubStadium(account, { name:"潮汐竞技场", standStyle:"classic", backgroundEffect:"meteor", pitchStyle:"checker" });
  const created = service.createAiTraining(account, { formation:"4-3-3", averageOverall:82 });
  assert.deepEqual(created.broadcast.match.stadium, {
    name:"潮汐竞技场",
    standStyle:"classic",
    backgroundEffect:"meteor",
    pitchStyle:"checker",
    sponsors:[],
  });

  service.updateClubStadium(account, { name:"潮汐新主场", standStyle:"steep", backgroundEffect:"none", pitchStyle:"plain" });
  const live = service.liveAiTrainings.get(created.broadcast.code);
  const refreshed = service.broadcastView(live);
  assert.equal(refreshed.match.stadium.name, "潮汐新主场");
  assert.equal(refreshed.match.stadium.standStyle, "steep");
  assert.equal(refreshed.match.stadium.backgroundEffect, "none");
  assert.equal("supporterBanner" in refreshed.match.stadium, false);
  assert.equal("supporterSlogan" in refreshed.match.stadium, false);
});

test("broadcast meteor background node survives commentary refreshes and is hidden on mobile", () => {
  const appSource = readFileSync(new URL("../versus/public/app.js", import.meta.url), "utf8");
  const cssSource = readFileSync(new URL("../versus/public/styles.css", import.meta.url), "utf8");
  const venueCssSource = readFileSync(new URL("../versus/public/broadcast-venue-fix.css", import.meta.url), "utf8");
  const clubCssSource = readFileSync(new URL("../versus/public/club.css", import.meta.url), "utf8");
  assert.match(appSource, /let content = overlay\.querySelector\(":scope > \.broadcast-v2-content"\)/);
  assert.match(appSource, /let layer = overlay\.querySelector\(":scope > \.broadcast-v2-meteor-background"\)[\s\S]*?if \(layer\) return;/);
  assert.match(appSource, /content\.innerHTML = broadcastScreenMarkup\(broadcast\)/);
  assert.doesNotMatch(appSource, /overlay\.innerHTML = broadcastScreenMarkup\(broadcast\)/);
  assert.match(cssSource, /@media\(max-width:820px\)\{\.broadcast-v2-meteor-background\{display:none\}/);
  assert.match(appSource, /broadcast-v2-ad-layout sponsor-stack/);
  assert.doesNotMatch(appSource, /name="adLayout"/);
  assert.doesNotMatch(appSource, /supporterBanner|supporterSlogan|data-club-supporters-form/);
  assert.match(appSource, /mail-home-income/);
  assert.doesNotMatch(appSource, /<b>\$\{escapeHtml\(sponsor\.name\)\}<\/b>/);
  assert.match(venueCssSource, /background:transparent;box-shadow:none/);
  assert.match(venueCssSource, /broadcast-v2-sponsor-board img\{width:100%;height:50px/);
  assert.match(venueCssSource, /Light broadcast venue palette: unified stands and softer grass/);
  assert.match(venueCssSource, /broadcast-v2-field-column\.stand-continuous\{[\s\S]*?repeating-radial-gradient\(ellipse at center,#d7e3dd 0 18px,#eef3f0 19px 31px,#cddbd4 32px 39px\)/);
  assert.match(venueCssSource, /data-league-theme="light"\] \.broadcast-v2-field-column>\.broadcast-v2-stadium\{[\s\S]*?background:transparent;[\s\S]*?box-shadow:none/);
  assert.match(venueCssSource, /pitch-striped \.broadcast-v2-pitch\{background-color:#e7eaee/);
  assert.match(cssSource, /Light broadcast canvas: calm default and daylight meteor palette/);
  assert.match(cssSource, /data-league-theme="light"\] \.broadcast-v2-meteor-background[\s\S]*?rgba\(249,252,255,\.98\)/);
  assert.match(clubCssSource, /stadium-management select\{color-scheme:dark/);
  assert.match(clubCssSource, /stadium-management select option\{color:#eef8f3;background:#071713/);
});