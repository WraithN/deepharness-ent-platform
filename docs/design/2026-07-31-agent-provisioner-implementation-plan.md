# Agent 容器生命周期管理 - 实施方案

> 日期：2026-07-31
> 状态：方案设计

## 一、目标

实现 gatewayd 容器的池化管理（暖池预创建 → 用户绑定 → 休眠/唤醒 → 驱逐销毁），
解耦 Pod 生命周期与用户会话，提供 AgentProvisioner 抽象接口支持开源/企业双模式。

## 二、包结构

```
packages/go-sdk/
  domain/agent/
    provisioner.go              # AgentProvisioner 接口定义 + 类型定义

apps/dh-backend/
  agent/
    provisioner/
      factory.go                # 根据 config 创建对应 Provider
      controller.go             # 后台控制器：暖池维护 + 空闲休眠 + 驱逐
      status.go                 # Provisioning 状态管理（内存 + Redis）
      mock/
        provider.go             # MockProvider（本地开发，无 K8s）
      k8s/
        provider.go             # K8sNativeProvider（client-go）
        pod_template.go         # Pod YAML 模板构建
        labels.go               # K8s label/selector 常量
      gatewayd_admin.go         # gatewayd Admin API 客户端（bind/sleep/wake/health）

  gateway/
    handler/
      agent_status_handler.go   # GET /api/v1/workspaces/{id}/agent-status（前端轮询）
```

## 三、AgentProvisioner 接口

**文件**：`packages/go-sdk/domain/agent/provisioner.go`

```go
package agent

// InstanceStatus 描述 Agent 实例当前状态。
type InstanceStatus string

const (
    InstanceStatusCreating  InstanceStatus = "creating"
    InstanceStatusActive    InstanceStatus = "active"
    InstanceStatusSleeping  InstanceStatus = "sleeping"
    InstanceStatusUnbound   InstanceStatus = "unbound"   // 暖池中，未绑定用户
    InstanceStatusError     InstanceStatus = "error"
)

// ProvisionRequest 携带用户上下文，用于绑定 Agent 实例。
type ProvisionRequest struct {
    WorkspaceID string
    UserID      string
    Roles       []string   // 用户角色，决定创建哪些角色目录
    AgentType   string     // "opencode" | "codex"
}

// AgentInstance 表示一个已分配的 Agent 实例。
type AgentInstance struct {
    InstanceID  string          // Pod name 或平台实例 ID
    AdminURL    string          // gatewayd admin 端口地址
    AgentURL    string          // gatewayd agent API 地址
    Status      InstanceStatus
    AssignedAt  time.Time
}

// ProvisionResult 包含 provisioning 结果和状态。
type ProvisionResult struct {
    Instance        AgentInstance
    Stage           string  // "waking" | "assigning" | "creating" | "ready"
    EstimatedSec    int     // 预估剩余秒数
}

// WarmPoolStatus 暖池状态。
type WarmPoolStatus struct {
    Available int   // 可用（unbound）数量
    Total     int   // 总数量
    Min       int   // 最小保有量
    Max       int   // 最大上限
}

// AgentProvisioner 是 Agent 实例生命周期的统一抽象。
// 开源版使用 K8sNativeProvider，企业版使用 EnterpriseDevOpsProvider。
type AgentProvisioner interface {
    // Provision 为用户分配一个可用的 Agent 实例。
    // 优先级：休眠唤醒 > 暖池分配 > 冷启动创建。
    // 该方法会阻塞直到实例就绪或超时/失败。
    Provision(ctx context.Context, req ProvisionRequest) (ProvisionResult, error)

    // Sleep 休眠实例：停止 Agent 进程，保留 Pod + PVC。
    Sleep(ctx context.Context, instanceID string) error

    // Wake 唤醒已休眠的实例。
    Wake(ctx context.Context, instanceID string) (AgentInstance, error)

    // Destroy 销毁实例：删除 Pod，保留 PVC。
    Destroy(ctx context.Context, instanceID string) error

    // Status 查询实例状态。
    Status(ctx context.Context, instanceID string) (InstanceStatus, error)

    // FindByUser 按 workspaceID + userID 查找已有实例。
    // 返回 InstanceStatusUnbound 表示未找到（需要 Provision）。
    FindByUser(ctx context.Context, workspaceID, userID string) (*AgentInstance, error)

    // WarmPoolEnsure 确保暖池中有至少 min 个可用实例。
    WarmPoolEnsure(ctx context.Context, min int) error

    // WarmPoolStatus 查询暖池状态。
    WarmPoolStatus(ctx context.Context) (WarmPoolStatus, error)
}
```

