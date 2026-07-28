# 飞书机器人 + AI Coding 平台集成方案设计

> 面向企业内部开发助手，支持个人编码辅助（场景1）和群聊总结/需求产出（场景2），
> 输出层使用 CardKit 流式卡片实现打字机效果。

## 1. 架构决策：扩展现有模块 vs 独立服务

**决策：扩展现有 `apps/dh-backend/domain/feishu/` 模块，不建独立服务。**

理由：
- 现有模块已实现 webhook 接收、用户绑定、会话映射、agent 分发、回复发送全链路
- AGUIClient、SessionStore、MessageStore、Config 系统可直接复用
- 符合 monorepo 架构（AGENTS.md §5），dh-backend 是中央管理后端
- 独立服务会重复实现 AGUIClient、配置加载、DB 连接等基础设施

现有基础 vs 需要新增：

| 能力 | 现有状态 | 需要新增 |
|------|---------|---------|
| Webhook 接收 | ✅ handler.go | - |
| 用户绑定 | ✅ service.go | 白名单权限分级 |
| 会话映射 | ✅ chat_sessions 表 | - |
| Agent 分发 | ✅ dispatcher.go | 流式输出到 CardKit |
| 回复发送 | ✅ replier.go (batch) | CardKit 流式卡片 |
| 意图识别 | ❌ | intent.go |
| 群历史拉取 | ❌ | group_history.go |
| CardKit 管理 | ❌ | cardkit.go |

## 2. 组件设计

### 2.1 整体数据流

```
飞书事件 (webhook/长连接)
    ↓
handler.go: Webhook 处理
    ↓
intent.go: 意图识别
    ├─ "编码：xxx"     → 场景1: dispatchCoding
    ├─ "总结群聊"      → 场景2: dispatchGroupSummary
    ├─ "生成需求卡片"   → 场景2: dispatchRequirement
    ├─ "原型设计：xxx"  → 场景2: dispatchPrototype
    └─ 其他             → 默认: dispatchChat (普通问答)
    ↓
dispatcher.go: 流式分发
    ├─ 场景1: AGUIClient.Run → SSE 事件流
    └─ 场景2: group_history.go 拉群消息 → AGUIClient.Run → SSE 事件流
    ↓
cardkit.go: 流式卡片管理
    ├─ 首个 token 到达 → 创建卡片
    ├─ 后续 token → 节流更新卡片 (300ms)
    └─ RUN_FINISHED → 终态卡片 + 操作按钮
    ↓
飞书聊天窗口实时渲染
```

### 2.2 文件结构

```
apps/dh-backend/domain/feishu/
├── handler.go              # [现有] webhook/bindings/chat-sessions 处理器
├── object/types.go         # [现有+扩展] 域模型，新增 Intent 类型
├── service/
│   ├── service.go          # [现有+扩展] 接口+DB，新增白名单校验
│   ├── dispatcher.go       # [改写] 流式分发，对接 CardKit
│   ├── replier.go          # [保留] batch 回复（mock 模式/降级用）
│   ├── cardkit.go          # [新增] CardKit 流式卡片管理器
│   ├── intent.go           # [新增] 意图识别路由
│   ├── group_history.go    # [新增] 群历史消息拉取（场景2）
│   └── identity.go         # [新增] 身份校验+权限分级
```

### 2.3 CardKit 流式卡片管理器 (`cardkit.go`)

**核心抽象**：管理飞书 CardKit 卡片的创建、流式更新、终态化。

```go
// CardKitManager 管理飞书流式卡片的生命周期。
// 飞书 CardKit API:
//   创建: POST /open-apis/cardkit/v1/cards
//   更新: PATCH /open-apis/cardkit/v1/cards/{card_id}
type CardKitManager struct {
    appID       string
    appSecret   string
    apiBaseURL  string
    tokenMu     sync.Mutex
    token       string // 缓存 tenant_access_token
    tokenExpire time.Time
}

// StreamingCard 封装一次流式卡片会话的上下文。
type StreamingCard struct {
    manager    *CardKitManager
    chatID     string
    cardID     string        // 创建后获得
    buf        strings.Builder
    lastUpdate time.Time     // 节流控制
    finalized  bool
}

// CreateStreamingCard 在指定会话中创建初始卡片，返回 StreamingCard 句柄。
// 初始内容为 placeholder（如"正在思考..."），后续通过 Update 追加真实内容。
func (m *CardKitManager) CreateStreamingCard(ctx context.Context, chatID, placeholder string) (*StreamingCard, error)

// Update 节流更新卡片内容。内部按 300ms 间隔节流，频繁调用安全。
// content 为全量文本（非增量），CardKit 会渲染最终态。
func (c *StreamingCard) Update(ctx context.Context, content string) error

// AppendAndFlush 追加增量文本并在必要时触发节流更新。
func (c *StreamingCard) AppendAndFlush(ctx context.Context, delta string) error

// Finalize 终态化卡片：写入最终内容 + 操作按钮，之后不再更新。
// buttons 格式: [{"text":"复制代码","action":"copy","data":"..."}, ...]
func (c *StreamingCard) Finalize(ctx context.Context, content string, buttons []CardButton) error

// UpdateStatus 更新卡片中的状态行（如"正在执行工具: bash..."），不修改正文。
func (c *StreamingCard) UpdateStatus(ctx context.Context, status string) error
```

