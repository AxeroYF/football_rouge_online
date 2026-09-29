import {sendJson} from "./json.mjs";
import {UNHANDLED} from "./route-result.mjs";

export function leagueRoutes({campaign, account, request, response, pathname, url, body}) {
    if(pathname==='/api/campaign/league/registration'&&['GET','POST'].includes(request.method)){
      const registration=request.method==='POST'?campaign.dailyLeague.saveRegistration(account,body):campaign.dailyLeague.registrationView(account);
      return sendJson(response,200,{registration});
    }
    if(request.method==='GET'&&pathname==='/api/campaign/league')return sendJson(response,200,{league:campaign.dailyLeague.view(account)});
    if(request.method==='GET'&&pathname==='/api/campaign/league/match')return sendJson(response,200,campaign.dailyLeague.snapshot(new URL(url,'http://localhost').searchParams.get('id')));
    if(request.method==='POST'&&pathname==='/api/campaign/league/watch')return sendJson(response,200,campaign.dailyLeague.watch(account,body.id,body.session));
    if(request.method==='POST'&&pathname==='/api/campaign/league/leave')return sendJson(response,200,campaign.dailyLeague.leave(account,body.id,body.session));
    if(request.method==='POST'&&pathname==='/api/campaign/league/read')return sendJson(response,200,campaign.dailyLeague.read(account,body.id));
  return UNHANDLED;
}
