#!/bin/bash

# DeepHarness Platform - Development Startup Script
# 一键启动：Agent Stub（dh gateway）→ DH Backend → Frontend Web App
# 同时检查外部 ent-desktop gatewayd（2346）是否运行并给出提示。

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 默认端口
AGENT_STUB_PORT="${AGENT_STUB_PORT:-8090}"
DH_BACKEND_PORT="${DH_BACKEND_PORT:-8080}"
FRONTEND_PORT="${FRONTEND_PORT:-8888}"
GATEWAYD_PORT="${GATEWAYD_PORT:-2346}"

# 基础 URL
AGENT_STUB_URL="http://localhost:${AGENT_STUB_PORT}"
API_BASE_URL="http://localhost:${DH_BACKEND_PORT}"
GATEWAYD_URL="http://localhost:${GATEWAYD_PORT}"

# 服务二进制路径
AGENT_STUB_DIR="apps/agent-stub"
AGENT_STUB_BIN="${AGENT_STUB_DIR}/dist/agent-stub"
DH_BACKEND_DIR="apps/dh-backend"
DH_BACKEND_BIN="${DH_BACKEND_DIR}/dist/dh-backend"

# PIDs
 declare -a PIDS=()

# Cleanup function
cleanup() {
    echo -e "\n${YELLOW}🛑 Shutting down services...${NC}"
    for pid in "${PIDS[@]}"; do
        if kill -0 "$pid" 2>/dev/null; then
            kill "$pid" 2>/dev/null || true
            wait "$pid" 2>/dev/null || true
        fi
    done
    echo -e "${GREEN}✅ All services stopped${NC}"
    exit 0
}

trap cleanup SIGINT SIGTERM EXIT

# Helper functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[OK]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

wait_for_service() {
    local url=$1
    local name=$2
    local max_attempts=${3:-30}
    local attempt=1

    echo -n "Waiting for $name..."
    while [ $attempt -le $max_attempts ]; do
        if curl -s "$url" >/dev/null 2>&1; then
            echo -e " ${GREEN}ready${NC}"
            return 0
        fi
        echo -n "."
        sleep 0.5
        attempt=$((attempt + 1))
    done
    echo -e " ${RED}timeout${NC}"
    return 1
}

check_port() {
    local port=$1
    if lsof -i :"$port" >/dev/null 2>&1 || ss -tlnp 2>/dev/null | grep -q ":$port "; then
        return 0
    fi
    return 1
}

kill_port() {
    local port=$1
    local pids
    pids=$(lsof -t -i :"$port" 2>/dev/null || true)
    if [ -n "$pids" ]; then
        kill $pids 2>/dev/null || true
        sleep 1
    fi
}

