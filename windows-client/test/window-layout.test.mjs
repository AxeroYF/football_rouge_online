import test from 'node:test';
import assert from 'node:assert/strict';
import {windowLayout} from '../window-layout.mjs';
test('layout fits small scaled screens and restores valid dimensions',()=>{
 const area={x:-1000,y:20,width:800,height:500};
 for(const launcher of [true,false]){const w=windowLayout(area,{width:4000,height:2000},launcher);assert.ok(w.width<=800&&w.height<=500);assert.ok(w.x>=area.x&&w.y>=area.y);assert.ok(w.minWidth<=w.width&&w.minHeight<=w.height);}
 const w=windowLayout({x:0,y:0,width:1920,height:1080},{width:1100,height:700});assert.equal(w.width,1100);assert.equal(w.height,700);
 assert.equal(windowLayout({x:0,y:0,width:1920,height:1080},{width:'invalid'}).width,1440);
});
