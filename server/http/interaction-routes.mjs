import {sendJson} from './json.mjs';
import {UNHANDLED} from './route-result.mjs';
import {territoryTradeChoices} from '../application/territory-trade.mjs';

export function interactionRoutes({campaign, account, request, response, pathname, url, body}) {
    if(request.method==='GET'&&pathname==='/api/campaign/interactions/territories'){const other=campaign.diplomacy.other(account,new URL(url,'http://localhost').searchParams.get('playerId'));return sendJson(response,200,territoryTradeChoices(campaign,account,other));}
    if(request.method==='GET'&&pathname==='/api/campaign/players')return sendJson(response,200,{interactions:campaign.diplomacy.summary(account)});
    if(request.method==='GET'&&pathname==='/api/campaign/interactions/cards')return sendJson(response,200,campaign.diplomacy.cards(account,new URL(url,'http://localhost').searchParams.get('playerId')));
    if(request.method==='GET'&&pathname==='/api/campaign/interactions/joint-scout'){const other=campaign.diplomacy.other(account,new URL(url,'http://localhost').searchParams.get('playerId'));return sendJson(response,200,campaign.jointScouting.options(account,other));}
    if(request.method==='GET'&&pathname==='/api/campaign/interactions')return sendJson(response,200,{view:campaign.diplomacy.details(account,new URL(url,'http://localhost').searchParams.get('playerId'),{profile:new URL(url,'http://localhost').searchParams.get('view')==='profile'})});
    if(request.method==='GET'&&pathname==='/api/campaign/interactions/match'){const query=new URL(url,'http://localhost').searchParams;return sendJson(response,200,campaign.diplomacy.snapshot(account,query.get('id'),query.has('afterTick')?Number(query.get('afterTick')):null));}
    if(request.method==='POST'&&pathname==='/api/campaign/interactions') {
      if(['read-news','read'].includes(body.action))return sendJson(response,200,{...campaign.diplomacy.mutate(account,body),acknowledged:true});
      campaign.settleDueChallenges();
      const proposal=campaign.world?.diplomacy?.requests?.[body.proposalId];
      const result=campaign.diplomacy.mutate(account,body);
      if(body.action==='trade'&&body.compact===true)return sendJson(response,200,{...result,proposal:campaign.diplomacy.publicRequest(campaign.world.diplomacy.requests[result.proposalId]),statePatch:{interactions:campaign.diplomacy.summary(account)}});
      if(body.compact===true&&(['joint-scout','reject','cancel','condemn','withdraw-condemnation','friendship'].includes(body.action)||body.action==='accept'&&['joint-scout','trade','friendship'].includes(proposal?.type)&&!(proposal.payload?.giveTerritoryIds?.length||proposal.payload?.takeTerritoryIds?.length)))return sendJson(response,200,{...result,view:campaign.diplomacy.details(account,body.targetId,{profile:true}),statePatch:{interactions:campaign.diplomacy.summary(account),...(body.action==='accept'&&['joint-scout','trade'].includes(proposal?.type)?{...campaign.actionState(account,{includeRoster:proposal?.type!=='joint-scout'}),scouting:campaign.scouting.publicState(account,campaign.world)}:{})}});
      return sendJson(response,200,{...result,view:campaign.diplomacy.details(account,body.targetId,{profile:body.compact===true}),state:campaign.state(account)});
    }

  return UNHANDLED;
}
