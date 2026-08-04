# S4 admin backend performance hotfix

## Status

**Implemented and packaged.** Package:
`handoff/football-ydl-s4-admin-performance-hotfix-20260803-1944.tar.gz`
(contains `versus/league-service.js` and `DEPLOY.md`).

Measured on day6 production-scale data (tracked state): `adminView()` ~3,570 ms
-> ~168 ms (about 21x). Output is deep-equal to the previous behavior. This
change is behavior-preserving: no admin UI contract changes, no league data,
shard revisions, credentials, environment files, or migration scripts.

Also included in the working tree (not in the deploy package):
`test/admin.test.js` and `test/league.test.js` stale assertions corrected
(DLC2 player count 602 -> 676; private-mixed pack price arithmetic 1600 ->
1000).

## Scope

- `versus/league-service.js` only (`adminViewUnmeasured`, `adminEconomyView`).
- Optional follow-up (not in this package): admin mutation endpoints returning
  compact responses and the admin frontend re-fetching on demand.

## Root cause (measured, production-scale day6 data)

Baseline on tracked state (shard/production form), 6,424 cards, 686 players,
15,103 ledger entries, 9 human teams:

| adminView component | Measured | Share |
| --- | --- | --- |
| `allocations` (player x card loop) | ~2,609 ms | ~72% |
| `adminEconomyView()` | ~129 ms | ~4% |
| final `clone()` (deep copy) | ~96 ms | ~3% |
| `ensureS4Assets()` (normalize + invariants) | ~49 ms | ~1% |
| active/recycled counts (2 full scans) | ~8 ms | <1% |
| standings / cupView / backupView | ~6 ms | <1% |
| **adminView() total** | **~3,570 ms** | 100% |

Why it is slow:

1. `allocations` is O(players x cards). For each of the 686 `REAL_PLAYERS`,
   the code runs a full `Object.values(cards).some(...)` scan, then a second
   full `filter(...)` scan for every matched player (~203 players). That is
   roughly 686 x 6,424 x 2 ≈ 8.8M card visits per request, and on tracked state
   every visit crosses proxy traps.
2. The mutation-versioned card index added for player views is bypassed: the
   admin code scans `Object.values(state.s4Assets.cards)` directly instead of
   using `cardsForOwner()` / `trackedCardIndex()`.
3. `adminEconomyView()` filters the full 15k ledger once per human team
   (9 x 15,103), then performs a `listings.find(...)` per ledger entry.
4. The final `clone()` deep-copies the whole result through `unwrapTracked` +
   `structuredClone`.
5. Every admin mutation endpoint (`coins/grant`, `s4-cards/grant`, `simulate`,
   resets, ...) returns a fresh `adminView()`, so every admin action pays the
   same cost. Because Node is single-threaded, a single admin request also
   blocks every player request (page refresh, 12s polling, match updates) for
   the duration.

## Changes

### 1. Single-pass active-card map for `allocations` (kills the 2.6s)

Replace the per-player full scans with one pass over `Object.values(cards)`:

- Build `activeByPlayer: Map<playerId, { cards, holderOwners:Set, highestUpgrade }>`
  once; count `activeCardCount` / `recycledCardCount` in the same pass.
- `allocations` then becomes a single `REAL_PLAYERS.filter(...)` with map
  lookups: `cardCount`, `cardHolderCount`, `highestUpgrade` are read from the
  map instead of re-scanning.
- Preserve exact semantics: `card.status === "active"`, same inclusion rule
  (`owned || reserved || hasActiveCards`), same output shape.

Expected: `allocations` ~2,609 ms -> ~10-20 ms.

### 2. `adminEconomyView()` single-pass grouping (129 ms -> ~15-30 ms)

- Build `ledgerByAccount: Map<accountId, entries[]>` in one pass over the ledger.
- Prebuild `listingById` and a `closedAt -> listing` map once; remove the
  per-entry `listings.find(...)`.
- Per team: map its own entries once, then a single sort.
- Keep the full ledger output. The admin UI renders "完整金币流水" from
  `economy.ledger`, so do **not** cap entries without a matching frontend
  change. (Optional later: cap to latest 200 with a UI note.)

