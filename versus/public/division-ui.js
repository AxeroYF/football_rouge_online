export function divisionStandingsMarkup(league, rows, escape) {
  const format=league.competitionFormat??{};
  const movement=format.movements?.at(-1),names=ids=>(ids??[]).map(id=>escape(league.teams.find(t=>t.id===id)?.name??id)).join('、');
  const board=division=>{
    const teams=league.teams.filter(t=>t.division===division);
    return `<section class="league-panel standings-panel division-panel division-${division}" data-division="${division}"><header><h2>${division}级联赛</h2><span class="division-zone-label ${division==='A'?'relegation':'promotion'}">${division==='A'?'7–8 名降级':'1–2 名升级'}</span></header><div class="league-table-wrap"><table class="league-table"><thead><tr><th>#</th><th>球队</th><th>赛</th><th>胜</th><th>平</th><th>负</th><th>进失</th><th>净胜</th><th>分</th></tr></thead><tbody>${rows(teams)}</tbody></table></div></section>`;
  };
  const tables=format.pendingMigration?`<p class="division-migration">当前比赛结束后切换双级联赛</p><section class="league-panel standings-panel"><table class="league-table"><thead><tr><th>#</th><th>球队</th><th>赛</th><th>胜</th><th>平</th><th>负</th><th>进失</th><th>净胜</th><th>分</th></tr></thead><tbody>${rows(league.teams)}</tbody></table></section>`:`<div class="division-boards">${board('A')}${board('B')}</div>`;
  return `<section class="home-panel home-standing"><header><h2>联赛积分榜</h2></header>${tables}${movement?`<details class="division-movement"><summary>上季升降级</summary><p>升级：${names(movement.promoted)}</p><p>降级：${names(movement.relegated)}</p></details>`:''}</section>`;
}

