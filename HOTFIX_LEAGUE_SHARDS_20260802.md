# League Sharded Persistence Hotfix

This hotfix adds directory-based league persistence while keeping `.json` state files supported.

## Included

- `versus/league-service.js`
- `versus/league-shard-store.js`
- `versus/s4-assets.js`
- `devtool/migrate-league-to-shards.js`
- `deploy/cloud/football-s4.env.example`
- `docs/league-sharded-persistence.md`

The package contains no league state, account data, backups, credentials, or temporary files.

## Server sequence

Run the migration while the service is stopped. Keep the original JSON as the rollback copy.

```bash
sudo systemctl stop football-s4
sudo tar -czf /home/admin/football-s4-before-shards-$(date +%Y%m%d-%H%M%S).tar.gz -C /opt/football-s4 data
sudo tar -xzf /home/admin/football-ydl-s4-league-shards-hotfix-20260802.tar.gz -C /opt/football-s4
sudo chown -R admin:admin /opt/football-s4
cd /opt/football-s4
node devtool/migrate-league-to-shards.js \
  /opt/football-s4/data/yellowdogs-league.json \
  /opt/football-s4/data/yellowdogs-league-shards
```

Verify `migration-report.json` has `"ok": true` before switching the service. Then set this line in `/etc/football-s4.env`:

```text
YELLOWDOGS_LEAGUE_PATH=/opt/football-s4/data/yellowdogs-league-shards
```

Start and verify:

```bash
sudo systemctl start football-s4
sudo systemctl status football-s4 --no-pager -l
sudo journalctl -u football-s4 -n 80 --no-pager
curl -fsS http://127.0.0.1:4318/versus/ >/dev/null
```

## Rollback

Stop the service, comment out `YELLOWDOGS_LEAGUE_PATH`, restore the legacy JSON path if it was changed, and start the service again. Do not delete the shard directory until the new deployment has passed an operating window.
