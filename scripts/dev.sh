#!/usr/bin/env bash
set -euo pipefail

trap 'kill $(jobs -p) 2>/dev/null; exit 0' INT TERM EXIT

echo "Starting altera-server (:4000) and altera-admin (:5173)..."

bun run --filter 'altera-server' dev &
bun run --filter 'altera-admin' dev &

wait
