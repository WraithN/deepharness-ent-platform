#!/bin/bash
set -e

PLATFORM_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENT_DESKTOP_ROOT="${PLATFORM_ROOT}/../deepharness-ent-desktop"
GATEWAYD_PORT="${GATEWAYD_ADMIN_PORT:-2346}"
GATEWAYD_URL="http://localhost:${GATEWAYD_PORT}"
# gatewayd 对 AttachAgent 传入的 work_directory 会做根目录白名单校验，
# 默认只允许 gatewayd 进程 cwd；通过 GATEWAYD_WORKSPACE_ROOTS 额外放行 workspace.root。
GATEWAYD_WORKSPACE_ROOTS="${GATEWAYD_WORKSPACE_ROOTS:-/home/nan/test}"

# 已经在运行就跳过
if curl -sf "${GATEWAYD_URL}/health" > /dev/null 2>&1; then
    echo "[gatewayd] Already running on port ${GATEWAYD_PORT}"
    exit 0
fi

echo "[gatewayd] Starting..."

GATEWAYD_BIN=""
if [ -f "${ENT_DESKTOP_ROOT}/target/debug/dh-gatewayd" ] && [ -f "${ENT_DESKTOP_ROOT}/target/release/dh-gatewayd" ]; then
    if [ "${ENT_DESKTOP_ROOT}/target/debug/dh-gatewayd" -nt "${ENT_DESKTOP_ROOT}/target/release/dh-gatewayd" ]; then
        GATEWAYD_BIN="${ENT_DESKTOP_ROOT}/target/debug/dh-gatewayd"
    else
        GATEWAYD_BIN="${ENT_DESKTOP_ROOT}/target/release/dh-gatewayd"
    fi
elif [ -f "${ENT_DESKTOP_ROOT}/target/release/dh-gatewayd" ]; then
    GATEWAYD_BIN="${ENT_DESKTOP_ROOT}/target/release/dh-gatewayd"
elif [ -f "${ENT_DESKTOP_ROOT}/target/debug/dh-gatewayd" ]; then
    GATEWAYD_BIN="${ENT_DESKTOP_ROOT}/target/debug/dh-gatewayd"
fi

if [ -z "$GATEWAYD_BIN" ]; then
    echo "[gatewayd] Binary not found, building..."
    (cd "$ENT_DESKTOP_ROOT" && cargo build --release -p dh-gatewayd)
    GATEWAYD_BIN="${ENT_DESKTOP_ROOT}/target/release/dh-gatewayd"
fi

GATEWAYD_WORKSPACE_ROOTS="$GATEWAYD_WORKSPACE_ROOTS" "$GATEWAYD_BIN" \
    --port "${GATEWAYD_API_PORT:-2345}" \
    --admin-port "$GATEWAYD_PORT" \
    --attach opencode \
    > /tmp/gatewayd.log 2>&1 &

sleep 2
if curl -sf "${GATEWAYD_URL}/health" > /dev/null 2>&1; then
    echo "[gatewayd] Started (log: /tmp/gatewayd.log)"
else
    echo "[gatewayd] WARNING: Started but not yet responding, continuing..."
fi