## 四、gatewayd Admin API 客户端

**文件**：`apps/dh-backend/agent/provisioner/gatewayd_admin.go`

dh-backend 通过 HTTP 调用 gatewayd 的 admin API（:2346），不依赖 gatewayd 内部实现。

### 需要的 gatewayd 端点（Rust 侧需新增）

| 端点 | 方法 | 请求体 | 响应 | 说明 |
|------|------|--------|------|------|
| `/admin/health` | GET | - | `{status: "active\|sleeping\|warm\|unbound"}` | 健康检查 + 状态 |
| `/admin/bind` | POST | `{workspaceId, userId, workspacePath, roles, agentType}` | `{status: "active"}` | 绑定用户上下文 |
| `/admin/unbind` | POST | - | `{status: "unbound"}` | 解绑，回到暖池 |
| `/admin/sleep` | POST | - | `{status: "sleeping"}` | 停止 agent 进程 |
| `/admin/wake` | POST | - | `{status: "active"}` | 重启 agent 进程 |

### Go 客户端实现

```go
type GatewaydAdminClient struct {
    httpClient *http.Client
}

func (c *GatewaydAdminClient) Health(ctx, adminURL) (string, error)
func (c *GatewaydAdminClient) Bind(ctx, adminURL, req BindRequest) error
func (c *GatewaydAdminClient) Unbind(ctx, adminURL) error
func (c *GatewaydAdminClient) Sleep(ctx, adminURL) error
func (c *GatewaydAdminClient) Wake(ctx, adminURL) error
```

### 过渡期兼容（gatewayd 尚未实现 sleep/wake/bind）

Phase 1 初期 gatewayd 还没有这些端点。MockProvider 和 K8sNativeProvider 需要处理：
- `Bind` 调用失败 -> 降级为"直接使用 Pod 地址"（假设 gatewayd 启动时已通过环境变量配置好）
- `Sleep/Wake` 调用失败 -> 降级为"删除 Pod + 重建"（旧模式）
- 用 feature flag 控制：`gatewayd_supports_bind: false`（默认 false，gatewayd 升级后改 true）

## 五、MockProvider

**文件**：`apps/dh-backend/agent/provisioner/mock/provider.go`

本地开发无需 K8s，模拟全部生命周期：

```go
type MockProvider struct {
    mu        sync.Mutex
    instances map[string]*mockInstance   // instanceID -> instance
    warmPool  []*mockInstance
    adminURL  string   // 本地 gatewayd 地址（config 中的 GatewaydAdminURL）
    agentURL  string   // 本地 gatewayd agent 地址
    config    MockConfig
}

type MockConfig struct {
    WarmPoolMin   int
    IdleTimeout   time.Duration
    SimulateDelay time.Duration  // 模拟 provisioning 延迟
}
```

### 行为

| 方法 | 行为 |
|------|------|
| `Provision` | 查 instances 找 sleeping -> wake；找 warmPool -> bind；都没有 -> 创建新 mock instance |
| `Sleep` | 标记 instance.Status = sleeping |
| `Wake` | 标记 instance.Status = active |
| `Destroy` | 从 instances 删除 |
| `FindByUser` | 遍历 instances 匹配 wsID+userID |
| `WarmPoolEnsure` | 补充 warmPool 到 min 数量 |
| `WarmPoolStatus` | 返回 warmPool 统计 |

### 本地开发流程

```
dh-backend 启动 -> MockProvider 初始化
  -> warmPool 为空（不预创建，本地开发不需要）
  -> 用户发起请求 -> Provision
  -> 返回 config 中配置的 GatewaydAdminURL/AgentURL
  -> 相当于直连本地 gatewayd 进程
```

## 六、K8sNativeProvider

**文件**：`apps/dh-backend/agent/provisioner/k8s/provider.go`

### 依赖

```go
import (
    "k8s.io/client-go/kubernetes"
    "k8s.io/client-go/rest"
    "k8s.io/client-go/tools/clientcmd"
)
```

