# YDL S4 shard persistence performance hotfix

## Root cause

- Per-match V2 checkpoints synchronously wrote each complete live match every 10 seconds.
- Five concurrent broadcasts could therefore produce five growing JSON writes and `fsync` calls in the same interval.
- Every sharded state save also recursively scanned referenced revision files and backup manifests before deleting old revisions.
- Shop, pack opening, enhancement, and match settlement all share these synchronous persistence paths.

## Changes

- Live match checkpoint interval defaults to 30 seconds and is configurable with `YDL_LIVE_MATCH_PERSIST_INTERVAL_MS`.
- Shard revision cleanup runs at most once per 60 seconds and is configurable with `YDL_SHARD_CLEANUP_INTERVAL_MS`.
- Match simulation, RNG state, scores, reports, settlements, and shard formats are unchanged.
- Existing shard data does not need migration.

## Deployment

```bash
cd /opt/football-s4
sudo systemctl stop football-s4
sudo tar -xzf /home/admin/football-ydl-s4-shard-persistence-performance-hotfix-20260802-2243.tar.gz -C /opt/football-s4
sudo chown -R admin:admin /opt/football-s4
node --check versus/league-service.js
node --check versus/league-shard-store.js

sudo sed -i '/^YDL_LIVE_MATCH_PERSIST_INTERVAL_MS=/d;/^YDL_SHARD_CLEANUP_INTERVAL_MS=/d' /etc/football-s4.env
printf '%s\n' \
  'YDL_LIVE_MATCH_PERSIST_INTERVAL_MS=30000' \
  'YDL_SHARD_CLEANUP_INTERVAL_MS=60000' \
  | sudo tee -a /etc/football-s4.env

sudo systemctl start football-s4
sudo systemctl status football-s4 --no-pager -l
sudo journalctl -u football-s4 -n 80 --no-pager
```

Do not rerun shard migration and do not replace or delete the current shard directory.
