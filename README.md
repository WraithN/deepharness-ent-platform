# DeepHarness Enterprise Platform

A Turborepo monorepo with a microservices backend (Go) and a React TypeScript frontend.

## Architecture

```
.
├── apps/                          # Deployable applications
│   ├── web/                       # React + Vite + TypeScript frontend
│   ├── agent-runtime/             # Go Agent runtime (Dockerized)
│   └── ide-extension/             # VS Code / JetBrains extension (reserved)
├── packages/                      # Shared libraries
│   ├── ui/                        # Shared React UI components
│   ├── api-types/                 # Shared API TypeScript types
│   ├── go-sdk/                    # Shared Go SDK (DDD domain + infrastructure abstractions)
│   │   ├── domain/                # Domain models (identity, project, workitem, agent, audit)
│   │   ├── infrastructure/        # Infrastructure abstractions (git, workitem-tracker, pr-agent, llm)
│   │   └── common/                # Common utilities
│   └── config/                    # Shared config (tsconfig, eslint presets)
├── services/                      # Backend microservices (Go)
│   ├── api-gateway/               # API Gateway (port 8080)
│   ├── identity-service/          # Identity & multi-tenant service (port 8081)
│   ├── project-service/           # Project & code repository service (port 8082)
│   ├── workitem-service/          # Unified workitem service (port 8083)
│   │   ├── adapters/              # Platform adapters (meego, pingcode, jira, azure-devops, github)
│   │   └── core/                  # Core business logic
│   ├── agent-orchestrator/        # Agent orchestration service (port 8084)
│   ├── pr-agent-service/          # PR-Agent unified service (port 8085)
│   └── audit-service/             # Audit log service (port 8086)
├── infra/                         # Infrastructure code
│   ├── database/                  # Database migration scripts
│   ├── k8s/                       # Kubernetes manifests
│   ├── helm/                      # Helm charts
│   └── docker/                    # Dockerfiles
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

# API Gateway
pnpm --filter @repo/api-gateway dev

# Identity Service
pnpm --filter @repo/identity-service dev

# WorkItem Service
pnpm --filter @repo/workitem-service dev
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

## Technologies

- **Frontend**: React 18, Vite, TypeScript, Tailwind CSS, shadcn/ui
- **Backend**: Go 1.22, standard library `net/http`, DDD architecture
- **Monorepo**: Turborepo, pnpm workspaces, Go workspaces
