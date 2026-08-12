package directhost

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"time"

	agent "github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/agent"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/config"
)

// 等待 personal-stub HTTP 服务就绪的最大时间。
const stubReadyTimeout = 45 * time.Second

// reconcileInterval 是槽位存活 reconcile 的周期。
const reconcileInterval = 30 * time.Second

// restartCooldown 是同一槽位自动重启的最小间隔，防止进程持续崩溃时崩溃循环刷爆端口/日志。
const restartCooldown = 60 * time.Second

// unhealthyThreshold 是 /health 连续探测失败多少次后才判定僵死并重启（按 reconcile 周期计）。
const unhealthyThreshold = 2

// stubHealthProbeTimeout 是单次 /health 探测的超时。
const stubHealthProbeTimeout = 2 * time.Second

// ProviderName 供给器类型名称。
const ProviderName = "direct-host"

// 默认端口递增步长与每主机最大用户数。
const (
	defaultPortStep        = 10
	defaultMaxUsersPerHost = 5
)

// Manager 是 direct-host 模式的统一管理器，同时实现 AgentProvisioner 和 ContainerPool 接口。
//
// 支持同一台主机上运行多个 personal-stub + gatewayd 进程：
//   - 每台主机有 maxUsersPerHost 个"槽位"
//   - 每个槽位对应一组唯一端口（agent/admin/stub），按 portStep 递增
//   - 槽位 0 使用基础端口，槽位 i 使用 base + i * portStep
//
// 示例（agentBase=2345, adminBase=2346, stubBase=8090, step=10）：
//
//	槽位 0: agent=2345, admin=2346, stub=8090
//	槽位 1: agent=2355, admin=2356, stub=8100
//	槽位 2: agent=2365, admin=2366, stub=8110
// WorkspaceResolver 根据 userID 解析其默认 workspaceID。
// 用于 Acquire 路径（containerMW 仅传 userID，不传 workspaceID）时为 gatewayd 补全平台上报配置。
type WorkspaceResolver func(userID string) (workspaceID string)

type Manager struct {
	mu     sync.Mutex
	hosts  []*hostState
	ports  portConfig
	nextID int
	// 进程管理配置（启用后 Manager 在 Acquire 时按需启动 gatewayd + personal-stub）。
	procCfg procConfig
	// workspaceResolver 根据 userID 解析 workspaceID（可选，由 server.go 注入 DB 查询实现）。
	workspaceResolver WorkspaceResolver
}

// portConfig 端口分配配置。
type portConfig struct {
	agentBase int
	adminBase int
	stubBase  int
	step      int
}

// procConfig 进程启动配置。
type procConfig struct {
	gatewaydBin   string // gatewayd 二进制路径（传递给 personal-stub，由 personal-stub 启动 gatewayd）
	stubBin       string // personal-stub 二进制路径
	bearerToken   string // 运行时上报 Bearer Token
	dhBackendURL  string // dh-backend 地址
	workspaceRoot string // 工作空间根目录
	gatewaydMode  string // gatewayd 管理模式："single"（1:1）或 "multi"（1:N）
}

// hostState 单台主机的槽位状态。
type hostState struct {
	host  string
	slots []*slotState
}

// slotState 单个槽位的运行时状态。
type slotState struct {
	instanceID  string
	userID      string
	workspaceID string
	runtimeID   string // 稳定的 per-user runtime ID: {hostname}:{userID}
	status      agent.InstanceStatus
	assignedAt  time.Time
	agentPort   int
	adminPort   int
	stubPort    int
	// 进程管理（仅 procCfg 启用时使用）。
	stubCmd *exec.Cmd // personal-stub 进程（gatewayd 由 personal-stub 启动和管理）
	// 自动重启冷却起点；零值表示从未自动重启过。
	lastRestartAt time.Time
	// /health 连续探测失败次数（僵死判定用），探测成功时清零。
	healthFailCount int
}

