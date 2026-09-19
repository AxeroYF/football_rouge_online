import {campaignRequestPath,campaignEntryRedirect} from '../server/http/public-entry.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { CampaignService } from '../campaign-service.mjs';
import { accountPasswordMatches } from '../server/domain/account-password.mjs';
import { convertS4Accounts } from '../shared/account-import/s4-accounts.mjs';
import { createRequestId } from '../client/core/request-id.js';
import { publicRequestPath, createStaticHandler } from '../server/http/static-handler.mjs';
import { JsonCampaignRepository } from '../server/infrastructure/json-campaign-repository.mjs';

function s4Account(password = ' original password ') {
  const salt = crypto.randomBytes(16);
  return { id:'S4-OLD01', nickname:'原玩家', passwordHash:'scrypt$' + salt.toString('base64url') + '$' + crypto.scryptSync(password, salt, 64).toString('base64url'),
    token:'old-session-must-not-transfer', createdAt:100, gold:99999, draft:{ roster:[{}] } };
}

test('S4 import preserves identity and credential bytes, discards sessions and game progress, and rejects ambiguous accounts', () => {
  const old = s4Account(), converted = convertS4Accounts({ accounts:{ old } }), a = converted.accounts[old.id];
  assert.equal(a.passwordHash, old.passwordHash); assert.equal(a.id, old.id); assert.equal(a.nickname, old.nickname);
  assert.equal(a.token, null); assert.equal(a.draft, null); assert.equal(a.setupComplete, false); assert.equal(a.gold, undefined);
  assert.equal(converted.world, null);
  assert.throws(() => convertS4Accounts({ accounts:{} }), /为空/);
  assert.throws(() => convertS4Accounts({ accounts:{ old, another:{ ...old, id:'ANOTHER' } } }), /重复/);
  assert.throws(() => convertS4Accounts({ accounts:{ old:{ ...old, passwordHash:null } } }), /密码哈希/);
});

test('original S4 passwords including spaces work; wrong passwords and old tokens never authenticate', () => {
  const old = s4Account(), service = new CampaignService({ catalog:[], repository:{ load:() => convertS4Accounts({ accounts:{ old } }), save() {} } });
  assert.equal(accountPasswordMatches(' original password ', old), true);
  assert.equal(accountPasswordMatches('original password', old), false);
  assert.throws(() => service.login(old.nickname, 'wrong'), /密码错误/);
  assert.throws(() => service.authenticate(old.token), /已失效/);
  assert.throws(() => service.authenticate(''), /已失效/);
  const login = service.login(old.nickname, ' original password ');
  assert.equal(login.profile.id, old.id); assert.equal(login.state.setupComplete, false); assert.equal(login.state.draft, null);
  assert.equal(service.authenticate(login.token).id, old.id);
  assert.throws(() => service.register(old.nickname, 'other-password'), /已经注册/);
  assert.doesNotMatch(JSON.stringify(login), /passwordHash|scrypt\$/);
});

test('campaign password accounts remain compatible and malformed imported hashes fail closed', () => {
  const service = new CampaignService({ catalog:[] });
  const registered = service.register('新玩家', 'new-password');
  assert.equal(service.login('新玩家', 'new-password').profile.id, registered.profile.id);
  for (const encoded of ['scrypt$short$bad','scrypt$a$a$extra','oops',null]) {
    assert.equal(accountPasswordMatches('password', { passwordHash:encoded }), false);
  }
});

