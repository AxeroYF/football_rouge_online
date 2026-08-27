# League Sharded Persistence

The league service supports two persistence modes:

- A path ending in `.json` uses the legacy single-file state.
- A path without the `.json` suffix uses a sharded directory with an atomic `manifest.json`.

The source JSON is never modified by the migration command.

## Migration

Run while the service is stopped:

```text
node devtool/migrate-league-to-shards.js \
  Cloud_league_data/day5/yellowdogs-league.json \
  Cloud_league_data/day5/yellowdogs-league-shards
```

The command writes `migration-report.json` and exits non-zero if any of these checks fail:

- teams, rounds, matches, listings, and archives
- match, ledger, card, and asset-transaction IDs
- active-card count
- reload from the generated manifest

The original JSON should remain available as the rollback copy.

The service refuses to initialize a new league when the configured shard directory already contains files but has no `manifest.json`. This prevents a wrong path or incomplete upload from silently starting an empty league.

## Server Switch

After copying the generated directory to the server, set the environment variable to the directory, not to a JSON file:

```text
YELLOWDOGS_LEAGUE_PATH=/opt/football-s4/data/yellowdogs-league-shards
```

Then restart the service. The service creates a manifest revision for each save and keeps per-account card files, per-account pack files, per-match reports, appendable ledger segments, and season archive files separate from the core state.

## Rollback

Stop the service, remove or comment out `YELLOWDOGS_LEAGUE_PATH`, restore the legacy JSON path, and restart. Keep the shard directory intact until the new deployment has passed a complete operating window.