// Config direct-host 管理器的配置参数。
type Config struct {
	Hosts          []string
	AgentPort      int
	AdminPort      int
	StubPort       int
	PortStep       int
	MaxUsersPerHost int
	// 进程管理配置（可选，启用后 Manager 按需启动 per-user personal-stub 进程）。
	// gatewayd 由 personal-stub 自动启动和管理，dh-backend 不直接启动 gatewayd。
	GatewaydBin   string
	StubBin       string
	BearerToken   string
	DHBackendURL  string
	WorkspaceRoot string
	GatewaydMode  string // "single"（1:1）或 "multi"（1:N），默认 "single"
}

// NewManager 创建 direct-host 管理器。
func NewManager(cfg Config) *Manager {
	hosts := cfg.Hosts
	if len(hosts) == 0 {
		hosts = []string{"127.0.0.1"}
	}

	step := cfg.PortStep
	if step <= 0 {
		step = defaultPortStep
	}

	maxPerHost := cfg.MaxUsersPerHost
	if maxPerHost <= 0 {
		maxPerHost = defaultMaxUsersPerHost
	}

	agentBase := cfg.AgentPort
	if agentBase == 0 {
		agentBase = agent.DefaultAgentPort
	}
	adminBase := cfg.AdminPort
	if adminBase == 0 {
		adminBase = agent.DefaultAdminPort
	}
	stubBase := cfg.StubPort
	if stubBase == 0 {
		stubBase = agent.DefaultStubPort
	}

	pc := portConfig{
		agentBase: agentBase,
		adminBase: adminBase,
		stubBase:  stubBase,
		step:      step,
	}

	hostList := make([]*hostState, len(hosts))
	for i, h := range hosts {
		slots := make([]*slotState, maxPerHost)
		for j := range slots {
			slots[j] = &slotState{
				status:    agent.InstanceStatusUnbound,
				agentPort: agentBase + j*step,
				adminPort: adminBase + j*step,
				stubPort:  stubBase + j*step,
			}
		}
		hostList[i] = &hostState{host: h, slots: slots}
	}

	return &Manager{
		hosts:  hostList,
		ports:  pc,
		procCfg: procConfig{
			gatewaydBin:   cfg.GatewaydBin,
			stubBin:       cfg.StubBin,
			bearerToken:   cfg.BearerToken,
			dhBackendURL:  cfg.DHBackendURL,
			workspaceRoot: cfg.WorkspaceRoot,
			gatewaydMode:  cfg.GatewaydMode,
		},
	}
}

// NewManagerFromConfig 从 ProvisionerConfig 创建管理器。
func NewManagerFromConfig(cfg config.DirectHostConfig) *Manager {
	return NewManager(Config{
		Hosts:           cfg.Hosts,
		AgentPort:       cfg.AgentPort,
		AdminPort:       cfg.AdminPort,
		StubPort:        cfg.StubPort,
		PortStep:        cfg.PortStep,
		MaxUsersPerHost: cfg.MaxUsersPerHost,
		WorkspaceRoot:   cfg.WorkspaceRoot,
		GatewaydBin:     cfg.GatewaydBin,
		StubBin:         cfg.StubBin,
		BearerToken:     cfg.BearerToken,
		DHBackendURL:    cfg.DHBackendURL,
		GatewaydMode:    cfg.GatewaydMode,
	})
}

// Name 返回供给器类型名称。
func (m *Manager) Name() string {
	return ProviderName
}

// --- ContainerPool 接口实现 ---

