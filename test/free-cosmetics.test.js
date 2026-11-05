import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,existsSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {YellowDogsLeagueService} from '../versus/league-service.js';
import {COUNTRY_BADGES,CLUB_BADGES,COSMETIC_BADGES} from '../versus/cosmetic-items.js';

const NOW=Date.parse('2026-11-04T09:00:00+08:00');
const user={id:'free-cosmetics-owner',nickname:'装饰玩家'};
function createService(options={}){return new YellowDogsLeagueService({statePath:null,backupDir:null,now:()=>NOW,rng:()=>.37,...options});}
function join(service,account=user){service.beginDraft(account,'免费装饰队');service.autoDraft(account);service.finishDraft(account);}

test('all players receive free access to every country and club decoration without inventory grants',()=>{
  const service=createService();
  const first=service.cosmeticsView(user.id);
  assert.equal(first.items.length,85);
  assert.equal(first.collection.country.ownedUnique,34);
  assert.equal(first.collection.club.ownedUnique,51);
  assert.equal(first.allUnlocked,true);
  assert.ok(first.items.every(item=>item.unlocked&&!item.tradable&&item.count>=1));
  assert.deepEqual(service.cosmeticInventory(user.id),{});
  const later=service.cosmeticsView('new-player-after-migration');
  assert.deepEqual(later.items.map(item=>item.id),COSMETIC_BADGES.map(item=>item.id));
  assert.deepEqual(service.cosmeticInventory('new-player-after-migration'),{});
});

test('free decorations can be switched independently without coins and invalid IDs remain rejected',()=>{
  const service=createService();join(service);
  const balance=service.wallet(user.id).balance;
  const country=COUNTRY_BADGES.at(-1),club=CLUB_BADGES.at(-1);
  service.equipCosmetic(user,country.id,'teamBadge',{compact:true});
  const equipped=service.equipCosmetic(user,club.id,'clubBadge',{compact:true});
  assert.equal(equipped.ownTeam.equippedBadge.id,country.id);
  assert.equal(equipped.ownTeam.equippedClubBadge.id,club.id);
  assert.equal(equipped.teamBadgeDelta.id,country.id);
  service.equipCosmetic(user,'','teamBadge',{compact:true});
  assert.equal(service.equippedTeamBadge(user.id),null);
  assert.equal(service.equippedClubBadge(user.id).id,club.id);
  assert.throws(()=>service.equipCosmetic(user,'not-a-decoration'),/有效/);
  assert.equal(service.wallet(user.id).balance,balance);
  assert.deepEqual(service.cosmeticInventory(user.id),{});
});

test('retired badge packs cannot be bought or newly granted from admin, and player packs remain available',()=>{
  const service=createService();join(service);
  const balance=service.wallet(user.id).balance,ledgerCount=service.state.ledger.length;
  assert.ok(service.shopView(user.id).catalog.every(pack=>pack.kind!=='cosmetic'));
  assert.ok(service.adminView().s4PackCatalog.every(pack=>pack.kind!=='cosmetic'));
  for(const type of ['country-badge-pack','club-badge-pack']){
    assert.throws(()=>service.buyS4Packs(user,type,1),/下架/);
    assert.throws(()=>service.grantS4PacksFromAdmin({packType:type,quantity:1}),/免费解锁/);
  }
  assert.throws(()=>service.buyS4Packs(user,'unknown-pack',1),/下架/);
  assert.equal(service.wallet(user.id).balance,balance);
  assert.equal(service.state.ledger.length,ledgerCount);
  const pack=service.shopView(user.id).catalog.find(entry=>entry.id==='private-mixed');
  service.buyS4Packs(user,pack.id,1,{compact:true});
  assert.equal(service.wallet(user.id).balance,balance-pack.price);
});

test('stale decoration trade requests cannot spend coins or expose a market listing',()=>{
  const service=createService();join(service);
  const listing={id:'stale-cosmetic',kind:'cosmetic',status:'active',sellerId:'old-seller',cosmeticItemId:COUNTRY_BADGES[0].id,price:1000};
  service.state.listings.push(listing);
  const balance=service.wallet(user.id).balance,ledgerCount=service.state.ledger.length;
  assert.throws(()=>service.listCosmetic(user,CLUB_BADGES[0].id,1000),/不再支持交易/);
  assert.throws(()=>service.buyListing(user,listing.id),/不再支持交易/);
  assert.throws(()=>service.buyCosmeticListing(user,listing),/不再支持交易/);
  assert.deepEqual(service.activeListingsView(),[]);
  assert.equal(service.wallet(user.id).balance,balance);
  assert.equal(service.state.ledger.length,ledgerCount);
});

for(const storage of ['json','sharded'])test(`${storage} saves retire old decoration listings once, restore escrow and retain equipment/history`,t=>{
  const directory=mkdtempSync(path.join(os.tmpdir(),'yffm1-free-cosmetics-'));
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const statePath=path.join(directory,storage==='json'?'league.json':'league-state');
  const backupDir=path.join(directory,'backups');
  const service=createService({statePath,backupDir});join(service);
  const country=COUNTRY_BADGES[0],listedClub=CLUB_BADGES[0],selectedClub=CLUB_BADGES[1];
  service.cosmeticInventory(user.id)[country.id]=2;
  service.equippedCosmeticIds(user.id).clubBadge=selectedClub.id;
  service.state.listings.push(
    {id:'old-country',kind:'cosmetic',status:'active',sellerId:user.id,cosmeticItemId:country.id,wasEquipped:true,price:700},
    {id:'old-club',kind:'cosmetic',status:'active',sellerId:user.id,cosmeticItemId:listedClub.id,wasEquipped:true,price:800},
    {id:'sold-decoration',kind:'cosmetic',status:'sold',sellerId:user.id,cosmeticItemId:country.id,price:500},
  );
  const balance=service.wallet(user.id).balance,ledger=JSON.parse(JSON.stringify(service.state.ledger));
  service.save();
  const migrated=createService({statePath,backupDir});
  assert.equal(migrated.cosmeticInventory(user.id)[country.id],3);
  assert.equal(migrated.cosmeticInventory(user.id)[listedClub.id],1);
  assert.equal(migrated.equippedTeamBadge(user.id).id,country.id);
  assert.equal(migrated.equippedClubBadge(user.id).id,selectedClub.id);
  assert.equal(migrated.state.listings.find(entry=>entry.id==='sold-decoration').status,'sold');
  assert.ok(migrated.state.listings.filter(entry=>entry.id!=='sold-decoration').every(entry=>entry.status==='cancelled'&&entry.closedReason==='free-cosmetics'));
  assert.equal(migrated.wallet(user.id).balance,balance);
  assert.deepEqual(migrated.state.ledger,ledger);
  assert.ok(existsSync(path.join(backupDir,storage==='json'?'pre-free-cosmetics-v1.json':'pre-free-cosmetics-v1.manifest.json')));
  const reloaded=createService({statePath,backupDir});
  assert.equal(reloaded.cosmeticInventory(user.id)[country.id],3);
  assert.equal(reloaded.cosmeticInventory(user.id)[listedClub.id],1);
  assert.equal(reloaded.cosmeticsView(user.id).items.length,85);
  assert.equal(reloaded.equippedClubBadge(user.id).id,selectedClub.id);
});
