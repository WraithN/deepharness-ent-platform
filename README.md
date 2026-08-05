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
- **Per-User 容器池**：按需为用户分配/回收 Agent 容器（mock 模式 / K8s 原生模式），支持暖池预热、休眠唤醒、资源限额
- **飞书机器人**：私聊/群聊 @机器人 调用 AI 编码平台，CardKit 流式卡片打字机输出，支持编码助手、群聊总结、需求提取、原型设计四种意图，白名单权限分级

## 产品展示

### 智能会话

![智能会话](./docs/screenshots/chat.png)

### 超管技能管理

![超管技能管理](./docs/screenshots/admin-skills.png)

### 超管提示词管理

![超管提示词管理](./docs/screenshots/admin-prompts.png)

## 系统架构

### 整体架构

```
dh-frontend (React, :8888)
  │ HTTP / WebSocket
  ▼
dh-backend (Go, :8080) — 用户管理后台
  │  HTTP 代理（文件/工程/预览）
  ├─▶ personal-stub (Go, :8090) — 用户个人管理服务
  │     └─▶ 文件系统操作 / dev server 进程管理
  │
  │  SSE（命令下发） / SSE（事件回流）
  ├─▶ gatewayd (Rust, :2345 API / :2346 Admin) — Agent 代理服务
  │     └─▶ 封装 coding agent（opencode / claude）
  │
  └─▶ crawler-service (Go, :8091) — 网页爬取服务

共享目录（agent 读写原型/项目代码，dh-backend 只读 serve）
```

### 三后端服务职责

| 服务 | 端口 | 职责 | 禁止事项 |
|------|------|------|----------|
| **dh-backend** | 8080 | 用户管理后台：用户/工作空间/会话管理、指令模板渲染、原型文件 serve（只读）+ 标注注入、共享资源管理（`shares/`） | 不直接写用户工作区目录；不直接执行 agent CLI；不直接执行 git/npm 命令 |
| **personal-stub** | 8090 | 用户个人管理服务：管理用户目录结构、查询/读写个人目录文件、启动/停止 npm dev server | 不执行 coding agent；不管理 agent 会话 |
| **gatewayd** | 2345 | Agent 代理服务：封装 coding agent（opencode/claude）供用户使用、执行工具调用（bash/文件写入）、SSE 事件流 | 不能访问 dh-backend 源码；只能访问共享目录 |
| **crawler-service** | 8091 | 网页爬取服务：为 PRD 分析等场景提供网站内容抓取 | 不管理用户数据；不执行 agent |

### Per-User 容器池架构

dh-backend 通过 `ContainerPool` 为每个已认证用户按需分配 Agent 容器。容器池有三种模式：

| 模式 | 配置值 | 说明 |
|------|--------|------|
| **Direct-Host** | `agent_provisioner.type: "direct-host"` | 使用配置的固定 IP 列表模拟容器分配，适用于本地开发 |
| **K8s** | `agent_provisioner.type: "k8s"` | 使用 `client-go` 管理 gatewayd Pod 的完整生命周期（创建/绑定/休眠/唤醒/销毁），适用于生产环境 |
| **Self-Defined** | `agent_provisioner.type: "self-defined"` | 通过 HTTP API 对接自定义外部供给器，适用于自研调度系统 |

请求处理链：

```
HTTP Request
  → Auth Middleware（注入 userID）
  → Container Middleware（Acquire 容器 → 注入 ContainerInfo + per-user stubclient 到 context）
  → Handler（通过 stubclient.FromContext(ctx) 获取 per-user 连接）
```

容器池耗尽时返回 `503 {"code":503,"message":"当前服务器资源紧缺，请联系管理员"}`。

### 共享目录结构

```
{workspaceRoot}/
├── {workspaceId}/{userId}/          # 用户工作区
│   ├── products/prototypes/         # 原型工程（agent 写入，dh-backend serve）
│   └── projects/                    # 项目代码
└── shares/                          # 全局共享资源（dh-backend 部署，agent 只读）
    ├── prototypes-templates/        # 原型模版（Vite 工程）
    └── scaffolds/                   # HTML 脚手架（dh-base.css / dh-base.js）
```