// Acquire 为用户分配容器（槽位）。
// 已分配 -> 直接返回；未分配 -> 找空闲槽位；全满 -> ErrPoolExhausted。
// 若配置了进程管理（gatewayd_bin + stub_bin 非空），会在分配时按需启动 per-user 进程。
func (m *Manager) Acquire(ctx context.Context, userID string) (*agent.ContainerInfo, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	// 已有分配
	if slot := m.findSlotByUserLocked(userID); slot != nil {
		// 确保进程在运行（可能因崩溃而停止）。
		if m.procEnabled() && !m.slotProcessesRunning(slot) {
			if err := m.startProcessesLocked(slot); err != nil {
				return nil, fmt.Errorf("start processes for user %s failed: %w", userID, err)
			}
		}
		return m.slotToContainerInfo(slot), nil
	}

	// 找空闲槽位
	slot := m.findFreeSlotLocked()
	if slot == nil {
		return nil, agent.ErrPoolExhausted
	}

	slot.userID = userID
	slot.status = agent.InstanceStatusActive
	slot.instanceID = m.generateInstanceID()
	slot.runtimeID = m.generateRuntimeID(userID)
	slot.assignedAt = time.Now()

	// 启动 per-user 进程（如果配置了进程管理）。
	if m.procEnabled() {
		if err := m.startProcessesLocked(slot); err != nil {
			m.resetSlot(slot)
			return nil, fmt.Errorf("start processes for user %s failed: %w", userID, err)
		}
	}

	return m.slotToContainerInfo(slot), nil
}

// GetByUser 查找用户已分配的容器。
func (m *Manager) GetByUser(_ context.Context, userID string) (*agent.ContainerInfo, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	slot := m.findSlotByUserLocked(userID)
	if slot == nil {
		return nil, nil
	}
	return m.slotToContainerInfo(slot), nil
}

// Release 释放用户的容器回池。
func (m *Manager) Release(_ context.Context, userID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	slot := m.findSlotByUserLocked(userID)
	if slot == nil {
		return nil
	}
	m.resetSlot(slot)
	return nil
}

// PoolStatus 返回容器池状态摘要。
// 注意：此方法不直接实现 ContainerPool 接口（因 AgentProvisioner 和 ContainerPool
// 都有名为 Status 的方法但签名不同），通过 PoolAdapter 适配。
func (m *Manager) PoolStatus(_ context.Context) (agent.PoolStatus, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	var available, assigned, total int
	for _, h := range m.hosts {
		for _, s := range h.slots {
			total++
			if s.status == agent.InstanceStatusUnbound {
				available++
			} else {
				assigned++
			}
		}
	}
	return agent.PoolStatus{
		Available: available,
		Assigned:  assigned,
		Total:     total,
		Max:       total,
		Min:       0,
	}, nil
}

// --- AgentProvisioner 接口实现 ---

// Provision 为用户分配 Agent 实例。
func (m *Manager) Provision(ctx context.Context, req agent.ProvisionRequest) (agent.ProvisionResult, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	// 已有实例
	if slot := m.findSlotByUserLocked(req.UserID); slot != nil {
		switch slot.status {
		case agent.InstanceStatusActive:
			if m.procEnabled() && !m.slotProcessesRunning(slot) {
				if err := m.startProcessesLocked(slot); err != nil {
					return agent.ProvisionResult{}, fmt.Errorf("start processes failed: %w", err)
				}
			}
			return agent.ProvisionResult{Instance: m.slotToAgentInstance(slot), Stage: "ready"}, nil
		case agent.InstanceStatusSleeping:
			slot.status = agent.InstanceStatusActive
			if m.procEnabled() && !m.slotProcessesRunning(slot) {
				if err := m.startProcessesLocked(slot); err != nil {
					return agent.ProvisionResult{}, fmt.Errorf("start processes failed: %w", err)
				}
			}
			return agent.ProvisionResult{Instance: m.slotToAgentInstance(slot), Stage: "waking", EstimatedSec: 1}, nil
		}
	}

	// 找空闲槽位
	slot := m.findFreeSlotLocked()
	if slot == nil {
		return agent.ProvisionResult{}, agent.ErrPoolExhausted
	}

	slot.userID = req.UserID
	slot.workspaceID = req.WorkspaceID
	slot.status = agent.InstanceStatusActive
	slot.instanceID = m.generateInstanceID()
	slot.runtimeID = m.generateRuntimeID(req.UserID)
	slot.assignedAt = time.Now()

	if m.procEnabled() {
		if err := m.startProcessesLocked(slot); err != nil {
			m.resetSlot(slot)
			return agent.ProvisionResult{}, fmt.Errorf("start processes failed: %w", err)
		}
	}

	return agent.ProvisionResult{
		Instance:     m.slotToAgentInstance(slot),
		Stage:        "creating",
		EstimatedSec: 2,
	}, nil
}

