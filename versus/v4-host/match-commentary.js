// Hybrid Match Commentary Engine (V4)
// Set A (Pro Broadcast High-Energy) for core play & rhythm;
// Set B (Entertainment Punchlines) for dramatic incidents, traits, spirit possession & blunders.
// Strictly deterministic (keyed by event id) and plain-JSON serializable for checkpoints.

const PHASES = {
  spiritPossession: 'spiritPossession',
  kickoff: 'kickoff',
  periodStart: 'kickoff',
  halfTime: 'halftime',
  addedTime: 'addedTime',
  fulltime: 'fulltime',
  matchEnd: 'fulltime',
  abandoned: 'abandoned',
  shootoutStart: 'penaltyShootoutStart',
  endsChanged: 'kickoff',
};

const DUELS = {
  interception: 'interception',
  tackle: 'tackle',
  block: 'block',
  woodwork: 'woodwork',
  secondBall: 'secondBall',
  foul: 'foul',
  offside: 'offside',
  save: 'save',
  parry: 'save',
  keeperSpill: 'keeperSpill',
};

const INCIDENTS = {
  blackWhistle: 'blackWhistle',
  brawl: 'brawl',
  lightning: 'lightning',
  weather: 'weather',
  weatherInjury: 'weatherInjury',
  matchInjury: 'matchInjury',
  traitActivated: 'traitActivated',
  emergencyKeeper: 'emergencyKeeper',
  tactical: 'tactical',
  injury:'injury', substitution:'substitution', replacementUnavailable:'replacementUnavailable', bondActive:'bondActive', captainBoost:'captainBoost',
  yellowCard: 'yellow',
  redCard: 'red',
  shootoutResult: 'penaltyShootoutKick',
};

const RESTARTS = {
  corner: '角球',
  freeKick: '任意球',
  directFreeKick: '直接任意球',
  indirectFreeKick: '间接任意球',
  penalty: '点球',
  throwIn: '界外球',
  goalKick: '球门球',
};

const pick = (list, seed) => list[Math.abs(Math.floor(Number(seed) || 0)) % list.length];

function findPlayer(teams,side,key) {
  const id=key?.slice(2),team=teams?.[side];
  if (!id || !team) return null;
  return team.players?.find(p=>p.id===id) ?? team.bench?.find(p=>p.id===id);
}

function formatRegularGoal({ scorer, assister, team, result, score, minute, count, isHeader, seed, confirmedLate = false }) {
  const isLate = confirmedLate && minute >= 85 && (result === '取得领先' || result === '扳平比分');
  if (isLate) {
    if (result === '扳平比分') {
      return pick([
        `绝平！第 ${Math.floor(minute)} 分钟，${scorer}顶住千钧压力把${team}从悬崖边拉了回来，${score}！`,
        `读秒绝平！比赛所剩无几，${scorer}挺身而出改写结局，全场沸腾，${score}！`,
      ], seed);
    }
    return pick([
      `绝杀！第 ${Math.floor(minute)} 分钟，${scorer}一剑封喉！${team}在最后时刻完成致命一击，${score}！`,
      `这就是足球！第 ${Math.floor(minute)} 分钟，${scorer}读秒破门绝杀比赛，${team}沸腾了，${score}！`,
    ], seed);
  }
  if (count >= 4) {
    return `封神之夜！${scorer}打进本场第 ${count} 球，对手防线在他面前形同虚设，${score}！`;
  }
  if (count === 3) {
    return pick([
      `帽子戏法！${scorer}今夜势不可挡，个人第三球彻底点燃全场，${score}！`,
      `戴帽封王！${scorer}完成帽子戏法，${team}${result}，${score}！`,
    ], seed);
  }
  if (count === 2) {
    return pick([
      `梅开二度！${scorer}状态火热再下一城，完全统治了这片禁区，${score}！`,
      `又是他！${scorer}完成梅开二度，${team}${result}，${score}！`,
    ], seed);
  }
  if (isHeader) {
    return pick([
      `力压防线！${scorer}高高跃起将球狠狠砸进大门，${team}用一记教科书头球${result}，${score}！`,
      `制空权拉满！${scorer}门前甩头攻门直挂死角，${team}${result}，${score}！`,
    ], seed);
  }
  if (assister) {
    return pick([
      `球进了！${scorer}接${assister}精准输送冷静推射得手，${team}${result}，${score}！`,
      `精妙连线！${assister}送出手术刀直塞，${scorer}一击致命，${team}${result}，${score}！`,
    ], seed);
  }
  return pick([
    `漂亮！${scorer}在禁区腹地抢出半步空间果断起脚，皮球直窜网窝，${team}${result}，${score}！`,
    `球进了！${scorer}抓住机会冷静施射洞穿球门，${team}${result}，${score}！`,
  ], seed);
}

