import test from 'node:test';
import assert from 'node:assert/strict';
import {ART_GRADES,normalizedArtPosition,initialArtPosition,normalizeArtBatch,playerArtPreviewContent,escapeArtHtml} from '../versus/public/player-art-preview.js';
import {shieldCardContent} from '../versus/public/player-card-shield.js';

test('authoring preview uses the game shield renderer for every supported grade',()=>{
  const position={xPercent:57,yPercent:61,widthPercent:147};
  for(const grade of ART_GRADES){
    const player={id:'sample',name:'测试球员',sourceName:'Sample',grade,overall:86,role:'ST',club:'皇家马德里',nationality:'法国'};
    const rendered=playerArtPreviewContent(player,'/sample.webp',position,{imageId:'preview'});
    const expected=shieldCardContent({playerId:'sample',name:player.name,sourceName:player.sourceName,grade,overall:86,role:'ST',club:player.club,nationality:player.nationality,upgradeLevel:0,traits:[],art:{url:'/sample.webp',x:57,y:61,width:147}},
      {imageId:'preview',showArtPlaceholder:true,animated:false,eager:true},escapeArtHtml,v=>String(v).replace(/[^a-z0-9_-]/gi,''));
    assert.equal(rendered,expected);
  }
});
test('position normalization rejects invalid numbers and keeps server limits',()=>{
  assert.throws(()=>normalizedArtPosition({xPercent:'invalid'}));
  assert.deepEqual(normalizedArtPosition({xPercent:-70,yPercent:180,widthPercent:500}),{xPercent:-50,yPercent:150,widthPercent:360});
  const p=initialArtPosition({width:600,height:1000,left:100,top:50,right:500,bottom:950});
  assert.ok(Object.values(p).every(Number.isFinite));
  assert.throws(()=>initialArtPosition({width:10,height:10,left:0,top:0,right:0,bottom:0}));
});
test('batch import preserves identity and rejects X, duplicate IDs and unsafe URLs',()=>{
  const player={id:'p1',grade:'B',name:'球员',imageUrl:'/versus/player_profiles/webp/sample.webp',position:{xPercent:55,yPercent:60,widthPercent:130}};
  assert.deepEqual(normalizeArtBatch({players:[player]})[0],player);
  for(const invalid of [{...player,grade:'X'},{...player,id:''},{...player,imageUrl:'javascript:alert(1)'},{...player,imageUrl:'//external.test/image.png'}])assert.throws(()=>normalizeArtBatch({players:[invalid]}));
  assert.throws(()=>normalizeArtBatch({players:[player,player]}));
});
