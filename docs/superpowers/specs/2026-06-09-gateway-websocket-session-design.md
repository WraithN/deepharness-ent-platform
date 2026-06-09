# Gateway WebSocket Session Gateway — Design Spec

> 创建时间: 2026-06-09  
> 目标: 增强现有 `services/api-gateway`，使其支持 HTTP 创建智能会话 + WebSocket 实时通信，并为后续 K8s Coding Agent（HTTP+SSE）通信预留扩展接口。

---

## 1. 背景与目标

前端「智能会话」功能需要：

1. 通过 **HTTP POST** 创建会话，获取 `sessionId` 和 WebSocket 连接地址。
2. 通过 **WebSocket** 与 Gateway 建立持久连接，进行多轮对话。
3. Gateway 作为协议桥梁，未来通过 **HTTP + SSE** 与部署在 K8s 中的 Coding Agent 通信。

当前 `services/api-gateway` 仅提供基础 HTTP 路由和 Health Check，需要增强会话管理、WebSocket 支持和消息队列能力。

---

## 2. 架构总览

Gateway 采用 **分层架构**，核心业务逻辑与存储/通信基础设施解耦：

```
┌─────────────────────────────────────────┐
│  HTTP Handlers + WebSocket Upgrader     │  ← API 入口
├─────────────────────────────────────────┤
│  Session Manager                        │
│  Connection Hub                         │  ← 业务逻辑层
│  Message Dispatcher                     │
├─────────────────────────────────────────┤
│  Session Store      │  Message Store    │  ← 存储抽象（可插拔）
│  Message Broker     │  Agent Client     │  ← 通信抽象（可插拔）
├─────────────────────────────────────────┤
│  memory / redis 具体实现               │  ← 通过配置切换后端
└─────────────────────────────────────────┘
```

**核心设计原则：**

- **接口隔离**：所有存储和 Broker 操作通过 Go interface 定义，`memory` 为默认实现，`redis` 实现可在不修改业务逻辑的情况下替换。
- **无状态 Gateway（相对）**：Gateway 本身不保存业务状态，会话状态和消息历史由 Store 层管理；连接状态由 Hub 层管理。
- **失败隔离**：Agent 通信失败不影响 Gateway 核心服务，错误通过 WebSocket 事件向前端透传。

---

## 3. 核心接口定义

### 3.1 Session Store

```go
type Session struct {
    ID        string
    AgentType string    // opencode | claude
    Model     string
    ProjectID string
    Context   map[string]any
    CreatedAt time.Time
    UpdatedAt time.Time
}

type SessionStore interface {
    Create(ctx context.Context, s Session) error
    Get(ctx context.Context, id string) (Session, error)
    UpdateActivity(ctx context.Context, id string) error
    Delete(ctx context.Context, id string) error
}
```

### 3.2 Message Store

```go
type Message struct {
    ID        string
    SessionID string
    Role      string    // user | assistant | system
    Type      string    // text | attachment | tool_use | tool_result | thinking
    Content   string
    Metadata  map[string]any  // fileName, toolName, mimeType 等
    Timestamp time.Time
}

type MessageStore interface {
    Append(ctx context.Context, sessionID string, msg Message) error
    GetHistory(ctx context.Context, sessionID string, limit int) ([]Message, error)
}
```

### 3.3 Message Broker

Broker 作为 Gateway 内部组件间的异步消息通道，解耦 Connection Hub 与 Agent Client：

```go
type BrokerEvent struct {
    Type    string    // message | status | error
    Payload Message   // 当 Type = message 时填充
    Error   *ErrorInfo // 当 Type = error 时填充
}

type MessageBroker interface {
    Publish(ctx context.Context, sessionID string, ev BrokerEvent) error
    Subscribe(ctx context.Context, sessionID string) (<-chan BrokerEvent, error)
    Unsubscribe(ctx context.Context, sessionID string, ch <-chan BrokerEvent) error
}
```

### 3.4 Agent Client

Agent Client 负责 Gateway 与 Coding Agent 之间的 HTTP+SSE 通信。当前版本仅定义接口，具体实现放在后续迭代：

```go
type AgentClient interface {
    // SendMessage 将用户消息发送至 Agent，并监听 SSE 响应流
    // 解析后的 SSE 事件通过内部回调或返回 channel 注入 MessageBroker
    SendMessage(ctx context.Context, session Session, msg Message) error
}
```

**说明：** `SendMessage` 内部会建立到 Agent Pod 的 HTTP 连接，发送消息体，并持续读取 SSE 响应流。每个 SSE 事件会被解析为 `BrokerEvent` 并 Publish 到对应 `sessionID` 的订阅通道。

---

## 4. API 规范

### 4.1 创建会话

```http
POST /api/v1/sessions
Content-Type: application/json

{
  "agentType": "opencode",
  "model": "claude-3-7-sonnet",
  "projectId": "proj-123",
  "context": { "language": "go", "framework": "gin" }
}
```