function formatSpecialGoal({ special, ownGoal, actorName, scoringTeam, score, seed }) {
  if (special === 'superWorldie') {
    return pick([
      `穿云箭！！${actorName}在禁区外直接开炮轰出超级世界波，门将飞身扑了个寂寞，${score}！`,
      `离谱世界波！${actorName}这一脚踢完物理引擎都要连夜写检讨，死角无解，${score}！`,
    ], seed);
  }
  if (special === 'butterFingers') {
    return pick([
      `年度下饭名场面！${actorName}手套仿佛抹了猪油，皮球从怀中丝滑钻进自家大门，${scoringTeam}笑纳大礼，${score}！`,
      `致命黄油手！${actorName}接球脱手送出大礼，皮球慢悠悠滚过门线，${score}！`,
    ], seed);
  }
  if (special === 'backpass' || ownGoal) {
    return pick([
      `卧底现身！${actorName}自摆乌龙将球送进自家大门，对面全队起立鼓掌，${score}！`,
      `戏剧乌龙！${actorName}慌乱之中把球碰进自家网窝，${scoringTeam}意外收获进球，${score}！`,
    ], seed);
  }
  return null;
}

export function createMatchCommentary(saved) {
  const state = saved ?? {rows:[],lastPlay:-100,previousPass:null};
  state.goalCounts ??= {};
  state.lastScore ??= [0,0];
  state.shootoutRound ??= state.shootoutKicks ?? 0;
  state.highlights ??= {};
  function pushRow(row) {
    state.rows.push(row);
    if (state.rows.length>110) {
      const expired=state.rows.shift();
      if(expired.importance==='major')state.highlights[expired.id]=expired;
    }
  }

  function consume(events, teams) {
    if (!Array.isArray(events) || !events.length) return;


    for (const e of events) {
      if (e.type === 'stoppage') {
        state.previousPass = null;
        continue;
      }
      if (!PHASES[e.type] && !DUELS[e.type] && !INCIDENTS[e.type] &&
          !['restart','pass','carry','shot','goal'].includes(e.type)) continue;
      if (state.penaltiesStarted && (DUELS[e.type] || ['pass','carry','shot','goal'].includes(e.type))) continue;
      const minute = Number((((e.clock?.baseSeconds ?? 0) + (e.clock?.elapsed ?? e.time ?? 0)) / 60).toFixed(2));
      const side = e.side;
      const team = teams?.[side]?.name ?? '';
      const dir = e.clock?.attackDirections?.[side] ?? (side === 1 ? -1 : 1);
      const x = e.position?.x;
      const depth = Number.isFinite(x) ? (dir === 1 ? x : 105 - x) : null;
      const y = e.position?.y;
      const area = depth == null ? '' : depth >= 70 ? '进攻三区' : depth < 35 ? '后场' : '中场';
      const lane = Number.isFinite(y) ? (y < 18 || y > 50 ? '边路' : '中路') : '';
      const actor = e.actor && !['pass','carry'].includes(e.type) ? findPlayer(teams, side, e.actor) : null;
      const actorName = actor?.name ?? team;

      if (Array.isArray(e.score) && e.score.length===2) state.lastScore=e.score;

      let type = PHASES[e.type] ?? DUELS[e.type] ?? INCIDENTS[e.type];
      let text = e.text;
      let detail;
      let importance = 'normal';
      let level = 'normal';

      if (e.type === 'restart' && RESTARTS[e.restartType]) {
        type = e.restartType === 'corner' ? 'corner' : 'setPiece';
        if (e.restartType === 'penalty') {
          text = `点球！${team}赢得十二码极刑机会，全场屏住呼吸！`;
          importance = 'major';
          level = 'critical';
        }
      }

      if (['pass', 'carry'].includes(e.type) && depth != null && depth >= 70 && e.time - state.lastPlay >= 32) {
        type = 'attack';
        detail = `${team}在${area}${lane}组织进攻`;
      }

      if (DUELS[e.type] && team && Number.isFinite(x)) {
        detail = `${team} · ${area}${lane}`;
      }

      // 3. Polish dramatic & core events
      if (e.type === 'spiritPossession' && actor?.spiritForm) {
        const legend=actor.spiritForm.name;
        text=pick([
          `开局开挂！${team}的 ${actorName}本场成功「请神」，摇来传奇【${legend} +4】代打出战！`,
          `法力无边！${team}的 ${actorName}请神降临化身【${legend} +4】体验卡，对面防线开始冒冷汗了！`,
        ],e.id);
        importance='major';level='critical';
      } else if (['bondActive','captainBoost','tactical'].includes(e.type)) {
        importance='major';level='highlight';
      } else if (e.type === 'kickoff') {
        const home = teams?.[0]?.name ?? '主队';
        const away = teams?.[1]?.name ?? '客队';
        text = `哨响开球！${home}迎战${away}，大战一触即发！`;
      } else if (e.type === 'halfTime') {
        const sc = state.lastScore.join(' : ');
        text = minute <= 55
          ? `半场哨响！双方战成 ${sc}，45 分钟的较量精彩纷呈，悬念留到下半场。`
          : `阶段结束，当前比分 ${sc}，双方抓紧喘息准备下一阶段决战！`;
      } else if (e.type === 'addedTime') {
        text = `第四官员举牌，${e.text}，最后时刻每一次触球都可能改写命运！`;
      } else if (e.type === 'fulltime' || e.type === 'matchEnd') {
        const sc = state.lastScore.join(' : ');
        // A late lead or equaliser is only decisive once the final whistle confirms it.
        const late=state.lateGoal;
        if(late && !state.penaltiesStarted && !e.text?.includes('点球大战') && late.score===sc && e.type==='fulltime'){
          const row=state.rows.find(r=>r.id===late.id) ?? state.highlights[late.id];
          if(row)row.text=late.finalText;
        }
        if (e.text?.includes('点球大战')) {
          text = `心跳停拍！点球大战尘埃落定，大心脏一方笑到最后！`;
        } else if (state.lastScore[0] !== state.lastScore[1]) {
          const winTeam = teams?.[state.lastScore[0] > state.lastScore[1] ? 0 : 1]?.name ?? '';
          text = `全场比赛结束！${winTeam}以 ${sc} 拿下这场硬仗，现场掌声雷动！`;
        } else {
          text = `全场比赛结束！双方激战成和，比分最终定格在 ${sc}！`;
        }
        importance = 'major';
      } else if (e.type === 'woodwork') {
        const isBar = String(e.text ?? '').includes('横梁');
        text = isBar
          ? `差之毫厘！${actorName}势大力沉的射门重重砸在横梁上弹回，球门都在震颤！`
          : `太可惜了！${actorName}兜射远角击中立柱外侧弹出，距离破门只差几厘米！`;
        importance = 'major';
        level = 'highlight';
      } else if (e.type === 'save') {
        const isFirstPen = String(e.text ?? '').includes('一夫当关');
        text = isFirstPen
          ? `一夫当关名不虚传！${actorName}提前预判方向，单手把这粒点球稳稳按在怀里！`
          : pick([
            `神扑！${actorName}反应神速飞身将射门稳稳没收，力保球门不失！`,
            `门神附体！${actorName}极限侧扑化解近距离爆射，赢得满堂喝彩！`,
          ], e.id);
        importance = 'major';
        level = 'highlight';
      } else if (e.type === 'parry') {
        text = `门前险情！${actorName}倒地扑救未能拿稳，皮球脱手弹出，禁区瞬间陷入混战！`;
        importance = 'major';
        level = 'highlight';
      } else if (e.type === 'keeperSpill') {
        text = `惊出冷汗！${actorName}接球脱手险些酿成黄油手大祸，后卫吓得差点当场心梗！`;
        importance = 'major';
        level = 'critical';
      } else if (e.type === 'offside') {
        text = pick([
          `边裁举旗！${actorName}启动稍早半个身位被吹越位，极具威胁的进攻无功而返。`,
          `体毛级越位！边裁旗子举得极快，${actorName}白跑一大段遗憾回撤。`,
        ], e.id);
      } else if (e.type === 'blackWhistle') {
        text = pick([
          `懂的都懂！主裁顶着漫天嘘声坚决指向点球点，${team}获得极具“含金量”的争议点球！`,
          `全场嘘声四起！主裁力排众议判给${team}一粒极具争议的点球，比赛火药味瞬间拉满！`,
        ], e.id);
        importance = 'major';
        level = 'critical';
      } else if (e.type === 'brawl') {
        text = pick([
          `全武行开打！双方球员在中场爆发大规模群体冲突，裁判掏红牌掏得手都快抽筋了！`,
          `彻底红温！两队多人卷入激烈推搡，比赛被迫中断，主裁开启批量清场模式！`,
        ], e.id);
        importance = 'major';
        level = 'critical';
      } else if (e.type === 'lightning') {
        const protectedHit = String(e.text ?? '').includes('避雷');
        text = protectedHit
          ? `人形避雷针发威！闪电直劈球场，${actorName}凭借避雷特性硬生生替全队扛下天威！`
          : actor
            ? `天劫降临！球场上空突降惊雷精准点名 ${actorName}，不幸被雷击中，队医紧急入场！`
            : `一道惊雷划破球场上空，所幸场上球员全部躲过一劫！`;
        importance = 'major';
        level = protectedHit ? 'highlight' : 'critical';
      } else if (e.type === 'traitActivated' && e.traitOpening) {
        importance='major';level=e.level ?? 'highlight';
      } else if (e.type === 'traitActivated') {
        const raw = String(e.text ?? '');
        if (raw.includes('红牌') || raw.includes('留场')) {
          text = `免死金牌生效！${actorName}触发红牌免疫特性，主裁摸了摸口袋默默把红牌塞了回去！`;
        } else if (raw.includes('伤退')) {
          text = `这都不伤？${actorName}触发钢筋铁骨免疫伤病，拍拍草屑起身继续满场飞奔！`;
        } else if (raw.includes('承担')) {
          text = `真兄弟替挡刀！${actorName}发动伤情转移替队友硬吃伤害，铁血担当拉满！`;
        }
        importance = 'major';
        if (level === 'normal') level = 'highlight';
      } else if (e.type === 'yellowCard' && String(e.text ?? '').includes('跳水王子')) {
        text = `奥斯卡影帝翻车！${actorName}禁区内教科书式跳水被主裁一眼看穿，喜提黄牌一张！`;
        importance = 'major';
        level = 'highlight';
      } else if (e.type === 'redCard') {
        const isSecondYellow = String(e.text ?? '').includes('两黄');
        text = isSecondYellow
          ? `两黄变红！${actorName}累计两张黄牌提前打卡下班，${team}接下来只能少打一人苦苦支撑！`
          : `红牌罚下！${actorName}被直接逐出场外，队友只能少打一人继续苦撑！`;
        importance = 'major';
        level = 'critical';
      } else if (e.type === 'emergencyKeeper') {
        text = `临危受命！没有可用门将替补，场上球员 ${actorName}戴上手套临时客串门将！`;
        importance = 'major';
        level = 'highlight';
      } else if (e.type === 'shootoutStart') {
        state.shootoutRound = 0;state.penaltiesStarted=true;
        text = `进入点球大战！常规与加时难分高下，接下来每一脚十二码都将直接决定命运！`;
        importance = 'major';
        level = 'critical';
      } else if (e.type === 'shootoutResult') {
        state.shootoutRound += 1;
        const roundNo = Math.ceil(state.shootoutRound / 2);
        const penScore = Array.isArray(e.shootoutScore) ? e.shootoutScore.join(' : ') : '';
        text = e.goal
          ? `点球大战第 ${roundNo} 轮，${actorName}顶住窒息压力稳稳罚入！点球比分 ${penScore}。`
          : `点球大战第 ${roundNo} 轮，${actorName}主罚未进！压力瞬间给到对手！${penScore ? `点球比分 ${penScore}。` : ''}`;
        importance = 'major';
        level = 'critical';
      }

      if (e.type === 'shot' || e.type === 'goal') {
        type = e.type;
        const last = state.previousPass;
        if (last && last.side === side && e.time - last.time <= 8) {
          detail = `${last.text}，随后完成${e.type === 'shot' ? '射门' : '破门'}`;
        } else if (team && Number.isFinite(x)) {
          detail = `${team} · ${area}${lane}`;
        }
      }

      // 4. Goal enrichment (regular + brace/hat-trick + 85'+ late drama + special worldie/blunder)
      if (e.type === 'goal' && [0, 1].includes(e.scoringSide) && Array.isArray(e.score)) {
        const scoring = teams?.[e.scoringSide];
        const scoringName = scoring?.name ?? '';
        const scoreStr = e.score.join(' : ');
        const delta = e.score[e.scoringSide] - e.score[1 - e.scoringSide];
        const result = delta === 0 ? '扳平比分' : delta === 1 ? '取得领先' : delta > 1 ? '扩大领先优势' : '追回一球';
        let count = 0;
        if (e.actor && !e.ownGoal) {
          count = (state.goalCounts[e.actor] ?? 0) + 1;
          state.goalCounts[e.actor] = count;
        }
        const assister = e.assistId && !e.ownGoal ? findPlayer(teams,e.scoringSide,`${e.scoringSide}:${e.assistId}`)?.name : null;
        const args={scorer:actorName || scoringName,assister,team:scoringName,result,score:scoreStr,minute,count,isHeader:e.bodyPart==='head',seed:e.id};
        const specialActor=e.special==='butterFingers' ? findPlayer(teams,1-e.scoringSide,e.keeperKey)?.name ?? '门将' : actorName;
        const specialText=formatSpecialGoal({special:e.special,ownGoal:e.ownGoal,actorName:specialActor,scoringTeam:scoringName,score:scoreStr,seed:e.id});
        text = e.sponsorGoal ? e.text : specialText ?? formatRegularGoal(args);
        const milestone=count===2?'梅开二度':count===3?'帽子戏法':count>=4?`个人第${count}球`:'';
        if(milestone && !text.includes(milestone) && (count<=3||specialText||e.sponsorGoal))text+=` ${milestone}！`;
        if(assister)text+=` 助攻：${assister}。`;
        state.lateGoal=null;
        if(minute>=85 && (delta===0||delta===1)){
          const verdict = delta === 0 ? '绝平' : '绝杀';
          const keepPlayDescription = milestone || specialText || assister || e.sponsorGoal || args.isHeader;
          const finalText = keepPlayDescription
            ? text + ` 这一球成为${scoringName}的${verdict}！`
            : formatRegularGoal({...args,confirmedLate:true});
          state.lateGoal = {id:`v4-${e.id}`,score:scoreStr,finalText};
          text='比赛尾声，'+text;
        }
        importance = 'major';
        level = 'critical';
      }

      if (e.type === 'pass') {
        state.previousPass = { side, time: e.time, text: e.text, actorName };
      }
      if (['kickoff', 'restart', 'stoppage', 'halfTime', 'interception', 'tackle'].includes(e.type)) {
        state.previousPass = null;
      }

      if (!type || !text) continue;
      const routine = ['tackle', 'interception', 'secondBall', 'attack', 'setPiece'].includes(type);
      if (routine && e.time - state.lastPlay < 24) continue;
      state.lastPlay = e.time;

      pushRow({
        id: `v4-${e.id}`,
        type,
        time: e.time,
        minute,
        text,
        teamIndex: e.type === 'goal' && [0, 1].includes(e.scoringSide) ? e.scoringSide : side,
        actorId:e.actor?.slice(2) ?? null,
        ...(e.type==='shootoutResult'?{shootoutGoal:e.goal===true}:{}),
        ...(detail ? {detail} : {}),
        importance,
        level,
      });

    }
  }

  return {
    consume,
    state,
    feed(important = []) {
      const rows = new Map([...Object.entries(state.highlights),...state.rows.map(r => [r.id, r])]);
      for (const e of important ?? []) {
        const line = rows.get(e.id);
        rows.set(e.id, {
          ...line,
          ...e,
          text: line?.text ?? e.text,
          ...((line?.detail ?? e.detail) != null ? {detail:line?.detail ?? e.detail} : {}),
          level: line?.level ?? e.level,
          importance: e.importance === 'major' || line?.importance === 'major' ? 'major' : 'normal',
        });
      }
      return [...rows.values()].sort((a, b) => Number(a.id.slice(3)) - Number(b.id.slice(3)));
    },
  };
}