`go.mod` 新增 `k8s.io/client-go` 依赖。

### 结构

```go
type K8sProvider struct {
    clientset   *kubernetes.Clientset
    namespace   string
    config      K8sProviderConfig
    adminClient *GatewaydAdminClient
    mu          sync.Mutex
}

type K8sProviderConfig struct {
    Image              string            // gatewayd 镜像
    ImagePullSecrets   []string
    Namespace          string            // K8s namespace
    WarmPoolMin        int               // 暖池最小保有量
    WarmPoolMax        int               // 暖池最大上限
    IdleTimeout        time.Duration     // 空闲多久进入休眠
    SleepEvictTimeout  time.Duration     // 休眠多久后可被驱逐
    MaxActivePerUser   int               // 每用户最多活跃实例
    AgentPort          int               // 默认 2345
    AdminPort          int               // 默认 2346
    SharedPVCName      string            // 共享 RWX PVC 名称
    WorkspaceMountPath string            // 默认 /workspace
    ResourceActive     ResourceSpec      // 活跃时资源配额
    ResourceSleeping   ResourceSpec      // 休眠时资源配额
    SupportsBind       bool              // gatewayd 是否支持 bind API（feature flag）
}

type ResourceSpec struct {
    CPURequest    string  // "2000m"
    CPULimit      string  // "4000m"
    MemoryRequest string  // "4Gi"
    MemoryLimit   string  // "8Gi"
}
```

### K8s Label 设计

```go
const (
    LabelManagedBy    = "deepharness.io/managed-by"     // "dh-backend"
    LabelType         = "deepharness.io/type"           // "warm-pool" | "user"
    LabelWorkspaceID  = "deepharness.io/workspace-id"
    LabelUserID       = "deepharness.io/user-id"
    LabelStatus       = "deepharness.io/status"         // "unbound" | "active" | "sleeping"
)
```

### Pod 模板

**暖池 Pod**（不绑定用户，预启动 agent 二进制）：

```yaml
metadata:
  labels:
    deepharness.io/managed-by: dh-backend
    deepharness.io/type: warm-pool
    deepharness.io/status: unbound
spec:
  containers:
    - name: gatewayd
      image: {Image}
      ports: [{containerPort: 2345}, {containerPort: 2346}]
      env:
        - {name: MODE, value: "warm"}
      resources: {ResourceActive}
      volumeMounts:
        - {name: workspace, mountPath: /workspace}
      readinessProbe:
        httpGet: {path: /admin/health, port: 2346}
  volumes:
    - name: workspace
      persistentVolumeClaim: {claimName: {SharedPVCName}}
```

**用户 Pod**（从暖池 bind 或新建）：

```yaml
metadata:
  labels:
    deepharness.io/managed-by: dh-backend
    deepharness.io/type: user
    deepharness.io/workspace-id: {wsID}
    deepharness.io/user-id: {userID}
    deepharness.io/status: active
```

### Provision 核心流程

```
Provision(ctx, req):
    1. FindByUser(req.WorkspaceID, req.UserID)
       -> labelSelector: workspace-id={wsID}, user-id={userID}
       -> 找到 sleeping Pod? -> Wake() -> 返回
       -> 找到 active Pod? -> 直接返回（已分配）

    2. 暖池查找
       -> labelSelector: type=warm-pool, status=unbound
       -> 找到? -> bind 流程：
           a. Patch Pod labels: type=user, workspace-id, user-id, status=active
           b. 如果 SupportsBind:
                POST /admin/bind {workspacePath, roles, agentType}
           c. 否则:
                Patch Pod env: WORKSPACE_PATH, WORKSPACE_ID, USER_ID
                （需要重建 Pod，降级模式）
           d. 等待 readinessProbe 通过
           e. 返回 AgentInstance

    3. 冷启动
       -> 创建新 Pod（带用户 labels）
       -> 等待 Pod Ready（轮询 /admin/health）
       -> bind 流程（同 2b/2c）
       -> 返回 AgentInstance
```

### 休眠/唤醒实现

