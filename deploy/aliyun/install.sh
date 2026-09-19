#!/usr/bin/env bash
set -euo pipefail
umask 027
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.."
bundle="$(pwd -P)"
s4_source="$bundle/seed/campaign-accounts.json"; tls_cert=''; tls_key=''
while [[ $# -gt 0 ]]; do
    case "$1" in
        --tls-cert) tls_cert="${2:?需要 HTTPS 完整证书链路径}"; shift 2 ;;
        --tls-key) tls_key="${2:?需要 HTTPS 私钥路径}"; shift 2 ;;
        *) echo "用法：sudo bash deploy/aliyun/install.sh --tls-cert /证书/fullchain.pem --tls-key /证书/privkey.pem"; exit 1 ;;
    esac
done
[[ "$(id -u)" == 0 ]] || { echo '需要 sudo'; exit 1; }
[[ "$(uname -m)" == x86_64 ]] || { echo '此包需要 Linux x86_64'; exit 1; }
for value in "$s4_source" "$tls_cert" "$tls_key"; do
    [[ "$value" == /* && -f "$value" && -r "$value" ]] || { echo '必须指定可读的绝对账号/证书路径'; exit 1; }
    [[ "$value" != *'"'* && "$value" != *'$'* && "$value" != *'\'* && "$value" != *$'\n'* && "$value" != *$'\r'* ]] || { echo '路径包含不支持的配置字符'; exit 1; }
done
for destination in /opt/yellowdogs-rougelite /var/lib/yellowdogs-rougelite /etc/yellowdogs-rougelite.env /etc/systemd/system/yellowdogs-rougelite.service /etc/nginx/conf.d/yellowdogs-rougelite.conf; do
    [[ ! -e "$destination" && ! -L "$destination" ]] || { echo "已有新服路径，不覆盖：$destination"; exit 1; }
done
command -v ss >/dev/null || { echo '请安装 iproute2 / iproute'; exit 1; }
[[ -z "$(ss -H -lntp 'sport = :4380')" ]] || { echo '4380 已占用，请先核实'; exit 1; }
if command -v nginx >/dev/null; then
    nginx -t
    if nginx -T 2>/dev/null | grep -E 'server_name[^;]*yellowdogsleague\.online([[:space:];]|$)' >/dev/null; then
        echo '旧域名站点仍在 Nginx 配置中；先备份并隔离该站点配置，再重新运行。不要删除证书或 S4 备份。'; exit 1
    fi
fi
for port in 80 443; do
    listeners="$(ss -H -lntp "sport = :$port")"
    if [[ -n "$listeners" ]] && printf '%s\n' "$listeners" | grep -v nginx >/dev/null; then echo "$port 被其他程序占用，先核实对应服务"; exit 1; fi
done
sha256sum -c SHA256SUMS >/dev/null
[[ -f app/server.mjs && -f runtime/node-v24.20.0-linux-x64.tar.xz ]]
if ! command -v nginx >/dev/null || ! command -v curl >/dev/null || ! command -v openssl >/dev/null || ! command -v xz >/dev/null; then
    if command -v apt-get >/dev/null; then export DEBIAN_FRONTEND=noninteractive; apt-get update; apt-get install -y nginx curl ca-certificates openssl xz-utils;
    elif command -v dnf >/dev/null; then dnf install -y nginx curl ca-certificates openssl xz;
    elif command -v yum >/dev/null; then yum install -y nginx curl ca-certificates openssl xz;
    else echo '请预先安装 nginx curl ca-certificates openssl xz'; exit 1; fi
fi
openssl x509 -in "$tls_cert" -noout -checkhost yellowdogsleague.online | grep -F "does match certificate" >/dev/null || { echo "证书不匹配游戏域名"; exit 1; }
openssl x509 -in "$tls_cert" -noout -checkend 86400 >/dev/null
cmp -s <(openssl x509 -in "$tls_cert" -pubkey -noout) <(openssl pkey -in "$tls_key" -passin pass: -pubout) || { echo 'HTTPS 证书和私钥不匹配'; exit 1; }
getent group ydl-rougelite >/dev/null || groupadd --system ydl-rougelite
id ydl-rougelite >/dev/null 2>&1 || useradd --system --gid ydl-rougelite --home-dir /var/lib/yellowdogs-rougelite --shell /usr/sbin/nologin ydl-rougelite
install -d -m 0755 /opt/yellowdogs-rougelite/node
cp -a "$bundle/app" /opt/yellowdogs-rougelite/app
tar -xJf runtime/node-v24.20.0-linux-x64.tar.xz --strip-components=1 -C /opt/yellowdogs-rougelite/node
node=/opt/yellowdogs-rougelite/node/bin/node
"$node" --version
chown -R root:root /opt/yellowdogs-rougelite
chmod -R u+rwX,go+rX,go-w /opt/yellowdogs-rougelite
chown -R ydl-rougelite:ydl-rougelite /opt/yellowdogs-rougelite/app/assets
install -d -o ydl-rougelite -g ydl-rougelite -m 0750 /var/lib/yellowdogs-rougelite
"$node" app/scripts/import-s4-accounts.mjs "$s4_source" /var/lib/yellowdogs-rougelite/campaign-accounts.json
chown ydl-rougelite:ydl-rougelite /var/lib/yellowdogs-rougelite/campaign-accounts.json
admin_password="$("$node" -e "process.stdout.write(require('node:crypto').randomBytes(24).toString('hex'))")"
cat > /etc/yellowdogs-rougelite.env <<ENV
NODE_ENV=production
CAMPAIGN_DEV_TOOLS=0
HOST=127.0.0.1
PORT=4380
DATA_DIR=/var/lib/yellowdogs-rougelite
ADMIN_BOOTSTRAP_PASSWORD=$admin_password
CAMPAIGN_LIVE_SLICE_MS=100
CAMPAIGN_LIVE_PERSIST_MS=5000
ENV
chmod 0600 /etc/yellowdogs-rougelite.env
unset admin_password
install -m 0644 deploy/aliyun/yellowdogs-rougelite.service /etc/systemd/system/yellowdogs-rougelite.service
install -d -m 0755 /etc/nginx/snippets /etc/nginx/conf.d
install -m 0644 deploy/aliyun/proxy.conf /etc/nginx/snippets/yellowdogs-rougelite-proxy.conf
TLS_CERT="$tls_cert" TLS_KEY="$tls_key" "$node" --input-type=module -e 'import fs from "node:fs";let s=fs.readFileSync("deploy/aliyun/nginx.conf.template","utf8");s=s.replaceAll("@@TLS_CERT@@",process.env.TLS_CERT).replaceAll("@@TLS_KEY@@",process.env.TLS_KEY);fs.writeFileSync("/etc/nginx/conf.d/yellowdogs-rougelite.conf",s,{flag:"wx",mode:0o644});'
nginx -t
systemctl daemon-reload
systemctl enable --now yellowdogs-rougelite
ready=0
for attempt in {1..30}; do
    if curl --fail --silent http://127.0.0.1:4380/healthz >/dev/null; then ready=1; break; fi
    sleep 1
done
if [[ "$ready" != 1 ]]; then journalctl -u yellowdogs-rougelite -n 30 --no-pager; echo '新服启动失败，尚未重载 Nginx；保留文件供排查'; exit 1; fi
curl --fail --silent http://127.0.0.1:4380/versus/ >/dev/null
systemctl enable --now nginx
systemctl reload nginx
if command -v getenforce >/dev/null && [[ "$(getenforce)" == Enforcing ]]; then
    echo 'SELinux 正在强制执行；如代理返回 502，请按文档检查 Nginx 到本机 4380 的连接策略。'
fi
echo '安装完成：https://yellowdogsleague.online/versus/'
echo '后台：https://yellowdogsleague.online/admin ，用户名：admin'
echo '后台密码保存在 /etc/yellowdogs-rougelite.env；不要把该文件放进公开目录。'
echo '阿里云安全组仅需开放网页 80/443；4380 保持本机监听。请执行部署文档的域名与存档验收。'