export function knockoutCupMarkup(league,escape,teamName,timeText,view='tree') {
  const cup=league.cup??{};
  const knockout=cup.knockout??{};
  const ownTeamId=league.ownTeam?.id??null;
  const stages=[
    ['roundOf16','十六强',8],
    ['quarterfinals','八强',4],
    ['semifinals','半决赛',2],
    ['final','决赛',1],
  ];
  const stageLabelMap=Object.fromEntries(stages.map(([k,v])=>[k,v]));

  // Normalize a tie into [teamA, teamB] with per-team leg goals & aggregate
  const analyzeTie=(tie,stage)=>{
    if(!tie) return null;
    const legs=Array.isArray(tie.legs)?tie.legs:[];
    const leg1=legs.find(l=>l.number===1)??legs[0]??null;
    const leg2=stage==='final'?null:(legs.find(l=>l.number===2)??legs[1]??null);
    const t0=tie.teams?.[0]??(leg1?{id:leg1.homeId,name:leg1.homeName}:null);
    const t1=tie.teams?.[1]??(leg1?{id:leg1.awayId,name:leg1.awayName}:null);
    if(!t0||!t1) return null;

    const goalsFor=(leg,teamId,fallbackIndex)=>{
      if(!leg?.score) return null;
      if(leg.homeId&&leg.homeId===teamId) return Number(leg.score[0]);
      if(leg.awayId&&leg.awayId===teamId) return Number(leg.score[1]);
      return Number(leg.score[fallbackIndex]);
    };

    const a1=goalsFor(leg1,t0.id,0);
    const b1=goalsFor(leg1,t1.id,1);
    const a2=stage==='final'?null:goalsFor(leg2,t0.id,1);
    const b2=stage==='final'?null:goalsFor(leg2,t1.id,0);
    const played=a1!=null||a2!=null;
    const aggA=played?(Number(a1??0)+Number(a2??0)):null;
    const aggB=played?(Number(b1??0)+Number(b2??0)):null;

    // Extract penalty shootout aligned to [t0, t1]
    const penLeg=[leg2,leg1].find(l=>Array.isArray(l?.penalties)&&l.penalties.length===2)??null;
    let penA=null,penB=null;
    if(penLeg){
      if(penLeg.homeId===t0.id){ penA=penLeg.penalties[0]; penB=penLeg.penalties[1]; }
      else if(penLeg.awayId===t0.id){ penA=penLeg.penalties[1]; penB=penLeg.penalties[0]; }
      else { penA=penLeg.penalties[0]; penB=penLeg.penalties[1]; }
    }

    const winnerId=tie.winnerId??null;
    const winner=winnerId?(t0.id===winnerId?t0:t1.id===winnerId?t1:(tie.teams?.find(t=>t.id===winnerId)??null)):null;
    const isOwn=Boolean(ownTeamId&&(t0.id===ownTeamId||t1.id===ownTeamId));

    return {
      tie, stage, leg1, leg2, t0, t1,
      a1, b1, a2, b2, aggA, aggB,
      penA, penB, hasPen:penA!=null&&penB!=null,
      played, winnerId, winner, isOwn,
    };
  };

  // Detect player's own club status in the cup for the hero summary
  const ownStatusText=()=>{
    if(!ownTeamId) return '';
    if(cup.championId&&cup.championId===ownTeamId) return '我队已夺得冠军杯';
    for(let s=stages.length-1;s>=0;s--){
      const [key,label]=stages[s];
      const list=knockout[key]??[];
      const match=list.find(t=>t?.teams?.some(tm=>tm.id===ownTeamId));
      if(!match) continue;
      if(match.winnerId===ownTeamId){
        return key==='final'?'我队已夺得冠军杯':`我队已晋级${stages[s+1]?.[1]??'下一轮'}`;
      }
      if(match.winnerId&&match.winnerId!==ownTeamId){
        return `我队止步${label}`;
      }
      return `我队正在征战${label}`;
    }
    return '';
  };

  // Compact two-row bracket card for symmetric tree
  const treeCardMarkup=(tie,stage,slotNumber)=>{
    const isFinal=stage==='final';
    const info=analyzeTie(tie,stage);
    if(!info){
      return `<article class="ko-card is-pending ${isFinal?'is-final':''}" data-ko-slot="${slotNumber}">
        <header class="ko-card-head">
          <span class="ko-slot">${isFinal?'决赛 · 单场决胜':`#${slotNumber}`}</span>
          ${isFinal?'<span class="ko-col-lbl">比分</span>':'<span class="ko-col-lbl">首</span><span class="ko-col-lbl">次</span><span class="ko-col-lbl">总</span>'}
        </header>
        <div class="ko-pending-body">
          <span class="ko-pending-row"><i></i><em>待定</em></span>
          <span class="ko-pending-row"><i></i><em>待定</em></span>
        </div>
      </article>`;
    }

    const {leg1,leg2,t0,t1,a1,b1,a2,b2,aggA,aggB,penA,penB,hasPen,played,winnerId,isOwn}=info;
    const l1Id=leg1?.matchId?escape(leg1.matchId):'';
    const l2Id=leg2?.matchId?escape(leg2.matchId):'';

    const scoreCell=(val,matchId,title)=>{
      const text=val!=null?String(val):'–';
      if(matchId){
        return `<button type="button" class="ko-score-btn" data-league-match-detail="${matchId}" title="${title}">${text}</button>`;
      }
      return `<span class="ko-score-empty">${text}</span>`;
    };

    const rowMarkup=(team,s1,s2,agg,penVal)=>{
      const isWinner=Boolean(winnerId&&winnerId===team.id);
      const isLoser=Boolean(winnerId&&winnerId!==team.id);
      const isOwnRow=Boolean(ownTeamId&&team.id===ownTeamId);
      const rowCls=`ko-team-row${isWinner?' is-winner':''}${isLoser?' is-loser':''}${isOwnRow?' is-own':''}`;
      const aggText=agg!=null?String(agg):'–';
      const penBadge=hasPen&&penVal!=null?`<sup class="ko-pen-sup" title="点球大战">${penVal}</sup>`:'';
      if(isFinal){
        return `<div class="${rowCls}">
          <div class="ko-team-cell">${teamName(team.id,team.name)}${isOwnRow?'<em class="ko-own-tag">我队</em>':''}</div>
          ${l1Id
            ?`<button type="button" class="ko-agg-cell is-clickable" data-league-match-detail="${l1Id}" title="查看决赛详情">${aggText}${penBadge}</button>`
            :`<span class="ko-agg-cell">${aggText}${penBadge}</span>`}
        </div>`;
      }
      return `<div class="${rowCls}">
        <div class="ko-team-cell">${teamName(team.id,team.name)}${isOwnRow?'<em class="ko-own-tag">我队</em>':''}</div>
        ${scoreCell(s1,l1Id,'查看首回合比赛详情')}
        ${scoreCell(s2,l2Id,'查看次回合比赛详情')}
        <span class="ko-agg-cell">${aggText}${penBadge}</span>
      </div>`;
    };

    const headCols=isFinal
      ?`<span class="ko-col-lbl">比分</span>`
      :`${l1Id?`<button type="button" class="ko-col-btn" data-league-match-detail="${l1Id}" title="查看首回合详情">首</button>`:'<span class="ko-col-lbl">首</span>'}
        ${l2Id?`<button type="button" class="ko-col-btn" data-league-match-detail="${l2Id}" title="查看次回合详情">次</button>`:'<span class="ko-col-lbl">次</span>'}
        <span class="ko-col-lbl is-agg">总</span>`;

    const penNote=hasPen?`<em class="ko-pen-pill">点 ${penA}:${penB}</em>`:'';

    return `<article class="ko-card${winnerId?' is-complete':''}${played&&!winnerId?' is-live':''}${isOwn?' is-own-tie':''}${isFinal?' is-final':''}" data-ko-slot="${slotNumber}">
      <header class="ko-card-head">
        <span class="ko-slot">${isFinal?'决赛 · 单场决胜':`#${slotNumber}`}${penNote}</span>
        ${headCols}
      </header>
      <div class="ko-card-body">
        ${rowMarkup(t0,a1,a2,aggA,penA)}
        ${rowMarkup(t1,b1,b2,aggB,penB)}
      </div>
    </article>`;
  };

  // Build symmetric left & right half trees
  const r16=knockout.roundOf16??[];
  const qf=knockout.quarterfinals??[];
  const sf=knockout.semifinals??[];
  const fin=knockout.final?.[0]??null;

  const pairBlock=(cardTop,cardBottom,topDone,botDone)=>`<div class="ko-pair${topDone?' is-top-done':''}${botDone?' is-bot-done':''}">
    <div class="ko-slot-wrap">${cardTop}</div>
    <div class="ko-slot-wrap">${cardBottom}</div>
  </div>`;

  const leftR16=`<div class="ko-col ko-col-r16 is-left">
    <h3 class="ko-col-title"><span>十六强</span><small>两回合</small></h3>
    <div class="ko-col-tracks">
      ${pairBlock(treeCardMarkup(r16[0],'roundOf16',1),treeCardMarkup(r16[1],'roundOf16',2),Boolean(r16[0]?.winnerId),Boolean(r16[1]?.winnerId))}
      ${pairBlock(treeCardMarkup(r16[2],'roundOf16',3),treeCardMarkup(r16[3],'roundOf16',4),Boolean(r16[2]?.winnerId),Boolean(r16[3]?.winnerId))}
    </div>
  </div>`;

  const leftQf=`<div class="ko-col ko-col-qf is-left">
    <h3 class="ko-col-title"><span>八强</span><small>两回合</small></h3>
    <div class="ko-col-tracks">
      ${pairBlock(treeCardMarkup(qf[0],'quarterfinals',1),treeCardMarkup(qf[1],'quarterfinals',2),Boolean(qf[0]?.winnerId),Boolean(qf[1]?.winnerId))}
    </div>
  </div>`;

  const leftSf=`<div class="ko-col ko-col-sf is-left">
    <h3 class="ko-col-title"><span>半决赛</span><small>两回合</small></h3>
    <div class="ko-col-tracks">
      <div class="ko-single${sf[0]?.winnerId?' is-done':''}">${treeCardMarkup(sf[0],'semifinals',1)}</div>
    </div>
  </div>`;

  const rightSf=`<div class="ko-col ko-col-sf is-right">
    <h3 class="ko-col-title"><span>半决赛</span><small>两回合</small></h3>
    <div class="ko-col-tracks">
      <div class="ko-single${sf[1]?.winnerId?' is-done':''}">${treeCardMarkup(sf[1],'semifinals',2)}</div>
    </div>
  </div>`;

  const rightQf=`<div class="ko-col ko-col-qf is-right">
    <h3 class="ko-col-title"><span>八强</span><small>两回合</small></h3>
    <div class="ko-col-tracks">
      ${pairBlock(treeCardMarkup(qf[2],'quarterfinals',3),treeCardMarkup(qf[3],'quarterfinals',4),Boolean(qf[2]?.winnerId),Boolean(qf[3]?.winnerId))}
    </div>
  </div>`;

  const rightR16=`<div class="ko-col ko-col-r16 is-right">
    <h3 class="ko-col-title"><span>十六强</span><small>两回合</small></h3>
    <div class="ko-col-tracks">
      ${pairBlock(treeCardMarkup(r16[4],'roundOf16',5),treeCardMarkup(r16[5],'roundOf16',6),Boolean(r16[4]?.winnerId),Boolean(r16[5]?.winnerId))}
      ${pairBlock(treeCardMarkup(r16[6],'roundOf16',7),treeCardMarkup(r16[7],'roundOf16',8),Boolean(r16[6]?.winnerId),Boolean(r16[7]?.winnerId))}
    </div>
  </div>`;

  const centerFinal=`<div class="ko-col ko-col-final">
    <div class="ko-trophy-stage">
      <div class="ko-trophy-glow" aria-hidden="true"></div>
      <img class="ko-trophy-img" src="/versus/assets/cup-trophy.png" alt="冠军杯奖杯" loading="eager" decoding="async" />
      <span class="ko-trophy-eyebrow">CHAMPIONS CUP FINAL</span>
    </div>
    <div class="ko-final-wrap">${treeCardMarkup(fin,'final',1)}</div>
    ${cup.championName?`<div class="ko-champion-banner"><small>本季冠军</small><b>${escape(cup.championName)}</b></div>`:`<div class="ko-final-hint">${cup.nextRoundAt?`下一轮：${timeText(cup.nextRoundAt)}`:'单场决胜 · 捧起大耳朵杯'}</div>`}
  </div>`;

  const card=(tie,stage,index)=>{
    if(!tie)return `<article class="knockout-tie is-pending"><header>${index+1}</header><p>待定</p></article>`;
    const aggregate=tie.legs.reduce((a,l,i)=>l.score?[a[0]+l.score[i?1:0],a[1]+l.score[i?0:1]]:a,[0,0]);
    const played=tie.legs.some(l=>l.score),winner=tie.teams.find(t=>t.id===tie.winnerId);
    const legs=tie.legs.map(leg=>`<button type="button" class="knockout-leg" ${leg.matchId?`data-league-match-detail="${escape(leg.matchId)}"`:'disabled'}>${stage==='final'?'':`<small>${leg.number===1?'首回合':'次回合'}</small>`}<span>${teamName(leg.homeId,leg.homeName)}</span><b>${leg.score?`${leg.score[0]} : ${leg.score[1]}`:'—'}</b><span>${teamName(leg.awayId,leg.awayName)}</span>${leg.penalties?`<em>点球 ${leg.penalties.join(' : ')}</em>`:''}</button>`).join('');
    return `<article class="knockout-tie ${winner?'is-complete':''}"><header><span>${index+1}</span>${played&&stage!=='final'?`<strong>总比分 ${aggregate.join(' : ')}</strong>`:''}</header>${legs}${winner?`<footer>${stage==='final'?'冠军':'晋级'}：${escape(winner.name)}</footer>`:''}</article>`;
  };
  const roundListMarkup=`<div class="knockout-scroll"><div class="knockout-stages">${stages.map(([stage,title,count])=>`<section class="knockout-stage" data-cup-stage="${stage}"><h2>${title}<small>${stage==='final'?'单场':'两回合'}</small></h2><div class="knockout-stage-ties">${Array.from({length:count},(_,i)=>card(cup.knockout?.[stage]?.[i],stage,i)).join('')}</div></section>`).join('')}</div></div>`;
  const currentStageText=cup.championId?'已完赛':stageLabelMap[cup.stage]??'未开赛';
  const ownStatus=ownStatusText();

  return `<section class="knockout-page ko-page">
    <input class="ko-view-radio" type="radio" name="yffm-cup-view" id="yffm-cup-view-tree" aria-label="对阵树" ${view==='tree'?'checked':''} />
    <input class="ko-view-radio" type="radio" name="yffm-cup-view" id="yffm-cup-view-rounds" aria-label="轮次赛程" ${view==='rounds'?'checked':''} />
    <header class="ko-hero">
      <div class="ko-hero-title">
        <div class="ko-hero-badges">
          <span class="ko-eyebrow">CHAMPIONS CUP</span>
          <span class="ko-stage-pill">${escape(currentStageText)}</span>
          ${ownStatus?`<span class="ko-own-status">${escape(ownStatus)}</span>`:''}
        </div>
        <h1>${cup.championName?`${escape(cup.championName)} · 冠军杯冠军`:'冠军杯 · 淘汰赛对阵图'}</h1>
      </div>
      <div class="ko-hero-actions">
        ${cup.nextRoundAt?`<span class="ko-next-time"><small>下轮开赛</small><b>${timeText(cup.nextRoundAt)}</b></span>`:''}
        <div class="ko-view-switch" role="group" aria-label="冠军杯视图切换">
          <label for="yffm-cup-view-tree" class="ko-switch-btn ko-switch-tree">对阵树</label>
          <label for="yffm-cup-view-rounds" class="ko-switch-btn ko-switch-rounds">轮次赛程</label>
        </div>
      </div>
    </header>
    <div class="ko-arena">
      <div class="ko-arena-bg" aria-hidden="true"></div>
      <div class="ko-arena-scrim" aria-hidden="true"></div>
      <div class="ko-tree-scroll">
        <div class="ko-bracket-symmetric">
          ${leftR16}${leftQf}${leftSf}${centerFinal}${rightSf}${rightQf}${rightR16}
        </div>
      </div>
      <div class="ko-rounds-view">
        ${roundListMarkup}
      </div>
    </div>
  </section>`;
}
