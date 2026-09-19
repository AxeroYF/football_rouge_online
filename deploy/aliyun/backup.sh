#!/usr/bin/env bash
set -euo pipefail
umask 077
[[ "$(id -u)" == 0 ]] || { echo '需要 sudo'; exit 1; }
for file in /var/lib/yellowdogs-rougelite/campaign-accounts.json /etc/yellowdogs-rougelite.env; do
  [[ -f "$file" ]] || { echo "缺少 $file"; exit 1; }
done
install -d -m 0700 /var/backups/yellowdogs-rougelite
backup="/var/backups/yellowdogs-rougelite/$(date -u +%Y%m%d-%H%M%S)-$$.tar.gz"
was_active=0
systemctl is-active --quiet yellowdogs-rougelite && was_active=1
restore_service() { if [[ "$was_active" == 1 ]]; then systemctl start yellowdogs-rougelite; fi; }
trap restore_service EXIT
systemctl stop yellowdogs-rougelite
tar -czf "$backup" -C / opt/yellowdogs-rougelite var/lib/yellowdogs-rougelite etc/yellowdogs-rougelite.env etc/systemd/system/yellowdogs-rougelite.service etc/nginx/conf.d/yellowdogs-rougelite.conf etc/nginx/snippets/yellowdogs-rougelite-proxy.conf
sha256sum "$backup" > "$backup.sha256"
echo "备份完成：$backup"
