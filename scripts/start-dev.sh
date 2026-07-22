#!/bin/bash
# DeepHarness Platform - 开发环境启动脚本
# 一键启动：DH Gatewayd（ent-desktop）→ Agent Stub → DH Backend → Frontend Web App
#
# 用法：
#   bash scripts/start-dev.sh           # 前台启动，按 Ctrl+C 停止所有服务
#   bash scripts/start-dev.sh --detach  # 后台启动，服务不受终端/任务超时影响

set -e

DETACH_MODE=false
for arg in "$@"; do
  if [ "$arg" = "--detach" ]; then
    DETACH_MODE=true
  fi
done

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# 项目路径
PLATFORM_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENT_DESKTOP_ROOT="${PLATFORM_ROOT}/../deepharness-ent-desktop"

# 默认端口
GATEWAYD_API_PORT="${GATEWAYD_API_PORT:-2345}"
GATEWAYD_ADMIN_PORT="${GATEWAYD_ADMIN_PORT:-2346}"
AGENT_STUB_PORT="${AGENT_STUB_PORT:-8090}"
DH_BACKEND_PORT="${DH_BACKEND_PORT:-8080}"
FRONTEND_PORT="${FRONTEND_PORT:-8888}"

# 基础 URL
GATEWAYD_ADMIN_URL="http://localhost:${GATEWAYD_ADMIN_PORT}"
AGENT_STUB_URL="http://localhost:${AGENT_STUB_PORT}"
API_BASE_URL="http://localhost:${DH_BACKEND_PORT}"

# 服务二进制路径
AGENT_STUB_DIR="apps/agent-stub"
AGENT_STUB_BIN="${AGENT_STUB_DIR}/dist/agent-stub"
DH_BACKEND_DIR="apps/dh-backend"
DH_BACKEND_BIN="${DH_BACKEND_DIR}/dist/dh-backend"
GATEWAYD_RELEASE="${ENT_DESKTOP_ROOT}/target/release/dh-gatewayd"
GATEWAYD_DEBUG="${ENT_DESKTOP_ROOT}/target/debug/dh-gatewayd"

# PIDs
declare -a PIDS=()

# Cleanup function
cleanup() {
    echo -e "\n${YELLOW}Shutting down services...${NC}"
    for pid in "${PIDS[@]}"; do
        if kill -0 "$pid" 2>/dev/null; then
            kill "$pid" 2>/dev/null || true
            wait "$pid" 2>/dev/null || true
        fi
    done
    # 兜底：按名称清理可能残留的子进程
    pkill -f "dh-gatewayd" 2>/dev/null || true
    pkill -f "agent-stub" 2>/dev/null || true
    pkill -f "dh-backend" 2>/dev/null || true
    echo -e "${GREEN}All services stopped${NC}"
    exit 0
}

trap cleanup SIGINT SIGTERM EXIT

if [ "$DETACH_MODE" = true ]; then
  trap - SIGINT SIGTERM EXIT
fi

log_info()    { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC}   $1"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error()   { echo -e "${RED}[ERROR]${NC} $1"; }