build_if_needed() {
    local source_file=$1
    local binary_file=$2
    local service_name=$3

    if [ ! -f "$binary_file" ] || [ "$source_file" -nt "$binary_file" ]; then
        log_info "Building ${service_name}..."
        local dir
        dir=$(dirname "$binary_file")
        mkdir -p "$dir"
        local module_dir
        module_dir=$(dirname "$source_file")
        local relative_output
        relative_output=${binary_file#${module_dir}/}
        (cd "$module_dir" && go build -o "$relative_output" .)
        log_success "${service_name} built"
    fi
}

build_services() {
    log_info "Building services..."
    build_if_needed "${AGENT_STUB_DIR}/main.go" "$AGENT_STUB_BIN" "agent-stub"
    build_if_needed "${DH_BACKEND_DIR}/main.go" "$DH_BACKEND_BIN" "dh-backend"
}

# Start Agent Stub (DH Gateway)
start_agent_stub() {
    log_info "Starting Agent Stub (DH Gateway) on port $AGENT_STUB_PORT..."

    if check_port "$AGENT_STUB_PORT"; then
        log_warn "Port $AGENT_STUB_PORT is in use, killing existing process..."
        kill_port "$AGENT_STUB_PORT"
    fi

    cd "$AGENT_STUB_DIR"
    PORT=$AGENT_STUB_PORT ./dist/agent-stub > /tmp/agent-stub.log 2>&1 &
    local pid=$!
    PIDS+=("$pid")
    cd ../..

    if wait_for_service "${AGENT_STUB_URL}/health" "Agent Stub"; then
        log_success "Agent Stub running (PID: $pid, log: /tmp/agent-stub.log)"
    else
        log_error "Agent Stub failed to start"
        cat /tmp/agent-stub.log
        exit 1
    fi
}

# Start DH Backend
start_dh_backend() {
    log_info "Starting DH Backend on port $DH_BACKEND_PORT..."

    if check_port "$DH_BACKEND_PORT"; then
        log_warn "Port $DH_BACKEND_PORT is in use, killing existing process..."
        kill_port "$DH_BACKEND_PORT"
    fi

    cd "$DH_BACKEND_DIR"
    PORT=$DH_BACKEND_PORT ./dist/dh-backend > /tmp/dh-backend.log 2>&1 &
    local pid=$!
    PIDS+=("$pid")
    cd ../..

    if wait_for_service "${API_BASE_URL}/health" "DH Backend"; then
        log_success "DH Backend running (PID: $pid, log: /tmp/dh-backend.log)"
    else
        log_error "DH Backend failed to start"
        cat /tmp/dh-backend.log
        exit 1
    fi
}

# Start Frontend
start_frontend() {
    log_info "Starting Frontend Web App on port $FRONTEND_PORT..."

    if check_port "$FRONTEND_PORT"; then
        log_warn "Port $FRONTEND_PORT is in use, killing existing process..."
        kill_port "$FRONTEND_PORT"
    fi

    cd apps/dh-frontend
    pnpm dev --port "$FRONTEND_PORT" > /tmp/frontend.log 2>&1 &
    local pid=$!
    PIDS+=("$pid")
    cd ../..

    # Vite takes a bit longer to start
    echo -n "Waiting for Frontend..."
    local attempt=1
    while [ $attempt -le 60 ]; do
        if curl -s "http://localhost:${FRONTEND_PORT}" >/dev/null 2>&1; then
            echo -e " ${GREEN}ready${NC}"
            log_success "Frontend running (PID: $pid, log: /tmp/frontend.log)"
            return 0
        fi
        echo -n "."
        sleep 0.5
        attempt=$((attempt + 1))
    done
    echo -e " ${RED}timeout${NC}"
    log_error "Frontend failed to start"
    cat /tmp/frontend.log
    exit 1
}

# 检查外部 ent-desktop gatewayd（AI Agent 运行时）是否已启动
check_external_gatewayd() {
    log_info "Checking external ent-desktop gatewayd on port $GATEWAYD_PORT..."
    if curl -s "${GATEWAYD_URL}/health" >/dev/null 2>&1; then
        log_success "External gatewayd is reachable at ${GATEWAYD_URL}"
    else
        log_warn "External gatewayd is NOT reachable at ${GATEWAYD_URL}"
        log_warn "Chat/agent features will fallback or fail until you start ent-desktop gatewayd."
        log_warn "Run: dh gwd help   (or: ent-desktop gatewayd --port ${GATEWAYD_PORT})"
    fi
}

# Main
main() {
    echo -e "${GREEN}🚀 DeepHarness Platform - Development Mode${NC}"
    echo ""

    # Check if we're in the right directory
    if [ ! -f "package.json" ] || [ ! -d "apps/dh-backend" ] || [ ! -d "apps/agent-stub" ]; then
        log_error "Please run this script from the project root directory"
        exit 1
    fi

    # Check dependencies
    if ! command -v go &> /dev/null; then
        log_error "Go is not installed"
        exit 1
    fi

    if ! command -v pnpm &> /dev/null; then
        log_error "pnpm is not installed"
        exit 1
    fi

    build_services

    start_agent_stub
    start_dh_backend
    start_frontend
    check_external_gatewayd

    echo ""
    echo -e "${GREEN}✅ All local services started successfully!${NC}"
    echo ""
    echo -e "${BLUE}Service URLs:${NC}"
    echo -e "  Frontend:     ${GREEN}http://localhost:${FRONTEND_PORT}${NC}"
    echo -e "  DH Backend:   ${GREEN}http://localhost:${DH_BACKEND_PORT}${NC}"
    echo -e "  Agent Stub:   ${GREEN}http://localhost:${AGENT_STUB_PORT}${NC} (DH Gateway)"
    echo -e "  Gatewayd:     ${YELLOW}${GATEWAYD_URL}${NC} (external ent-desktop, see warning above)"
    echo ""
    echo -e "${BLUE}Logs:${NC}"
    echo -e "  Frontend:     /tmp/frontend.log"
    echo -e "  DH Backend:   /tmp/dh-backend.log"
    echo -e "  Agent Stub:   /tmp/agent-stub.log"
    echo ""
    echo -e "${YELLOW}Press Ctrl+C to stop all services${NC}"
    echo ""

    # Keep script running
    while true; do
        sleep 1
    done
}

main "$@"
