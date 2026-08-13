function roundRobin(values, includeSelf = true) {
  const pairs = [];
  for (let left = 0; left < values.length; left += 1) {
    for (let right = includeSelf ? left : left + 1; right < values.length; right += 1) pairs.push([values[left], values[right]]);
  }
  return pairs;
}

const scenarioCache = new WeakMap();

function scenarioSide(matrix, formationId, profileId) {
  const formation = matrix.formations?.[formationId];
  const profile = matrix.profiles?.[profileId];
  if (!formation) throw new Error(`V2 scenario matrix formation does not exist: ${formationId}`);
  if (!profile) throw new Error(`V2 scenario matrix profile does not exist: ${profileId}`);
  return { formationId, profileId };
}

export function expandV2ScenarioMatrix(matrix = {}) {
  const scenarios = [];
  for (const suite of matrix.suites ?? []) {
    if (suite.enabled === false) continue;
    if (suite.type === "formationRoundRobin") {
      roundRobin(suite.formations ?? [], suite.includeSelf !== false).forEach(([homeFormation, awayFormation], index) => scenarios.push({
        id:`${suite.id}:${homeFormation}-vs-${awayFormation}`,
        suiteId:suite.id,
        category:suite.category ?? "formation",
        tags:suite.tags ?? [],
        home:scenarioSide(matrix, homeFormation, suite.profile),
        away:scenarioSide(matrix, awayFormation, suite.profile),
        sequence:index,
      }));
      continue;
    }
    if (suite.type === "profileRoundRobin") {
      const formations = suite.formations?.length ? suite.formations : [suite.formation];
      roundRobin(suite.profiles ?? [], suite.includeSelf !== false).forEach(([homeProfile, awayProfile], index) => {
        const homeFormation = formations[index % formations.length];
        const awayFormation = formations[(index + Number(suite.awayFormationOffset ?? 0)) % formations.length];
        scenarios.push({
          id:`${suite.id}:${homeProfile}-vs-${awayProfile}:${homeFormation}-vs-${awayFormation}`,
          suiteId:suite.id,
          category:suite.category ?? "tactics",
          tags:suite.tags ?? [],
          home:scenarioSide(matrix, homeFormation, homeProfile),
          away:scenarioSide(matrix, awayFormation, awayProfile),
          sequence:index,
        });
      });
      continue;
    }
    if (suite.type === "explicit") {
      (suite.matchups ?? []).forEach((matchup, index) => scenarios.push({
        id:`${suite.id}:${matchup.id ?? index + 1}`,
        suiteId:suite.id,
        category:matchup.category ?? suite.category ?? "extreme",
        tags:[...(suite.tags ?? []), ...(matchup.tags ?? [])],
        home:scenarioSide(matrix, matchup.home.formation, matchup.home.profile),
        away:scenarioSide(matrix, matchup.away.formation, matchup.away.profile),
        sequence:index,
      }));
      continue;
    }
    throw new Error(`Unsupported V2 scenario matrix suite type: ${suite.type}`);
  }
  if (!scenarios.length) throw new Error("V2 scenario matrix did not generate any scenarios");
  return scenarios;
}

export function v2ScenarioForMatch(config, matchIndex) {
  const matrix = config.scenarioMatrix;
  if (!matrix) return null;
  let scenarios = scenarioCache.get(matrix);
  if (!scenarios) {
    scenarios = expandV2ScenarioMatrix(matrix);
    scenarioCache.set(matrix, scenarios);
  }
  const scenarioIndex = matchIndex % scenarios.length;
  const repetition = Math.floor(matchIndex / scenarios.length);
  const mirrored = matrix.mirrorHomeAway !== false && repetition % 2 === 1;
  const source = scenarios[scenarioIndex];
  const archetypeRotation = matrix.archetypeRotation?.length ? matrix.archetypeRotation : ["standard"];
  const archetypeCycle = matrix.mirrorHomeAway === false ? repetition : Math.floor(repetition / 2);
  const defaultArchetype = archetypeRotation[archetypeCycle % archetypeRotation.length];
  const environmentRotation = matrix.environmentRotation?.length ? matrix.environmentRotation : null;
  const environmentCycle = matrix.mirrorHomeAway === false ? repetition : Math.floor(repetition / 2);
  const home = mirrored ? source.away : source.home;
  const away = mirrored ? source.home : source.away;
  return {
    ...source,
    scenarioIndex,
    repetition,
    mirrored,
    environment:environmentRotation ? environmentRotation[environmentCycle % environmentRotation.length] : null,
    home:{ ...home, sourceSide:mirrored ? "away" : "home", archetype:home.archetype ?? defaultArchetype },
    away:{ ...away, sourceSide:mirrored ? "home" : "away", archetype:away.archetype ?? defaultArchetype },
  };
}

export function v2ScenarioSeatOptions(matrix, side) {
  const formation = matrix.formations[side.formationId];
  const profile = matrix.profiles[side.profileId];
  const openingPlan = {
    tactic:profile.tactic,
    style:profile.style,
    inPossession:profile.inPossession ?? "balanced",
    outOfPossession:profile.outOfPossession ?? "balanced",
    inPossessionDetails:profile.inPossessionDetails,
    outOfPossessionDetails:profile.outOfPossessionDetails,
    tacticalDimensions:profile.tacticalDimensions,
    playerDutyMode:profile.playerDutyMode,
    bondMode:profile.bondMode,
    positionPreset:"position1",
  };
  return {
    formation:side.formationId,
    formationSlots:formation.slots,
    formationLines:formation.formationLines,
    formationTags:formation.tags ?? [],
    shapeRisk:formation.risk ?? "normal",
    tacticalProfileId:side.profileId,
    detailProfileId:profile.detailProfile ?? side.profileId,
    tactic:profile.tactic,
    style:profile.style,
    inPossession:openingPlan.inPossession,
    outOfPossession:openingPlan.outOfPossession,
    inPossessionDetails:profile.inPossessionDetails,
    outOfPossessionDetails:profile.outOfPossessionDetails,
    tacticalDimensions:profile.tacticalDimensions,
    playerDutyMode:profile.playerDutyMode,
    bondMode:profile.bondMode,
    attackFocus:profile.attackFocus ?? "balanced",
    defenseFocus:profile.defenseFocus ?? "balanced",
    lockTacticalProfile:profile.locked !== false,
  };
}