### 3. Replace the final deep `clone()` (optional, ~96 ms)

`adminView` builds most of its result fresh. Only `season`, `dailyAutomation`,
`discipline`, and the grants slices alias state references. Clone those leaves
explicitly and drop the whole-result `clone(unwrapTracked(...))`.

If any shared mutable reference is missed, keep the existing `clone()` as the
safe default - it is only ~3% of the cost.

### 4. Add runtime sub-metrics

- Wrap `allocations` and `adminEconomyView` with `measureRuntimeSync(...)`
  (`league.adminView.allocations`, `league.adminEconomyView`) so the
  `GET /api/diagnostics/metrics` endpoint can verify the fix in production.

### 5. Optional follow-up (not in this package)

- Run `ensureS4Assets()` only on load/mutation instead of every admin read
  (saves ~49 ms/request; requires verifying invariant safety).
- Return compact `{ ok:true }` from admin mutation endpoints and make the
  frontend re-fetch (`loadLeagueAdmin`) after actions - removes the duplicate
  full `adminView()` per operation. This changes the admin API contract and is
  deferred to a separate hotfix.

## Expected result

- `adminView()`: ~3,570 ms -> well under 100 ms on the same data.
- Admin operations (read league, grant coins/cards, simulate, resets) stop
  blocking the single-threaded event loop for all players.
- Player page refresh and 12s polling no longer queue behind admin requests.

## Files

- `versus/league-service.js` (only file in this package)

## Deploy

```bash
cd /opt/football-s4
package=/home/admin/football-ydl-s4-admin-performance-hotfix-20260803.tar.gz
backup=/home/admin/football-s4-admin-performance-backup-$(date +%Y%m%d-%H%M%S).tar.gz

sudo systemctl stop football-s4
sudo tar -czf "$backup" versus/league-service.js
sudo tar -xzf "$package" -C /opt/football-s4 ./versus/league-service.js
sudo chown admin:admin versus/league-service.js
node --check versus/league-service.js
sudo systemctl start football-s4
sudo systemctl status football-s4 --no-pager -l
echo "backup=$backup"
```

Do not rerun shard migration and do not replace the shard directory.

## Verify

Local (before building the package):

```bash
node --check versus/league-service.js
node --test test/league.test.js test/s4-assets.test.js test/s4-card-index.test.js test/runtime-metrics.test.js
```

Benchmark (day6 tracked data; see `devtool/benchmark-admin-view.mjs`):

- Before: adminView ~3,570 ms (allocations ~2,609 ms).
- After: adminView < 100 ms; allocations < 20 ms; adminEconomyView < 30 ms.

Production:

```bash
ydl_pid=$(sudo systemctl show football-s4 -p MainPID --value)
curl --max-time 30 -sS -o /dev/null -u admin:"$VERSUS_ADMIN_PASSWORD" \
  -w 'admin/league status=%{http_code} time=%{time_total}s\n' \
  http://127.0.0.1:4318/api/admin/league

node devtool/profile-live.mjs "$ydl_pid" 60 \
  | tee "/home/admin/cpu-profile-admin-hotfix-$(date +%Y%m%d-%H%M%S).txt"

curl --max-time 10 -sS http://127.0.0.1:4318/api/diagnostics/metrics \
  -H "Authorization: Bearer $YDL_METRICS_TOKEN"
```

Functional checks with a test account:

- Open the admin league tab: allocations table shows the same counts as before.
- Grant coins / grant a card / simulate next round: actions complete without
  multi-second stalls, and the admin page re-renders with fresh data.
- While the admin page is open, a player page refresh completes normally.

## Roll back

```bash
cd /opt/football-s4
sudo systemctl stop football-s4
sudo tar -xzf /home/admin/football-s4-admin-performance-backup-YYYYMMDD-HHMMSS.tar.gz \
  -C /opt/football-s4
sudo chown admin:admin versus/league-service.js
node --check versus/league-service.js
sudo systemctl start football-s4
sudo systemctl status football-s4 --no-pager -l
```
