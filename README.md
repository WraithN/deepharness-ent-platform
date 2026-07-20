# DeepHarness Enterprise Platform

[English](./README.en.md) | [日本語](./README.ja.md) | [Français](./README.fr.md)

面向开发团队的多租户 AI 辅助编码平台。

## 功能列表

- **多角色智能会话**：支持产品经理、开发、测试、设计等角色，提供斜杠指令、提示词、技能、代码库、任务卡片与 `@文档` 引用等原子化输入能力
- **产品空间**：产品文档（Markdown 三模式编辑器 + 目录树 + 版本历史 + 分享批注）、需求看板、交互原型、版本历史
- **研发空间**：代码工程、代码图谱、智能评审、智能测试、设计/工程规范（AGENTS.md / DESIGN.md）智能生成
- **技能与提示词市场**：市场浏览、复制使用、超管审核与分类管理、工作空间自定义提示词
- **工作项管理**：需求、缺陷、测试用例的全生命周期管理，支持与 Jira / Meego / PingCode 等平台对接
- **代码库管理**：Git 仓库配置、克隆同步、用户工程目录映射
- **数据大盘**：技能/提示词/会话/工作项等多维度统计
- **高可靠 Agent 运行时**：AG-UI SSE 事件缓冲、断线重连回放、崩溃恢复、多 Agent 会话编排

## 产品展示

### 智能会话

![智能会话](./docs/screenshots/chat.png)

### 超管技能管理

![超管技能管理](./docs/screenshots/admin-skills.png)

### 超管提示词管理

![超管提示词管理](./docs/screenshots/admin-prompts.png)

## 架构

```
.
├── apps/                          # 可部署应用
│   ├── dh-frontend/               # React + Vite + TypeScript 前端
│   ├── agent-runtime/             # Agent 运行时封装（目标 Rust，当前为 Go 占位）
│   ├── dh-backend/                # DeepHarness 统一后端（端口 8080）
│   │   ├── config/                # 环境配置加载
│   │   ├── constants/             # 全局常量
│   │   ├── agent/                 # Agent 客户端、会话、编排器
│   │   │   ├── agui/              # AG-UI 协议类型与 SSE 缓冲
│   │   │   │   └── buffer/        # SSEBuffer 接口 + 内存/Redis 实现
│   │   │   ├── chat/              # Session/Message 领域模型与存储
│   │   │   ├── client/            # 到 gatewayd 的 HTTP+SSE 客户端
│   │   │   └── orchestrator/      # Agent 会话编排
│   │   ├── gateway/               # HTTP 路由、处理器、中间件、服务器
│   │   │   ├── handler/           # AGUI、会话、文件、指令处理器
│   │   │   ├── middleware/        # CORS、认证、请求日志
│   │   │   └── server/            # 服务器组装与路由注册
│   │   ├── domain/                # 业务领域模块
│   │   │   ├── identity/          # 用户认证与管理
│   │   │   ├── project/           # 项目管理
│   │   │   ├── workitem/          # 需求、缺陷、测试用例
│   │   │   ├── pragent/           # PR 评审 Agent
│   │   │   └── audit/             # 审计日志
│   │   └── tests/test-agent       # Agent Client 本地测试工具
│   └── mock/                      # 本地 Agent SSE mock（独立模块）
├── packages/                      # 共享库
│   ├── ui/                        # 共享 React UI 组件
│   ├── api-types/                 # 共享 API TypeScript 类型
│   ├── go-sdk/                    # 共享 Go SDK（DDD 领域 + 基础设施抽象）
│   │   ├── domain/                # 领域模型（identity、project、workitem、agent、audit）
│   │   ├── infrastructure/        # 基础设施抽象（git、workitem-tracker、pr-agent、llm、postgres）
│   │   └── common/                # 通用工具
│   └── config/                    # 共享配置（tsconfig、eslint presets）
├── infra/                         # 基础设施代码
│   ├── database/                  # 数据库迁移脚本
│   ├── k8s/                       # Kubernetes 清单
│   ├── helm/                      # Helm Charts
│   └── docker/                    # Dockerfile 与 compose 文件
├── turbo.json                     # Turborepo 配置
├── pnpm-workspace.yaml            # pnpm workspaces
├── go.work                        # Go workspace
└── package.json                   # 根 workspace
```

## 环境要求

