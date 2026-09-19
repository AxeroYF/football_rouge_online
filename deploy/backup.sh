#!/usr/bin/env bash
set -euo pipefail
umask 077
if [[ "$(id -u)" != 0 ]]; then echo "请使用 sudo bash deploy/backup.sh"; exit 1; fi
test -d /opt/yellowdogs/app
test -f /var/lib/yellowdogs/campaign-accounts.json
install -d -m 0700 /var/backups/yellowdogs
stamp="$(date +%Y%m%d-%H%M%S)"
destination="/var/backups/yellowdogs/yellowdogs-$stamp.tar.gz"
test ! -e "$destination"
was_active=0
if systemctl is-active --quiet yellowdogs; then was_active=1; systemctl stop yellowdogs; fi
resume() { if [[ "$was_active" = 1 ]]; then systemctl start yellowdogs; fi; }
trap resume EXIT
tar -czf "$destination" -C / opt/yellowdogs/app var/lib/yellowdogs etc/yellowdogs.env etc/systemd/system/yellowdogs.service etc/nginx/sites-available/yellowdogs-v01 etc/nginx/snippets/yellowdogs-proxy.conf
sha256sum "$destination" > "$destination.sha256"
echo "备份完成：$destination"
