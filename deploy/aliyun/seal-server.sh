#!/usr/bin/env bash
# Final offline archive for the standard Aliyun installation. Never starts service.
set -euo pipefail
umask 077
[[ "$(id -u)" == 0 ]] || { echo '需要 sudo'; exit 1; }
service=yellowdogs-rougelite.service
node=/opt/yellowdogs-rougelite/node/bin/node
data=/var/lib/yellowdogs-rougelite
config=(etc/yellowdogs-rougelite.env etc/systemd/system/yellowdogs-rougelite.service etc/nginx/conf.d/yellowdogs-rougelite.conf etc/nginx/snippets/yellowdogs-rougelite-proxy.conf)
for command in systemctl tar gzip sha256sum mktemp stat; do command -v "$command" >/dev/null; done
for file in "$data/campaign-accounts.json" "$node" "${config[@]/#//}"; do
  [[ -f "$file" ]] || { echo "缺少 $file；未执行停服"; exit 1; }
done
[[ -d /home/admin && -x "$node" ]] || { echo '请核对标准安装路径'; exit 1; }
[[ "$(systemctl show "$service" -p WorkingDirectory --value)" == /opt/yellowdogs-rougelite/app ]] || { echo '服务工作目录不符，请人工核对'; exit 1; }
grep -qx 'DATA_DIR=/var/lib/yellowdogs-rougelite' /etc/yellowdogs-rougelite.env || { echo 'DATA_DIR 与标准安装不符，请人工核对'; exit 1; }
[[ ! -d /etc/systemd/system/yellowdogs-rougelite.service.d ]] || config+=(etc/systemd/system/yellowdogs-rougelite.service.d)
output=$(mktemp -d "/home/admin/yellowdogs-final-$(date -u +%Y%m%d-%H%M%S)-XXXXXX")
trap 'echo "封存未完成；不会自动开服。请检查错误，保留原数据和目录：$output" >&2' ERR
echo '正在正常停服并关闭开机自启，等待最后一次存档……'
systemctl disable --now "$service"
assert_stopped() {
  [[ "$(systemctl show "$service" -p ActiveState --value)" == inactive ]] || return 1
  [[ "$(systemctl show "$service" -p MainPID --value)" == 0 ]] || return 1
  [[ "$(systemctl show "$service" -p Result --value)" == success ]] || return 1
  [[ "$(systemctl show "$service" -p ExecMainStatus --value)" == 0 ]] || return 1
  [[ "$(systemctl show "$service" -p UnitFileState --value)" == disabled ]] || return 1
}
assert_stopped || { echo "停服或最后存档状态异常，先查看 sudo journalctl -u $service -n 80；不要删除任何数据。"; exit 1; }
"$node" --max-old-space-size=768 --input-type=module - "$data/campaign-accounts.json" > "$output/ACCOUNTS-CHECK.json" <<'NODE'
import fs from 'node:fs';
const saved = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (!saved || !saved.accounts || typeof saved.accounts !== 'object' || Array.isArray(saved.accounts) || !saved.world || typeof saved.world !== 'object') throw Error('存档结构异常，请保留原文件并人工检查');
console.log(JSON.stringify({checkedAt: new Date().toISOString(), version: saved.version, accountCount: Object.keys(saved.accounts).length}, null, 2));
NODE
{
  date -u +%Y-%m-%dT%H:%M:%SZ
  "$node" --version
  systemctl show "$service" -p ActiveState -p UnitFileState -p MainPID -p Result -p ExecMainStatus
  stat -c '%u:%g %a %n' "$data" /opt/yellowdogs-rougelite/app/assets
} > "$output/SERVER-STATE.txt"
original_hash=$(sha256sum "$data/campaign-accounts.json" | cut -d ' ' -f 1)
echo '归档玩家数据、实际运行程序（含依赖和私有资源）、服务配置……'
tar --numeric-owner -czf "$output/data.tar.gz" -C / var/lib/yellowdogs-rougelite
tar --numeric-owner -czf "$output/runtime.tar.gz" -C / opt/yellowdogs-rougelite
tar --numeric-owner -czf "$output/config.tar.gz" -C / "${config[@]}"
for archive in "$output"/*.tar.gz; do gzip -t "$archive"; tar -tzf "$archive" >/dev/null; done
archived_hash=$(tar -xOzf "$output/data.tar.gz" var/lib/yellowdogs-rougelite/campaign-accounts.json | sha256sum | cut -d ' ' -f 1)
[[ "$original_hash" == "$archived_hash" && "$original_hash" == "$(sha256sum "$data/campaign-accounts.json" | cut -d ' ' -f 1)" ]]
assert_stopped
printf '%s  var/lib/yellowdogs-rougelite/campaign-accounts.json\n' "$original_hash" > "$output/SAVE.sha256"
(
  cd "$output"
  sha256sum data.tar.gz runtime.tar.gz config.tar.gz ACCOUNTS-CHECK.json SERVER-STATE.txt SAVE.sha256 > SHA256SUMS
  sha256sum -c SHA256SUMS
)
chown -R "$(stat -c '%u:%g' /home/admin)" "$output"
trap - ERR
echo "封存完成，服务保持停止且禁止开机自启。请通过 SFTP 下载整个目录：$output"
echo '包含玩家密码哈希和服务秘密；请私密保存。异地双份校验完成前，不要释放服务器或删除原数据。'
