const clamp = (value, minimum = 0, maximum = 100) => Math.max(minimum, Math.min(maximum, value));
const mix = (from, to, progress) => from + (to - from) * progress;

export const V25_PHASES = Object.freeze([
  { id:"restDefense", label:"防守落位", shortLabel:"低位防守", possession:1, carrierRole:"RCM" },
  { id:"recovery", label:"后场夺回球权", shortLabel:"夺回球权", possession:0, carrierRole:"RDM" },
  { id:"buildUp", label:"后场组织", shortLabel:"后场组织", possession:0, carrierRole:"LDM" },
  { id:"progression", label:"整体推进", shortLabel:"整体前压", possession:0, carrierRole:"AM" },
  { id:"finalThird", label:"进入进攻三区", shortLabel:"前场围攻", possession:0, carrierRole:"LW" },
  { id:"boxAttack", label:"禁区进攻", shortLabel:"禁区进攻", possession:0, carrierRole:"AM" },
  { id:"siege", label:"全面压上／全面退守", shortLabel:"半场攻防", possession:0, carrierRole:"AM" },
  { id:"turnover", label:"前场丢失球权", shortLabel:"攻守转换", possession:1, carrierRole:"RCM" },
  { id:"counterLaunch", label:"低位抢断发动反击", shortLabel:"反击启动", possession:1, carrierRole:"LST" },
  { id:"counterDefense", label:"快速反击推进", shortLabel:"反击推进", possession:1, carrierRole:"LST" },
  { id:"counterGoal", label:"反击单刀进球", shortLabel:"射门入网", possession:1, carrierRole:"LST", action:"goal", goalSide:"left" },
  { id:"tackle", label:"关键抢断", shortLabel:"抢断", possession:0, carrierRole:"RDM", action:"tackle", eventRole:"RDM" },
  { id:"dribble", label:"个人带球突破", shortLabel:"带球突破", possession:0, carrierRole:"LW", action:"dribble", eventRole:"LW" },
  { id:"save", label:"门将极限扑救", shortLabel:"门将扑救", possession:0, carrierRole:"ST", action:"save", eventRole:"GK", eventTeam:1 },
  { id:"penalty", label:"点球命中", shortLabel:"罚点球", possession:0, carrierRole:"ST", action:"penalty", goalSide:"right", eventRole:"ST" },
]);

export const V25_DEMO_TEAMS = Object.freeze([
  {
    id:"azure", name:"苍穹竞技", shortName:"苍穹", color:"#55d6ff", outline:"#d8f7ff", direction:1,
    mentality:"积极进攻", shape:"4-2-3-1",
    players:[
      ["GK",1,"门将",7,50],["LB",3,"左卫",20,17],["LCB",4,"左中卫",18,40],["RCB",5,"右中卫",18,60],["RB",2,"右卫",20,83],
      ["LDM",6,"后腰",36,39],["RDM",8,"中场",38,61],["LW",11,"左翼",57,16],["AM",10,"前腰",55,50],["RW",7,"右翼",57,84],["ST",9,"中锋",72,50],
    ].map(([role,number,name,x,y]) => ({ role, number, name, anchor:{ x, y } })),
  },
  {
    id:"crimson", name:"赤焰联队", shortName:"赤焰", color:"#ff6577", outline:"#ffe0e4", direction:-1,
    mentality:"防守反击", shape:"4-4-2",
    players:[
      ["GK",1,"门将",93,50],["LB",3,"左卫",80,83],["LCB",4,"左中卫",82,60],["RCB",5,"右中卫",82,40],["RB",2,"右卫",80,17],
      ["LM",11,"左前卫",62,82],["LCM",6,"中场",61,61],["RCM",8,"中场",61,39],["RM",7,"右前卫",62,18],["LST",9,"前锋",44,60],["RST",10,"前锋",44,40],
    ].map(([role,number,name,x,y]) => ({ role, number, name, anchor:{ x, y } })),
  },
]);

