import assert from "node:assert/strict";
import test from "node:test";
import { automaticSubstitutionRank, compareAutomaticSubstitutes } from "../versus/automatic-substitution.js";

test("automatic substitutions rank primary, secondary and same-line roles consistently", () => {
  assert.equal(automaticSubstitutionRank("DM", { role:"DM", secondaryRole:"CB" }), 3);
  assert.equal(automaticSubstitutionRank("DM", { role:"CB", secondaryRole:"DM" }), 2);
  assert.equal(automaticSubstitutionRank("DM", { role:"ST", secondaryRole:"AM" }), 1);
  assert.equal(automaticSubstitutionRank("DM", { role:"ST", secondaryRole:"RW" }), 0);
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
