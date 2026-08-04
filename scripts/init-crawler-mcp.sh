#!/bin/bash
# 将 crawler-service 的 MCP server 注册到 gatewayd.db 的 mcp_servers 表。
# 本脚本幂等：若已存在同名 server 则跳过，避免重复插入。

set -e

PLATFORM_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# 使用相对于 PLATFORM_ROOT 的路径注册到 gatewayd.db，避免绝对路径中出现
# gatewayd MCP 黑名单子串（如 -e）。gatewayd 需以 PLATFORM_ROOT 为 CWD 启动。
MCP_SERVER_SCRIPT="./apps/crawler-service/dist/mcp-server.js"
MCP_SERVER_SCRIPT_ABS="${PLATFORM_ROOT}/apps/crawler-service/dist/mcp-server.js"
DB_PATH="${GATEWAYD_DB_PATH:-${HOME}/.local/share/deepharness/gatewayd.db}"
SERVER_NAME="${CRAWLER_MCP_NAME:-crawler}"
CRAWLER_SERVICE_URL="${CRAWLER_SERVICE_URL:-http://127.0.0.1:8091}"

if [ ! -f "${MCP_SERVER_SCRIPT_ABS}" ]; then
    echo "[init-crawler-mcp] ERROR: ${MCP_SERVER_SCRIPT_ABS} not found. Run 'pnpm --filter @repo/crawler-service build' first." >&2
    exit 1
fi

if [ ! -f "${DB_PATH}" ]; then
    echo "[init-crawler-mcp] WARNING: gatewayd.db not found at ${DB_PATH}; skipping MCP registration." >&2
    exit 0
fi

if ! command -v sqlite3 >/dev/null 2>&1; then
    echo "[init-crawler-mcp] WARNING: sqlite3 not found; skipping MCP registration." >&2
    exit 0
fi

# 确保 mcp_servers 表已存在（gatewayd 首次启动前可能表不存在）。
sqlite3 "${DB_PATH}" "
CREATE TABLE IF NOT EXISTS mcp_servers (
    name TEXT PRIMARY KEY,
    command TEXT NOT NULL,
    args TEXT NOT NULL DEFAULT '[]',
    env TEXT NOT NULL DEFAULT '{}',
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
" >/dev/null

# 检查是否已注册
existing_count=$(sqlite3 "${DB_PATH}" "SELECT COUNT(*) FROM mcp_servers WHERE name = '${SERVER_NAME}';")
if [ "${existing_count}" -gt 0 ]; then
    echo "[init-crawler-mcp] MCP server '${SERVER_NAME}' already registered in ${DB_PATH}."
    exit 0
fi

# 注册 crawler MCP server：通过 node 执行 dist/mcp-server.js，以 stdio 方式与 gatewayd 通信。
now=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
sqlite3 "${DB_PATH}" "
INSERT INTO mcp_servers (name, command, args, env, enabled, created_at, updated_at)
VALUES (
    '${SERVER_NAME}',
    'node',
    '[\"${MCP_SERVER_SCRIPT}\"]',
    '{\"CRAWLER_SERVICE_URL\":\"${CRAWLER_SERVICE_URL}\"}',
    1,
    '${now}',
    '${now}'
);
" >/dev/null

echo "[init-crawler-mcp] Registered MCP server '${SERVER_NAME}' -> ${MCP_SERVER_SCRIPT}"
echo "[init-crawler-mcp] Please restart gatewayd if it is already running: bash scripts/restart-dev.sh"
