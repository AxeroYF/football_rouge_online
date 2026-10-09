# R13 recovery deployment confirmed

User supplied successful server output: Installed: 20260919-r13.
Health check passed after 20 seconds, on attempt 11; initial ten fetch failures occurred during startup.
Recovery archive: yellowdogs-hot-update-20260919-r13-recovery.tar.gz.
Game payload is identical to original R13 (62 files); installer health timing and diagnostics changed.
Backup: /var/backups/yellowdogs-rougelite/hot-updates/20260919-r13-1789824343071
Rollback (only if required): sudo bash /home/admin/yellowdogs-hot-update-20260919-r13-recovery/update.sh rollback /var/backups/yellowdogs-rougelite/hot-updates/20260919-r13-1789824343071

Prior service OOM events remain unresolved. Successful deployment does not prove memory pressure is fixed or identify the exact original health-check failure.
Admin grant visibility investigation remains paused at user request.