```
Sleep(instanceID):
    1. 如果 SupportsBind:
        POST /admin/sleep -> gatewayd 停止 agent 进程
    2. 否则:
        Patch Pod resources -> 降低到 ResourceSleeping
        （Pod 保留但资源降到最低）
    3. Patch Pod label: status=sleeping

Wake(instanceID):
    1. 如果 SupportsBind:
        POST /admin/wake -> gatewayd 重启 agent 进程
    2. 否则:
        Patch Pod resources -> 恢复到 ResourceActive
        （如果 Pod 已被驱逐，需要重新创建）
    3. Patch Pod label: status=active
    4. 等待 readinessProbe 通过
```

### 驱逐策略

```
evictSleepingPods():
    1. 查询所有 status=sleeping 的 Pod
    2. 按 SleepStartedAt 排序（最久的最先驱逐）
    3. 计算集群资源水位（通过 K8s API 查询节点资源）
    4. 水位 > 80% 或 sleeping Pod 数量 > WarmPoolMax:
        -> 删除最久的 sleeping Pod（保留 PVC）
    5. sleeping 超过 SleepEvictTimeout 的 Pod:
        -> 强制删除
```

## 七、Provisioner Factory + Config

### Config 变更

**文件**：`apps/dh-backend/config/config.go`

Config struct 新增：

```go
type Config struct {
    // ... 已有字段 ...

    // AgentProvisioner Agent 实例生命周期管理配置。
    AgentProvisioner ProvisionerConfig
}

type ProvisionerConfig struct {
    // Type: "mock" | "k8s" | "enterprise"
    Type string

    // Mock 本地开发模式配置
    Mock MockProvisionerConfig

    // K8s 原生模式配置
    K8s K8sProvisionerConfig

    // Enterprise 企业 DevOps 适配器配置
    Enterprise EnterpriseProvisionerConfig

    // 通用配置
    IdleTimeout       time.Duration  // 空闲多久进入休眠，默认 30m
    SleepEvictTimeout time.Duration  // 休眠多久后可被驱逐，默认 2h
    StatusCheckInterval time.Duration // 状态检查间隔，默认 60s
}

type MockProvisionerConfig struct {
    SimulateDelay time.Duration
}

type K8sProvisionerConfig struct {
    Namespace          string
    Image              string
    ImagePullSecrets   []string
    WarmPoolMin        int
    WarmPoolMax        int
    MaxActivePerUser   int
    SharedPVCName      string
    WorkspaceMountPath string  // 默认 /workspace
    AgentPort          int     // 默认 2345
    AdminPort          int     // 默认 2346
    KubeconfigPath     string  // 为空则用 in-cluster config
    ResourceActiveCPU    string
    ResourceActiveMemory string
    ResourceSleepingCPU    string
    ResourceSleepingMemory string
    SupportsBind       bool   // gatewayd 是否支持 bind API
}

type EnterpriseProvisionerConfig struct {
    DevOpsAPIURL   string
    DevOpsAPIToken string
}
```

### config.yaml 新增

```yaml
agent_provisioner:
  type: mock                    # 开发环境用 mock，生产用 k8s
  idle_timeout: 30m
  sleep_evict_timeout: 2h
  status_check_interval: 60s

  mock:
    simulate_delay: 0s

  k8s:
    namespace: deepharness
    image: ghcr.io/deepharness/gatewayd:latest
    warm_pool_min: 3
    warm_pool_max: 10
    max_active_per_user: 1
    shared_pvc_name: shared-workspace
    workspace_mount_path: /workspace
    agent_port: 2345
    admin_port: 2346
    kubeconfig_path: ""         # 空则用 in-cluster config
    resource_active_cpu: "2000m"
    resource_active_memory: "4Gi"
    resource_sleeping_cpu: "50m"
    resource_sleeping_memory: "128Mi"
    supports_bind: false        # gatewayd 升级后改 true

  enterprise:
    devops_api_url: ""
    devops_api_token: ""
```

### Factory

**文件**：`apps/dh-backend/agent/provisioner/factory.go`

```go
func NewProvisioner(cfg config.ProvisionerConfig) (agent.AgentProvisioner, error) {
    switch cfg.Type {
    case "mock":
        return mock.NewMockProvider(cfg.Mock, cfg.IdleTimeout)
    case "k8s":
        return k8s.NewK8sProvider(cfg.K8s, cfg.IdleTimeout, cfg.SleepEvictTimeout)
    case "enterprise":
        return nil, fmt.Errorf("enterprise provider not implemented, use separate module")
    default:
        return nil, fmt.Errorf("unknown provisioner type: %s", cfg.Type)
    }
}
```

