import test from 'node:test';
import assert from 'node:assert/strict';
import {playerPreviewValues} from '../versus/public/player-preview.js';
test('player previews are independent, cap attributes and leave the source unchanged',()=>{
  const player={overall:90,attributes:{finishing:90,pace:85}};
  const source=structuredClone(player);
  const left=playerPreviewValues(player,1,0),right=playerPreviewValues(player,8,10);
  assert.equal(left.attributes.finishing,91);assert.equal(right.attributes.finishing,99);
  assert.equal(playerPreviewValues(player,8,10,{unlocked:true}).attributes.finishing,113);
  assert.equal(left.attributes.finishing,91);assert.deepEqual(player,source);
  assert.equal(playerPreviewValues(player,99,-200).attributes.pace,1);
});
