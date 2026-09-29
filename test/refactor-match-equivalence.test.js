import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {simulateV2Match} from '../engine/s4-v2.1/versus/v2/match-engine-v2.js';
import {refactorMatchTeams, refactorMatchCases} from './fixtures/refactor-match-cases.mjs';

const golden=JSON.parse(readFileSync(new URL('./fixtures/r43-match-fingerprints.json',import.meta.url),'utf8'));
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
test('R43 deterministic match input has not drifted',()=>{
  assert.equal(digest({teams:refactorMatchTeams(),cases:refactorMatchCases}),golden.input);
});
for(const options of refactorMatchCases)test(`R43 complete match and replay equivalence: ${options.seed} ${options.weather}`,()=>{
  // JSON excludes only the RNG function. It includes its numeric state, every
  // event, player consequence, tactical snapshot and generated replay frame.
  assert.equal(digest(simulateV2Match(refactorMatchTeams(),options)),golden.matches[options.seed]);
});
