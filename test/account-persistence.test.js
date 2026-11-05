import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { JsonAccountRepository } from '../versus/infrastructure/json-account-repository.js';
import { VersusRoomService } from '../versus/room-service.js';

function fixture(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'yffm1-accounts-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  return path.join(dir,'accounts.json');
}
test('damaged or invalid account saves fail closed without replacing the original',t=>{
  const file=fixture(t);
  for(const invalid of ['{broken', '{"accounts":[]}', '{"accounts":{"x":null}}']) {
    fs.writeFileSync(file,invalid);
    assert.throws(()=>new VersusRoomService({accountsPath:file,lineups:new Map()}),/账号存档读取失败/);
    assert.equal(fs.readFileSync(file,'utf8'),invalid);
  }
});
test('registration and password changes survive reopening the same account store',t=>{
  const file=fixture(t);
  const service=new VersusRoomService({accountsPath:file,lineups:new Map()});
  const result=service.register('经理','first-password');
  service.changePassword(result.profile.id,result.accountToken,'first-password','next-password');
  const reopened=new VersusRoomService({accountsPath:file,lineups:new Map()});
  assert.equal(reopened.login('经理','next-password').profile.id,result.profile.id);
  assert.throws(()=>reopened.login('经理','first-password'),/昵称或密码错误/);
  assert.equal(fs.readdirSync(path.dirname(file)).filter(f=>f.endsWith('.tmp')).length,0);
});
test('legacy container keys remain readable while duplicate account keys are rejected',t=>{
  const file=fixture(t);
  const account={key:'legacy-id',id:'legacy-id',token:'legacy-token',nickname:'Legacy',matches:[]};
  fs.writeFileSync(file,JSON.stringify({version:1,accounts:{oldContainer:account}}));
  const service=new VersusRoomService({accountsPath:file,lineups:new Map()});
  assert.equal(service.accountByNickname('Legacy').id,'legacy-id');
  const invalid=JSON.stringify({accounts:{first:account,second:account}});
  fs.writeFileSync(file,invalid);
  assert.throws(()=>new VersusRoomService({accountsPath:file,lineups:new Map()}),/账号存档读取失败/);
  assert.equal(fs.readFileSync(file,'utf8'),invalid);
});
test('failed rename preserves the last save and rolls back registration and credential changes',t=>{
  const file=fixture(t);
  const good=new VersusRoomService({accountsPath:file,lineups:new Map()});
  const user=good.register('已保存','original-password');
  const original=fs.readFileSync(file,'utf8');
  const repository=new JsonAccountRepository(file,{...fs,renameSync(){throw new Error('disk failure');}});
  const service=new VersusRoomService({accountsPath:file,accountRepository:repository,lineups:new Map()});
  const account=service.accounts.get(user.profile.id.toLowerCase());
  assert.throws(()=>service.register('未保存','new-password'),/disk failure/);
  assert.equal(service.accountByNickname('未保存'),null);
  assert.throws(()=>service.bindAccount('constructor',null,'Legacy ID'),/disk failure/);
  assert.equal(service.accounts.has('constructor'),false);
  assert.throws(()=>service.changePassword(user.profile.id,user.accountToken,'original-password','rejected-password'),/disk failure/);
  assert.equal(service.accounts.get(user.profile.id.toLowerCase()),account);
  assert.equal(fs.readFileSync(file,'utf8'),original);
  assert.equal(fs.readdirSync(path.dirname(file)).filter(f=>f.endsWith('.tmp')).length,0);
  const reopened=new VersusRoomService({accountsPath:file,lineups:new Map()});
  assert.equal(reopened.login('已保存','original-password').profile.id,user.profile.id);
});
