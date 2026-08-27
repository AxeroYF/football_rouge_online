import assert from "node:assert/strict";
import test from "node:test";
import { automaticSubstitutionRank, compareAutomaticSubstitutes } from "../versus/automatic-substitution.js";

test("automatic substitutions rank primary, secondary and same-line roles consistently", () => {
  assert.equal(automaticSubstitutionRank("DM", { role:"DM", secondaryRole:"CB" }), 3);
  assert.equal(automaticSubstitutionRank("DM", { role:"CB", secondaryRole:"DM" }), 2);
  assert.equal(automaticSubstitutionRank("DM", { role:"ST", secondaryRole:"AM" }), 1);
  assert.equal(automaticSubstitutionRank("DM", { role:"ST", secondaryRole:"RW", traits:["utility-player"] }), 0.5);
  assert.equal(automaticSubstitutionRank("DM", { role:"ST", secondaryRole:"RW" }), 0);
  assert.equal(automaticSubstitutionRank("GK", { role:"ST", traits:["utility-player"] }), 0);
});

test("utility players are a cross-line fallback behind primary, secondary and same-line substitutes", () => {
  const candidates = [
    { id:"utility-cross-line", role:"ST", secondaryRole:"RW", overall:99, traits:["utility-player"] },
    { id:"same-line", role:"AM", overall:70 },
    { id:"secondary", role:"CB", secondaryRole:"DM", overall:65 },
    { id:"primary", role:"DM", overall:60 },
  ];
  candidates.sort((left, right) => compareAutomaticSubstitutes("DM", left, right));
  assert.deepEqual(candidates.map((player) => player.id), ["primary", "secondary", "same-line", "utility-cross-line"]);
});

test("automatic substitutions prefer role fit, then overall, then fitness deterministically", () => {
  const candidates = [
    { id:"same-line", role:"AM", overall:99, state:{ fitness:100 } },
    { id:"secondary-low", role:"CB", secondaryRole:"DM", overall:80, state:{ fitness:100 } },
    { id:"primary-low-fitness", role:"DM", overall:90, state:{ fitness:70 } },
    { id:"primary-high-fitness", role:"DM", overall:90, state:{ fitness:95 } },
    { id:"primary-high-overall", role:"DM", overall:91, state:{ fitness:60 } },
  ];
  candidates.sort((left, right) => compareAutomaticSubstitutes("DM", left, right));
  assert.deepEqual(candidates.map((player) => player.id), [
    "primary-high-overall",
    "primary-high-fitness",
    "primary-low-fitness",
    "secondary-low",
    "same-line",
  ]);
});

test("automatic substitutions can rank by enhanced effective overall", () => {
  const candidates = [
    { id:"higher-base", role:"DM", overall:84, upgradeBonus:0, state:{ fitness:100 } },
    { id:"higher-effective", role:"DM", overall:80, upgradeBonus:7, state:{ fitness:100 } },
  ];
  candidates.sort((left, right) => compareAutomaticSubstitutes(
    "DM",
    left,
    right,
    (player) => player.state.fitness,
    (player) => player.overall + player.upgradeBonus,
  ));
  assert.deepEqual(candidates.map((player) => player.id), ["higher-effective", "higher-base"]);
});