### 关键数据流

1. **命令下发**：dh-frontend → dh-backend（HTTP/WebSocket）→ gatewayd（SSE）
2. **事件回流**：gatewayd（SSE 事件）→ dh-backend（转发/缓冲/重放）→ dh-frontend（消费渲染）
3. **文件写入**：agent 在 gatewayd 容器中写入共享目录
4. **文件读取**：dh-backend serve 端点读取共享目录 → 注入标注脚本 → dh-frontend iframe 加载
5. **个人目录管理**：dh-frontend → dh-backend（代理）→ personal-stub（文件 CRUD / dev server）
6. **指令模板渲染**：dh-backend 读取共享目录中的脚手架/配置 → 渲染为 prompt → 通过 gatewayd 下发给 agent

## 仓库结构

```
.
├── apps/                              # 可部署应用
│   ├── dh-frontend/                   # React + Vite + TypeScript 前端（:8888）
│   ├── dh-backend/                    # DeepHarness 统一后端（:8080）
│   │   ├── config/                    # 环境配置加载（YAML + 环境变量）
│   │   ├── constants/                 # 全局常量
│   │   ├── agent/                     # Agent 相关模块
│   │   │   ├── agui/                  # AG-UI 协议类型与 SSE 缓冲
│   │   │   │   └── buffer/            # SSEBuffer 接口 + 内存/Redis 实现
│   │   │   ├── chat/                  # Session/Message 领域模型与存储
│   │   │   │   └── session/           # Session/Message 内存存储实现
│   │   │   ├── client/                # 到 gatewayd 的 HTTP+SSE 客户端
│   │   │   ├── orchestrator/          # Agent 会话编排
│   │   │   ├── sessionmanager/        # 会话生命周期管理
│   │   │   └── provisioner/           # Agent 容器供给器
│   │   │       ├── container.go       # ContainerInfo / ContainerPool 接口 / 中间件 / context 辅助
│   │   │       ├── mock_pool.go       # Mock 容器池（固定 IP 列表）
│   │   │       ├── k8s_pool.go        # K8s 容器池（适配 AgentProvisioner → ContainerPool）
│   │   │       ├── factory.go         # 供给器工厂 + adminClient 适配器
│   │   │       ├── gatewayd_admin.go  # gatewayd Admin HTTP 客户端
│   │   │       ├── controller.go      # 供给控制器
│   │   │       ├── status.go          # 状态管理
│   │   │       ├── k8s/               # K8s 原生 provisioner（client-go）
│   │   │       │   ├── provider.go    # AgentProvisioner 实现（Provision/Sleep/Wake/Destroy）
│   │   │       │   ├── pod_template.go # Pod 模板构建器
│   │   │       │   └── labels.go      # K8s 标签常量
│   │   │       └── mock/              # Mock provisioner
│   │   ├── gateway/                   # HTTP 路由、处理器、中间件、服务器
│   │   │   ├── handler/               # AGUI、会话、文件、指令、StubProxy 处理器
│   │   │   ├── middleware/            # CORS、认证、请求日志
│   │   │   ├── stubclient/            # personal-stub HTTP 客户端（全局 + per-user context 感知）
│   │   │   └── server/                # 服务器组装与路由注册
│   │   ├── domain/                    # 业务领域模块（DDD）
│   │   │   ├── identity/              # 用户认证与管理
│   │   │   ├── workspace/             # 工作空间管理
│   │   │   ├── workitem/              # 需求、缺陷、测试用例
│   │   │   ├── productspace/          # 产品空间（文档/原型/版本/分享）
│   │   │   ├── productdoc/            # 产品文档采纳与物化
│   │   │   ├── prototypetemplate/     # 原型模板管理
│   │   │   ├── repository/            # Git 代码库管理（克隆/同步/分支/文件树/扫描/规范）
│   │   │   ├── process/               # 需求流程管理
│   │   │   ├── agentconfig/           # Agent 配置管理
│   │   │   ├── agent_review/          # Agent 评审
│   │   │   ├── agentruntime/          # Agent 运行时状态监控
│   │   │   ├── pragent/               # PR 评审 Agent
│   │   │   ├── crawler/               # 网页爬取集成
│   │   │   ├── feishu/                # 飞书机器人（webhook + 意图路由 + CardKit 流式卡片）
│   │   │   ├── notification/          # 通知管理
│   │   │   ├── personalassistant/     # 个人助手
│   │   │   ├── platformtemplate/      # 平台模板
│   │   │   ├── team/                  # 团队管理
│   │   │   └── audit/                 # 审计日志
│   │   ├── orchestrator/              # Agent 编排核心
│   │   ├── pkg/                       # 后端内部工具包
│   │   └── tests/                     # 本地测试工具
│   ├── personal-stub/                 # 用户个人管理服务（:8090）
│   ├── crawler-service/               # 网页爬取服务（:8091）
│   └── gatewayd/                      # Agent 代理服务（Rust，:2345/:2346，独立仓库）
├── packages/                          # 共享库
│   ├── ui/                            # 共享 React UI 组件库
│   ├── api-types/                     # 前后端共享 API TypeScript 类型
│   ├── go-sdk/                        # 共享 Go SDK（DDD 领域 + 基础设施抽象）
│   │   ├── domain/                    # 领域模型（identity、project、workitem、agent、audit、repository、workspace）
│   │   ├── infrastructure/            # 基础设施抽象（git、llm、postgres、pr-agent、repository、workitem-tracker）
│   │   └── common/                    # 通用工具
│   └── config/                        # 共享配置（tsconfig、eslint presets）
├── infra/                             # 基础设施代码
│   ├── database/                      # 数据库 Schema 脚本（PostgreSQL 15）
│   │   ├── identity/                  # 身份认证 Schema
│   │   ├── workspace/                 # 工作空间 Schema
│   │   ├── workitem/                  # 工作项 Schema
│   │   ├── repository/                # 代码库 Schema
│   │   ├── process/                   # 需求流程 Schema
│   │   ├── audit/                     # 审计日志 Schema
│   │   ├── agentruntime/              # Agent 运行时 Schema
│   │   └── ...                        # 其他领域 Schema
│   ├── k8s/                           # Kubernetes 部署清单（Kustomize）
│   │   ├── base/                      # 基础清单（namespace + API Gateway）
│   │   ├── overlays/                  # 环境覆盖（dev / staging / prod）
│   │   └── agent-runtime/             # Agent Pod 模板
│   ├── helm/                          # Helm Chart
│   └── docker/                        # Dockerfile 与 Compose 文件
├── scripts/                           # 开发与运维脚本
│   ├── restart-dev.sh                 # 一键重启开发环境
│   ├── start-dev.sh                   # 启动所有服务（前台/后台）
│   ├── stop-dev.sh                    # 停止所有后台服务
│   ├── ensure-gatewayd.sh             # gatewayd 二进制准备
│   └── init-crawler-mcp.sh            # crawler MCP 初始化
├── docs/                              # 项目文档
│   ├── bugs/                          # 缺陷记录
│   ├── design/                        # 设计文档
│   └── screenshots/                   # 截图
├── turbo.json                         # Turborepo 配置
├── pnpm-workspace.yaml                # pnpm workspaces
├── go.work                            # Go workspace
└── package.json                       # 根 workspace
```

