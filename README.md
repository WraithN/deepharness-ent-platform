# DeepHarness Enterprise Platform

A Turborepo monorepo with a unified Go backend and a React TypeScript frontend.

## Architecture

```
.
├── apps/                          # Deployable applications
│   ├── web/                       # React + Vite + TypeScript frontend
│   ├── agent-runtime/             # Agent runtime wrapper (Rust target, currently Go stub)
│   ├── dh-backend/                # Unified DeepHarness backend (port 8080)
│   │   ├── config/                # Environment config loader
│   │   ├── constants/             # Global constants
│   │   ├── agent/                 # Agent client, chat, orchestrator
│   │   ├── gateway/               # HTTP routes, WebSocket, middleware, server
│   │   ├── worker/                # Per-session Agent worker lifecycle
│   │   ├── domain/                # Business domain modules (identity, project, workitem, pragent, audit)
│   │   └── tests/test-agent       # Agent Client local test tool
│   └── mock/                      # Local Agent SSE mock (independent module)
├── packages/                      # Shared libraries
│   ├── ui/                        # Shared React UI components
│   ├── api-types/                 # Shared API TypeScript types
│   ├── go-sdk/                    # Shared Go SDK (DDD domain + infrastructure abstractions)
│   │   ├── domain/                # Domain models (identity, project, workitem, agent, audit)
│   │   ├── infrastructure/        # Infrastructure abstractions (git, workitem-tracker, pr-agent, llm, mysql)
│   │   └── common/                # Common utilities
│   └── config/                    # Shared config (tsconfig, eslint presets)
├── infra/                         # Infrastructure code
│   ├── database/                  # Database migration scripts
│   ├── k8s/                       # Kubernetes manifests
│   ├── helm/                      # Helm charts
│   └── docker/                    # Dockerfiles and compose files
├── turbo.json                     # Turborepo configuration
├── pnpm-workspace.yaml            # pnpm workspaces
├── go.work                        # Go workspace
└── package.json                   # Root workspace
```

## Prerequisites

- [Node.js](https://nodejs.org/) (v20+)
- [pnpm](https://pnpm.io/) (v9.15.5)
- [Go](https://go.dev/) (v1.22+)

## Getting Started

Install dependencies:

```bash
pnpm install
```

Run all services in development mode:

```bash
pnpm dev
```

Or run individually:

```bash
# Frontend
pnpm --filter @repo/web dev

# DH Backend
pnpm --filter @repo/dh-backend dev
```

## Build

Build all applications:

```bash
pnpm build
```

## Available Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start all apps in development mode |
| `pnpm build` | Build all apps |
| `pnpm lint` | Lint all apps |
| `pnpm check-types` | Type-check all apps |
| `pnpm test` | Run all tests |

## Database (PostgreSQL)

This project uses **PostgreSQL 15** as the primary database.

Start a local PostgreSQL instance with Docker Compose:

```bash
docker compose -f infra/docker/compose.postgres.yml up -d
```

Default connection (used by Go services):

| Variable | Value |
|----------|-------|
| `DB_HOST` | `127.0.0.1` |
| `DB_PORT` | `5433` (host) / `5432` (container) |
| `DB_USER` | `deepharness` |
| `DB_PASSWORD` | `deepharness` |
| `DB_NAME` | `deepharness` |

Schema files are located in `infra/database/` and are automatically mounted into
the PostgreSQL container on first startup.

`apps/dh-backend` gracefully falls back to in-memory mock data when `DB_HOST` is
not set, so `pnpm dev` works without a running database.

## Mock & Test Tools

- **`apps/agent-runtime/mock/main.go`**: A standalone Agent SSE mock server. It simulates the
  streaming response of an external Agent Runtime (e.g. OpenCode / Claude Code)
  for local development and testing. It has no dependency on `apps/dh-backend`
  and can be run independently.

- **`apps/dh-backend/tests/test-agent/main.go`**: A small test binary inside the
  `dh-backend` module. It exercises `dh-backend`'s Agent HTTP+SSE client against
  the standalone mock server. It lives in the same Go module as `dh-backend` so
  it can import the backend packages directly.

## Technologies

- **Frontend**: React 18, Vite, TypeScript, Tailwind CSS, shadcn/ui
- **Backend**: Go 1.22, standard library `net/http`, unified `dh-backend` module
- **Database**: MySQL 8.0
- **Monorepo**: Turborepo, pnpm workspaces, Go workspaces
