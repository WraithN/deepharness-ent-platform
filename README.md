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
- **飞书机器人**：私聊/群聊 @机器人 调用 AI 编码平台，CardKit 流式卡片打字机输出，支持编码助手、群聊总结、需求提取、原型设计四种意图，白名单权限分级

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
│   │   │   ├── feishu/            # 飞书机器人（webhook + 意图路由 + CardKit 流式卡片）
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

## 飞书机器人

飞书 IM 机器人对接 AI 编码平台，用户在私聊或群聊中 @机器人 发送消息，机器人调用 agent 生成回复，通过 CardKit 流式卡片实时输出（打字机效果）。

### 两大场景

| 场景 | 触发方式 | 能力 |
|------|---------|------|
| 个人编码助手 | `编码：xxx` / `原型：xxx` / `需求：xxx` | 调用 agent 执行编码/原型/需求任务，支持工具调用与多轮上下文 |
| 群聊总结 | `总结群聊` / `生成需求卡片` | 拉取群历史消息，LLM 总结/提取需求/设计原型 |

### 意图路由

消息内容通过关键词前缀匹配识别意图，路由到不同分发路径：

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

### CardKit 流式卡片生命周期

```
t=0s    Webhook 收到消息 -> 立即返回 200（飞书要求 3s 内响应）
t=0s    创建卡片: "正在连接 AI 编码平台..."
        ↓ (agent 启动)
t=5s    首个 token -> 更新卡片正文（500ms 节流）
t=5.5s  继续流式 -> 节流更新
t=8s    工具调用 -> 状态行: "🔧 执行工具: bash"
t=10s   工具返回 -> 状态行: "✅ 工具执行完成"
t=15s   RUN_FINISHED -> 终态化: 全文 + 操作按钮 [复制全部] [重新生成]
```

- **节流策略**：500ms 间隔（约 2 次/秒），在飞书 API 限频安全范围内
- **降级策略**：CardKit 不可用时自动降级为 batch 模式（收集全文后一次性发送）
- **SSE 心跳**：15s 间隔发送 `: heartbeat` 注释，防止中间层 LB 空闲超时断连

### 配置

`apps/dh-backend/config.yaml`：

```yaml
feishu:
  app_id: ""              # 飞书应用 App ID（mock 模式可空）
  app_secret: ""          # App Secret
  verify_token: ""        # 事件订阅 Token
  encrypt_key: ""         # 加密 Key（生产启用）
  webhook_token: "feishu-local-dev-token"  # 平台侧 webhook Bearer Token
  api_base_url: "https://open.feishu.cn/open-apis"
  bot_user_id: ""         # 兜底平台用户 ID
  default_workspace: ""   # 兜底工作空间 ID
  mock_mode: true         # true=本地调试（不连飞书），false=生产
  dispatch_timeout: "30m"
  admin_user_ids: []      # 白名单 open_id 列表（完整编码能力）
```

环境变量覆盖（优先级最高）：

| 变量 | 说明 |
|------|------|
| `FEISHU_APP_ID` | 飞书应用 App ID |
| `FEISHU_APP_SECRET` | App Secret |
| `FEISHU_MOCK_MODE` | `true`/`false` |
| `FEISHU_ADMIN_USER_IDS` | 逗号分隔的白名单 open_id |
| `FEISHU_WEBHOOK_TOKEN` | 平台侧 Bearer Token |

### 本地测试（Mock 模式）

```bash
# 1. 确保服务已启动
bash scripts/restart-dev.sh

# 2. 绑定飞书用户（首次需要）
curl -s -X POST http://127.0.0.1:8080/api/v1/feishu/bindings \
  -H "Authorization: Bearer admin" \
  -H "Content-Type: application/json" \
  -d '{"openId":"ou_test_user_001","userId":"admin","workspaceId":"default-workspace"}'

# 3. 发送编码请求（需白名单权限）
curl -s -X POST http://127.0.0.1:8080/api/v1/feishu/webhook \
  -H "Authorization: Bearer feishu-local-dev-token" \
  -H "Content-Type: application/json" \
  -d '{"mock_event":true,"chat_id":"oc_test","chat_type":"p2p","open_id":"ou_test_user_001","message_type":"text","content":"编码：用 Go 写一个 hello world","message_id":"om_1"}'

# 4. 发送普通问答
curl -s -X POST http://127.0.0.1:8080/api/v1/feishu/webhook \
  -H "Authorization: Bearer feishu-local-dev-token" \
  -H "Content-Type: application/json" \
  -d '{"mock_event":true,"chat_id":"oc_test","chat_type":"p2p","open_id":"ou_test_user_001","message_type":"text","content":"你好","message_id":"om_2"}'

# 5. 查看流式输出日志
tail -f /tmp/dh-backend.log | grep -E "\[Feishu"
```

也可直接运行完整测试脚本：

```bash
bash apps/dh-backend/tests/test-feishu/mock-event.sh
```

### 生产部署

1. 在飞书开放平台创建自建应用，开启机器人能力
2. 开通权限：`im:message`、`im:message:send_as_bot`、`im:message.history`（群总结需要）
3. 配置事件订阅 URL：`https://<your-domain>/api/v1/feishu/webhook`
4. 设置环境变量 `FEISHU_MOCK_MODE=false`，填入真实 `FEISHU_APP_ID`/`FEISHU_APP_SECRET`/`FEISHU_VERIFY_TOKEN`
5. 配置 `FEISHU_ADMIN_USER_IDS` 为允许使用编码功能的用户 open_id 列表

### API 端点

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| POST | `/api/v1/feishu/webhook` | Bearer webhook_token | 飞书事件回调（webhook） |
| POST | `/api/v1/feishu/bindings` | Bearer userId | 绑定飞书用户与平台用户 |
| GET | `/api/v1/feishu/bindings` | Bearer userId | 查询绑定列表 |
| GET | `/api/v1/feishu/chat-sessions` | Bearer userId | 查询飞书会话映射 |

## 技术栈

- **前端**：React 18、Vite、TypeScript、Tailwind CSS、shadcn/ui
- **后端**：Go 1.22、标准库 `net/http`、统一的 `dh-backend` 模块
- **数据库**：PostgreSQL 15
- **缓存/缓冲**：Redis（可选，用于 SSE 事件缓存与崩溃恢复）
- **Monorepo**：Turborepo、pnpm workspaces、Go workspaces
