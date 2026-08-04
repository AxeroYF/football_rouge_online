# YellowDogs World Cup hotfix

Package: `football-ydl-s4-world-cup-hotfix-20260804-1413.tar.gz`

This is a production code-only update. It does not contain or migrate league data, shard revisions, accounts, environment files, credentials, or generated match files.

## Contents

- 12-team YellowDogs World Cup: three groups with three human managers and one AI team in each group.
- Three group rounds, best eight qualification, and single-match knockout rounds with extra time and penalties.
- Daily national-team assignment, 23-player roster selection, automatic roster fallback, and normal-player temporary `+3` upgrades.
- At the 09:51 daily reset, national teams, groups, and all three group-round fixtures are created immediately, while kickoff remains pending.
- Completing the cup final schedules World Cup round one for 20 minutes later. Rosters remain editable until exactly 10 minutes before that kickoff; later rounds continue on the 20-minute event chain.
- Shared national-team tactics board, without bonds, closing 30 minutes after the event.
- Television, schedule, match-detail, standings, scorer, and assist integration.
- Club tactics never consume World Cup fixture context; national-team tactics use the player's actual daily country, opponent, group round, and kickoff time.
- Admin controls to bootstrap, re-time, start, repair, or close today's event.
- Temporary-player cleanup and sharded live World Cup checkpoint persistence.
- Dark/light themes, responsive layout, and 12 national flag assets.

## Required maintenance window

Use a short maintenance window. Stop `football-s4` before backing up or extracting the package. This prevents a match or shard revision from changing between the backup and deployment.

## Deploy

Upload the package to `/home/admin`, then run:

```bash
cd /opt/football-s4

ydl_package=/home/admin/football-ydl-s4-world-cup-hotfix-20260804-1413.tar.gz
ydl_stamp=$(date +%Y%m%d-%H%M%S)
ydl_code_backup=/home/admin/football-s4-before-world-cup-code-$ydl_stamp.tar.gz
ydl_shard_snapshot=/opt/football-s4/data/yellowdogs-league-shards-before-world-cup-$ydl_stamp

sudo tar -tzf "$ydl_package"
sudo test -f /opt/football-s4/data/yellowdogs-league-shards/manifest.json

sudo systemctl stop football-s4
sudo systemctl is-active football-s4 || true

sudo tar -czf "$ydl_code_backup" \
  admin/public/app.js \
  admin/public/league.css \
  devtool/server.js \
  versus/admin-api.js \
  versus/api.js \
  versus/league-service.js \
  versus/league-shard-store.js \
  versus/public/app.js \
  versus/public/styles.css

sudo cp -al \
  /opt/football-s4/data/yellowdogs-league-shards \
  "$ydl_shard_snapshot"

sudo test -f "$ydl_shard_snapshot/manifest.json"

sudo tar -xzf "$ydl_package" -C /opt/football-s4
sudo chown -R admin:admin \
  admin/public/app.js \
  admin/public/league.css \
  devtool/server.js \
  versus/admin-api.js \
  versus/api.js \
  versus/league-service.js \
  versus/league-shard-store.js \
  versus/public/app.js \
  versus/public/styles.css \
  versus/public/world-cup-flags

node --check admin/public/app.js
node --check devtool/server.js
node --check versus/admin-api.js
node --check versus/api.js
node --check versus/league-service.js
node --check versus/league-shard-store.js
node --check versus/public/app.js

sudo systemctl start football-s4
sudo systemctl status football-s4 --no-pager -l

echo "code_backup=$ydl_code_backup"
echo "shard_snapshot=$ydl_shard_snapshot"
```

`cp -al` is intentional. Shard revisions are immutable and `manifest.json` is atomically replaced, so after the service is stopped this creates a fast, consistent, low-space snapshot on the same filesystem. Do not delete it until the World Cup has completed and the next daily reset has been verified.

For an off-machine or compressed backup, archive the static snapshot later. This is slower but no longer races the live service:

```bash
sudo tar -czf "/home/admin/$(basename "$ydl_shard_snapshot").tar.gz" \
  -C /opt/football-s4/data \
  "$(basename "$ydl_shard_snapshot")"
```

## Verify after restart

