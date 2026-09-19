#!/usr/bin/env bash
set -uo pipefail
printf '%s\n' '阿里云部署目标：8.210.0.104 / 内网 172.17.12.224 / yellowdogsleague.online/versus/'
uname -sm
if [[ -f /etc/os-release ]]; then grep -E '^(PRETTY_NAME|ID|VERSION_ID)=' /etc/os-release; fi
getconf GNU_LIBC_VERSION || true
free -h
df -h / /opt /var
printf '%s\n' '当前端口（新游戏仅使用本机 4380；公网使用 80/443）'
ss -lntp
printf '%s\n' '旧游戏与网站服务'
systemctl list-unit-files --type=service --no-pager | grep -Ei 'football|yellowdogs|ydl|s4|nginx|apache|pm2' || true
printf '%s\n' '可能的旧目录：仅列出，不移动、不删除'
find /opt /srv /var/www -maxdepth 2 -type d \( -iname '*yellowdogs*' -o -iname '*football*' -o -iname '*s4*' \) -print 2>/dev/null || true
if command -v nginx >/dev/null; then
    printf '%s\n' '域名、证书和代理相关配置（不读取私钥或账号内容）'
    nginx -T 2>/dev/null | awk '/^# configuration file /{file=$0} /server_name.*yellowdogsleague\.online/{print file;print} /^[[:space:]]*(ssl_certificate|ssl_certificate_key|proxy_pass)[[:space:]]/{print file;print}'
fi
printf '%s\n' '只读排查完成。保留 S4 备份；根据确切服务名和目录做隔离。'
