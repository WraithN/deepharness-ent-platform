#!/bin/bash
# DeepHarness Platform - 开发环境重启脚本
# 停止所有开发服务并重新启动，无需手动杀进程。
set -e

PLATFORM_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

echo -e "${GREEN}  Stopping existing services...${NC}"

# 按端口杀掉旧进程
for port in 8888 8080 8090 2345 2346; do
    pids=$(lsof -t -i :"$port" 2>/dev/null || true)
    if [ -n "$pids" ]; then
        echo "  Killing port $port (PID: $pids)"
        kill $pids 2>/dev/null || true
    fi
done
sleep 1

echo -e "${GREEN}  Restarting all services...${NC}"
exec bash "${PLATFORM_ROOT}/scripts/start-dev.sh" --detach