test('HTTP request IDs use secure random bytes when randomUUID is unavailable', () => {
  const source = { getRandomValues: bytes => crypto.webcrypto.getRandomValues(bytes) };
  const ids = new Set(Array.from({ length:100 }, () => createRequestId(source)));
  assert.equal(ids.size, 100);
  for (const id of ids) assert.match(id, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.equal(createRequestId({ randomUUID:() => 'native' }), 'native');
});

test('static routes expose game assets but reject data, backend, archives, encoded traversal and hidden files', () => {
  for (const request of ['/data/campaign-accounts.json','/data/admin-state.json','/server.mjs','/campaign-service.mjs','/server/application/admin-service.mjs',
    '/seed/campaign-accounts.json','/node_modules/three/package.json','/deploy/install.sh','/YDL_backup/file.tar.gz','/.git/config',
    '/assets/../data/campaign-accounts.json','/assets/%2e%2e/data/campaign-accounts.json','/assets/%5c..%5cdata/campaign-accounts.json',
    '/assets/.secret.json','/assets/../../../etc/passwd','/%00','/%invalid','/shared/account-import/s4-accounts.mjs']) assert.equal(publicRequestPath(request), null, request);
  assert.equal(publicRequestPath('/game'), 'index.html'); assert.equal(publicRequestPath('/admin/'), 'admin-v2.html');
  for (const request of ['/assets/data/territory-index.json','/assets/map-relief/relief-mesh/europe.bin','/client/core/request-id.js?v=1','/shared/config/draft.mjs','/styles/draft.css','/engine/s4-v2.1/game/public/schema.js','/app.js']) assert.ok(publicRequestPath(request), request);
});

class Response extends Writable {
  constructor() { super(); this.chunks=[]; this.headers={}; this.headersSent=false; }
  _write(chunk, encoding, done) { this.chunks.push(Buffer.from(chunk)); done(); }
  writeHead(status, headers={}) { this.status=status; this.headers=headers; this.headersSent=true; }
}
test('static serving streams complete bytes, supports HEAD/ETag and keeps mutable JSON revalidated', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ydl-static-'));
  try {
    fs.mkdirSync(path.join(root,'assets'));
    fs.writeFileSync(path.join(root,'assets','test.json'),'{"ok":true}');
    const serve=createStaticHandler(root), response=new Response();
    await serve({ url:'/assets/test.json',method:'GET',headers:{} },response);
    assert.equal(response.status,200); assert.equal(Buffer.concat(response.chunks).toString(),'{"ok":true}');
    assert.equal(response.headers['cache-control'],'no-cache');
    const head=new Response(); await serve({url:'/assets/test.json',method:'HEAD',headers:{}},head);
    assert.equal(head.status,200); assert.equal(head.chunks.length,0); assert.equal(head.headers['content-length'],11);
    const cached=new Response(); await serve({url:'/assets/test.json',method:'GET',headers:{'if-none-match':response.headers.etag}},cached);
    assert.equal(cached.status,304); assert.equal(cached.chunks.length,0);
    const privateResponse=new Response(); await serve({url:'/data/campaign-accounts.json',method:'GET',headers:{}},privateResponse);
    assert.equal(privateResponse.status,404);
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});

test('a broken existing save cannot silently become an empty world and overwrite accounts', () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ydl-save-'));
  try {
    const file=path.join(root,'campaign.json');fs.writeFileSync(file,'broken');
    assert.throws(() => new JsonCampaignRepository({dataPath:file}).load(), /账号存档读取失败/);
    assert.equal(fs.readFileSync(file,'utf8'),'broken');
    assert.equal(new JsonCampaignRepository({dataPath:path.join(root,'missing.json')}).load(),null);
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});


test('versus entry serves relative assets and keeps API paths and private files isolated',()=>{
 for(const p of ['/versus','/versus/'])assert.equal(publicRequestPath(p),'index.html');
 for(const p of ['app.js','styles/login.css','client/core/request-id.js','assets/data/territory-index.json','engine/s4-v2.1/game/public/schema.js'])assert.equal(publicRequestPath('/versus/'+p+'?v=1'),p);
 for(const p of ['data/campaign-accounts.json','server.mjs','campaign-service.mjs','shared/account-import/s4-accounts.mjs','../data/campaign-accounts.json','assets/%5c..%5cdata/campaign-accounts.json','.env'])assert.equal(publicRequestPath('/versus/'+p),null);
 assert.equal(campaignRequestPath('/versus/api/campaign/state'),'/api/campaign/state');assert.equal(campaignRequestPath('/api/campaign/state'),'/api/campaign/state');
 assert.equal(campaignRequestPath('/versus-other/app.js'),'/versus-other/app.js');
 for(const p of ['/','/versus'])assert.equal(campaignEntryRedirect(p),'/versus/');
 assert.equal(campaignEntryRedirect('/versus/'),null);assert.equal(campaignEntryRedirect('/admin/'),'/admin');
});
