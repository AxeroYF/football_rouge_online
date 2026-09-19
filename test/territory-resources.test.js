import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resourceBudget, validateTerritoryResources, RESOURCE_DEFINITIONS, YIELD_RESOURCE_IDS } from '../shared/config/resources.mjs';
import { territoryResourceMarkup } from '../client/resources/resource-markup.js';
import { createTerritoryPresentation } from '../client/map/territory-presentation.js';
const read=f=>JSON.parse(fs.readFileSync(new URL('../'+f,import.meta.url),'utf8'));
const catalog=read('assets/data/territory-resources.json'),index=read('assets/data/territory-index.json'),survey=read('outputs/territory-resources-20260908/survey.json');
test('all 598 merged territories have valid stable one/two/three-resource profiles',()=>{
 assert.equal(validateTerritoryResources(catalog,index),catalog);assert.equal(Object.keys(catalog.territories).length,598);
 const counts={1:0,2:0,3:0};for(const p of Object.values(catalog.territories)){counts[Object.values(p.yields).filter(Boolean).length]++;assert.ok(resourceBudget(p.yields)>=8&&resourceBudget(p.yields)<=12);}
 assert.equal(counts[1]+counts[2]+counts[3],598);assert.ok(counts[1]>250&&counts[2]>285&&counts[3]>40);
});
test('each continent contains all three yield resources and comparable total budgets',()=>{
 for(const region of Object.values(survey.regions))for(const id of YIELD_RESOURCE_IDS)assert.ok(region.totalHourly[id]>0);
 assert.ok(Math.abs(survey.regions.europe.meanBudget-survey.regions['south-america'].meanBudget)<.1);
 const groups={};for(const t of survey.records){const n=Object.values(t.yields).filter(Boolean).length;(groups[n]??=[]).push(t.budget);}
 const averages=Object.values(groups).map(xs=>xs.reduce((s,n)=>s+n,0)/xs.length);assert.ok(Math.max(...averages)-Math.min(...averages)<.25,'mixed yields do not receive a bigger budget');
});
test('forests and relief favor production, plains favor gold, and real coastal flags are preserved',()=>{
 const coasts=read('assets/data/campaign-coastlines.json');
 for(const t of survey.records){assert.equal(t.terrain.includes('coastal'),Boolean(coasts.territories[t.territoryId]?.coastlines?.length));if(t.mode==='science')continue;
  const production=t.terrain.some(k=>['forest','mountain','hills'].includes(k));assert.ok(production?t.yields.production>=t.yields.gold/12:t.yields.gold/12>=t.yields.production);
 }
 assert.ok(survey.records.filter(t=>t.survey.sampling!=='polygon-grid').length<60);
});
test('resource validation rejects omissions, invalid types, negative or unsupported yields',()=>{
 for(const mutate of [v=>delete v.territories[index.territories[0].territoryId],v=>{v.territories[index.territories[0].territoryId].yields.science=-1;},v=>{v.territories[index.territories[0].territoryId].yields.production=.1;},v=>{v.territories[index.territories[0].territoryId].yields.fans=1;}]){const bad=structuredClone(catalog);mutate(bad);assert.throws(()=>validateTerritoryResources(bad,index));}
});
test('the resource glossary has distinct local icons for the four new concepts',()=>{
 for(const id of ['production','science','fans','sponsorship']){const file=RESOURCE_DEFINITIONS[id].icon;const svg=fs.readFileSync(new URL('../'+file.replace('./',''),import.meta.url),'utf8');assert.match(svg,/<svg/);assert.doesNotMatch(svg,/<script|https?:\/\/(?!www.w3.org)/);}
 assert.equal(new Set(['production','science','fans','sponsorship'].map(id=>RESOURCE_DEFINITIONS[id].icon)).size,4);
});
test('territory tooltip presents the same three rates as detail markup and respects fog',()=>{
 const profile={terrain:['hills','forest'],yields:{gold:24,production:3,science:2}},metadata={territoryId:'tile',country:'测试',name:'测试地块',resources:profile},state={ownerType:'neutral'};
 const detail=territoryResourceMarkup(profile),presentation=createTerritoryPresentation({ownerTypes:{PLAYER:'player',CLUB:'club',NEUTRAL:'neutral'},escapeHtml:s=>String(s),getContext:()=>({})});
 for(const id of YIELD_RESOURCE_IDS){assert.match(detail,new RegExp(`data-resource="${id}"`));assert.match(presentation.territoryTooltipMarkup(metadata,state),new RegExp(`data-resource="${id}"`));}
 const hidden=createTerritoryPresentation({ownerTypes:{PLAYER:'player',CLUB:'club'},escapeHtml:s=>String(s),getContext:()=>({campaignState:{fog:{enabled:true,visibleTerritoryIds:[],exploredTerritoryIds:[]}}})});assert.equal(hidden.territoryTooltipMarkup(metadata,state),'');
 assert.match(detail,/地块产出/);assert.doesNotMatch(detail,/小时/);assert.match(detail,/丘陵 · 森林/);assert.equal(territoryResourceMarkup(null),'');
});

test('hover sources omit zero contributions, escape labels and do not confuse stocks with capacity',async()=>{
 const {resourceSourcesMarkup}=await import('../client/resources/resource-controller.js');
 const state={wallet:{gold:942097},resources:{hourly:{gold:24},current:{production:3,science:2},balances:{production:349,science:112},
   sources:[{id:'a"',label:'德国 · <测试>',yields:{gold:24,production:3,science:0}},{id:'b',label:'法国 · 科技地',yields:{gold:0,production:0,science:2}}]}};
 const gold=resourceSourcesMarkup(state,'gold'),production=resourceSourcesMarkup(state,'production'),science=resourceSourcesMarkup(state,'science');
 assert.match(gold,/每小时收支/);assert.match(gold,/>\+24/);assert.match(gold,/&lt;测试&gt;/);assert.doesNotMatch(gold,/<测试>|科技地|942,097/);
 assert.match(production,/当前贡献/);assert.doesNotMatch(production,/小时|349|<small|<p>/);
 assert.match(science,/科技地/);assert.doesNotMatch(science,/小时|112|德国/);
 assert.match(resourceSourcesMarkup({resources:{sources:[],current:{production:0}}},'production'),/暂无来源/);
 assert.match(resourceSourcesMarkup({resources:{current:{production:3}}},'production'),/明细暂不可用/);
});
