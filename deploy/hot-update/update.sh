#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
echo '校验安装包完整性…'
sha256sum -c SHA256SUMS >/dev/null
echo '安装包完整性通过，开始版本检查…'
exec /opt/yellowdogs-rougelite/node/bin/node hot-update.mjs "$@"
