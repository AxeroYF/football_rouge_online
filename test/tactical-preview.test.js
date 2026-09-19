import test from "node:test";
import assert from "node:assert/strict";
import {campaignTacticalPreview} from "../server/application/tactical-preview.mjs";
import {createShapePreviewController} from "../client/tactics/shape-preview-controller.js";
import {createCampaignApiHandler} from "../server/http/campaign-api-handler.mjs";

function fixture(){
 const specs=[[50,90,'GK'],[15,70,'LB'],[38,70,'CB'],[62,70,'CB'],[85,70,'RB'],[25,48,'DM'],[50,48,'DM'],[75,48,'DM'],[20,20,'LW'],[50,20,'ST'],[80,20,'RW']];
 const roster=specs.map(([, ,role],i)=>({id:`p${i}`,name:`球员${i}`,role,pool:i===0?'GK':i<5?'DEF':i<8?'MID':'ATT',overall:85,upgradeLevel:i%9}));
 const account={setupComplete:true,draft:{roster},tactics:{untouched:true}};
 const body={starterIds:roster.map(p=>p.id),positions:Object.fromEntries(specs.map(([x,y],i)=>[`p${i}`,{x,y}])),planState:'opening',plan:{tactic:'balanced',style:'possession',playerDuties:{p9:'advancedForward'}}};
 return {account,body};
}

test('S4 preview produces distinct attack/defense positions from one lineup without changing the save',()=>{
 const {account,body}=fixture(),before=structuredClone({account,body});const result=campaignTacticalPreview(account,body);
 assert.deepEqual(result.frames.map(f=>f.id),['base','attack','defense']);
 const [base,attack,defense]=result.frames;
 assert.equal(base.players.length,11);assert.ok(attack.players.some((p,i)=>p.targetPosition.y!==base.players[i].targetPosition.y));assert.notDeepEqual(attack.players.map(p=>p.targetPosition),defense.players.map(p=>p.targetPosition));
 for(const frame of result.frames)for(const player of frame.players)for(const v of Object.values(player.targetPosition))assert.ok(Number.isFinite(v)&&v>=0&&v<=100);
 assert.deepEqual({account,body},before);
 const retreat=campaignTacticalPreview(account,{...body,plan:{...body.plan,playerDuties:{p9:'deepLyingForward'}}});
 assert.notDeepEqual(attack.players.find(p=>p.id==='p9').targetPosition,retreat.frames[1].players.find(p=>p.id==='p9').targetPosition);
 const leading=campaignTacticalPreview(account,{...body,planState:'leading',positions:{...body.positions,p9:{x:40,y:25}},plan:{...body.plan,inPossessionDetails:{attackDirection:'left'}}});
 assert.equal(leading.scoreState,'leading');assert.equal(leading.attackLane,'farLeft');assert.deepEqual(leading.frames[0].players.find(p=>p.id==='p9').targetPosition,{x:40,y:25});
});

test('preview requires eleven distinct owned players and finite positions',()=>{
 const {account,body}=fixture();
 assert.throws(()=>campaignTacticalPreview(account,{...body,starterIds:body.starterIds.slice(1)}),/11/);
 assert.throws(()=>campaignTacticalPreview(account,{...body,starterIds:[...body.starterIds.slice(0,10),'p0']}),/11/);
 assert.throws(()=>campaignTacticalPreview(account,{...body,starterIds:[...body.starterIds.slice(0,10),'foreign']}),/本队/);
 assert.throws(()=>campaignTacticalPreview(account,{...body,positions:{}}),/站位/);
});

test('preview API is authenticated and read-only',async()=>{
 const {account,body}=fixture();const handler=createCampaignApiHandler({campaign:{authenticate(token){assert.equal(token,'own-token');return account;}}});
 const response={writeHead(status){this.status=status;},end(body){this.value=JSON.parse(body);}};
 const request={method:'POST',headers:{authorization:'Bearer own-token'},async *[Symbol.asyncIterator](){yield Buffer.from(JSON.stringify(body));}};
 await handler(request,response,'/api/campaign/tactics/preview','/api/campaign/tactics/preview');assert.equal(response.status,200);assert.equal(response.value.tacticalShapePreview.frames.length,3);
});

function uiFixture(){
 const classes=()=>{const values=new Set();return{add:v=>values.add(v),remove:v=>values.delete(v),toggle:(v,on)=>on?values.add(v):values.delete(v),contains:v=>values.has(v)}};
 const node={dataset:{leagueMagnet:'p1'},style:{left:'50%',top:'70%'},classList:classes()};const pending=[],frames=[],messages=[];
 let overlay=null;
 const board={classList:classes(),querySelectorAll:()=>[node],querySelector:()=>overlay,insertAdjacentHTML(_,html){overlay={html,remove(){overlay=null;}};}};
 const label={textContent:''};const menu={classList:classes(),removeAttribute(){},querySelector:()=>label,querySelectorAll:()=>[]};
 const panel={hidden:false,querySelector:s=>s==='#league-tactics-pitch'?board:menu};
 const controller=createShapePreviewController({panel,request:(url,options)=>new Promise((resolve,reject)=>pending.push({url,options,resolve,reject})),getPayload:()=>({starterIds:['p1']}),showToast:m=>messages.push(m),scheduleFrame:cb=>frames.push(cb)});
 const response=mode=>({tacticalShapePreview:{frames:[{id:mode,players:[{id:'p1',basePosition:{x:50,y:70},targetPosition:{x:40,y:30}}]}]}});
 return {controller,node,pending,frames,panel,board,label,messages,response,overlay:()=>overlay};
}

test('preview transitions to the selected frame and default restores the original board without a request',async()=>{
 const f=uiFixture(),work=f.controller.select('attack');f.pending[0].resolve(f.response('attack'));await work;while(f.frames.length)f.frames.shift()();
 assert.equal(f.node.style.top,'30%');assert.equal(f.label.textContent,'进攻落位');assert.ok(f.overlay().html.includes('50,70 40,30'));
 await f.controller.select('base');assert.equal(f.node.style.top,'70%');assert.equal(f.pending.length,1);assert.equal(f.overlay(),null);assert.equal(f.board.classList.contains('is-tactical-shape-previewing'),false);
});

test('closing, changing plans or switching modes cancels stale responses and animation callbacks',async()=>{
 const f=uiFixture(),old=f.controller.select('attack'),latest=f.controller.select('defense');
 f.pending[1].resolve(f.response('defense'));await latest;f.pending[0].resolve(f.response('attack'));await old;assert.equal(f.label.textContent,'防守落位');
 f.controller.stop();f.panel.hidden=true;while(f.frames.length)f.frames.shift()();assert.equal(f.node.style.top,'70%');assert.equal(f.overlay(),null);
 f.panel.hidden=false;const next=f.controller.select('attack');f.controller.stop();f.pending[2].resolve(f.response('attack'));await next;assert.equal(f.overlay(),null);
});
