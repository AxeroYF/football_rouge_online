#!/usr/bin/env bash
set -euo pipefail
umask 027
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
bundle="$(pwd -P)"
if [[ "$(id -u)" != 0 ]]; then echo "请使用 sudo bash deploy/install.sh"; exit 1; fi
if [[ "$(uname -m)" != x86_64 ]]; then echo "此运行包适用于 Ubuntu x86_64；当前架构不匹配。"; exit 1; fi
. /etc/os-release
if [[ "$ID" != ubuntu ]] || ! dpkg --compare-versions "$VERSION_ID" ge 20.04; then echo "需要 Ubuntu 20.04 或更新版本。"; exit 1; fi
if [[ -e /opt/yellowdogs || -e /var/lib/yellowdogs/campaign-accounts.json || -e /etc/yellowdogs.env || -e /etc/systemd/system/yellowdogs.service ]]; then
  echo "发现已有黄狗风云安装。本脚本只用于首次安装；请按部署文档更新，防止覆盖存档。"
  exit 1
fi
command -v ss >/dev/null || { echo "缺少 ss 命令，请先安装 iproute2。"; exit 1; }
if [[ -n "$(ss -H -lntp 'sport = :4370')" ]]; then
  echo "4370 已被占用，请先排查并停止旧游戏服务："
  ss -lntp 'sport = :4370'
  exit 1
fi
port80="$(ss -H -lntp 'sport = :80')"
if [[ -n "$port80" ]] && printf '%s\n' "$port80" | grep -v nginx >/dev/null; then
  echo "80 端口由其他程序占用，请按部署文档确认处理，安装已停止。"
  ss -lntp 'sport = :80'
  exit 1
fi
if command -v nginx >/dev/null && nginx -T 2>/dev/null | grep -E 'server_name[^;]*106\.54\.12\.175([[:space:];]|$)' >/dev/null; then
  echo "Nginx 已有此 IP 的站点，请先确认并停用不用的旧站点启用链接。"
  exit 1
fi

sha256sum -c SHA256SUMS >/dev/null
test -f app/server.mjs
test -f seed/campaign-accounts.json
test -f runtime/node-v24.20.0-linux-x64.tar.xz
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y nginx ca-certificates curl xz-utils
getent group yellowdogs >/dev/null || groupadd --system yellowdogs
id yellowdogs >/dev/null 2>&1 || useradd --system --gid yellowdogs --home-dir /var/lib/yellowdogs --shell /usr/sbin/nologin yellowdogs
install -d -m 0755 /opt/yellowdogs /opt/yellowdogs/node
cp -a "$bundle/app" /opt/yellowdogs/app
tar -xJf runtime/node-v24.20.0-linux-x64.tar.xz --strip-components=1 -C /opt/yellowdogs/node
/opt/yellowdogs/node/bin/node --version
chown -R root:root /opt/yellowdogs
chmod -R u+rwX,go+rX,go-w /opt/yellowdogs
chown -R yellowdogs:yellowdogs /opt/yellowdogs/app/assets
install -d -o yellowdogs -g yellowdogs -m 0750 /var/lib/yellowdogs
install -o yellowdogs -g yellowdogs -m 0600 seed/campaign-accounts.json /var/lib/yellowdogs/campaign-accounts.json
admin_password="$(/opt/yellowdogs/node/bin/node -e "process.stdout.write(require('node:crypto').randomBytes(24).toString('hex'))")"
cat > /etc/yellowdogs.env <<ENV
NODE_ENV=production
CAMPAIGN_DEV_TOOLS=0
HOST=127.0.0.1
PORT=4370
DATA_DIR=/var/lib/yellowdogs
ADMIN_BOOTSTRAP_PASSWORD=$admin_password
CAMPAIGN_LIVE_SLICE_MS=100
CAMPAIGN_LIVE_PERSIST_MS=5000
ENV
chmod 0600 /etc/yellowdogs.env
unset admin_password
install -m 0644 deploy/yellowdogs.service /etc/systemd/system/yellowdogs.service
install -d /etc/nginx/snippets
install -m 0644 deploy/yellowdogs-proxy.conf /etc/nginx/snippets/yellowdogs-proxy.conf
install -m 0644 deploy/yellowdogs-nginx.conf /etc/nginx/sites-available/yellowdogs-v01
ln -s /etc/nginx/sites-available/yellowdogs-v01 /etc/nginx/sites-enabled/yellowdogs-v01
nginx -t
systemctl daemon-reload
systemctl enable --now yellowdogs
ready=0
for attempt in {1..30}; do
  if curl --fail --silent http://127.0.0.1:4370/healthz >/dev/null; then ready=1; break; fi
  sleep 1
done
if [[ "$ready" != 1 ]]; then
  journalctl -u yellowdogs -n 30 --no-pager
  echo "启动失败，请查看上方日志；安装文件与账号种子均已保留。"
  exit 1
fi
systemctl enable --now nginx
systemctl reload nginx
if command -v ufw >/dev/null && ufw status | grep -q 'Status: active'; then ufw allow 80/tcp; fi
echo "安装完成：http://106.54.12.175/game"
echo "后台：http://106.54.12.175/admin ，用户名：admin"
echo "查看后台密码：sudo cat /etc/yellowdogs.env"
echo "请在腾讯云防火墙/安全组中放行 TCP 80。不要开放 4370。"