## 技术栈

### 前端

| 类别 | 技术 |
|------|------|
| 框架 | React 18（函数组件 + Hooks） |
| 路由 | react-router / react-router-dom v7 |
| 构建 | Vite（`rolldown-vite` 别名） |
| 语言 | TypeScript 5.9（`strict: true`） |
| 样式 | Tailwind CSS v3 + `tailwindcss-animate` + `tailwindcss-intersect` + `@tailwindcss/container-queries` |
| 组件库 | shadcn/ui（New York 风格），基于 Radix UI + `class-variance-authority` + `tailwind-merge` |
| 主题 | `next-themes`（`class` 策略，默认 `system`），深色主题为 Dracula 风格 |
| 图标 | `lucide-react` |
| 表单 | `react-hook-form` + `zod`（通过 `@hookform/resolvers`） |
| 通知 | `sonner` |
| 图表 | `recharts` |
| 富文本编辑 | `@wangeditor/editor` + `@wangeditor/editor-for-react` |

### 后端

| 类别 | 技术 |
|------|------|
| 语言 | Go 1.22 |
| 框架 | 标准库 `net/http` + `http.ServeMux` |
| 架构 | DDD（领域模型定义在 `packages/go-sdk/domain/`） |
| 数据库 | PostgreSQL 15 |
| 缓存 | Redis（可选，用于 SSE 事件缓存与崩溃恢复） |
| K8s 客户端 | `client-go`（Agent 容器池管理） |
| 中间件 | 手写 CORS、请求日志、Bearer Token 认证 |

