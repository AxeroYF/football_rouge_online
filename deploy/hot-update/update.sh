#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
sha256sum -c SHA256SUMS >/dev/null
exec /opt/yellowdogs-rougelite/node/bin/node hot-update.mjs "$@"
