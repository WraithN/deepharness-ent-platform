#!/bin/bash
# DeepHarness Platform - 开发环境停止脚本
# 停止所有由 start-dev.sh --detach 启动的后台服务

set -e

PLATFORM_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PLATFORM_ROOT"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info()    { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC}   $1"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC} $1"; }

kill_port() {
    local port=$1
    local pids
    pids=$(lsof -t -i :"$port" 2>/dev/null || true)
    if [ -n "$pids" ]; then
        kill $pids 2>/dev/null || true
        sleep 0.5
    fi
}

echo -e "${YELLOW}Stopping development services...${NC}"

for port in 8888 8080 8090 8091 2345 2346; do
    kill_port "$port"
done

# 兜底：按名称清理可能残留的子进程
pkill -f "dh-gatewayd" 2>/dev/null || true
pkill -f "personal-stub" 2>/dev/null || true
pkill -f "dh-backend" 2>/dev/null || true
pkill -f "vite --host --port 8888" 2>/dev/null || true
pkill -f "pnpm dev --port 8888" 2>/dev/null || true
pkill -f "crawler-service" 2>/dev/null || true

echo -e "${GREEN}All services stopped${NC}"