## 八、Agent Status API（前端轮询）

**文件**：`apps/dh-backend/gateway/handler/agent_status_handler.go`

### API 设计

```
GET /api/v1/workspaces/{workspaceId}/agent-status
  -> 200 {
       "status": "creating",          // creating|waking|assigning|ready|error
       "stage": "pulling_image",      // 人类可读的阶段描述
       "estimatedSeconds": 15,        // 预估剩余秒数
       "instanceId": "pod-xxx"        // 实例 ID（ready 时有值）
     }

SSE /api/v1/workspaces/{workspaceId}/agent-status/stream
  -> event: status {"status":"creating","stage":"pulling_image","estimatedSeconds":15}
  -> event: status {"status":"ready","instanceId":"pod-xxx"}
```

### Handler 实现

```go
type AgentStatusHandler struct {
    provisioner agent.AgentProvisioner
}

func (h *AgentStatusHandler) GetStatus(w, r) {
    workspaceID := r.PathValue("workspaceId")
    userID := middleware.UserIDFromContext(r.Context())

    instance, err := h.provisioner.FindByUser(ctx, workspaceID, userID)
    if err != nil || instance == nil {
        // 无实例，返回需要 provisioning
        writeJSON(w, 200, {status: "none"})
        return
    }

    writeJSON(w, 200, {
        status: instance.Status,
        instanceId: instance.InstanceID,
    })
}

func (h *AgentStatusHandler) StreamStatus(w, r) {
    // SSE 推送状态变更
    // 前端 EventSource 订阅，ready 后关闭
}
```

### 路由注册

`gateway/server/server.go` 中新增：

```go
agentStatusHandler := handler.NewAgentStatusHandler(provisioner)
mux.HandleFunc(ROUTE_WORKSPACES_BY_ID_AGENT_STATUS, middleware.Auth(agentStatusHandler.GetStatus))
mux.HandleFunc(ROUTE_WORKSPACES_BY_ID_AGENT_STATUS_STREAM, middleware.Auth(agentStatusHandler.StreamStatus))
```

## 九、AgentRun 集成

### 改造点

**文件**：`gateway/handler/agui_run.go`

在 `AgentRun` 方法的阶段 3（resolveRunWorkspace）之后、阶段 7（abortIfGatewaydUnreachable）之前，
插入新的 provisioning 阶段。

### 改造前（当前流程）

```
阶段3: resolveRunWorkspace -> 得到 workspacePath
阶段5: prepareSSEStream
阶段7: abortIfGatewaydUnreachable -> 检查 gatewayd 是否可达
阶段8: executeAgentRun -> 调用 h.aguiClient.Run()
```

### 改造后

```
阶段3: resolveRunWorkspace -> 得到 workspacePath
阶段3.5（新增）: ensureAgentProvisioned -> 确保 Agent 实例就绪
阶段5: prepareSSEStream
阶段7: abortIfGatewaydUnreachable（保留，但 gatewayd 地址改为动态）
阶段8: executeAgentRun -> 使用 provisioned 实例的 AgentURL
```

### 阶段 3.5 实现

```go
// ensureAgentProvisioned 确保用户有可用的 Agent 实例。
// 如果实例不存在或休眠中，触发 provisioning。
// 返回实例信息；SSE 模式下通过 flusher 推送进度事件。
func (h *AGUIHandler) ensureAgentProvisioned(
    ctx context.Context,
    flusher http.Flusher,
    workspaceID, userID, workspacePath string,
) (*agent.AgentInstance, error) {
    // 1. 查找已有实例
    existing, err := h.provisioner.FindByUser(ctx, workspaceID, userID)
    if err == nil && existing != nil {
        switch existing.Status {
        case agent.InstanceStatusActive:
            return existing, nil  // 已就绪，直接用
        case agent.InstanceStatusSleeping:
            // 推送 SSE 进度：正在唤醒...
            emitProvisioningEvent(flusher, "waking", "正在唤醒编码环境...", 3)
            result, err := h.provisioner.Wake(ctx, existing.InstanceID)
            if err != nil {
                return nil, fmt.Errorf("wake agent failed: %w", err)
            }
            return &result, nil
        }
    }

    // 2. 触发 Provision
    emitProvisioningEvent(flusher, "creating", "正在启动编码环境...", 15)
    result, err := h.provisioner.Provision(ctx, agent.ProvisionRequest{
        WorkspaceID: workspaceID,
        UserID:      userID,
        AgentType:   "opencode",
    })
    if err != nil {
        return nil, fmt.Errorf("provision agent failed: %w", err)
    }
    emitProvisioningEvent(flusher, "ready", "编码环境已就绪", 0)

    return &result.Instance, nil
}
```

