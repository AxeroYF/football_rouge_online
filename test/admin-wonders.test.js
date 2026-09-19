import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AdminService } from '../server/application/admin-service.mjs';
import { createAdminApiHandler } from '../server/http/admin-api-handler.mjs';
const catalog = JSON.parse(fs.readFileSync(new URL('../assets/wonders/catalog.json', import.meta.url), 'utf8'));
const actor = { id: 'content-test', username: '编辑测试', role: 'content' };
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ydl-wonder-drafts-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const options = { dataPath: path.join(directory, 'admin-state.json'), wonderCatalog: catalog, bootstrapPassword: 'isolated-test', now: () => 1788768000000 };
  const service = new AdminService(options);
  return { directory, options, service };
}
const save = (service, text = '', revision = 0, id = 'santiago-bernabeu') => service.saveWonderDraft(actor, id, { effectText: text, revision }).wonder;

test('without configured proposals, wonder catalog starts with 24 colored assets and blank effects', t => {
  const { service, options } = fixture(t);
  const before = fs.readFileSync(options.dataPath, 'utf8');
  const view = service.wonderManagement(actor);
  assert.equal(view.wonders.length, 24);
  assert.equal(view.wonders.filter(item => item.region === '欧洲').length, 16);
  assert.equal(view.wonders.filter(item => item.region === '南美洲').length, 8);
  assert.equal(view.wonders.find(item => item.assetId === 'santiago-bernabeu').name, '伯纳乌球场');
  for (const item of view.wonders) { assert.equal(item.effectText, ''); assert.equal(item.revision, 0); assert.equal(item.status, 'empty'); assert.match(item.thumbnail, /\.webp$/); }
  assert.equal(fs.readFileSync(options.dataPath, 'utf8'), before, 'reading is not a save');
});

test('blank drafts, multiline text and clearing persist after service reload with independent wonder records', t => {
  const { service, options } = fixture(t);
  assert.equal(save(service).status, 'draft');
  let reopened = new AdminService(options);
  assert.equal(reopened.wonderManagement(actor).wonders.find(item => item.assetId === 'santiago-bernabeu').revision, 1);
  const text = '  由我填写的待定效果\n保留空行与空格\n\n</textarea><script>globalThis.injected=true</script>  ';
  const result = save(reopened, text, 1);
  save(reopened, '另一座奇观', 0, 'eiffel-tower');
  reopened = new AdminService(options);
  assert.equal(reopened.wonderManagement(actor).wonders.find(item => item.assetId === 'santiago-bernabeu').effectText, text);
  assert.equal(result.updatedBy, actor.username);
  assert.equal(result.updatedAt, options.now());
  save(reopened, '', 2);
  reopened = new AdminService(options);
  const list = reopened.wonderManagement(actor).wonders;
  assert.equal(list.find(item => item.assetId === 'santiago-bernabeu').effectText, '');
  assert.equal(list.find(item => item.assetId === 'santiago-bernabeu').status, 'draft');
  assert.equal(list.find(item => item.assetId === 'eiffel-tower').effectText, '另一座奇观');
  assert.equal(reopened.listAudit().filter(entry => entry.action === 'wonder.draft.save').length, 4);
  assert.equal(reopened.listAudit()[0].details.textLength, 0);
});

test('wonder editing follows content roles; read access does not allow readonly or operator writes', t => {
  const { service } = fixture(t);
  for (const role of ['readonly', 'operator', 'content', 'superadmin']) assert.equal(service.wonderManagement({ ...actor, role }).wonders.length, 24);
  for (const role of ['readonly', 'operator']) assert.throws(() => service.saveWonderDraft({ ...actor, role }, 'eiffel-tower', { effectText: '', revision: 0 }), error => error.statusCode === 403);
  assert.equal(service.saveWonderDraft({ ...actor, role: 'superadmin' }, 'eiffel-tower', { effectText: '', revision: 0 }).wonder.revision, 1);
});

test('wonder writes reject unknown IDs, absent text, nontext, oversized text and invalid versions without changes', t => {
  const { service } = fixture(t), before = JSON.stringify(service.state);
  assert.throws(() => save(service, '', 0, 'not-a-wonder'), error => error.statusCode === 404);
  for (const input of [null, {}, { effectText: null, revision: 0 }, { effectText: 15, revision: 0 }, { effectText: 'a'.repeat(20001), revision: 0 }, { effectText: '', revision: -1 }, { effectText: '', revision: '0' }, { effectText: '', revision: 0.5 }]) {
    assert.throws(() => service.saveWonderDraft(actor, 'eiffel-tower', input), error => error.statusCode === 400);
  }
  assert.equal(JSON.stringify(service.state), before);
  assert.equal(save(service, '文'.repeat(20000)).effectText.length, 20000);
});

