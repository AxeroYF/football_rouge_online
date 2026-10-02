import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createPlayerFilter} from '../client/player-card/player-filter.js';
import {createFeatureNavigation} from '../client/core/feature-navigation.js';

const root=fileURLToPath(new URL('../',import.meta.url));
function files(directory){return readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?files(path.join(directory,entry.name)):/\.(mjs|js)$/.test(entry.name)?[path.join(directory,entry.name)]:[]);}
test('server and shared modules cannot import the client layer',()=>{
  for(const file of [...files(path.join(root,'server')),...files(path.join(root,'shared'))]){
    const source=readFileSync(file,'utf8');
    for(const [,specifier] of source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)["']([^"']+)["']/g)){
      if(!specifier.startsWith('.'))continue;
      const resolved=path.relative(root,path.resolve(path.dirname(file),specifier.split('?')[0])).replaceAll('\\','/');
      assert.ok(!resolved.startsWith('client/'),`${path.relative(root,file)} imports ${specifier}`);
    }
  }
});
test('shared player filtering respects secondary position, enhanced ability and exact upgrade',()=>{
  const player={name:'球员甲',sourceName:'Source',role:'ST',secondaryRole:'RW',club:'Club',nationality:'国家',overall:70,effectiveOverall:85,upgradeLevel:0};
  assert.equal(createPlayerFilter({search:'SOURCE',position:'RW',club:'Club',nationality:'国家',min:80,upgrade:'0'})(player),true);
  assert.equal(createPlayerFilter({upgrade:'1'})(player),false);
  assert.equal(createPlayerFilter({min:86})(player),false);
  assert.equal(createPlayerFilter({search:'Source'},{includeSourceName:false})(player),false);
  assert.equal(createPlayerFilter({club:'Cl'})(player),false);
  assert.equal(createPlayerFilter()({name:'球员乙'}),true);
});
function button(id){
  const element=new EventTarget(),attrs=new Map();
  element.id=id;element.classList={toggle:(name,on)=>attrs.set(name,on)};
  element.setAttribute=(key,value)=>attrs.set(key,value);element.removeAttribute=key=>attrs.delete(key);
  element.attrs=attrs;return element;
}
test('navigation follows IDs after reordering, keeps one active tab, and disposes listeners',()=>{
  const team=button('team'),map=button('map'),inventory=button('inventory');
  const nav=createFeatureNavigation([inventory,team,map]);let opens=0;
  const unsubscribe=nav.on('team',()=>opens++);
  nav.select('team');assert.equal(team.attrs.get('aria-current'),'page');assert.equal(map.attrs.has('aria-current'),false);
  team.dispatchEvent(new Event('click'));assert.equal(opens,1);unsubscribe();team.dispatchEvent(new Event('click'));assert.equal(opens,1);
  nav.on('map',()=>opens++);nav.dispose();map.dispatchEvent(new Event('click'));assert.equal(opens,1);
  nav.select('map');assert.equal(team.attrs.has('aria-current'),false);assert.equal(map.attrs.get('aria-current'),'page');
  assert.throws(()=>nav.select('unknown'));
  assert.throws(()=>createFeatureNavigation([map,map]));
});
