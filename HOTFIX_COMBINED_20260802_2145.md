# YDL S4 combined hotfix 2026-08-02 21:45

This package combines three completed changes:

1. Enhancement trait-offer cleanup after a pending +4/+7 card is consumed as material.
2. League state sharding and scoped persistence.
3. V2 tactical-fit display, X-player tackle/save task collection, and the optional tactical-board bond-bonus display.

The archive contains no league state, account data, credentials, backups, or temporary files.

## Runtime files

- `versus/league-service.js`
- `versus/league-shard-store.js`
- `versus/s4-assets.js`
- `versus/api.js`
- `versus/public/app.js`
- `versus/v2/match-engine-v2.js`
- `versus/v2/ydl-league-engine-adapter.js`
- `devtool/migrate-league-to-shards.js`
- `deploy/cloud/football-s4.env.example`
- `docs/league-sharded-persistence.md`
- `package.json`

## Required deployment mode

This is a stopped-service migration. Do not switch a running service from the single JSON file to the shard directory.

Keep `/opt/football-s4/data/yellowdogs-league.json` unchanged until the new shard deployment has passed verification. Do not allow players back in between migration and verification.

## Server deployment

Upload the archive to `/home/admin/football-ydl-s4-combined-hotfix-20260802-2145-fixed.tar.gz`, then run:

```bash
cd /opt/football-s4
sudo systemctl stop football-s4

sudo tar --exclude='football-s4/node_modules' --exclude='football-s4/data' \
  -czf /home/admin/football-s4-code-before-combined-$(date +%Y%m%d-%H%M%S).tar.gz \
  -C /opt football-s4
sudo tar -czf /home/admin/football-s4-data-before-combined-$(date +%Y%m%d-%H%M%S).tar.gz \
  -C /opt/football-s4 data
sudo cp /etc/football-s4.env /home/admin/football-s4.env.before-combined

sudo tar -xzf /home/admin/football-ydl-s4-combined-hotfix-20260802-2145-fixed.tar.gz -C /opt/football-s4
sudo chown -R admin:admin /opt/football-s4

node --check versus/league-service.js
node --check versus/league-shard-store.js
node --check versus/public/app.js
node --check versus/v2/match-engine-v2.js
node --check versus/v2/ydl-league-engine-adapter.js

node --test test/league-shard-safety.test.js test/league-shards.test.js
node --test test/match-engine-v2.test.js test/ydl-league-engine-v2.test.js

if [ -e /opt/football-s4/data/yellowdogs-league-shards ]; then
  sudo mv /opt/football-s4/data/yellowdogs-league-shards \
    /opt/football-s4/data/yellowdogs-league-shards.before-$(date +%Y%m%d-%H%M%S)
fi
node devtool/migrate-league-to-shards.js \
  /opt/football-s4/data/yellowdogs-league.json \
  /opt/football-s4/data/yellowdogs-league-shards

node -e "const r=require('./data/yellowdogs-league-shards/migration-report.json'); if(!r.ok) process.exit(1); console.log(r)"

sudo sed -i '/^YELLOWDOGS_LEAGUE_PATH=/d' /etc/football-s4.env
echo 'YELLOWDOGS_LEAGUE_PATH=/opt/football-s4/data/yellowdogs-league-shards' | sudo tee -a /etc/football-s4.env

sudo systemctl daemon-reload
sudo systemctl start football-s4
sudo systemctl status football-s4 --no-pager -l
sudo journalctl -u football-s4 -n 100 --no-pager
curl -fsS http://127.0.0.1:4318/versus/ >/dev/null && echo 'versus ok'
```

After startup, verify that `manifest.json` revision increases after one controlled admin-side write:

```bash
cd /opt/football-s4
node -e "const m=require('./data/yellowdogs-league-shards/manifest.json'); console.log({revision:m.revision, updatedAt:m.updatedAt})"
sudo journalctl -u football-s4 --since '-5 min' --no-pager | grep -Ei 'error|exception|failed|ENOENT|EACCES|manifest' || true
```

## Functional verification

- Open television and confirm both teams show non-zero tactical fit.
- Complete one V2 match and confirm player tackles and goalkeeper saves appear in match statistics.
- Confirm the X-player growth page updates the applicable formal-match task.
- Open the tactical board and confirm `羁绊增益` is off by default; enable it and confirm affected player values increase.
- Open enhancement once to trigger cleanup of any invalid stale trait offer.

## Immediate rollback

Rollback is safe before players resume operations. Stop the service, restore the saved environment file and code archive, and restart using the unchanged legacy JSON:

```bash
sudo systemctl stop football-s4
sudo cp /home/admin/football-s4.env.before-combined /etc/football-s4.env
sudo tar -xzf /home/admin/football-s4-code-before-combined-YYYYMMDD-HHMMSS.tar.gz -C /opt
sudo systemctl daemon-reload
sudo systemctl start football-s4
sudo systemctl status football-s4 --no-pager -l
```

Do not use this rollback after players have generated new shard-only writes unless those writes are migrated back first; otherwise post-deployment progress will be lost.
