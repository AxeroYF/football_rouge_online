# S4 V2.1 match engine

This directory is a self-contained migration of the S4 V2.1 match engine used by YellowDogs Chronicles.

- Runtime entry: `versus/v2/match-engine-v2.js`
- Campaign adapter: `../campaign-match-engine.mjs`
- Model version: `match-engine-v2.1`
- Stable profile: `v2.1-stable-dynamic.2`
- Parameter source: `versus/v2/match-parameters-v2.json`

All relative imports resolve inside this directory. Runtime code must not import from `S4_source_snapshot` or another worktree. Territory matches should be created through the campaign adapter so saved tactical presets, player attributes, AI garrisons, and the compact public match report remain consistent.