**响应：**

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "sessionId": "sess-uuid-xxx",
    "wsUrl": "ws://gateway-host:8080/ws/v1/sessions/sess-uuid-xxx"
  }
}
```

### 4.2 WebSocket 连接

```
WS /ws/v1/sessions/{sessionId}
```

**连接流程：**

1. 客户端发起 WebSocket Upgrade 请求。
2. Gateway 从 URL Path 提取 `sessionId`，查询 SessionStore 验证会话存在且未过期。
3. 验证通过后，ConnectionHub 注册该连接，并从 MessageStore 读取最近 N 条历史消息推送至客户端。
4. 客户端收到历史消息后即可发送新消息。

**WebSocket 消息信封格式：**

```json
// 客户端 → Gateway（发送消息）
{
  "event": "message",
  "payload": {
    "type": "text",
    "content": "帮我写一个登录页面"
  }
}

// Gateway → 客户端（代理 Agent 回复）
{
  "event": "message",
  "payload": {
    "id": "msg-uuid",
    "sessionId": "sess-uuid",
    "role": "assistant",
    "type": "thinking",
    "content": "正在分析需求...",
    "timestamp": "2026-06-09T12:00:00Z"
  }
}

// Gateway → 客户端（状态通知）
{
  "event": "status",
  "payload": { "state": "agent_connecting" }
}

// Gateway → 客户端（错误通知）
{
  "event": "error",
  "payload": { "code": "AGENT_TIMEOUT", "message": "Agent 响应超时" }
}
```

---

## 5. 数据流详细说明

### 5.1 会话创建流

```
Frontend
    │
    ▼
POST /api/v1/sessions
    │
    ▼
Handler: 解析请求 → 生成 sessionId → 组装 Session 对象
    │
    ▼
SessionStore.Create(ctx, session)
    │
    ▼
返回 { sessionId, wsUrl }
```

### 5.2 消息收发流（核心循环）

```
Frontend                              Gateway
    │                                      │
    │────── WS /ws/v1/sessions/{id} ──────►│
    │                                      │── Validate sessionId (SessionStore.Get)
    │                                      │── Register conn (ConnectionHub)
    │                                      │── Replay history (MessageStore.GetHistory)
    │◄─────────────────────────────────────│
    │                                      │
    │── { event: "message", ... } ────────►│
    │                                      │── Parse envelope
    │                                      │── Build Message 对象
    │                                      │── MessageStore.Append(userMsg)
    │                                      │── MessageBroker.Publish(userMsg)
    │                                      │
    │                                      │── AgentClient.SendMessage(session, userMsg)
    │                                      │    │
    │                                      │    ▼
    │                                      │    HTTP POST → Agent Pod
    │                                      │    ◄── SSE Stream
    │                                      │
    │◄──── MessageBroker.Subscribe ◄───────│── 解析 SSE event → BrokerEvent
    │                                      │── MessageStore.Append(agentMsg)
    │                                      │── WS WriteJSON(agentMsg)
    │                                      │
```

### 5.3 重连流

```
Frontend (断开重连)
    │
    ▼
WS /ws/v1/sessions/{id} (相同 sessionId)
    │
    ▼
Gateway
    │── Validate sessionId
    │── Register new conn
    │── MessageStore.GetHistory(sessionId, RECONNECT_HISTORY_LIMIT)
    │── 按时间顺序推送历史消息
    │