**节流策略**：
- 最小更新间隔 300ms（约 3 次/秒），平衡流畅度与 API 限流
- 使用 `time.Since(lastUpdate)` 判断，不足间隔时只累积不发送
- 终态事件（RUN_FINISHED/RUN_ERROR）立即 flush，不等节流

**卡片内容格式**（Markdown 渲染）：
```
{状态行，如"✅ 已完成 / 🔧 执行工具: bash"}

{正文：agent 回复的 Markdown，含代码块、列表等}

---
{操作按钮：复制代码 | 重新生成 | 导出文档}
```

### 2.4 意图路由 (`intent.go`)

```go
type Intent int

const (
    IntentCoding       Intent = iota  // "编码：xxx" / "代码：xxx"
    IntentGroupSummary                // "总结群聊" / "总结最近N条消息"
    IntentRequirement                  // "生成需求卡片" / "需求：xxx"
    IntentPrototype                    // "原型设计：xxx" / "原型：xxx"
    IntentChat                         // 默认：普通问答
)

// ParseIntent 根据消息内容识别意图。
// 初期使用关键词匹配，后续可升级为 LLM 识别。
func ParseIntent(content string) Intent {
    // 关键词优先级：编码 > 原型 > 需求 > 总结 > 默认问答
    // 支持中英文前缀: "编码：" "code:" "原型：" "proto:" 等
}

// DispatchRoute 根据意图选择分发路径。
type DispatchRoute struct {
    Intent      Intent
    AgentMode   string  // "oneshot" | "persistent"
    Preprocess  func(ev InboundEvent) (string, error)  // 场景2的前置处理（拉群消息等）
    NeedHistory bool    // 场景2需要拉取群历史
}
```

**关键词规则**（初期，可配置化）：

| 关键词前缀 | 意图 | Agent 模式 | 前置处理 |
|-----------|------|-----------|---------|
| `编码：` `代码：` `code:` | IntentCoding | persistent | 无 |
| `原型：` `proto:` | IntentPrototype | persistent | 无 |
| `需求：` `requirement:` | IntentRequirement | persistent | 无 |
| `总结` `summary` | IntentGroupSummary | oneshot | 拉群历史消息 |
| 其他 | IntentChat | oneshot | 无 |

### 2.5 群历史拉取 (`group_history.go`)

```go
// GroupHistoryFetcher 拉取飞书群历史消息。
// 飞书 API: GET /open-apis/im/v1/chats/{chat_id}/messages
// 权限: im:message.history
type GroupHistoryFetcher struct {
    appID      string
    appSecret  string
    apiBaseURL string
}

// FetchMessages 拉取指定群最近 N 条文本消息。
// limit: 消息条数上限（默认 20，飞书单页最多 50）
// duration: 时间范围上限（默认 30 分钟）
func (f *GroupHistoryFetcher) FetchMessages(ctx context.Context, chatID string, limit int, duration time.Duration) ([]GroupMessage, error)

// GroupMessage 飞书群消息（清洗后）。
type GroupMessage struct {
    SenderName string
    Content    string
    Timestamp  time.Time
}

// BuildSummaryPrompt 将群消息列表组装为 LLM prompt。
func BuildSummaryPrompt(messages []GroupMessage, intent Intent) string {
    // 根据意图选择 prompt 模板：
    // - IntentGroupSummary: "请总结以下群聊内容..."
    // - IntentRequirement: "根据以下群聊讨论，提取需求..."
    // - IntentPrototype: "根据以下讨论，设计原型..."
}
```

**限制处理**：
- 飞书 API 单页最多 50 条，需翻页
- 群消息量大时按 token 数截断（保留最近消息）
- 非 text 消息类型过滤（图片/文件等暂不处理）

### 2.6 身份校验+权限分级 (`identity.go`)

```go
// IdentityResolver 身份校验与权限分级。
type IdentityResolver struct {
    adminUserIDs map[string]bool  // 白名单：完整编码能力
    botUserID    string           // 兜底用户
    defaultWS    string
}

type PermissionLevel int

const (
    PermFull    PermissionLevel = iota  // 白名单用户：编码/原型/需求/总结
    PermBasic                            // 普通用户：仅问答+总结
    PermDenied                           // 未授权
)

// Resolve 解析用户身份与权限。
func (r *IdentityResolver) Resolve(openID string) (userID, workspaceID string, perm PermissionLevel)
```

