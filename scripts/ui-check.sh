#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

PORT="${CONFIG_MATE_UI_PORT:-3311}"
BASE_URL="${CONFIG_MATE_UI_BASE_URL:-http://127.0.0.1:${PORT}}"
SERVER_PID=""
SERVER_LOG="${TMPDIR:-/tmp}/config-mate-ui-check-${PORT}.log"

cleanup() {
    if [[ -n "${SERVER_PID}" ]] && kill -0 "${SERVER_PID}" 2>/dev/null; then
        kill "${SERVER_PID}" 2>/dev/null || true
        wait "${SERVER_PID}" 2>/dev/null || true
    fi
}

is_server_ready() {
    node -e "fetch(process.argv[1]).then(res => process.exit(res.ok ? 0 : 1)).catch(() => process.exit(1));" "${BASE_URL}" >/dev/null 2>&1
}

wait_for_server() {
    for _ in $(seq 1 60); do
        if is_server_ready; then
            return 0
        fi
        sleep 1
    done

    echo "[ui:check] Config Mate server did not become ready at ${BASE_URL}." >&2
    if [[ -f "${SERVER_LOG}" ]]; then
        echo "[ui:check] Server log:" >&2
        tail -n 120 "${SERVER_LOG}" >&2 || true
    fi
    return 1
}

trap cleanup EXIT INT TERM

npm run lint:style
npm run test:ui

if is_server_ready; then
    echo "[ui:check] Reusing existing Config Mate server at ${BASE_URL}."
else
    echo "[ui:check] Starting Config Mate server at ${BASE_URL}."
    NO_BROWSER=1 PORT="${PORT}" CONFIG_MATE_PASSWORD="${CONFIG_MATE_PASSWORD:-123456}" node tb-config-src.js --dev >"${SERVER_LOG}" 2>&1 &
    SERVER_PID="$!"
    wait_for_server
fi

npm run test:visual
npm run build