### 工具链

| 类别 | 技术 |
|------|------|
| 包管理器 | pnpm 9.15.5（`packageManager` 已锁定） |
| Monorepo 调度 | Turborepo 2.5.3 |
| Go 工作区 | `go.work` 管理所有 Go 模块 |
| Linter | Biome 2.4.5（仅启用 lint，formatter 关闭） |
| 类型检查 | `tsc --noEmit`；lint 脚本中还使用 `tsgo` |
| 代码规则扫描 | ast-grep，规则存放在 `apps/dh-frontend/.rules/` |

## 环境要求

- [Node.js](https://nodejs.org/) (v20+)
- [pnpm](https://pnpm.io/) (v9.15.5)
- [Go](https://go.dev/) (v1.22+)
- [PostgreSQL](https://www.postgresql.org/) 15（可选，未启动时使用内存 mock）
- [Redis](https://redis.io/)（可选，用于 SSE 事件缓存与崩溃恢复）

## 快速开始

### 安装与启动

```bash
# 安装全部依赖
pnpm install

# 一键启动开发环境（后台运行所有服务）
bash scripts/restart-dev.sh

# 或前台启动所有服务
pnpm dev
```

启动后访问：

| 服务 | 地址 |
|------|------|
| 前端 | http://localhost:8888 |
| DH Backend | http://localhost:8080 |
| Personal Stub | http://localhost:8090 |
| Crawler Service | http://localhost:8091 |
| Gatewayd API | http://localhost:2345 |
| Gatewayd Admin | http://localhost:2346 |

### 单独运行服务

```bash
# 前端
pnpm --filter @repo/dh-frontend dev

# DH Backend
pnpm --filter @repo/dh-backend dev
```

### 开发环境管理

```bash
# 一键重启（停止旧进程 + 重新启动全部服务，后台运行）
bash scripts/restart-dev.sh

# 停止后台运行的开发服务
bash scripts/stop-dev.sh

# 查看日志
tail -f /tmp/dh-backend.log        # DH Backend
tail -f /tmp/frontend.log          # 前端
tail -f /tmp/personal-stub.log     # Personal Stub
tail -f /tmp/gatewayd.log          # Gatewayd
tail -f /tmp/crawler-service.log   # Crawler Service
```

## 可用脚本

| 命令 | 说明 |
|------|------|
| `pnpm dev` | 开发模式启动所有应用 |
| `pnpm build` | 构建所有应用 |
| `pnpm lint` | 对所有应用执行 lint |
| `pnpm check-types` | 对所有应用执行类型检查 |
| `pnpm test` | 运行所有测试 |
| `bash scripts/restart-dev.sh` | 一键重启开发环境（后台） |
| `bash scripts/stop-dev.sh` | 停止所有后台服务 |

## 数据库（PostgreSQL）

本项目以 **PostgreSQL 15** 作为主数据库。

使用 Docker Compose 启动本地 PostgreSQL：

```bash
docker compose -f infra/docker/compose.postgres.yml up -d
```

默认连接信息：

| 变量 | 值 |
|------|-----|
| `DB_HOST` | `127.0.0.1` |
| `DB_PORT` | `5433`（宿主机）/ `5432`（容器） |
| `DB_USER` | `deepharness` |
| `DB_PASSWORD` | `deepharness` |
| `DB_NAME` | `deepharness` |

Schema 文件位于 `infra/database/`，按领域拆分（identity / workspace / workitem / repository / process / audit / agentruntime 等），首次启动 PostgreSQL 容器时会自动挂载。

当未设置 `DB_HOST` 时，`apps/dh-backend` 会优雅降级为内存 mock 数据，因此不启动数据库也能运行 `pnpm dev`。

## 配置

主配置文件为 `apps/dh-backend/config.yaml`，配置优先级为：**环境变量 > config.yaml > 代码默认值**。

### 关键配置项

| 配置路径 | 环境变量 | 说明 |
|----------|---------|------|
| `server.port` | `PORT` | 后端监听端口（默认 8080） |
| `database.host` | `DB_HOST` | PostgreSQL 地址（为空则使用内存 mock） |
| `database.port` | `DB_PORT` | PostgreSQL 端口 |
| `workspace.root` | `WORKSPACE_ROOT` | 共享目录根路径 |
| `personal_stub.url` | `PERSONAL_STUB_URL` | personal-stub 服务地址 |
| `crawler_service.url` | `CRAWLER_SERVICE_URL` | crawler-service 服务地址 |
| `gatewayd.admin_url` | `GATEWAYD_ADMIN_URL` | gatewayd Admin 地址 |
| `redis.addrs` | `REDIS_ADDRS` | Redis 地址（逗号分隔为 Cluster 模式） |
| `agent_provisioner.type` | `AGENT_PROVISIONER_TYPE` | 容器池模式：`mock` / `k8s` |
| `agent_provisioner.mock_hosts` | `AGENT_PROVISIONER_MOCK_HOSTS` | mock 模式固定 IP 列表 |
| `agent_provisioner.stub_port` | `AGENT_PROVISIONER_STUB_PORT` | personal-stub 端口（默认 8090） |
| `agent_provisioner.kubeconfig_path` | `KUBECONFIG_PATH` | K8s kubeconfig 路径（空则用 in-cluster） |
| `agent_runtime.bearer_token` | `AGENT_RUNTIME_BEARER_TOKEN` | Agent 运行时状态上报 Token |
| `feishu.mock_mode` | `FEISHU_MOCK_MODE` | 飞书 mock 模式开关 |
| `security.ssh_key_encryption_key` | `SSH_KEY_ENCRYPTION_KEY` | SSH 私钥加密密钥（32 字节 AES-256 hex） |

### Agent 容器池配置

```yaml
agent_provisioner:
  type: "direct-host"             # direct-host（本地开发）| k8s（生产）| self-defined（自定义）

  # 公共配置
  warm_pool_min: 2                # 暖池最小预热数
  warm_pool_max: 10               # 暖池最大数
  idle_timeout: "15m"             # 空闲超时后休眠
  sleep_evict_timeout: "30m"      # 休眠超时后销毁
  max_active_per_user: 3          # 每用户最大活跃容器数

  # direct-host 模式配置
  direct_host:
    hosts:                        # 固定 IP 列表
      - "127.0.0.1"
    agent_port: 2345              # gatewayd API 端口
    admin_port: 2346              # gatewayd Admin 端口
    stub_port: 8090               # personal-stub 端口（与 gatewayd 共部署）

  # k8s 模式配置
  k8s:
    namespace: "dh-agents"        # K8s 命名空间
    image: "deepharness/gatewayd:latest"
    agent_port: 2345
    admin_port: 2346
    stub_port: 8090
    kubeconfig_path: ""           # K8s kubeconfig 路径
    shared_pvc_name: "dh-workspace"
    workspace_mount_path: "/workspace"
    supports_bind: false          # 是否支持容器绑定（热启动）
    resource_active:              # 活跃状态资源限额
      cpu_request: "2000m"
      cpu_limit: "4000m"
      memory_request: "4Gi"
      memory_limit: "8Gi"
    resource_sleeping:            # 休眠状态资源限额
      cpu_request: "100m"
      cpu_limit: "200m"
      memory_request: "128Mi"
      memory_limit: "256Mi"

  # self-defined 模式配置
  self_defined:
    endpoint: ""                  # 外部供给器 API 基地址
    token: ""                     # Bearer Token 认证
    timeout: "30s"                # HTTP 调用超时
    stub_port: 8090               # personal-stub 端口
```

## Agent Runtime 状态上报接口

外部 gatewayd / personal-stub 可通过以下接口向 DH Backend 上报运行时状态，供管理后台「Agent 运行时」页面实时监控。

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

#### 查询运行时列表（超管）

```http
GET /api/v1/agent-runtimes?tenantId=&workspaceId=&userId=&agentType=&page=1&pageSize=10
Authorization: Bearer <user-token>
```

#### 查询单个运行时详情（超管）

```http
GET /api/v1/agent-runtimes/{runtimeId}
Authorization: Bearer <user-token>
```

## SSE 缓冲（事件缓存与崩溃恢复）

后端对 AG-UI SSE 事件与运行级检查点进行缓冲，以支持：

1. **前端断线重连回放** — 浏览器运行中掉线后，重连时重放缓冲事件。
2. **崩溃恢复** — 服务运行中崩溃时，检查点保存的运行状态（reasoning / text / tool-call 片段）会在下次加载会话历史时恢复为完整的助手消息。

存储后端通过 `session.buffer_store_type` 配置：
- `memory`：内存存储（默认，不跨重启）
- `redis`：Redis 存储（支持单节点和 Cluster，跨重启恢复）

## 飞书机器人

飞书 IM 机器人对接 AI 编码平台，用户在私聊或群聊中 @机器人 发送消息，机器人调用 agent 生成回复，通过 CardKit 流式卡片实时输出（打字机效果）。

### 意图路由

| 关键词前缀 | 意图 | Agent 模式 | 说明 |
|-----------|------|-----------|------|
| `编码：` `代码：` `code:` | 编码 | persistent | 多轮上下文 + 工具调用 |
| `原型：` `proto:` | 原型设计 | persistent | 多轮上下文 + 工具调用 |
| `需求：` `requirement:` | 需求卡片 | persistent | 多轮上下文 + 工具调用 |
| 包含 `总结` `summary` | 群聊总结 | oneshot | 拉群历史 + LLM 总结 |
| 其他 | 默认问答 | oneshot | QuickComplete 轻量问答 |

### 权限分级

| 权限 | 编码/原型/需求 | 问答/群总结 | 配置方式 |
|------|--------------|------------|---------|
| `full`（白名单） | ✅ | ✅ | `feishu.admin_user_ids` |
| `basic`（默认） | ❌ | ✅ | 已绑定/兜底用户 |

### 配置

```yaml
feishu:
  app_id: ""
  app_secret: ""
  verify_token: ""
  encrypt_key: ""
  webhook_token: "feishu-local-dev-token"
  api_base_url: "https://open.feishu.cn/open-apis"
  bot_user_id: ""
  default_workspace: ""
  mock_mode: true               # true=本地调试，false=生产
  dispatch_timeout: "30m"
  admin_user_ids: []            # 白名单 open_id 列表
```

环境变量覆盖：`FEISHU_APP_ID`、`FEISHU_APP_SECRET`、`FEISHU_MOCK_MODE`、`FEISHU_ADMIN_USER_IDS`、`FEISHU_WEBHOOK_TOKEN`。

### 本地测试（Mock 模式）

```bash
# 发送编码请求
curl -s -X POST http://127.0.0.1:8080/api/v1/feishu/webhook \
  -H "Authorization: Bearer feishu-local-dev-token" \
  -H "Content-Type: application/json" \
  -d '{"mock_event":true,"chat_id":"oc_test","chat_type":"p2p","open_id":"ou_test_user_001","message_type":"text","content":"编码：用 Go 写一个 hello world","message_id":"om_1"}'

# 查看流式输出日志
tail -f /tmp/dh-backend.log | grep -E "\[Feishu"
```

## 部署

### Docker

基础设施 Dockerfile 与 Compose 文件位于 `infra/docker/`：

- `Dockerfile.dh-frontend` — 前端镜像构建（Vite build + Nginx serve）
- `nginx.conf` — Nginx 配置（反向代理到 dh-backend）
- `compose.postgres.yml` — PostgreSQL 15 开发环境
- `compose.yml` — 全服务编排

```bash
# 启动 PostgreSQL
docker compose -f infra/docker/compose.postgres.yml up -d

# 构建前端镜像
docker build -f infra/docker/Dockerfile.dh-frontend -t deepharness/dh-frontend .
```

### Kubernetes

K8s 部署清单位于 `infra/k8s/`，使用 Kustomize 管理：

```
infra/k8s/
├── base/                # 基础清单
│   ├── namespace.yaml   # 命名空间定义
│   └── api-gateway.yaml # API Gateway（Ingress / Service）
├── overlays/            # 环境覆盖
│   ├── dev/             # 开发环境
│   ├── staging/         # 预发布环境
│   └── prod/            # 生产环境
└── agent-runtime/       # Agent Pod 模板
    └── pod-template.yaml
```

```bash
# 部署到开发环境
kubectl apply -k infra/k8s/overlays/dev

# 部署到生产环境
kubectl apply -k infra/k8s/overlays/prod
```

#### Agent 容器池（K8s 模式）

生产环境使用 K8s 模式时，dh-backend 通过 `client-go` 自动管理 gatewayd Pod 的完整生命周期：

| 生命周期 | 触发条件 | 行为 |
|---------|---------|------|
| **Provision** | 用户首次请求 | 创建新 Pod 或从暖池分配 |
| **Bind** | `supports_bind: true` | 将 Pod 绑定到用户（热启动） |
| **Sleep** | 空闲超时（`idle_timeout`） | 降级资源到 `resource_sleeping` 限额 |
| **Wake** | 用户再次请求 | 恢复到 `resource_active` 限额 |
| **Destroy** | 休眠超时（`sleep_evict_timeout`） | 销毁 Pod，释放资源 |

每个 Pod 中 co-located 部署 gatewayd + personal-stub，共享同一网络命名空间和持久卷挂载。

### Helm

Helm Chart 位于 `infra/helm/`，可用于更灵活的参数化部署：

```bash
helm install deepharness infra/helm/ \
  --set image.tag=latest \
  --set database.enabled=true
```

### 生产部署检查清单

- [ ] `DB_HOST` 设置为生产 PostgreSQL 地址
- [ ] `REDIS_ADDRS` 设置为生产 Redis 地址（启用 SSE 缓冲与崩溃恢复）
- [ ] `AGENT_PROVISIONER_TYPE` 设置为 `k8s`
- [ ] `KUBECONFIG_PATH` 配置正确的 kubeconfig（或使用 in-cluster service account）
- [ ] `AGENT_RUNTIME_BEARER_TOKEN` 设置为强随机字符串
- [ ] `SSH_KEY_ENCRYPTION_KEY` 设置为 32 字节 AES-256 密钥（`openssl rand -hex 32`）
- [ ] `FEISHU_MOCK_MODE` 设置为 `false` 并填入真实飞书应用凭证
- [ ] `FEISHU_ADMIN_USER_IDS` 配置白名单用户
- [ ] CORS 中间件收紧为具体域名（生产环境不要用 `*`）
- [ ] dh-backend 配置身份校验与请求限流