const ROLE_MOBILITY = Object.freeze({
  GK:.18, LCB:.62, RCB:.62, LB:.92, RB:.92, LDM:.86, RDM:.86, LCM:.84, RCM:.84,
  LM:.96, RM:.96, LW:1.08, RW:1.08, AM:1.12, ST:1, LST:1, RST:1,
});

const ATTACK_PHASE = Object.freeze({ restDefense:-.22, recovery:-.12, buildUp:.04, progression:.43, finalThird:.72, boxAttack:.92, siege:1, turnover:.78, counterLaunch:.28, counterDefense:.62, counterGoal:.82 });
const DEFENSE_PHASE = Object.freeze({ restDefense:.74, recovery:.52, buildUp:.35, progression:.12, finalThird:-.2, boxAttack:-.42, siege:-1, turnover:-.1, counterLaunch:.2, counterDefense:.34, counterGoal:.56 });

const SIEGE_ATTACK_X = Object.freeze({ GK:19, LCB:47, RCB:47, LB:65, RB:65, LDM:62, RDM:64, LW:82, RW:82, AM:78, ST:89 });
const SIEGE_DEFENSE_X = Object.freeze({ GK:93, LCB:87, RCB:87, LB:86, RB:86, LM:76, RM:76, LCM:78, RCM:78, LST:66, RST:72 });

function applySpecialPhaseShape(player, teamIndex, phase, attacking, position) {
  if (phase.id === "siege") {
    position.x = (attacking ? SIEGE_ATTACK_X : SIEGE_DEFENSE_X)[player.role] ?? position.x;
    if (!attacking) position.y = 50 + (position.y - 50) * .78;
    if (attacking && ["LCB","RCB","LDM","RDM"].includes(player.role)) position.y = 50 + (position.y - 50) * .82;
  }
  if (["counterLaunch","counterDefense","counterGoal"].includes(phase.id) && attacking) {
    if (["LST","RST"].includes(player.role)) position.x -= player.role === "LST" ? 17 : 9;
    if (["LM","RM"].includes(player.role)) position.x -= 8;
    if (["LCM","RCM"].includes(player.role)) position.x -= 4;
  }
  if (phase.id === "counterGoal" && attacking && player.role === "LST") position.x = 12;
  if (phase.id === "tackle" && attacking && player.role === "RDM") position.x = 51;
  if (phase.id === "dribble" && attacking && player.role === "LW") { position.x = 74; position.y = 29; }
  if (["save","penalty"].includes(phase.id)) {
    if (attacking && player.role === "ST") { position.x = phase.id === "penalty" ? 88 : 78; position.y = 50; }
    if (!attacking && player.role === "GK") {
      position.x = phase.id === "penalty" ? 98 : 91;
      position.y = phase.id === "save" ? 43 : 50;
    }
  }
  if (phase.id === "penalty" && player.role !== "ST" && player.role !== "GK") {
    position.x = player.anchor.x < 50 ? 68 : 76;
    position.y = 50 + (player.anchor.y - 50) * .72;
  }
  return position;
}

function roleLaneAdjustment(player, team, phase, attacking) {
  const role = player.role;
  const carrier = team.players.find((candidate) => candidate.role === phase.carrierRole);
  const ballSide = (carrier?.anchor.y ?? 50) - 50;
  const linePull = attacking ? .18 : .28;
  let lateral = ballSide * linePull;
  if (["LCB","RCB"].includes(role)) lateral *= .55;
  if (role === "GK") lateral *= .22;
  if (attacking && ["LB","RB"].includes(role)) lateral += (player.anchor.y - 50) * .08;
  if (attacking && ["LW","RW","LM","RM"].includes(role)) lateral += (player.anchor.y - 50) * .12;
  return lateral;
}