test('concurrent editors cannot overwrite a newer draft, while retrying a lost response is idempotent', t => {
  const { service, options } = fixture(t);
  const first = save(service, '已存版本');
  const reopened = new AdminService(options);
  assert.throws(() => save(reopened, '旧页面修改'), error => error.statusCode === 409);
  assert.deepEqual(save(reopened, '已存版本'), first);
  assert.equal(reopened.listAudit().length, 1);
  assert.equal(save(reopened, '核对后修改', 1).revision, 2);
});

test('an atomic save failure preserves the old file, live draft and audit; retry succeeds', t => {
  const { service, options, directory } = fixture(t);
  save(service, '原始内容');
  const beforeFile = fs.readFileSync(options.dataPath, 'utf8'), beforeState = JSON.stringify(service.state);
  const mocked = t.mock.method(fs, 'renameSync', () => { throw new Error('isolated disk failure'); });
  assert.throws(() => save(service, '不能丢掉原稿', 1), /disk failure/);
  mocked.mock.restore();
  assert.equal(JSON.stringify(service.state), beforeState);
  assert.equal(fs.readFileSync(options.dataPath, 'utf8'), beforeFile);
  assert.deepEqual(fs.readdirSync(directory), ['admin-state.json']);
  assert.equal(save(service, '重试成功', 1).revision, 2);
});

test('invalid admin JSON is preserved instead of silently resetting saved content', t => {
  const { options } = fixture(t);
  fs.writeFileSync(options.dataPath, '{"wonderDrafts":');
  assert.throws(() => new AdminService(options), /存档读取失败/);
  assert.equal(fs.readFileSync(options.dataPath, 'utf8'), '{"wonderDrafts":');
});

function response() { return { statusCode: null, body: '', writeHead(code) { this.statusCode = code; }, end(body) { this.body = JSON.parse(body); } }; }
function request(method, token, body) { return { method, headers: token ? { authorization: `Bearer ${token}` } : {}, async *[Symbol.asyncIterator]() { if (body !== undefined) yield Buffer.from(JSON.stringify(body)); } }; }
test('wonder API authenticates reads/writes and saves empty text through real admin service', async t => {
  const { service } = fixture(t), token = service.login('admin', 'isolated-test').token;
  const handler = createAdminApiHandler({ admin: service, players: {} });
  const get = response();
  await handler(request('GET', token), get, '/api/admin/wonders', '/api/admin/wonders');
  assert.equal(get.statusCode, 200); assert.equal(get.body.wonders.length, 24);
  const posted = response();
  await handler(request('POST', token, { effectText: '', revision: 0 }), posted, '/api/admin/wonders/santiago-bernabeu', '/api/admin/wonders/santiago-bernabeu');
  assert.equal(posted.statusCode, 200); assert.equal(posted.body.wonder.effectText, ''); assert.equal(posted.body.wonder.status, 'draft');
  for (const method of ['GET', 'POST']) await assert.rejects(handler(request(method, '', { effectText: '', revision: 0 }), response(), '/api/admin/wonders', '/api/admin/wonders'), error => error.statusCode === 401);
  await assert.rejects(handler(request('POST', token, { effectText: 'a'.repeat(170000), revision: 0 }), response(), '/api/admin/wonders/santiago-bernabeu', '/api/admin/wonders/santiago-bernabeu'), error => error.statusCode === 413);
});

const designProposals = JSON.parse(fs.readFileSync(new URL('../shared/config/wonder-design-drafts.json', import.meta.url), 'utf8')).items;
const players = JSON.parse(fs.readFileSync(new URL('../assets/data/s4-player-catalog.json', import.meta.url), 'utf8'));
const conditions = () => ({ totalProduction: 23000, adjacentBuildings: ['port', 'club-shop'], terrain: { anyOf: ['hills','mountain'], allOf: ['forest'] }, playerCollection: { minDistinctPlayers: 10, nationalities: ['葡萄牙', '巴西'], minNationalities: 2 } });
function plannedFixture(t) {
  const base = fixture(t);
  const options = { ...base.options, wonderProposals: designProposals, playerCatalog: players };
  return { ...base, options, service: new AdminService(options) };
}
const putConditions = (service, construction, revision = 0, effectText = '效果原文') => service.saveWonderDraft(actor, 'eiffel-tower', { effectText, construction, revision }).wonder;