// Sleep 将实例标记为休眠。
func (m *Manager) Sleep(_ context.Context, instanceID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	slot := m.findSlotByInstanceIDLocked(instanceID)
	if slot == nil {
		return fmt.Errorf("instance %s not found", instanceID)
	}
	slot.status = agent.InstanceStatusSleeping
	return nil
}

// Wake 将实例从休眠唤醒。
func (m *Manager) Wake(_ context.Context, instanceID string) (agent.AgentInstance, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	slot := m.findSlotByInstanceIDLocked(instanceID)
	if slot == nil {
		return agent.AgentInstance{}, fmt.Errorf("instance %s not found", instanceID)
	}
	slot.status = agent.InstanceStatusActive
	return m.slotToAgentInstance(slot), nil
}

// Destroy 删除实例（释放槽位）。
func (m *Manager) Destroy(_ context.Context, instanceID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	slot := m.findSlotByInstanceIDLocked(instanceID)
	if slot == nil {
		return fmt.Errorf("instance %s not found", instanceID)
	}
	m.resetSlot(slot)
	return nil
}

// Status 查询实例状态。
func (m *Manager) Status(_ context.Context, instanceID string) (agent.InstanceStatus, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	slot := m.findSlotByInstanceIDLocked(instanceID)
	if slot == nil {
		return "", fmt.Errorf("instance %s not found", instanceID)
	}
	return slot.status, nil
}

// FindByUser 按 workspaceID + userID 查找已有实例。
// workspaceID 为空时仅按 userID 匹配。
func (m *Manager) FindByUser(_ context.Context, workspaceID, userID string) (*agent.AgentInstance, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	for _, h := range m.hosts {
		for _, s := range h.slots {
			if s.userID != userID {
				continue
			}
			if workspaceID != "" && s.workspaceID != "" && s.workspaceID != workspaceID {
				continue
			}
			ai := m.slotToAgentInstance(s)
			return &ai, nil
		}
	}
	return nil, nil
}

// WarmPoolEnsure direct-host 模式下进程由外部启动，此方法为空操作。
func (m *Manager) WarmPoolEnsure(_ context.Context, min int) error {
	return nil
}

// WarmPoolStatus 返回暖池状态（可用槽位数）。
func (m *Manager) WarmPoolStatus(_ context.Context) (agent.WarmPoolStatus, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	var available, total int
	for _, h := range m.hosts {
		for _, s := range h.slots {
			total++
			if s.status == agent.InstanceStatusUnbound {
				available++
			}
		}
	}
	return agent.WarmPoolStatus{
		Available: available,
		Total:     total,
		Min:       0,
		Max:       total,
	}, nil
}

// --- 内部方法 ---

func (m *Manager) findSlotByUserLocked(userID string) *slotState {
	for _, h := range m.hosts {
		for _, s := range h.slots {
			if s.userID == userID && s.status != agent.InstanceStatusUnbound {
				return s
			}
		}
	}
	return nil
}

func (m *Manager) findSlotByInstanceIDLocked(instanceID string) *slotState {
	for _, h := range m.hosts {
		for _, s := range h.slots {
			if s.instanceID == instanceID {
				return s
			}
		}
	}
	return nil
}

func (m *Manager) findFreeSlotLocked() *slotState {
	for _, h := range m.hosts {
		for _, s := range h.slots {
			if s.status == agent.InstanceStatusUnbound {
				return s
			}
		}
	}
	return nil
}

func (m *Manager) resetSlot(s *slotState) {
	// 停止该槽位的 personal-stub 进程（gatewayd 由 personal-stub 管理，会随父进程退出）。
	m.stopProcessesLocked(s)
	s.instanceID = ""
	s.userID = ""
	s.workspaceID = ""
	s.runtimeID = ""
	s.status = agent.InstanceStatusUnbound
	s.assignedAt = time.Time{}
}