### AGUIHandler 结构变更

```go
type AGUIHandler struct {
    aguiClient    *client.AGUIClient       // 保留，但 adminURL 改为动态
    sessions      chat.SessionStore
    messages      chat.MessageStore
    buffer        buffer.SSEBuffer
    workItemSvc   workitemservice.WorkItemService
    workspaceRoot string
    provisioner   agent.AgentProvisioner   // 新增
    gatewaydAdminURL string                 // 默认 gatewayd 地址（provisioner 不可用时降级）
}
```

### executeAgentRun 改造

当前 `executeAgentRun` 使用 `h.aguiClient.Run()`，aguiClient 的 adminURL 是固定的。

改造后：
- 如果 provisioner 返回了实例，用实例的 AdminURL 创建临时 AGUIClient
- 如果 provisioner 不可用（nil），降级使用默认 gatewaydAdminURL

```go
func (h *AGUIHandler) executeAgentRun(..., instance *agent.AgentInstance) {
    var aguiClient *client.AGUIClient
    if instance != nil {
        aguiClient = client.NewAGUIClient(instance.AdminURL, h.aguiClient.GetPluginKey())
    } else {
        aguiClient = h.aguiClient  // 降级
    }
    actualThreadID, events, err := aguiClient.Run(ctx, input)
    // ...
}
```

### Server 初始化变更

```go
// server.go
provisioner, err := provisioner.NewProvisioner(cfg.AgentProvisioner)
if err != nil {
    log.Fatalf("init provisioner failed: %v", err)
}

aguiHandler := handler.NewAGUIHandler(
    cfg.GatewaydAdminURL, cfg.GatewaydAgentID, cfg.WorkspaceRoot,
    sessions, messages, sseBuffer, workItemSvc,
    provisioner,  // 新增
)

// 启动后台控制器
controller := provisioner.NewController(provisioner, cfg.AgentProvisioner)
controller.Start(ctx)
```

## 十、后台控制器

**文件**：`apps/dh-backend/agent/provisioner/controller.go`

```go
type Controller struct {
    provisioner agent.AgentProvisioner
    config      config.ProvisionerConfig
    stopCh      chan struct{}
}

func (c *Controller) Start(ctx context.Context) {
    // 1. 暖池维护循环
    safego.Go("warmpool-ensure", func() {
        ticker := time.NewTicker(c.config.StatusCheckInterval)
        defer ticker.Stop()
        for {
            select {
            case <-ticker.C:
                c.provisioner.WarmPoolEnsure(ctx, c.config.K8s.WarmPoolMin)
            case <-c.stopCh:
                return
            }
        }
    })

    // 2. 空闲休眠检查循环
    safego.Go("idle-sleep-check", func() {
        ticker := time.NewTicker(c.config.StatusCheckInterval)
        defer ticker.Stop()
        for {
            select {
            case <-ticker.C:
                c.checkAndSleepIdleInstances(ctx)
            case <-c.stopCh:
                return
            }
        }
    })

    // 3. 休眠驱逐循环（仅 K8s 模式）
    if c.config.Type == "k8s" {
        safego.Go("sleep-evict", func() {
            ticker := time.NewTicker(5 * time.Minute)
            defer ticker.Stop()
            for {
                select {
                case <-ticker.C:
                    c.evictSleepingPods(ctx)
                case <-c.stopCh:
                    return
                }
            }
        })
    }
}
```

### 空闲检测

```
checkAndSleepIdleInstances(ctx):
    1. 查询所有 status=active 的用户实例
    2. 对每个实例：
       a. 查询该用户最近活跃时间（从 session store 获取 LastActivityAt）
       b. 如果空闲时间 > IdleTimeout:
          -> provisioner.Sleep(ctx, instanceID)
          -> 记录日志 + 更新状态
```

