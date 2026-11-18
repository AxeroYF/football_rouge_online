export function divisionOverviewMarkup(league, rows, escape) {
  const format=league.competitionFormat??{},own=league.ownTeam;
  const movement=format.movements?.at(-1),names=ids=>(ids??[]).map(id=>escape(league.teams.find(t=>t.id===id)?.name??id)).join('、');
  const board=division=>{
    const teams=league.teams.filter(t=>t.division===division);
    return `<section class="league-panel standings-panel division-panel division-${division}" data-division="${division}"><header><h2>${division}级联赛</h2><span class="division-zone-label ${division==='A'?'relegation':'promotion'}">${division==='A'?'7–8 名降级':'1–2 名升级'}</span></header><div class="league-table-wrap"><table class="league-table"><thead><tr><th>#</th><th>球队</th><th>赛</th><th>胜</th><th>平</th><th>负</th><th>进失</th><th>净胜</th><th>分</th></tr></thead><tbody>${rows(teams)}</tbody></table></div></section>`;
  };
  const tables=format.pendingMigration?`<p class="division-migration">当前比赛结束后切换双级联赛</p><section class="league-panel standings-panel"><table class="league-table"><thead><tr><th>#</th><th>球队</th><th>赛</th><th>胜</th><th>平</th><th>负</th><th>进失</th><th>净胜</th><th>分</th></tr></thead><tbody>${rows(league.teams)}</tbody></table></section>`:`<div class="division-boards">${board('A')}${board('B')}</div>`;
  return `<section class="division-hero"><div><h1>联赛</h1><p>${escape(league.season.name)}${own?` · 本队 ${escape(own.division??'待定')} 级`:''}</p></div><div class="division-season"><strong>${league.season.currentRound}<span> / ${league.season.totalRounds} 轮</span></strong><small>${league.season.status==='completed'?'已完赛':league.season.status==='registration'?'报名中':'进行中'}</small></div></section>${tables}${movement?`<details class="division-movement"><summary>上季升降级</summary><p>升级：${names(movement.promoted)}</p><p>降级：${names(movement.relegated)}</p></details>`:''}`;
}

export function knockoutCupMarkup(league,escape,teamName,timeText) {
  const cup=league.cup??{}, stages=[['roundOf16','十六强',8],['quarterfinals','八强',4],['semifinals','半决赛',2],['final','决赛',1]];
  const card=(tie,stage,index)=>{
    if(!tie)return `<article class="knockout-tie is-pending"><header>${index+1}</header><p>待定</p></article>`;
    const aggregate=tie.legs.reduce((a,l,i)=>l.score?[a[0]+l.score[i?1:0],a[1]+l.score[i?0:1]]:a,[0,0]);
    const played=tie.legs.some(l=>l.score),winner=tie.teams.find(t=>t.id===tie.winnerId);
    const legs=tie.legs.map(leg=>`<button type="button" class="knockout-leg" ${leg.matchId?`data-league-match-detail="${escape(leg.matchId)}"`:'disabled'}>${stage==='final'?'':`<small>${leg.number===1?'首回合':'次回合'}</small>`}<span>${teamName(leg.homeId,leg.homeName)}</span><b>${leg.score?`${leg.score[0]} : ${leg.score[1]}`:'—'}</b><span>${teamName(leg.awayId,leg.awayName)}</span>${leg.penalties?`<em>点球 ${leg.penalties.join(' : ')}</em>`:''}</button>`).join('');
    return `<article class="knockout-tie ${winner?'is-complete':''}"><header><span>${index+1}</span>${played&&stage!=='final'?`<strong>总比分 ${aggregate.join(' : ')}</strong>`:''}</header>${legs}${winner?`<footer>${stage==='final'?'冠军':'晋级'}：${escape(winner.name)}</footer>`:''}</article>`;
  };
  return `<section class="knockout-page"><header class="division-hero"><div><h1>${cup.championName?escape(cup.championName)+' · 杯赛冠军':'冠军杯'}</h1></div><aside><b>${stages.find(s=>s[0]===cup.stage)?.[1]??(cup.status==='completed'?'已完赛':'未开赛')}</b>${cup.nextRoundAt?`<p>${timeText(cup.nextRoundAt)}</p>`:''}</aside></header><div class="knockout-scroll"><div class="knockout-stages">${stages.map(([stage,title,count])=>`<section class="knockout-stage" data-cup-stage="${stage}"><h2>${title}<small>${stage==='final'?'单场':'两回合'}</small></h2><div class="knockout-stage-ties">${Array.from({length:count},(_,i)=>card(cup.knockout?.[stage]?.[i],stage,i)).join('')}</div></section>`).join('')}</div></div></section>`;
}