func (m *Manager) generateInstanceID() string {
	m.nextID++
	return fmt.Sprintf("direct-host-agent-%d", m.nextID)
}

// generateRuntimeID 生成稳定的 per-user runtime ID: {hostname}:{userID}。
// 跨重启保持一致（只要 hostname 和 userID 不变）。
func (m *Manager) generateRuntimeID(userID string) string {
	hostname, err := os.Hostname()
	if err != nil || hostname == "" {
		hostname = "localhost"
	}
	return fmt.Sprintf("%s:%s", hostname, userID)
}

// SetWorkspaceResolver 注入 workspace 解析器（由 server.go 在初始化时调用）。
func (m *Manager) SetWorkspaceResolver(resolver WorkspaceResolver) {
	m.workspaceResolver = resolver
}

// procEnabled 返回是否启用了进程管理。
// 只需要 stubBin 非空即可：dh-backend 启动 personal-stub，由 personal-stub 负责启动和管理 gatewayd。
func (m *Manager) procEnabled() bool {
	return m.procCfg.stubBin != ""
}

// slotProcessesRunning 检查槽位的 personal-stub 进程是否在运行。
func (m *Manager) slotProcessesRunning(s *slotState) bool {
	if s.stubCmd == nil || s.stubCmd.Process == nil {
		return false
	}
	// 检查进程是否已退出。
	if s.stubCmd.ProcessState != nil {
		return false
	}
	return true
}

// startProcessesLocked 为槽位启动 personal-stub 进程。
// gatewayd 由 personal-stub 自动启动和管理，dh-backend 不直接启动 gatewayd。
// 调用前必须持有 m.mu 锁。
func (m *Manager) startProcessesLocked(s *slotState) error {
	host := m.findHostBySlot(s)

	// 若 workspaceID 为空，尝试通过 resolver 解析（containerMW 路径不传 workspaceID）。
	// 注意：workspaceID 仅用于 directhost 内部记录，不再传递给 gatewayd。
	if s.workspaceID == "" && m.workspaceResolver != nil {
		s.workspaceID = m.workspaceResolver(s.userID)
	}

	// 1:N 模式下，检查同主机是否已有 personal-stub 在运行。
	// 若已有，复用该进程，不重复启动。
	if m.procCfg.gatewaydMode == "multi" {
		if existing := m.findStubOnHostLocked(s); existing != nil {
			// 复用同主机的 personal-stub 进程。
			s.stubCmd = existing.stubCmd
			log.Printf("[DirectHost] reuse personal-stub on host=%s for user=%s", host, s.userID)
			return nil
		}
	}

	// 启动 personal-stub 进程。
	// 将 gatewayd 配置通过环境变量传递给 personal-stub，由 personal-stub 负责启动 gatewayd。
	stubCmd := exec.Command(m.procCfg.stubBin)
	gatewaydMode := m.procCfg.gatewaydMode
	if gatewaydMode == "" {
		gatewaydMode = "single"
	}
	stubCmd.Env = append(os.Environ(),
		fmt.Sprintf("PORT=%d", s.stubPort),
		fmt.Sprintf("WORKSPACE_ROOT=%s", m.resolveWorkspaceRoot(s)),
		// gatewayd 配置：personal-stub 根据此配置启动和管理 gatewayd 进程。
		fmt.Sprintf("GATEWAYD_BIN=%s", m.procCfg.gatewaydBin),
		fmt.Sprintf("GATEWAYD_MODE=%s", gatewaydMode),
		fmt.Sprintf("GATEWAYD_AGENT_PORT=%d", s.agentPort),
		fmt.Sprintf("GATEWAYD_ADMIN_PORT=%d", s.adminPort),
		// 平台配置：传递给 personal-stub，由其转发给 gatewayd。
		fmt.Sprintf("DH_PLATFORM_USER_ID=%s", s.userID),
		fmt.Sprintf("DH_BACKEND_URL=%s", m.procCfg.dhBackendURL),
		fmt.Sprintf("DH_BACKEND_RUNTIME_TOKEN=%s", m.procCfg.bearerToken),
		fmt.Sprintf("DH_BACKEND_RUNTIME_ID=%s", s.runtimeID),
		// 1:N 模式下 gatewayd admin 代理需要知道当前请求的用户 ID。
		// personal-stub 通过 health 端点的 user_id 参数解析。
	)
	stubLog := fmt.Sprintf("/tmp/personal-stub-%s.log", s.userID)
	stubLogFP, err := os.Create(stubLog)
	if err != nil {
		return fmt.Errorf("create stub log file failed: %w", err)
	}
	stubCmd.Stdout = stubLogFP
	stubCmd.Stderr = stubLogFP
	if err := stubCmd.Start(); err != nil {
		stubLogFP.Close()
		return fmt.Errorf("start personal-stub failed: %w", err)
	}
	s.stubCmd = stubCmd

	// 启动 personal-stub 子进程后，必须等待其 HTTP 监听就绪再返回；
	// 否则后续请求立即通过反向代理访问该端口，会得到 502 Bad Gateway。
	if err := waitForStubReady(host, s.stubPort, stubReadyTimeout); err != nil {
		_ = stubCmd.Process.Kill()
		_ = stubCmd.Wait()
		stubLogFP.Close()
		s.stubCmd = nil
		return fmt.Errorf("personal-stub not ready for user=%s on port=%d: %w", s.userID, s.stubPort, err)
	}

	log.Printf("[DirectHost] personal-stub started for user=%s runtimeID=%s pid=%d port=%d log=%s (gatewayd managed by personal-stub, mode=%s)",
		s.userID, s.runtimeID, stubCmd.Process.Pid, s.stubPort, stubLog, gatewaydMode)

	// 收割协程：Wait 等待进程退出并设置 ProcessState。否则进程死亡后无人 Wait，
	// ProcessState 永远为 nil，slotProcessesRunning 持续误判为存活，
	// Manager 会把死进程当存活路由（请求 502），且残留僵尸进程。
	go func() { _ = stubCmd.Wait() }()

	return nil
}

