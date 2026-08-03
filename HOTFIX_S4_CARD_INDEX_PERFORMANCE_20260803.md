# S4 cardsForOwner performance hotfix

## Scope

This incremental hotfix contains only:

- `versus/league-shard-store.js`
- `versus/s4-assets.js`

It does not modify league data, shard revisions, systemd configuration, or the V2 match engine.

## Root cause and fix

Production CPU profiling showed `cardsForOwner()` consuming 50.5% of samples. Each lookup scanned every S4 card and repeatedly traversed tracked proxies. The hotfix builds a mutation-versioned index by owner and player. It rebuilds only after the tracked S4 asset scope changes, preserving sorting, filtering, dirty tracking, and immediate visibility of card mutations.

## Deploy

Upload this archive to `/home/admin`, then run:

```bash
cd /opt/football-s4
package=/home/admin/football-ydl-s4-card-index-performance-hotfix-20260803-1423.tar.gz
backup=/home/admin/football-s4-card-index-backup-$(date +%Y%m%d-%H%M%S).tar.gz

sudo systemctl stop football-s4
sudo tar -czf "$backup" \
  versus/league-shard-store.js \
  versus/s4-assets.js
sudo tar -xzf "$package" -C /opt/football-s4 \
  ./versus/league-shard-store.js \
  ./versus/s4-assets.js
sudo chown admin:admin \
  versus/league-shard-store.js \
  versus/s4-assets.js
node --check versus/league-shard-store.js
node --check versus/s4-assets.js
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

curl --max-time 10 -sS -o /dev/null \
  -w 'broadcasts status=%{http_code} time=%{time_total}s bytes=%{size_download}\n' \
  http://127.0.0.1:4318/api/versus/broadcasts

node devtool/profile-live.mjs "$ydl_pid" 60 \
  | tee "/home/admin/cpu-profile-card-index-$(date +%Y%m%d-%H%M%S).txt"
```

During the 60-second profile, keep the normal match/spectator workload active. `cardsForOwner` should no longer dominate the profile. Also inspect recent errors:

```bash
sudo journalctl -u football-s4 --since '-10 min' --no-pager -l \
  | tail -n 200
```

## Roll back

Use the exact backup path printed by the deploy commands:

```bash
cd /opt/football-s4
sudo systemctl stop football-s4
sudo tar -xzf /home/admin/football-s4-card-index-backup-YYYYMMDD-HHMMSS.tar.gz \
  -C /opt/football-s4
sudo chown admin:admin \
  versus/league-shard-store.js \
  versus/s4-assets.js
node --check versus/league-shard-store.js
node --check versus/s4-assets.js
sudo systemctl start football-s4
sudo systemctl status football-s4 --no-pager -l
```
