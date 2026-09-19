#!/usr/bin/env bash
set -euo pipefail
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
qa="$(mktemp -d /tmp/ydl-hot-update-XXXXXX)"
mkdir "$qa/node" "$qa/data"
tar -xJf "$root/outputs/v01-runtime/node-v24.20.0-linux-x64.tar.xz" --strip-components=1 -C "$qa/node"
cp -a "$root/outputs/aliyun-release-20260909-s4accounts/yellowdogs-rougelite-aliyun/app" "$qa/app"
bundle="${1:?Provide staged bundle directory}"
out="${2:?Provide QA output directory}"
if [[ -n "${3:-}" ]]; then cp -a "$3/payload/." "$qa/app/"; fi
bash -n "$bundle/update.sh"
"$qa/node/bin/node" "$root/scripts/verify-hot-update.mjs" "$qa/app" "$bundle" "$qa/data" "$qa/backups" "$out"
echo "Linux QA retained at $qa"