需要 SessionStore 提供 `ListActiveSessions()` 或类似接口来获取所有活跃会话的最后活动时间。

## 十一、飞书 Dispatcher 集成

**文件**：`apps/dh-backend/domain/feishu/service/dispatcher.go`

### 改造点

在 `processEvent` 方法的第 5 步（计算工作目录）之后、第 6 步（路由分发）之前，
插入 Agent 实例就绪检查。

### 改造前

```
步骤5: buildWorkspacePath -> 得到 workspacePath
步骤6: 路由分发 -> dispatchStreaming/dispatchGroupSummary
```

### 改造后

```
步骤5: buildWorkspacePath -> 得到 workspacePath
步骤5.5（新增）: ensureAgentReady -> 确保 Agent 实例就绪
步骤6: 路由分发
```

### 步骤 5.5 实现

```go
func (s *DBFeishuService) ensureAgentReady(
    ev object.InboundEvent,
    identity IdentityResult,
    workspacePath string,
) error {
    // 1. 查找已有实例
    existing, _ := s.provisioner.FindByUser(ctx, identity.WorkspaceID, identity.UserID)
    if existing != nil && existing.Status == agent.InstanceStatusActive {
        return nil  // 已就绪
    }

    // 2. 发送"正在准备"飞书卡片
    s.replier.Send(ev, "🔧 正在准备编码环境，请稍候...")

    // 3. 触发 provisioning（阻塞等待）
    result, err := s.provisioner.Provision(ctx, agent.ProvisionRequest{
        WorkspaceID: identity.WorkspaceID,
        UserID:      identity.UserID,
        AgentType:   "opencode",
    })
    if err != nil {
        s.replier.Send(ev, "❌ 编码环境启动失败：" + err.Error())
        return err
    }

    // 4. 发送"已就绪"飞书卡片
    s.replier.Send(ev, "✅ 编码环境已就绪，正在执行你的指令...")
    return nil
}
```

### FeishuService 结构变更

```go
type DBFeishuService struct {
    // ... 已有字段 ...
    provisioner agent.AgentProvisioner  // 新增
}
```

### Server 初始化变更

```go
// server.go 中初始化飞书服务时传入 provisioner
feishuSvc := feishuservice.NewDBFeishuService(..., provisioner)
```

## 十二、Provisioning 状态管理

**文件**：`apps/dh-backend/agent/provisioner/status.go`

用于在 provisioning 过程中追踪状态，支持前端轮询/SSE。

### 内存实现（单实例 dh-backend）

```go
type StatusTracker struct {
    mu     sync.RWMutex
    states map[string]*ProvisioningState  // key: {wsID}:{userID}
}

type ProvisioningState struct {
    Status         string     // creating|waking|assigning|ready|error
    Stage          string     // 人类可读阶段
    EstimatedSec   int
    InstanceID     string
    StartedAt      time.Time
    CompletedAt    time.Time
    Error          string
}
```

### Redis 实现（多实例 dh-backend）

如果 dh-backend 多副本部署，状态需要存 Redis：

```
key: agent:provision:{wsID}:{userID}
value: { status, stage, estimatedSec, instanceId, startedAt }
TTL: 5 分钟（provisioning 完成后自动过期）
```

Phase 1 先用内存实现，Phase 2 支持 Redis。

## 十三、实施顺序

### Phase 1-A：接口 + Mock + 集成（1 周）

| 序号 | 任务 | 文件 | 依赖 |
|------|------|------|------|
| 1 | 定义 AgentProvisioner 接口 | `go-sdk/domain/agent/provisioner.go` | 无 |
| 2 | 实现 gatewayd admin 客户端 | `provisioner/gatewayd_admin.go` | 1 |
| 3 | 实现 MockProvider | `provisioner/mock/provider.go` | 1, 2 |
| 4 | 实现 StatusTracker | `provisioner/status.go` | 1 |
| 5 | 实现 Factory | `provisioner/factory.go` | 3 |
| 6 | Config 新增 ProvisionerConfig | `config/config.go` | 无 |
| 7 | AgentRun 集成 provisioning | `gateway/handler/agui_run.go` | 1, 5, 6 |
| 8 | Server 初始化接入 | `gateway/server/server.go` | 5, 6, 7 |
| 9 | Agent Status API | `gateway/handler/agent_status_handler.go` | 1, 4 |
| 10 | 编译验证 | - | 1-9 |