**权限矩阵**：

| 意图 | PermFull | PermBasic |
|------|----------|-----------|
| IntentCoding | ✅ | ❌（提示无权限）|
| IntentPrototype | ✅ | ❌ |
| IntentRequirement | ✅ | ✅ |
| IntentGroupSummary | ✅ | ✅ |
| IntentChat | ✅ | ✅ |

### 2.7 流式分发器 (`dispatcher.go` 改写)

**核心变化**：从 batch 模式（收集全部文本再回复）改为 streaming 模式（边收边更新卡片）。

```go
// dispatchStreaming 流式分发：agent SSE 事件 → CardKit 流式卡片。
func (s *DBFeishuService) dispatchStreaming(ev object.InboundEvent, prompt string, workspacePath string) error {
    ctx, cancel := s.dispatchContext()
    defer cancel()

    // 1. 构建 Run 输入
    input := buildRunInput(threadID, prompt, workspacePath)
    actualThreadID, events, err := s.aguiClient.Run(ctx, input)
    if err != nil {
        s.replier.Send(ev, "连接 AI 平台失败: "+err.Error())
        return err
    }

    // 2. 流式消费事件，写入 CardKit 卡片
    card, err := s.cardKit.CreateStreamingCard(ctx, ev.ChatID, "正在连接 AI 编码平台...")
    if err != nil {
        // CardKit 不可用时降级为 batch 模式
        return s.dispatchBatchFallback(ev, actualThreadID, events)
    }

    var textBuilder strings.Builder
    var statusText string

    for ev := range events {
        switch ev.Type {
        case agui.EventTextMessageContent:
            textBuilder.WriteString(ev.Delta)
            card.AppendAndFlush(ctx, textBuilder.String())

        case agui.EventToolCallStart:
            statusText = fmt.Sprintf("🔧 执行工具: %s", ev.ToolCallName)
            card.UpdateStatus(ctx, statusText)

        case agui.EventToolCallResult:
            statusText = "✅ 工具执行完成"
            card.UpdateStatus(ctx, statusText)

        case agui.EventRunFinished:
            buttons := buildActionButtons(ev, actualThreadID)
            card.Finalize(ctx, textBuilder.String(), buttons)
            s.persistRun(actualThreadID, ev, ...)
            s.upsertChatSession(...)
            return nil

        case agui.EventRunError:
            card.Finalize(ctx, "❌ 执行失败: "+ev.Message, nil)
            return fmt.Errorf("agent error: %s", ev.Message)
        }
    }
    return nil
}
```

**降级策略**：
- CardKit API 不可用 → 降级为 batch 模式（现有 replier.Send）
- 群历史拉取失败 → 提示用户"无法拉取群消息，请检查权限"
- Agent 超时 → 卡片更新为超时提示

## 3. CardKit 流式卡片生命周期

```
时间轴：
t=0s   Webhook 收到消息 → 立即返回 200
t=0s   创建卡片: "正在连接 AI 编码平台..."
       ↓ (agent 启动中)
t=5s   Agent 首个 token → 更新卡片: 显示正文开头
t=5.3s 继续流式 → 节流更新卡片 (300ms 间隔)
t=5.6s 继续流式 → 节流更新
t=8s   工具调用 → 状态行: "🔧 执行工具: bash"
t=10s  工具返回 → 状态行: "✅ 工具执行完成"
t=10.3s 继续流式正文
t=15s  RUN_FINISHED → 终态化: 全文 + 按钮
       卡片内容:
       ┌──────────────────────────────────┐
       │ ✅ 已完成                         │
       │                                   │
       │ {agent 回复的 Markdown 全文}       │
       │                                   │
       │ ─────────────────                │
       │ [复制代码] [重新生成] [导出文档]   │
       └──────────────────────────────────┘
```

## 4. 会话隔离与上下文管理

现有 `feishu_chat_sessions` 表已支持按 `chat_id` 隔离：

| chat_id | session_id | mode | chat_type |
|---------|-----------|------|-----------|
| oc_user_001 | thread-aaa | persistent | p2p |
| oc_group_dev | thread-bbb | persistent | group |

- **私聊**：一个 chat_id 对应一个 session，多轮上下文
- **群聊**：一个群一个 chat_id，所有群成员共享上下文
- **斜杠命令**（`/` 开头）走 persistent 模式，复用 session
- **普通消息**走 oneshot 模式，无上下文

扩展：在 session context 中增加 `intent` 和 `permission` 字段：
```go
context["source"] = "feishu"
context["feishuChatId"] = ev.ChatID
context["feishuOpenId"] = ev.OpenID
context["intent"] = intent.String()       // 新增
context["permission"] = perm.String()     // 新增
```

