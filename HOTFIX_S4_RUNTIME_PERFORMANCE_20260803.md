# S4 runtime performance hotfix

## Scope

This incremental package combines the production fixes completed after the August 3 CPU profile:

- Mutation-versioned owner/player card indexes for `cardsForOwner()` and `cardsForPlayer()`.
- Superstar Path `+1`, `+5`, and maximum allocation controls.
- Single-card lookup and pre-save task settlement for Superstar Path mutations.
- Local Superstar Path DOM updates instead of full page redraws for point allocation.
- Enhancement material-family lookup reuse.
- Enhancement history reads the latest 50 matching ledger entries without sorting the complete ledger.
- Enhancement scan start and finish update local phase state; the warehouse is rebuilt only when the result changes cards.

The archive contains no league data, shard revisions, credentials, environment files, or migration scripts. Do not rerun shard migration.

## Deploy

Upload the archive to `/home/admin`, then run:

```bash
cd /opt/football-s4
package=/home/admin/football-ydl-s4-runtime-performance-hotfix-20260803-1544.tar.gz
backup=/home/admin/football-s4-runtime-performance-backup-$(date +%Y%m%d-%H%M%S).tar.gz

sudo systemctl stop football-s4
sudo tar -czf "$backup" \
  versus/league-shard-store.js \
  versus/s4-assets.js \
  versus/league-service.js \
  versus/public/app.js \
  versus/public/styles.css

sudo tar -xzf "$package" -C /opt/football-s4
sudo chown admin:admin \
  versus/league-shard-store.js \
  versus/s4-assets.js \
  versus/league-service.js \
  versus/public/app.js \
  versus/public/styles.css \
  src/runtime-metrics.js

node --check versus/league-shard-store.js
node --check versus/s4-assets.js
node --check versus/league-service.js
node --check versus/public/app.js
node --check src/runtime-metrics.js

sudo systemctl start football-s4
sudo systemctl status football-s4 --no-pager -l
echo "backup=$backup"
```

All connected players should refresh once after the service starts.

## Verify

```bash
ydl_pid=$(sudo systemctl show football-s4 -p MainPID --value)
echo "PID=$ydl_pid"
ps -p "$ydl_pid" -o pid,ppid,%cpu,%mem,rss,vsz,etime,cmd

curl --max-time 10 -sS -o /dev/null \
  -w 'health status=%{http_code} time=%{time_total}s\n' \
  http://127.0.0.1:4318/api/health

node devtool/profile-live.mjs "$ydl_pid" 60 \
  | tee "/home/admin/cpu-profile-runtime-hotfix-$(date +%Y%m%d-%H%M%S).txt"

sudo journalctl -u football-s4 --since '-10 min' --no-pager -l \
  | tail -n 200
```

Run the profile during normal match and spectator activity. `cardsForOwner` should no longer dominate samples. Also verify Superstar Path allocation and one card enhancement with a test account.

## Roll back

Use the exact backup path printed during deployment:

```bash
cd /opt/football-s4
sudo systemctl stop football-s4
sudo tar -xzf /home/admin/football-s4-runtime-performance-backup-YYYYMMDD-HHMMSS.tar.gz \
  -C /opt/football-s4
sudo chown admin:admin \
  versus/league-shard-store.js \
  versus/s4-assets.js \
  versus/league-service.js \
  versus/public/app.js \
  versus/public/styles.css
node --check versus/league-shard-store.js
node --check versus/s4-assets.js
node --check versus/league-service.js
node --check versus/public/app.js
sudo systemctl start football-s4
sudo systemctl status football-s4 --no-pager -l
```

`src/runtime-metrics.js` can remain after rollback because the restored files do not use it. It can be removed separately only after confirming the restored `league-service.js` does not import it.