// waitForStubReady 轮询 personal-stub 的 /health 端点，直到其 HTTP 服务就绪或超时。
// 直接拨 TCP 端口无法保证 HTTP handler 已注册，因此使用 GET /health 真正确认服务可用。
func waitForStubReady(host string, port int, timeout time.Duration) error {
	if port <= 0 {
		return fmt.Errorf("invalid stub port %d", port)
	}
	if host == "" {
		host = "127.0.0.1"
	}
	addr := fmt.Sprintf("http://%s:%d/health", host, port)
	deadline := time.Now().Add(timeout)
	client := &http.Client{Timeout: 1 * time.Second}
	for time.Now().Before(deadline) {
		resp, err := client.Get(addr)
		if err == nil {
			resp.Body.Close()
			if resp.StatusCode == http.StatusOK {
				return nil
			}
		}
		time.Sleep(200 * time.Millisecond)
	}
	return fmt.Errorf("personal-stub health not ready at %s after %v", addr, timeout)
}

// resolveWorkspaceRoot 计算用户的工作空间根目录。
func (m *Manager) resolveWorkspaceRoot(s *slotState) string {
	workspaceRoot := m.procCfg.workspaceRoot
	if workspaceRoot == "" {
		workspaceRoot = filepath.Join(os.TempDir(), "deepharness-workspace")
	}
	return filepath.Join(workspaceRoot, s.userID)
}

// findStubOnHostLocked 查找同主机上已启动的 personal-stub 进程（1:N 模式复用）。
func (m *Manager) findStubOnHostLocked(target *slotState) *slotState {
	host := m.findHostBySlot(target)
	for _, h := range m.hosts {
		if h.host != host {
			continue
		}
		for _, s := range h.slots {
			if s == target {
				continue
			}
			if s.stubCmd != nil && s.stubCmd.Process != nil && s.stubCmd.ProcessState == nil {
				return s
			}
		}
	}
	return nil
}