## 5. 部署：开发调试 vs 生产

### 开发调试（长连接，无需公网）

使用飞书 SDK 的 WebSocket 长连接模式，本地无需暴露公网端口：

```yaml
# config.yaml
feishu:
  mock_mode: true              # 本地 mock（不连飞书）
  webhook_token: "feishu-local-dev-token"
```

Mock 模式下用 curl 模拟飞书事件：
```bash
curl -X POST http://127.0.0.1:8080/api/v1/feishu/webhook \
  -H "Authorization: Bearer feishu-local-dev-token" \
  -d '{"mock_event":true,"chat_id":"oc_test","open_id":"ou_001","content":"编码：实现登录中间件","message_type":"text","message_id":"om_1"}'
```

流式输出在日志中查看：`tail -f /tmp/dh-backend.log | grep -E "\[Feishu"`

### 切换真实飞书调试（长连接）

```yaml
feishu:
  mock_mode: false
  app_id: "cli_xxxx"           # 飞书应用 App ID
  app_secret: "xxxx"           # App Secret
  verify_token: "xxxx"         # 事件订阅 Token
  bot_user_id: "admin"         # 兜底平台用户
  default_workspace: "ws-001"  # 兜底工作空间
  use_long_connection: true    # 新增：启用 WS 长连接
```

长连接模式下，dh-backend 主动连接飞书 WS 网关接收事件，无需公网 webhook。

### 生产部署（Webhook 回调）

```yaml
feishu:
  mock_mode: false
  use_long_connection: false   # 关闭长连接，用 webhook
  app_id: "cli_xxxx"
  app_secret: "xxxx"
  verify_token: "xxxx"
  encrypt_key: "xxxx"          # 生产启用加密
```

在飞书开放平台配置事件订阅 URL：
```
https://your-domain.com/api/v1/feishu/webhook
```

## 6. 配置扩展

`config.yaml` 新增字段：

```yaml
feishu:
  # 现有字段...
  app_id: ""
  app_secret: ""
  verify_token: ""
  encrypt_key: ""
  webhook_token: "feishu-local-dev-token"
  api_base_url: "https://open.feishu.cn/open-apis"
  bot_user_id: ""
  default_workspace: ""
  mock_mode: true
  dispatch_timeout: "30m"
  
  # ---- 新增字段 ----
  use_long_connection: false       # true=WS长连接调试, false=webhook生产
  admin_user_ids:                  # 白名单用户（完整编码能力）
    - "ou_admin_001"
  cardkit_throttle_ms: 300         # CardKit 流式更新节流间隔（毫秒）
  group_history_default_limit: 20  # 群历史拉取默认条数
  group_history_default_duration: "30m"  # 群历史拉取默认时间范围
```

对应环境变量：
- `FEISHU_USE_LONG_CONNECTION`
- `FEISHU_ADMIN_USER_IDS` (逗号分隔)
- `FEISHU_CARDKIT_THROTTLE_MS`
- `FEISHU_GROUP_HISTORY_DEFAULT_LIMIT`
- `FEISHU_GROUP_HISTORY_DEFAULT_DURATION`

## 7. 实施路线图

### Phase 1：CardKit 流式卡片（场景1 核心）
1. 实现 `cardkit.go`：CardKitManager + StreamingCard
2. 改写 `dispatcher.go`：batch → streaming，对接 CardKit
3. Mock 模式下验证流式日志输出
4. 接入真实飞书 CardKit API，验证打字机效果

### Phase 2：意图路由 + 权限分级
1. 实现 `intent.go`：关键词匹配
2. 实现 `identity.go`：白名单 + 权限矩阵
3. handler.go 中接入意图路由

### Phase 3：群聊总结（场景2）
1. 实现 `group_history.go`：拉取群消息
2. 实现 prompt 模板：总结/需求/原型
3. 端到端验证场景2全链路

### Phase 4：长连接调试 + 生产部署
1. 集成飞书 SDK 长连接模式
2. CardKit 按钮交互处理（复制/重新生成/导出）
3. 生产部署 + 监控告警

## 8. 关键风险与对策

| 风险 | 对策 |
|------|------|
| CardKit API 限流 | 300ms 节流 + 降级 batch 模式 |
| 群消息 token 超限 | 按 token 数截断，保留最近消息 |
| Agent 长任务（>5min）超时 | dispatch_timeout 30min + 卡片状态更新 |
| 飞书 WS 长连接断开 | 自动重连 + 心跳保活 |
| 多用户并发 | chat_id 隔离 + 每会话独立 goroutine |
| CardKit 权限不足 | 创建卡片失败时降级为普通消息 |