```bash
curl --max-time 10 -sS -o /dev/null \
  -w 'health status=%{http_code} time=%{time_total}s\n' \
  http://127.0.0.1:4318/api/health

curl --max-time 10 -sS -o /dev/null \
  -w 'flag status=%{http_code} size=%{size_download}\n' \
  http://127.0.0.1:4318/versus/world-cup-flags/es.svg

sudo journalctl -u football-s4 --since '-10 min' --no-pager -l | tail -n 200
```

Confirm the service does not report shard-load, syntax, roster-limit, or `liveWorldCupRound` errors.

## Daily automation and today's one-time recovery

From the next 09:51 daily reset onward, no admin action is required. The reset assigns the nine player-controlled national teams, adds the three AI teams, and creates the groups and fixtures. The first kickoff stays unset until the cup final completes; the service then schedules World Cup round one 20 minutes later and locks roster edits 10 minutes before kickoff.

Because today's cup final already finished before this code was deployed, bootstrap the World Cup once from the admin YellowDogs League page. Choose a first kickoff at least 30 minutes in the future, then click `补建今日世界杯`.

Alternatively, call the admin endpoint from the server:

```bash
read -rsp 'Admin password: ' ydl_admin_password; echo
ydl_starts_at=$(date -d '+30 minutes' --iso-8601=seconds)

curl --max-time 60 -sS -o /tmp/world-cup-bootstrap-result.json \
  -w 'bootstrap status=%{http_code} time=%{time_total}s\n' \
  -u "admin:$ydl_admin_password" \
  -H 'Content-Type: application/json' \
  --data "{\"startsAt\":\"$ydl_starts_at\"}" \
  http://127.0.0.1:4318/api/admin/league/world-cup/bootstrap

unset ydl_admin_password
head -c 300 /tmp/world-cup-bootstrap-result.json; echo
```

The endpoint is idempotent for the same day: retrying it repairs the existing event instead of creating a second one.

After bootstrap, verify:

- Admin shows 12 teams, 3 groups, and 18 pending group fixtures.
- Each group contains exactly three human managers and one AI team.
- A player can open YellowDogs World Cup, select a roster, and switch to the national-team tactics board.
- Today's schedule contains only that player's fixtures; the full schedule contains every determined fixture.
- The first round enters the television page at kickoff.

## Code rollback

Use the exact `code_backup` path printed during deployment:

```bash
cd /opt/football-s4
sudo systemctl stop football-s4
sudo tar -xzf /home/admin/football-s4-before-world-cup-code-YYYYMMDD-HHMMSS.tar.gz \
  -C /opt/football-s4
sudo chown admin:admin \
  admin/public/app.js \
  admin/public/league.css \
  devtool/server.js \
  versus/admin-api.js \
  versus/api.js \
  versus/league-service.js \
  versus/league-shard-store.js \
  versus/public/app.js \
  versus/public/styles.css
node --check versus/league-service.js
node --check versus/league-shard-store.js
node --check versus/public/app.js
sudo systemctl start football-s4
sudo systemctl status football-s4 --no-pager -l
```

Leaving `versus/public/world-cup-flags/` after a code rollback is harmless because the old frontend does not reference it.

## Data rollback (only if state was damaged)

Code rollback normally does not require data rollback. Restoring the shard snapshot discards every player action made after deployment, so use it only when the current shard state is actually invalid and inform players first.

```bash
cd /opt/football-s4
sudo systemctl stop football-s4

ydl_failed=/opt/football-s4/data/yellowdogs-league-shards-failed-$(date +%Y%m%d-%H%M%S)
sudo mv /opt/football-s4/data/yellowdogs-league-shards "$ydl_failed"
sudo cp -al \
  /opt/football-s4/data/yellowdogs-league-shards-before-world-cup-YYYYMMDD-HHMMSS \
  /opt/football-s4/data/yellowdogs-league-shards

sudo test -f /opt/football-s4/data/yellowdogs-league-shards/manifest.json
sudo systemctl start football-s4
sudo systemctl status football-s4 --no-pager -l
echo "failed_state_kept_at=$ydl_failed"
```

Do not rerun the single-JSON-to-shards migration during normal deployment or code rollback.