test('new proposals provide 24 requirements and 19 effects without writing on read or replacing existing user text', t => {
  const { service, options } = plannedFixture(t);
  const original = '  用户已填效果\n原始空格  ';
  service.state.wonderDrafts = { 'eiffel-tower': { effectText: original, revision: 1 }, 'versailles-palace': { effectText: '', revision: 1 } };
  const before = fs.readFileSync(options.dataPath, 'utf8');
  const view = service.wonderManagement(actor);
  assert.equal(view.wonders.length, 24);
  assert.equal(Object.values(designProposals).filter(v => v.effectText).length, 19);
  assert.ok(view.wonders.every(w => w.construction.totalProduction > 0));
  assert.equal(view.wonders.find(w => w.assetId === 'eiffel-tower').effectText, original);
  assert.equal(view.wonders.find(w => w.assetId === 'eiffel-tower').suggestedConstruction, true);
  assert.equal(view.wonders.find(w => w.assetId === 'versailles-palace').effectText, '');
  assert.ok(view.requirementOptions.pools.some(o => o.value === 'ATT'));
  assert.equal(fs.readFileSync(options.dataPath, 'utf8'), before);
});

test('structured conditions persist and can be explicitly cleared without restoring proposal defaults', t => {
  const { service, options } = plannedFixture(t);
  const first = putConditions(service, conditions());
  assert.equal(first.suggestedConstruction, false);
  const reopened = new AdminService(options);
  const loaded = reopened.wonderManagement(actor).wonders.find(w => w.assetId === 'eiffel-tower');
  assert.deepEqual(loaded.construction, first.construction);
  const empty = { totalProduction: null, adjacentBuildings: [], terrain: { anyOf: [], allOf: [] }, playerCollection: null };
  putConditions(reopened, empty, 1, '');
  const cleared = new AdminService(options).wonderManagement(actor).wonders.find(w => w.assetId === 'eiffel-tower');
  assert.deepEqual(cleared.construction, empty);
  assert.equal(cleared.effectText, '');
  assert.equal(cleared.suggestedConstruction, false);
});

test('condition-only edits conflict even when effect text matches; identical retry does not audit twice', t => {
  const { service } = plannedFixture(t);
  const first = putConditions(service, conditions());
  const changed = { ...conditions(), totalProduction: 31000 };
  assert.throws(() => putConditions(service, changed), e => e.statusCode === 409);
  assert.deepEqual(putConditions(service, conditions()), first);
  assert.equal(service.state.audit.length, 1);
  assert.equal(putConditions(service, changed, 1).revision, 2);
  assert.equal(service.state.audit.length, 2);
});

test('older effect-only clients preserve current structured conditions', t => {
  const { service } = plannedFixture(t);
  const first = putConditions(service, conditions());
  const second = save(service, '修改效果', 1, 'eiffel-tower');
  assert.deepEqual(second.construction, first.construction);
});

test('invalid requirements fail before changing draft, version or audit', t => {
  const { service } = plannedFixture(t);
  const before = JSON.stringify(service.state);
  for (const bad of [null, {}, {...conditions(),totalProduction:0}, {...conditions(),totalProduction:-1}, {...conditions(),totalProduction:1.5}, {...conditions(),totalProduction:'100'}, {...conditions(),totalProduction:Infinity}, {...conditions(),adjacentBuildings:['invented']}, {...conditions(),terrain:{anyOf:['desert'],allOf:[]}}, {...conditions(),unknown:true}, {...conditions(),playerCollection:{minDistinctPlayers:0}}, {...conditions(),playerCollection:{minDistinctPlayers:10,nationalities:['不存在国籍']}}, {...conditions(),playerCollection:{minDistinctPlayers:10,clubs:['不存在俱乐部']}}, {...conditions(),playerCollection:{minDistinctPlayers:10,pools:['FWD']}}, {...conditions(),playerCollection:{minDistinctPlayers:10,minNationalities:11}}, {...conditions(),playerCollection:{minDistinctPlayers:10,nationalities:['葡萄牙'],minNationalities:2}}]) {
    assert.throws(() => putConditions(service,bad), e => e.statusCode === 400);
  }
  assert.equal(JSON.stringify(service.state), before);
});

test('condition save failure is atomic and readonly users cannot edit conditions', t => {
  const { service, options } = plannedFixture(t);
  putConditions(service, conditions());
  const beforeFile = fs.readFileSync(options.dataPath, 'utf8'), before = JSON.stringify(service.state);
  for (const role of ['readonly','operator']) assert.throws(() => service.saveWonderDraft({...actor,role}, 'eiffel-tower', { effectText:'效果原文', revision:1, construction:conditions() }), e => e.statusCode === 403);
  const mocked = t.mock.method(fs, 'renameSync', () => { throw new Error('condition disk failure'); });
  assert.throws(() => putConditions(service, {...conditions(),totalProduction:40000}, 1), /condition disk failure/);
  mocked.mock.restore();
  assert.equal(JSON.stringify(service.state), before);
  assert.equal(fs.readFileSync(options.dataPath, 'utf8'), beforeFile);
});