Frontend 收到历史消息后恢复上下文
```

**常量定义：**

```go
const (
    RECONNECT_HISTORY_LIMIT = 50    // 重连时回放的最大消息数
    SESSION_TIMEOUT         = 30 * time.Minute  // 会话空闲超时
    WS_WRITE_TIMEOUT        = 10 * time.Second  // WebSocket 写入超时
    AGENT_REQUEST_TIMEOUT   = 120 * time.Second // Agent HTTP 请求超时
    AGENT_SSE_RETRY_MAX     = 3                 // Agent SSE 断开最大重试次数
)
```

---

## 6. 存储与 Broker 实现策略

### 6.1 Memory 实现（默认）

- **SessionStore:** `map[string]Session` + `sync.RWMutex`
- **MessageStore:** `map[string][]Message`（按 sessionId 分片）+ `sync.RWMutex`，支持环形缓冲区限制单会话消息数。
- **MessageBroker:** 每个 `sessionId` 维护一个订阅者列表 `map[string][]chan BrokerEvent`，Publish 时遍历并异步发送。

### 6.2 Redis 实现（预留）

- **SessionStore:** Redis Hash / JSON，带 TTL。
- **MessageStore:** Redis List（`LPUSH` + `LTRIM`），天然支持定长历史。
- **MessageBroker:** Redis Pub/Sub，每个 `sessionId` 作为一个 channel。

**切换方式：** 通过环境变量配置，启动时根据配置初始化对应实现，注入到业务层。

---

## 7. 错误处理与边界情况

| 场景 | 处理策略 |
|------|---------|
| WebSocket 异常断开 | 连接从 Hub 移除，Session 保留；客户端可重连并恢复历史 |
| 无效的 sessionId（WS 连接时） | 拒绝 Upgrade，返回 HTTP 403，WebSocket close reason: `invalid_session` |
| Agent HTTP 请求失败 | AgentClient 重试最多 `AGENT_SSE_RETRY_MAX` 次；最终失败时通过 Broker 发送 `error` 事件至前端 |
| Agent SSE 流异常中断 | 同上，指数退避重连；若重试耗尽，发送 `error` 事件 |
| MessageStore 内存溢出风险 | 单会话消息上限 `MAX_MESSAGES_PER_SESSION = 1000`，超出时淘汰最旧消息 |
| Broker 订阅者泄漏 | Unsubscribe 必须在连接断开时调用；内存实现使用 `sync.Once` 保证只清理一次 |
| 并发写同一 WebSocket | Hub 层为每个连接持有 `sync.Mutex`，确保写操作串行化 |

---

## 8. 配置项

```go
type Config struct {
    Port             string        `env:"PORT" default:"8080"`
    SessionStoreType string        `env:"SESSION_STORE" default:"memory"`   // memory | redis
    MessageStoreType string        `env:"MESSAGE_STORE" default:"memory"`   // memory | redis
    BrokerType       string        `env:"BROKER_TYPE" default:"memory"`     // memory | redis
    RedisURL         string        `env:"REDIS_URL"`                        // redis 后端时必填
    AgentBaseURL     string        `env:"AGENT_BASE_URL"`                   // Coding Agent K8s Service URL
    SessionTimeout   time.Duration `env:"SESSION_TIMEOUT" default:"30m"`
}
```

---

## 9. 目录结构

```
services/api-gateway/
├── main.go
├── go.mod
├── internal/
│   ├── server/
│   │   └── server.go           # 路由注册、中间件链
│   ├── handler/
│   │   ├── health.go           # 现有 Health Check
│   │   ├── session.go          # POST /api/v1/sessions
│   │   └── websocket.go        # WS /ws/v1/sessions/{id}
│   ├── middleware/
│   │   ├── cors.go
│   │   ├── logger.go
│   │   └── auth.go             # 预留：WebSocket 连接鉴权
│   ├── domain/
│   │   ├── session.go          # Session / Message 实体
│   │   └── event.go            # BrokerEvent / ErrorInfo 实体
│   ├── store/
│   │   ├── store.go            # SessionStore / MessageStore 接口
│   │   ├── memory/
│   │   │   ├── session.go
│   │   │   └── message.go
│   │   └── redis/
│   │       ├── session.go      # 预留
│   │       └── message.go      # 预留
│   ├── broker/
│   │   ├── broker.go           # MessageBroker 接口
│   │   └── memory/
│   │       └── broker.go
│   ├── hub/
│   │   └── hub.go              # ConnectionHub：连接管理、历史回放、消息分发
│   └── agent/
│       └── client.go           # AgentClient 接口 + 预留实现
├── config/
│   └── config.go               # 配置解析
└── Makefile
```

---

## 10. 测试策略

| 层级 | 范围 | 方式 |
|------|------|------|
| 单元测试 | Handler、Hub、Store、Broker 的独立逻辑 | 使用 mock interface 注入依赖 |
| 集成测试 | HTTP + WS 端到端流程 | 启动真实 Server，使用 in-memory 实现，通过 `httptest` + Gorilla WebSocket client 测试 |
| Agent Client 测试 | SSE 解析与事件转发 | Mock SSE HTTP server，验证 Broker 收到的事件序列 |

**关键测试场景：**

1. 创建会话 → WS 连接 → 收发消息 → 断开 → 重连 → 历史回放完整。
2. 多客户端并发连接到不同 session，消息互不串扰。
3. Agent Client SSE 流中断后重试，最终失败时前端收到 error 事件。

---

## 11. 风险与后续迭代

| 风险 | 缓解措施 |
|------|---------|
| 单 Gateway 实例内存 Broker 无法水平扩展 | 接口已预留 Redis 实现，扩展时切换即可 |
| WebSocket 长连接数过高 | 后续可考虑连接分片或多 Gateway 实例 + Redis Pub/Sub |
| Agent Pod 网络不稳定 | AgentClient 已实现重试 + 退避；未来可加入熔断 |
| 缺少鉴权 | 当前版本预留 `middleware/auth.go`，接入身份服务后补充 |

---

## 12. 待后续实现（本阶段不纳入）

- `AgentClient` 的具体 HTTP+SSE 实现（等待 Coding Agent 接口定义）
- `store/redis/` 和 `broker/redis/` 的具体实现
- WebSocket 鉴权中间件（需对接 `identity-service`）
- 消息持久化到数据库（当前仅内存/Redis，不落地）

---

*本设计文档经讨论确认，作为 implementation plan 的输入。*
