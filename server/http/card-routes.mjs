import {sendJson} from "./json.mjs";
import {UNHANDLED} from "./route-result.mjs";

export function cardRoutes({campaign, account, request, response, pathname, url, body}) {
    if (pathname === '/api/campaign/card-purchases' && request.method === 'GET') {
      const params=new URL(url,'http://localhost').searchParams;
      return sendJson(response,200,campaign.cardPurchases.list(account,{mine:params.get('mine')==='1',page:params.get('page')}));
    }
    if (pathname === '/api/campaign/card-purchases/options' && request.method === 'GET') return sendJson(response,200,campaign.cardPurchases.options(account));
    if (pathname === '/api/campaign/card-purchases/detail' && request.method === 'GET') return sendJson(response,200,campaign.cardPurchases.detail(account,new URL(url,'http://localhost').searchParams.get('id')));
    if (pathname === '/api/campaign/card-purchases/preview' && request.method === 'POST') return sendJson(response,200,campaign.cardPurchases.preview(account,body));
    if (pathname === '/api/campaign/card-purchases' && request.method === 'POST') {
      const result=campaign.cardPurchases.mutate(account,body);
      return sendJson(response,200,{result});
    }
    if (request.method === "GET" && pathname === "/api/campaign/cards") return sendJson(response, 200, campaign.cardManagementDetails(account));
    if (request.method === "POST" && pathname === "/api/campaign/cards/preview") return sendJson(response, 200, campaign.previewCardManagement(account, body));
    const cardAction = { "/api/campaign/cards/recycle": "recycle", "/api/campaign/cards/trade-up": "trade-up", "/api/campaign/cards/list": "list", "/api/campaign/cards/buy": "buy", "/api/campaign/cards/cancel": "cancel" }[pathname];
    if (request.method === "POST" && cardAction) return sendJson(response, 200, campaign.mutateCardManagement(account, cardAction, body));
  return UNHANDLED;
}