wait_for_service() {
    local url=$1
    local name=$2
    local max_attempts=${3:-30}
    local attempt=1

    echo -n "  Waiting for ${name}..."
    while [ $attempt -le $max_attempts ]; do
        if curl -sf "$url" >/dev/null 2>&1; then
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
    lsof -i :"$port" >/dev/null 2>&1 || ss -tlnp 2>/dev/null | grep -q ":$port "
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

build_go_if_needed() {
    local module_dir=$1
    local binary_file=$2
    local service_name=$3

    if [ ! -f "$binary_file" ]; then
        log_info "Building ${service_name}..."
        mkdir -p "$(dirname "$binary_file")"
        local relative_output=${binary_file#${module_dir}/}
        (cd "$module_dir" && go build -o "$relative_output" .)
        log_success "${service_name} built"
        return
    fi

    local binary_mtime
    binary_mtime=$(stat -c %Y "$binary_file" 2>/dev/null || stat -f %m "$binary_file" 2>/dev/null)
    if [ -z "$binary_mtime" ]; then
        binary_mtime=0
    fi

    local needs_rebuild=false
    while IFS= read -r -d '' file; do
        local file_mtime
        file_mtime=$(stat -c %Y "$file" 2>/dev/null || stat -f %m "$file" 2>/dev/null)
        if [ -n "$file_mtime" ] && [ "$file_mtime" -gt "$binary_mtime" ]; then
            needs_rebuild=true
            break
        fi
    done < <(find "$module_dir" -name "*.go" -type f -print0)

    if [ "$needs_rebuild" = true ]; then
        log_info "Building ${service_name}..."
        mkdir -p "$(dirname "$binary_file")"
        local relative_output=${binary_file#${module_dir}/}
        (cd "$module_dir" && go build -o "$relative_output" .)
        log_success "${service_name} built"
    fi
}

resolve_gatewayd_bin() {
    if [ -f "$GATEWAYD_RELEASE" ] && [ -f "$GATEWAYD_DEBUG" ]; then
        if [ "$GATEWAYD_DEBUG" -nt "$GATEWAYD_RELEASE" ]; then
            echo "$GATEWAYD_DEBUG"
        else
            echo "$GATEWAYD_RELEASE"
        fi
    elif [ -f "$GATEWAYD_RELEASE" ]; then
        echo "$GATEWAYD_RELEASE"
    elif [ -f "$GATEWAYD_DEBUG" ]; then
        echo "$GATEWAYD_DEBUG"
    else
        echo ""
    fi
}

build_gatewayd() {
    GATEWAYD_BIN=$(resolve_gatewayd_bin)
    if [ -n "$GATEWAYD_BIN" ]; then
        return 0
    fi
    if ! command -v cargo &> /dev/null; then
        log_error "Rust/cargo not found, cannot build dh-gatewayd"
        return 1
    fi
    log_info "Building dh-gatewayd (Rust release build, may take a while)..."
    (cd "$ENT_DESKTOP_ROOT" && cargo build --release -p dh-gatewayd)
    GATEWAYD_BIN="$GATEWAYD_RELEASE"
    log_success "dh-gatewayd built"
}

# ── Start DH Gatewayd (ent-desktop) ──────────────────────────────
start_gatewayd() {
    if [ ! -d "$ENT_DESKTOP_ROOT" ]; then
        log_warn "ent-desktop directory not found at ${ENT_DESKTOP_ROOT}, skipping gatewayd"
        return 0
    fi

    log_info "Cleaning up orphaned opencode processes (ports 3001-3050)..."
    for port in $(seq 3001 3050); do
        kill_port "$port"
    done

    log_info "Starting DH Gatewayd on ports ${GATEWAYD_API_PORT}/${GATEWAYD_ADMIN_PORT}..."

    if check_port "$GATEWAYD_ADMIN_PORT"; then
        log_warn "Port ${GATEWAYD_ADMIN_PORT} in use, killing existing..."
        kill_port "$GATEWAYD_ADMIN_PORT"
    fi
    if check_port "$GATEWAYD_API_PORT"; then
        log_warn "Port ${GATEWAYD_API_PORT} in use, killing existing..."
        kill_port "$GATEWAYD_API_PORT"
    fi

    if ! build_gatewayd; then
        return 1
    fi

    if [ "$DETACH_MODE" = true ]; then
        setsid nohup "$GATEWAYD_BIN" \
            --port "$GATEWAYD_API_PORT" \
            --admin-port "$GATEWAYD_ADMIN_PORT" \
            --attach opencode \
            > /tmp/gatewayd.log 2>&1 &
        disown
        local pid=$!
    else
        "$GATEWAYD_BIN" \
            --port "$GATEWAYD_API_PORT" \
            --admin-port "$GATEWAYD_ADMIN_PORT" \
            --attach opencode \
            > /tmp/gatewayd.log 2>&1 &
        local pid=$!
        PIDS+=("$pid")
    fi

    if wait_for_service "${GATEWAYD_ADMIN_URL}/health" "Gatewayd" 60; then
        log_success "Gatewayd running (PID: $pid, log: /tmp/gatewayd.log)"
    else
        log_error "Gatewayd failed to start"
        cat /tmp/gatewayd.log
        return 1
    fi
}

# ── Start Agent Stub ─────────────────────────────────────────────
start_agent_stub() {
    log_info "Starting Agent Stub on port ${AGENT_STUB_PORT}..."

    if check_port "$AGENT_STUB_PORT"; then
        log_warn "Port ${AGENT_STUB_PORT} in use, killing existing..."
        kill_port "$AGENT_STUB_PORT"
    fi

    cd "$AGENT_STUB_DIR"
    if [ "$DETACH_MODE" = true ]; then
        setsid nohup env PORT=$AGENT_STUB_PORT ./dist/agent-stub > /tmp/agent-stub.log 2>&1 &
        disown
        local pid=$!
    else
        PORT=$AGENT_STUB_PORT ./dist/agent-stub > /tmp/agent-stub.log 2>&1 &
        local pid=$!
        PIDS+=("$pid")
    fi
    cd ../..

    if wait_for_service "${AGENT_STUB_URL}/health" "Agent Stub"; then
        log_success "Agent Stub running (PID: $pid, log: /tmp/agent-stub.log)"
    else
        log_error "Agent Stub failed to start"
        cat /tmp/agent-stub.log
        exit 1
    fi
}

# ── Start DH Backend ─────────────────────────────────────────────
start_dh_backend() {
    log_info "Starting DH Backend on port ${DH_BACKEND_PORT}..."

    if check_port "$DH_BACKEND_PORT"; then
        log_warn "Port ${DH_BACKEND_PORT} in use, killing existing..."
        kill_port "$DH_BACKEND_PORT"
    fi

    cd "$DH_BACKEND_DIR"
    if [ "$DETACH_MODE" = true ]; then
        setsid nohup env PORT=$DH_BACKEND_PORT ./dist/dh-backend > /tmp/dh-backend.log 2>&1 &
        disown
        local pid=$!
    else
        PORT=$DH_BACKEND_PORT ./dist/dh-backend > /tmp/dh-backend.log 2>&1 &
        local pid=$!
        PIDS+=("$pid")
    fi
    cd ../..

    if wait_for_service "${API_BASE_URL}/health" "DH Backend" 60; then
        log_success "DH Backend running (PID: $pid, log: /tmp/dh-backend.log)"
    else
        log_error "DH Backend failed to start"
        cat /tmp/dh-backend.log
        exit 1
    fi
}

# ── Start Frontend ───────────────────────────────────────────────
start_frontend() {
    log_info "Starting Frontend on port ${FRONTEND_PORT}..."

    if check_port "$FRONTEND_PORT"; then
        log_warn "Port ${FRONTEND_PORT} in use, killing existing..."
        kill_port "$FRONTEND_PORT"
    fi

    cd apps/dh-frontend
    if [ "$DETACH_MODE" = true ]; then
        setsid nohup pnpm dev --port "$FRONTEND_PORT" > /tmp/frontend.log 2>&1 &
        disown
        local pid=$!
    else
        pnpm dev --port "$FRONTEND_PORT" > /tmp/frontend.log 2>&1 &
        local pid=$!
        PIDS+=("$pid")
    fi
    cd ../..

    echo -n "  Waiting for Frontend..."
    local attempt=1
    while [ $attempt -le 60 ]; do
        if curl -sf "http://localhost:${FRONTEND_PORT}" >/dev/null 2>&1; then
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

# ── Main ─────────────────────────────────────────────────────────
main() {
    echo ""
    echo -e "${GREEN}  DeepHarness Platform - Development Mode${NC}"
    echo ""

    if [ ! -f "package.json" ] || [ ! -d "apps/dh-backend" ] || [ ! -d "apps/agent-stub" ]; then
        log_error "Please run this script from the platform project root"
        exit 1
    fi

    if ! command -v go &> /dev/null; then
        log_error "Go is not installed"
        exit 1
    fi
    if ! command -v pnpm &> /dev/null; then
        log_error "pnpm is not installed"
        exit 1
    fi

    # 构建 Go 服务
    build_go_if_needed "${AGENT_STUB_DIR}" "$AGENT_STUB_BIN" "agent-stub"
    build_go_if_needed "${DH_BACKEND_DIR}" "$DH_BACKEND_BIN" "dh-backend"

    # 按依赖顺序启动
    start_gatewayd
    start_agent_stub
    start_dh_backend
    start_frontend

    echo ""
    echo -e "${GREEN}  All services started!${NC}"
    echo ""
    echo -e "  ${BLUE}Service URLs:${NC}"
    echo -e "    Gatewayd:     ${GREEN}http://localhost:${GATEWAYD_API_PORT}${NC} (API)"
    echo -e "    Gatewayd:     ${GREEN}http://localhost:${GATEWAYD_ADMIN_PORT}${NC} (Admin/Health)"
    echo -e "    Agent Stub:   ${GREEN}http://localhost:${AGENT_STUB_PORT}${NC}"
    echo -e "    DH Backend:   ${GREEN}http://localhost:${DH_BACKEND_PORT}${NC}"
    echo -e "    Frontend:     ${GREEN}http://localhost:${FRONTEND_PORT}${NC}"
    echo ""
    echo -e "  ${BLUE}Logs:${NC}"
    echo -e "    Gatewayd:     /tmp/gatewayd.log"
    echo -e "    Agent Stub:   /tmp/agent-stub.log"
    echo -e "    DH Backend:   /tmp/dh-backend.log"
    echo -e "    Frontend:     /tmp/frontend.log"
    echo ""

    if [ "$DETACH_MODE" = true ]; then
        echo -e "  ${YELLOW}服务已在后台启动，使用 bash scripts/restart-dev.sh 重启或按端口手动停止${NC}"
        echo ""
        return 0
    fi

    echo -e "  ${YELLOW}Press Ctrl+C to stop all services${NC}"
    echo ""

    while true; do
        sleep 1
    done
}

main "$@"
