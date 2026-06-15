#!/bin/bash

# DeepHarness Platform - Development Startup Script
# Starts: Agent Mock → DH Backend → Frontend Web App

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Ports
AGENT_MOCK_PORT="${AGENT_MOCK_PORT:-19090}"
DH_BACKEND_PORT="${DH_BACKEND_PORT:-8080}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"

# Base URLs
AGENT_BASE_URL="http://localhost:${AGENT_MOCK_PORT}"
API_BASE_URL="http://localhost:${DH_BACKEND_PORT}"

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

# Build services if needed
build_services() {
    log_info "Building services..."

    # Build agent mock
    if [ ! -f "apps/mock/dist/mock" ] || [ "apps/mock/main.go" -nt "apps/mock/dist/mock" ]; then
        log_info "Building mock..."
        cd apps/mock
        go build -o dist/mock .
        cd ../..
        log_success "mock built"
    fi

    # Build dh-backend
    if [ ! -f "apps/dh-backend/dist/dh-backend" ] || [ "apps/dh-backend/main.go" -nt "apps/dh-backend/dist/dh-backend" ]; then
        log_info "Building dh-backend..."
        cd apps/dh-backend
        go build -o dist/dh-backend .
        cd ../..
        log_success "dh-backend built"
    fi
}

# Start Agent Mock
start_agent_mock() {
    log_info "Starting Agent Mock Service on port $AGENT_MOCK_PORT..."

    if check_port "$AGENT_MOCK_PORT"; then
        log_warn "Port $AGENT_MOCK_PORT is in use, killing existing process..."
        kill_port "$AGENT_MOCK_PORT"
    fi

    cd apps/mock
    PORT=$AGENT_MOCK_PORT ./dist/mock > /tmp/agent-mock.log 2>&1 &
    local pid=$!
    PIDS+=("$pid")
    cd ../..

    if wait_for_service "http://localhost:${AGENT_MOCK_PORT}/health" "Agent Mock"; then
        log_success "Agent Mock running (PID: $pid, log: /tmp/agent-mock.log)"
    else
        log_error "Agent Mock failed to start"
        cat /tmp/agent-mock.log
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

    cd apps/dh-backend
    AGENT_BASE_URL=$AGENT_BASE_URL PORT=$DH_BACKEND_PORT ./dist/dh-backend > /tmp/dh-backend.log 2>&1 &
    local pid=$!
    PIDS+=("$pid")
    cd ../..

    if wait_for_service "http://localhost:${DH_BACKEND_PORT}/health" "DH Backend"; then
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

    cd apps/web
    pnpm dev --port $FRONTEND_PORT > /tmp/frontend.log 2>&1 &
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

# Main
main() {
    echo -e "${GREEN}🚀 DeepHarness Platform - Development Mode${NC}"
    echo ""

    # Check if we're in the right directory
    if [ ! -f "package.json" ] || [ ! -d "apps/dh-backend" ]; then
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

    # Build services
    build_services

    # Start services in order
    start_agent_mock
    start_dh_backend
    start_frontend

    echo ""
    echo -e "${GREEN}✅ All services started successfully!${NC}"
    echo ""
    echo -e "${BLUE}Service URLs:${NC}"
    echo -e "  Frontend:     ${GREEN}http://localhost:${FRONTEND_PORT}${NC}"
    echo -e "  DH Backend:   ${GREEN}http://localhost:${DH_BACKEND_PORT}${NC}"
    echo -e "  Agent Mock:   ${GREEN}http://localhost:${AGENT_MOCK_PORT}${NC}"
    echo ""
    echo -e "${BLUE}Logs:${NC}"
    echo -e "  Frontend:     /tmp/frontend.log"
    echo -e "  DH Backend:   /tmp/dh-backend.log"
    echo -e "  Agent Mock:   /tmp/agent-mock.log"
    echo ""
    echo -e "${YELLOW}Press Ctrl+C to stop all services${NC}"
    echo ""

    # Keep script running
    while true; do
        sleep 1
    done
}

main "$@"