function roleDepthAdjustment(player, attacking, intensity) {
  const role = player.role;
  if (attacking) {
    if (role === "GK") return intensity * 9;
    if (["LCB","RCB"].includes(role)) return intensity * 23;
    if (["LB","RB"].includes(role)) return intensity * 34;
    if (["LDM","RDM","LCM","RCM"].includes(role)) return intensity * 29;
    if (["LW","RW","LM","RM","AM"].includes(role)) return intensity * 25;
    return intensity * 17;
  }
  if (role === "GK") return intensity * 2;
  if (["LCB","RCB","LB","RB"].includes(role)) return intensity * 13;
  if (["LDM","RDM","LCM","RCM","LM","RM"].includes(role)) return intensity * 24;
  return intensity * 31;
}

export function dynamicTeamShape(team, teamIndex, phase) {
  const attacking = phase.possession === teamIndex;
  const rawIntensity = (attacking ? ATTACK_PHASE[phase.id] : DEFENSE_PHASE[phase.id]) ?? .32;
  const intensity = Math.abs(rawIntensity);
  const movementDirection = attacking ? team.direction : -team.direction;
  const positioned = team.players.map((player, playerIndex) => {
    const mobility = ROLE_MOBILITY[player.role] ?? .85;
    const collectiveShift = roleDepthAdjustment(player, attacking, intensity) * movementDirection * mobility;
    const transitionRecovery = phase.id === "turnover" && !attacking ? -team.direction * (playerIndex % 3) * 1.3 : 0;
    const roleRun = phase.id === "boxAttack" && attacking && ["LW","RW","AM"].includes(player.role) ? team.direction * 7 : 0;
    const special = applySpecialPhaseShape(player, teamIndex, phase, attacking, {
      x:player.anchor.x + collectiveShift + transitionRecovery + roleRun,
      y:player.anchor.y + roleLaneAdjustment(player, team, phase, attacking),
    });
    const x = clamp(special.x, 4, 96);
    const y = clamp(special.y, 5, 95);
    return { ...player, x, y, attacking, displacement:Math.hypot(x - player.anchor.x, y - player.anchor.y) };
  });
  const minimumGap = 7.2;
  for (let pass = 0; pass < 3; pass += 1) {
    for (let firstIndex = 0; firstIndex < positioned.length; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < positioned.length; secondIndex += 1) {
        const first = positioned[firstIndex];
        const second = positioned[secondIndex];
        const deltaX = second.x - first.x;
        const deltaY = second.y - first.y;
        const distance = Math.hypot(deltaX, deltaY);
        if (distance >= minimumGap) continue;
        const direction = deltaY === 0 ? (firstIndex % 2 ? -1 : 1) : Math.sign(deltaY);
        const correction = (minimumGap - distance) / 2 + .3;
        first.y = clamp(first.y - direction * correction, 5, 95);
        second.y = clamp(second.y + direction * correction, 5, 95);
      }
    }
  }
  positioned.forEach((player) => {
    player.displacement = Math.hypot(player.x - player.anchor.x, player.y - player.anchor.y);
  });
  return positioned;
}

export function dynamicFrame(phaseIndex, teams = V25_DEMO_TEAMS, phaseOverride = null) {
  const phase = phaseOverride ?? V25_PHASES[((phaseIndex % V25_PHASES.length) + V25_PHASES.length) % V25_PHASES.length];
  return {
    phase,
    teams:teams.map((team, teamIndex) => ({ ...team, players:dynamicTeamShape(team, teamIndex, phase) })),
  };
}

export function interpolateFrames(from, to, progress) {
  const eased = progress * progress * (3 - 2 * progress);
  return {
    phase:from.phase,
    teams:from.teams.map((team, teamIndex) => ({
      ...team,
      players:team.players.map((player, playerIndex) => ({
        ...player,
        x:mix(player.x, to.teams[teamIndex].players[playerIndex].x, eased),
        y:mix(player.y, to.teams[teamIndex].players[playerIndex].y, eased),
      })),
    })),
  };
}