// stopProcessesLocked 停止槽位的 personal-stub 进程。
// gatewayd 由 personal-stub 管理，随父进程退出而终止。
// 调用前必须持有 m.mu 锁。
func (m *Manager) stopProcessesLocked(s *slotState) {
	// 1:N 模式下，若 personal-stub 被同主机其他槽位复用，不停止。
	if m.procCfg.gatewaydMode == "multi" {
		if reused := m.findOtherSlotUsingStubLocked(s); reused != nil {
			log.Printf("[DirectHost] personal-stub still in use by user=%s, not stopping", reused.userID)
			s.stubCmd = nil
			return
		}
	}
	if s.stubCmd != nil {
		m.stopProcess(s.stubCmd)
		s.stubCmd = nil
		log.Printf("[DirectHost] personal-stub stopped for user=%s runtimeID=%s", s.userID, s.runtimeID)
	}
}

// findOtherSlotUsingStubLocked 查找同主机上是否有其他槽位在复用同一个 personal-stub 进程。
func (m *Manager) findOtherSlotUsingStubLocked(target *slotState) *slotState {
	if target.stubCmd == nil {
		return nil
	}
	host := m.findHostBySlot(target)
	for _, h := range m.hosts {
		if h.host != host {
			continue
		}
		for _, s := range h.slots {
			if s == target {
				continue
			}
			if s.stubCmd == target.stubCmd && s.status != agent.InstanceStatusUnbound {
				return s
			}
		}
	}
	return nil
}

// stopProcess 停止一个进程：先尝试 SIGTERM，3 秒后强制 SIGKILL。
func (m *Manager) stopProcess(cmd *exec.Cmd) {
	if cmd == nil || cmd.Process == nil {
		return
	}
	_ = cmd.Process.Signal(os.Interrupt)
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		_ = cmd.Process.Kill()
		<-done
	}
}

// StartReconcileLoop 启动 personal-stub 存活 reconcile 循环。
// 背景：Acquire/Provision 的"进程死了就重启"依赖 ProcessState 可见（由收割协程保证），
// 且只在有请求到达时触发；本循环提供主动巡检，并覆盖"进程在但服务僵死"的场景：
//   - 进程已退出（ProcessState 非 nil）→ 立即重启；
//   - 进程在但 /health 连续 unhealthyThreshold 个周期探测失败 → 判定僵死，杀死后重启；
//   - 探测成功 → 失败计数清零。
// 同一槽位重启间隔不小于 restartCooldown，防止持续崩溃时崩溃循环。
// stop 传入 nil 时循环永不退出（dh-backend 进程生命周期内持续运行）。
func (m *Manager) StartReconcileLoop(stop <-chan struct{}) {
	if !m.procEnabled() {
		return
	}
	go func() {
		ticker := time.NewTicker(reconcileInterval)
		defer ticker.Stop()
		for {
			select {
			case <-stop:
				return
			case <-ticker.C:
				m.reconcileSlots()
			}
		}
	}()
}

func (m *Manager) reconcileSlots() {
	for _, h := range m.hosts {
		for _, s := range h.slots {
			m.reconcileSlot(s)
		}
	}
}

