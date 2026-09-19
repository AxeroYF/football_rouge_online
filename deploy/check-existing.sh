#!/usr/bin/env bash
set -u
echo "监听端口（重点检查 80 和 4370）"
ss -lntp
echo "运行中的相关服务"
systemctl list-units --type=service --state=running --no-pager | grep -Ei 'football|yellowdogs|ydl|s4|node|nginx|apache|pm2' || true
echo "Node 和游戏进程"
ps -eo pid,ppid,user,args | grep -E '[n]ode|[n]pm|[P]M2|[f]ootball|[y]ellowdogs' || true
if command -v nginx >/dev/null; then
  echo "Nginx 同 IP 站点"
  nginx -T 2>&1 | grep -n -B 4 -A 6 'server_name.*106\.54\.12\.175' || true
fi
echo "检查完成，本脚本没有停止进程或修改服务。"
