import assert from "node:assert/strict";
import test from "node:test";
import { createAdminApiHandler } from "../server/http/admin-api-handler.mjs";

function responseRecorder(){return{statusCode:null,body:"",writeHead(statusCode){this.statusCode=statusCode;},end(body){this.body=String(body??"");}};}
function postRequest(body){return{method:"POST",headers:{authorization:"Bearer admin-token"},async *[Symbol.asyncIterator](){yield Buffer.from(JSON.stringify(body));}};}

test("admin API lists server players and grants packs to the selected account",async()=>{
  const actor={id:"ADM-1",role:"superadmin"};
  const calls=[];
  const management={players:[{id:"YF-1",nickname:"玩家一",totalPacks:0}],packTypes:[
    {type:"legendary-player-pack",name:"传奇球员卡包"},
    {type:"exotic-player-pack",name:"珍奇球员卡包"},
    {type:"rare-player-pack",name:"稀有球员卡包"},
    {type:"common-player-pack",name:"普通球员卡包"},
  ],maxGrantCount:999};
  const admin={
    authenticate(token){assert.equal(token,"admin-token");return actor;},
    playerPackManagement(value){assert.equal(value,actor);return management;},
    grantPlayerPacks(value,body){assert.equal(value,actor);calls.push(body);return body.scope==="all"?{scope:"all",recipientCount:1,totalPacksGranted:body.count,grant:{type:body.packType,name:"普通球员卡包",count:body.count},reason:body.reason}:{scope:"player",player:{id:body.accountId,nickname:"玩家一"},grant:{type:body.packType,name:"珍奇球员卡包",count:body.count},reason:body.reason};},
  };
  const handler=createAdminApiHandler({admin,campaign:{},players:{}});
  const listing=responseRecorder();
  await handler({method:"GET",headers:{authorization:"Bearer admin-token"}},listing,"/api/admin/player-packs","/api/admin/player-packs");
  assert.equal(listing.statusCode,200);
  assert.deepEqual(JSON.parse(listing.body),management);
  assert.equal(JSON.parse(listing.body).packTypes.length,4);

  const granting=responseRecorder();
  const body={accountId:"YF-1",packType:"exotic-player-pack",count:5,reason:"运营活动"};
  await handler(postRequest(body),granting,"/api/admin/player-packs","/api/admin/player-packs");
  assert.equal(granting.statusCode,200);
  assert.equal(JSON.parse(granting.body).grant.count,5);
  const batchResponse=responseRecorder();
  const batchBody={scope:"all",packType:"common-player-pack",count:2,reason:"全服补偿"};
  await handler(postRequest(batchBody),batchResponse,"/api/admin/player-packs","/api/admin/player-packs");
  assert.equal(JSON.parse(batchResponse.body).totalPacksGranted,2);
  assert.deepEqual(calls,[body,batchBody]);
});
