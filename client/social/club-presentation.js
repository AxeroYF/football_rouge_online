import {representativePlayers} from '../../shared/config/representative-players.mjs';
import {buildAccountMatchSeat} from '../../shared/football/account-match-seat.mjs';
import {createPlayerCardViewModel,playerCardMarkup,escapePlayerCardHtml as esc} from '../player-card/player-card.js';
export const squadNames={expedition:'远征',garrison:'留守',league:'联赛'};
export function clubSquad(state,id='expedition'){
 const all=state?.draft?.roster??[],registration=state?.leagueRegistration;
 const tactics=id==='league'?(registration?.tactics??state?.tactics?.squads?.league):state?.tactics?.squads?.[id];
 const eligible=id==='league'?all.filter(p=>(registration?.playerIds??[]).includes(p.id)):representativePlayers(all).filter(p=>(state?.playerSquads?.assignments?.[p.id]??'garrison')===id);
 const byId=new Map(eligible.map(p=>[String(p.id),p]));
 let seat=null;
 try{seat=buildAccountMatchSeat(structuredClone({id:state.playerId,nickname:state.nickname,draft:state.draft,playerSquads:state.playerSquads,tactics:state.tactics,leagueRegistration:registration,formationResearch:state.formationResearch}),id);}catch{}
 const starters=seat?.players??(tactics?.planSnapshots?.__s4V2?.starters??tactics?.starters??[]).map(id=>byId.get(String(id))).filter(Boolean).slice(0,11);
 return {name:squadNames[id],formation:seat?.formation??tactics?.formation??'待编队',style:seat?.style??tactics?.style,players:starters.map(p=>({player:createPlayerCardViewModel(p),position:seat?.positions?.[p.id]??tactics?.positions?.[p.id]})),roster:eligible.map(createPlayerCardViewModel),average:starters.length?Number((starters.reduce((sum,p)=>sum+Number(p.effectiveOverall??p.overall??0),0)/starters.length).toFixed(1)):null};
}
export function ownClubView(state){
 return {player:{id:state.playerId,nickname:state.nickname,teamName:state.draft?.teamName??'我的俱乐部',color:state.playerColor},selfId:state.playerId,relationship:'self',requests:[],events:[],matches:[],rules:{},squad:clubSquad(state),theirCards:representativePlayers(state.draft?.roster??[]).map(createPlayerCardViewModel),cardCount:representativePlayers(state.draft?.roster??[]).length};
}
export function clubRosterMarkup(roster,total,page=0,loaded=true){
 const size=12,start=page*size;
 return `<section class="interaction-roster"><header class="interaction-section-heading"><h3>球员陈列室 <small>${total??roster.length}</small></h3><span>首发优先 · 球员卡</span></header><div class="club-card-gallery">${roster.slice(start,start+size).map(p=>`<article>${playerCardMarkup(p,{variant:'mini',animated:false,deferred:true})}<i class="club-card-plinth" aria-hidden="true"></i><span>${esc(p.name)}</span></article>`).join('')||(!loaded?'<button class="ui-button" data-interaction-action="cards-load">查看俱乐部球员卡 →</button>':'<p>暂无球员</p>')}</div>${roster.length>size?`<nav class="club-gallery-pages" aria-label="球员卡翻页"><button class="ui-button" data-interaction-action="roster-prev" ${page===0?'disabled':''}>上一页</button><span>${page+1} / ${Math.ceil(roster.length/size)}</span><button class="ui-button" data-interaction-action="roster-next" ${start+size>=roster.length?'disabled':''}>下一页</button></nav>`:''}</section>`;
}
