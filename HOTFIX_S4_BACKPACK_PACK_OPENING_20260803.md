# S4 backpack pack-opening hotfix

## Scope

This incremental package contains only the backpack and pack-opening changes made after the runtime performance hotfix:

- Compute only the active backpack subpage.
- Update pack inventory, counters, and pack dialogs in place during pack opening.
- Omit the unchanged full team view when starting a choice pack.
- Clear stale pack-opening results before merging compact responses.
- Reduce the private mixed-pool random pack price from 1,600 to 1,000 coins.

`src/runtime-metrics.js` is included only because the current `league-service.js` imports it at startup. No other runtime performance files or profiling tools are included. This archive contains no league data, shard revisions, credentials, environment files, migration scripts, or card-index files.

## Deploy

Upload the archive to `/home/admin`, then run:

```bash
cd /opt/football-s4
package=/home/admin/football-ydl-s4-backpack-pack-opening-hotfix-20260803-1622.tar.gz
backup=/home/admin/football-s4-backpack-pack-opening-backup-$(date +%Y%m%d-%H%M%S).tar.gz

sudo systemctl stop football-s4
sudo tar -czf "$backup" \
  versus/s4-balance.js \
  versus/league-service.js \
  versus/public/app.js

sudo tar -xzf "$package" -C /opt/football-s4
sudo chown admin:admin \
  src/runtime-metrics.js \
  versus/s4-balance.js \
  versus/league-service.js \
  versus/public/app.js

node --check src/runtime-metrics.js
node --check versus/s4-balance.js
node --check versus/league-service.js
node --check versus/public/app.js

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

sudo journalctl -u football-s4 --since '-10 min' --no-pager -l \
  | tail -n 200
```

With a test account, verify that the private mixed-pool random pack costs 1,000 coins. Open a private-pack batch, close its result dialog, then start a legend-pack batch. The new legend three-choice dialog should appear and the previous private-pack results must not reopen.

## Roll back

Use the exact backup path printed during deployment:

```bash
cd /opt/football-s4
sudo systemctl stop football-s4
sudo tar -xzf /home/admin/football-s4-backpack-pack-opening-backup-YYYYMMDD-HHMMSS.tar.gz \
  -C /opt/football-s4
sudo chown admin:admin \
  versus/s4-balance.js \
  versus/league-service.js \
  versus/public/app.js
node --check versus/s4-balance.js
node --check versus/league-service.js
node --check versus/public/app.js
sudo systemctl start football-s4
sudo systemctl status football-s4 --no-pager -l
```