- [Node.js](https://nodejs.org/) (v20+)
- [pnpm](https://pnpm.io/) (v9.15.5)
- [Go](https://go.dev/) (v1.22+)

## Agent Runtime 状态上报接口

外部 gatewayd / agent-stub 可通过以下接口向 DH Backend 上报运行时状态，供管理后台「Agent 运行时」页面实时监控。

### 认证

上报接口使用固定 Bearer Token 认证：

```
Authorization: Bearer <agent_runtime.bearer_token>
```

Token 配置位置：

- `apps/dh-backend/config.yaml`：`agent_runtime.bearer_token`
- 环境变量：`AGENT_RUNTIME_BEARER_TOKEN`（优先级最高）

### 端点

#### 上报/更新运行时状态

```http
POST /api/v1/agent-runtimes/{runtimeId}/status
Content-Type: application/json
Authorization: Bearer {token}
```

请求体示例：

```json
{
  "workspace_id": "95d698acad194c76a7a2bb482677a4df",
  "user_id": "a0564de55589467d935d797611963493",
  "status": "running",
  "uptime_seconds": 45240,
  "cpu_percent": 32.0,
  "mem_percent": 58.0,
  "sandbox_spec": "4C / 8G",
  "agents": [
    {
      "type": "opencode",
      "name": "opencode-main",
      "status": "running",
      "calls_today": 1284,
      "version": "v2.1.3",
      "last_active": "2分钟前"
    }
  ]
}
```

字段说明：

| 字段 | 类型 | 说明 |
|------|------|------|
| `workspace_id` | string | 运行时所属工作空间 ID；服务端据此反查 `tenantId`、`tenantName`、`workspaceName` |
| `user_id` | string | 运行时所属成员 ID（服务端自动查询 `userName` 与 `userDisplayName`） |
| `status` | string | 运行时整体状态：`running` / `error` / `stopped` / `resource_warning` |
| `uptime_seconds` | int64 | 已运行秒数 |
| `cpu_percent` / `mem_percent` | float | CPU / 内存使用率百分比 |
| `sandbox_spec` | string | 沙箱规格，如 `4C / 8G` |
| `agents` | array | 该运行时内部的智能体实例列表 |
| `agents[].type` | string | 智能体类型，如 `opencode`、`codex`、`claude-code` |
| `agents[].status` | string | 智能体实例状态：`running` / `error` / `idle` |

#### 查询运行时列表（超管）

```http
GET /api/v1/agent-runtimes?tenantId=&workspaceId=&userId=&agentType=&page=1&pageSize=10
Authorization: Bearer <user-token>
```

响应示例：

```json
{
  "list": [...],
  "total": 100,
  "page": 1,
  "pageSize": 10
}
```

#### 查询单个运行时详情（超管）

```http
GET /api/v1/agent-runtimes/{runtimeId}
Authorization: Bearer <user-token>
```

## 快速开始

安装依赖：

```bash
pnpm install
```

开发模式运行所有服务：

```bash
pnpm dev
```

单独运行某个服务：

```bash
# 前端
pnpm --filter @repo/dh-frontend dev

# DH Backend
pnpm --filter @repo/dh-backend dev
```

## 构建

构建所有应用：

```bash
pnpm build
```

## 可用脚本

| 命令 | 说明 |
|------|------|
| `pnpm dev` | 开发模式启动所有应用 |
| `pnpm build` | 构建所有应用 |
| `pnpm lint` | 对所有应用执行 lint |
| `pnpm check-types` | 对所有应用执行类型检查 |
| `pnpm test` | 运行所有测试 |

## 数据库（PostgreSQL）

本项目以 **PostgreSQL 15** 作为主数据库。

使用 Docker Compose 启动本地 PostgreSQL：

```bash
docker compose -f infra/docker/compose.postgres.yml up -d
```

Go 服务默认连接信息：

| 变量 | 值 |
|------|-----|
| `DB_HOST` | `127.0.0.1` |
| `DB_PORT` | `5433`（宿主机）/ `5432`（容器） |
| `DB_USER` | `deepharness` |
| `DB_PASSWORD` | `deepharness` |
| `DB_NAME` | `deepharness` |

Schema 文件位于 `infra/database/`，首次启动 PostgreSQL 容器时会自动挂载。

当未设置 `DB_HOST` 时，`apps/dh-backend` 会优雅降级为内存 mock 数据，因此不启动数据库也能运行 `pnpm dev`。

## SSE 缓冲（事件缓存与崩溃恢复）

后端对 AG-UI SSE 事件与运行级检查点进行缓冲，以支持：

1. **前端断线重连回放** — 浏览器运行中掉线后，重连时重放缓冲事件。
2. **崩溃恢复** — 服务运行中崩溃时，检查点保存的运行状态（reasoning / text / tool-call 片段）会在下次加载会话历史时恢复为完整的助手消息。

## 技术栈

- **前端**：React 18、Vite、TypeScript、Tailwind CSS、shadcn/ui
- **后端**：Go 1.22、标准库 `net/http`、统一的 `dh-backend` 模块
- **数据库**：PostgreSQL 15
- **缓存/缓冲**：Redis（可选，用于 SSE 事件缓存与崩溃恢复）
- **Monorepo**：Turborepo、pnpm workspaces、Go workspaces
