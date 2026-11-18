import assert from 'node:assert/strict';
import test from 'node:test';
import {setTimeout as wait} from 'node:timers/promises';
import {createStudioAutosave} from '../admin/public/studio-autosave.js';

test('autosave coalesces edits, separates players, serializes slow uploads and retains failed edits', async () => {
  const calls = [], releases = [];
  const queue = createStudioAutosave({ delay:10, save:(id, value) => {
    calls.push({id, ...value});
    return new Promise((resolve, reject) => releases.push({resolve, reject}));
  }});
  const file = {name:'art.png'};
  queue.change('A', {position:{xPercent:51}, file});
  queue.change('A', {position:{xPercent:52}, file});
  await wait(30);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].position.xPercent, 52);
  queue.change('A', {position:{xPercent:53}, file});
  queue.change('B', {position:{xPercent:10}});
  await queue.flush('A'); // Must not overlap the upload.
  const b = queue.flush('B');
  assert.equal(calls.length, 2);
  assert.equal(calls[1].id, 'B');
  releases[1].resolve({}); await b;
  await wait(20);
  releases[0].resolve({}); await wait(0);
  assert.equal(calls.length, 3);
  assert.equal(calls[2].position.xPercent, 53);
  assert.equal(calls[2].file, null); // Uploaded only once.
  releases[2].reject(new Error('offline')); await wait(0);
  assert.equal(queue.get('A').status, 'error');
  assert.equal(queue.get('A').value.position.xPercent, 53);
  assert.equal(queue.unsettled(), true);
  queue.retry();
  releases[3].resolve({}); await wait(0);
  assert.equal(queue.get('A').status, 'saved');
  assert.equal(queue.unsettled(), false);
});
