# YDL S4 historical roster overflow startup hotfix

## Incident

- Production shard revision 977 contains 48 active player families for `ydl-team-1`.
- After X/legend/external +5 exemptions, the team uses 36 of 33 roster slots.
- The strict startup invariant prevented the whole service from loading.

## Change

- Historical roster overflow is tolerated only while `ensureS4Assets` loads existing state.
- Explicit invariant checks remain strict and still report the team, owner, family count, active cards, and occupied slots.
- Existing mutation paths continue to reject new card families while roster usage is at or above 33.
- No cards, ownerships, matches, wallets, or shard files are modified by this hotfix.

## Required follow-up

After startup, the affected player must sell, release, or otherwise remove at least three slot-using player families before receiving another slot-using family.

## Deployment

```bash
cd /opt/football-s4
sudo systemctl stop football-s4
sudo tar -xzf /home/admin/football-ydl-s4-roster-overflow-startup-hotfix-20260803-1053.tar.gz -C /opt/football-s4
sudo chown admin:admin /opt/football-s4/versus/s4-assets.js
node --check versus/s4-assets.js
sudo systemctl start football-s4
sudo systemctl status football-s4 --no-pager -l
sudo journalctl -u football-s4 -n 80 --no-pager
```

Do not rerun shard migration and do not replace the current shard directory.