func (m *Manager) reconcileSlot(s *slotState) {
	m.mu.Lock()
	if s.status == agent.InstanceStatusUnbound || s.stubCmd == nil {
		m.mu.Unlock()
		return
	}
	if time.Since(s.lastRestartAt) < restartCooldown {
		m.mu.Unlock()
		return
	}
	procAlive := s.stubCmd.ProcessState == nil
	host := m.findHostBySlot(s)
	port := s.stubPort
	failCount := s.healthFailCount
	m.mu.Unlock()

	// 进程在：探测 /health，未连续失败则仅计数（探测在锁外执行，避免阻塞请求路由）。
	if procAlive {
		if stubHealthy(host, port) {
			m.mu.Lock()
			s.healthFailCount = 0
			m.mu.Unlock()
			return
		}
		m.mu.Lock()
		s.healthFailCount++
		m.mu.Unlock()
		if failCount+1 < unhealthyThreshold {
			log.Printf("[DirectHost] personal-stub health probe failed for user=%s port=%d (%d/%d)",
				s.userID, port, failCount+1, unhealthyThreshold)
			return
		}
	}

	// 需要重启：重新持锁并校验状态，避免与并发 Release/resetSlot 竞争。
	m.mu.Lock()
	defer m.mu.Unlock()
	if s.status == agent.InstanceStatusUnbound || s.stubCmd == nil || time.Since(s.lastRestartAt) < restartCooldown {
		return
	}
	s.lastRestartAt = time.Now()
	s.healthFailCount = 0
	if procAlive {
		log.Printf("[DirectHost] personal-stub unhealthy (process alive but /health failing) for user=%s port=%d, killing and restarting", s.userID, port)
		m.stopProcess(s.stubCmd)
		s.stubCmd = nil
	} else {
		log.Printf("[DirectHost] personal-stub process dead for user=%s port=%d, restarting", s.userID, port)
	}
	if err := m.startProcessesLocked(s); err != nil {
		log.Printf("[DirectHost] reconcile restart failed for user=%s: %v", s.userID, err)
	}
}

// stubHealthy 探测 personal-stub 的 /health 是否可用（僵死判定用）。
func stubHealthy(host string, port int) bool {
	if port <= 0 {
		return false
	}
	if host == "" {
		host = "127.0.0.1"
	}
	client := &http.Client{Timeout: stubHealthProbeTimeout}
	resp, err := client.Get(fmt.Sprintf("http://%s:%d/health", host, port))
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	return resp.StatusCode == http.StatusOK
}

func (m *Manager) slotToContainerInfo(s *slotState) *agent.ContainerInfo {
	return &agent.ContainerInfo{
		Host:      m.findHostBySlot(s),
		AgentPort: s.agentPort,
		AdminPort: s.adminPort,
		StubPort:  s.stubPort,
		UserID:    s.userID,
	}
}

func (m *Manager) slotToAgentInstance(s *slotState) agent.AgentInstance {
	host := m.findHostBySlot(s)
	return agent.AgentInstance{
		InstanceID: s.instanceID,
		AdminURL:   fmt.Sprintf("http://%s:%d", host, s.adminPort),
		AgentURL:   fmt.Sprintf("http://%s:%d", host, s.agentPort),
		Status:     s.status,
		AssignedAt: s.assignedAt,
	}
}

func (m *Manager) findHostBySlot(target *slotState) string {
	for _, h := range m.hosts {
		for _, s := range h.slots {
			if s == target {
				return h.host
			}
		}
	}
	return ""
}

// PoolAdapter 将 *Manager 适配为 agent.ContainerPool 接口。
// 由于 AgentProvisioner.Status(ctx, instanceID) 和 ContainerPool.Status(ctx)
// 方法名相同但签名不同，Go 不允许同一类型同时实现两者。
// Manager 直接实现 AgentProvisioner，ContainerPool 通过此适配器委托。
type PoolAdapter struct {
	m *Manager
}

// NewPoolAdapter 创建 ContainerPool 适配器。
func NewPoolAdapter(m *Manager) *PoolAdapter {
	return &PoolAdapter{m: m}
}

// Acquire 为用户分配容器（委托给 Manager）。
func (a *PoolAdapter) Acquire(ctx context.Context, userID string) (*agent.ContainerInfo, error) {
	return a.m.Acquire(ctx, userID)
}

// GetByUser 查找用户已分配的容器（委托给 Manager）。
func (a *PoolAdapter) GetByUser(ctx context.Context, userID string) (*agent.ContainerInfo, error) {
	return a.m.GetByUser(ctx, userID)
}

// Release 释放用户的容器（委托给 Manager）。
func (a *PoolAdapter) Release(ctx context.Context, userID string) error {
	return a.m.Release(ctx, userID)
}

// Status 返回池状态（委托给 Manager.PoolStatus）。
func (a *PoolAdapter) Status(ctx context.Context) (agent.PoolStatus, error) {
	return a.m.PoolStatus(ctx)
}
