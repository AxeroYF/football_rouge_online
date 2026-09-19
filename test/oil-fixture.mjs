import {districtSiteYield,DISTRICT_RULES} from '../shared/buildings/district-yields.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {CampaignService} from '../campaign-service.mjs';
import {BuildingService} from '../server/application/building-service.mjs';
import {EconomyService} from '../server/application/economy-service.mjs';
import {BUILDING_DEFINITIONS} from '../shared/config/buildings.mjs';
import {facilityEffects,STADIUM_CAPACITIES} from '../shared/config/facility-levels.mjs';
import {setAbsence,absenceMatches,healthUnavailable} from '../shared/football/match-availability.mjs';
import {buildingPanelMarkup} from '../client/buildings/building-panel-controller.js';
const H=3600000;
function fixture(){
 let now=1000,saved=null,failure=false;
 const index={territories:Array.from({length:12},(_,i)=>({territoryId:'t'+i,country:'测试',countryCode:'FRA',region:'europe',name:'t'+i,centroid:[2+i,48],bounds:[1+i,47,3+i,49],neighbors:[],landNeighbors:[],cityIds:[],clubIds:[],spawnAllowed:true,initialOwner:{type:'neutral',id:null,name:'中立'}}))};
 const resources={schemaVersion:1,version:'upgrade-fixture',periodMs:H,territories:Object.fromEntries(index.territories.map(t=>[t.territoryId,{terrain:['plains'],yields:{gold:12,production:5,science:1}}]))};
 const catalog=Array.from({length:44},(_,i)=>({id:'p'+i,name:'球员'+i,cardDefinitionId:'p'+i,pool:['GK','DEF','MID','ATT'][i%4],role:['GK','CB','DM','ST'][i%4],grade:i<22?'C':'B',overall:70,attributes:{passing:60,pace:60,finishing:60},state:{fitness:100}}));
 const repository={load:()=>null,save:value=>{if(failure)throw Error('disk failure');saved=structuredClone(value);}};
 const s=new CampaignService({repository,catalog,territoryIndex:index,territoryResources:resources,now:()=>now,random:()=>.1});
 const a={id:'one',nickname:'测试',token:'fixture',setupComplete:true,homeTerritoryId:'t0',gold:5000000,goldLedger:[],resources:{fans:50000},draft:{teamName:'测试',roster:structuredClone(catalog.slice(0,33))},playerSquads:{assignments:Object.fromEntries(catalog.slice(0,33).map((p,i)=>[p.id,i<22?'expedition':'garrison']))}};
 s.accounts.set(a.id,a);s.world.players.one={playerId:'one',territoryIds:index.territories.map(t=>t.territoryId),capitalTerritoryId:'t0'};
 for(const t of Object.values(s.world.territories))Object.assign(t,{ownerType:'player',ownerId:a.id,capitalOf:t.territoryId==='t0'?'one':null,buildings:[]});
 s.world.territories.t0.capitalOf='one';s.buildings.isCoastal=()=>true;
 const hq=s.buildings.ensureCapitalHeadquarters(a,s.world,'t0');hq.level=5;s.save();
 const build=(type,id='t1')=>{const result=s.buildings.build(a,s.world,id,type,'gold');return s.world.territories[id].buildings.find(b=>b.id===result.building.id);};
 const upgrade=(b,id='t1',method='gold',key=`upgrade-${b.id}-${b.level}`)=>s.buildings.upgrade(a,s.world,id,b.id,{buildMethod:method,expectedLevel:b.level,requestId:key});
 return {s,a,hq,build,upgrade,setTime:t=>{now=t;},time:()=>now,fail:value=>{failure=value;},saved:()=>saved};
}


const M=60000;
export function districtFixture(){const f=fixture();f.s.territoryIndex.territories.find(t=>t.territoryId==='t1').landNeighbors=['t0','t2'];f.s.territoryProduction.catalog.territories.t1.terrain=['hills','forest'];f.s.save();return f;}