**Phase 1-A 验收**：本地开发用 MockProvider，AgentRun 流程正常工作，前端可查询 agent-status。

### Phase 1-B：后台控制器 + 飞书集成（1 周）

| 序号 | 任务 | 文件 | 依赖 |
|------|------|------|------|
| 11 | 实现后台控制器 | `provisioner/controller.go` | 1-A |
| 12 | 空闲休眠检查 | `provisioner/controller.go` | 11 |
| 13 | 飞书 dispatcher 集成 | `domain/feishu/service/dispatcher.go` | 1-A |
| 14 | 编译验证 | - | 11-13 |

**Phase 1-B 验收**：飞书消息触发 provisioning + 状态卡片反馈；空闲实例自动休眠。

### Phase 2：K8sNativeProvider（2~3 周）

| 序号 | 任务 | 文件 | 依赖 |
|------|------|------|------|
| 15 | go.mod 新增 client-go | `apps/dh-backend/go.mod` | 无 |
| 16 | K8s label 常量 | `provisioner/k8s/labels.go` | 无 |
| 17 | Pod 模板构建 | `provisioner/k8s/pod_template.go` | 16 |
| 18 | K8sProvider 实现 | `provisioner/k8s/provider.go` | 1, 2, 16, 17 |
| 19 | 暖池管理 | `provisioner/k8s/provider.go` | 18 |
| 20 | 驱逐策略 | `provisioner/k8s/provider.go` | 18 |
| 21 | 集群内测试 | - | 18-20 |

**Phase 2 验收**：K8s 集群中暖池预创建、用户绑定、休眠/唤醒、驱逐全流程跑通。

### Phase 3：企业适配器 + 高级优化（按需）

| 序号 | 任务 | 说明 |
|------|------|------|
| 22 | EnterpriseDevOpsProvider | 独立私有仓库 |
| 23 | Redis 状态共享 | 多副本 dh-backend |
| 24 | 分布式锁 | 防止并发 provisioning |
| 25 | 监控指标 | Prometheus metrics |
| 26 | PVC 归档自动化 | personal-stub 改造 |

## 十四、风险与降级

### 降级策略

| 场景 | 降级方案 |
|------|----------|
| provisioner 初始化失败 | dh-backend 启动时不 fatal，降级为 nil，AgentRun 用固定 GatewaydAdminURL |
| Provision 超时/失败 | AgentRun 返回 SSE error 事件，前端展示"环境启动失败，点击重试" |
| gatewayd 不支持 bind/sleep/wake | `SupportsBind=false`，降级为删除 Pod + 重建 |
| K8s API 不可达 | K8sProvider 返回错误，dh-backend 返回 503 |
| 暖池为空 + 冷启动慢 | 前端展示进度条 + 预估时间 |

### 环境兼容

| 环境 | provisioner type | 说明 |
|------|-----------------|------|
| 本地开发 | `mock` | 直连本地 gatewayd 进程，无池化 |
| 开发集群 | `k8s` + `warm_pool_min: 1` | 最小暖池，快速验证 |
| 生产集群 | `k8s` + `warm_pool_min: 3~10` | 正常暖池 |
| 企业私有化 | `enterprise` | 对接内部 DevOps 平台 |

## 十五、gatewayd Rust 侧改造清单（外部协作）

以下端点需要在 gatewayd（Rust）中实现，dh-backend 通过 HTTP 调用：

| 优先级 | 端点 | Phase | 说明 |
|--------|------|-------|------|
| P0 | `GET /admin/health` | 1-A | 返回状态，用于 readinessProbe |
| P0 | `POST /admin/bind` | 1-B | 绑定用户上下文 |
| P1 | `POST /admin/sleep` | 1-B | 停止 agent 进程 |
| P1 | `POST /admin/wake` | 1-B | 重启 agent 进程 |
| P2 | `POST /admin/unbind` | 2 | 回到暖池状态 |

**在 gatewayd 实现这些端点之前**，dh-backend 侧用 `SupportsBind=false` 降级运行：
- 不调用 bind/sleep/wake
- Provision 直接返回 Pod 地址
- Sleep 降级为降低 Pod 资源配额
- Wake 降级为恢复资源配额或重建 Pod
