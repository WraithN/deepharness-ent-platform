package handler

import (
	"fmt"
	"log"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"time"
)

// gatewayd 进程管理常量。
const (
	// gatewaydStartTimeout 是等待 gatewayd 端口就绪的超时时间。
	gatewaydStartTimeout = 30 * time.Second
	// gatewaydMultiPortStart 是 1:N 模式端口池起始端口（agent 端口）。
	gatewaydMultiPortStart = 2350
	// gatewaydMultiPortEnd 是 1:N 模式端口池结束端口。
	gatewaydMultiPortEnd = 2399
	// gatewaydMultiPortStep 是 1:N 模式端口递增步长。
	// 每个实例占用 agentPort 和 agentPort+1（admin），步长 10 避免端口冲突。
	gatewaydMultiPortStep = 10
	// gatewaydDefaultUserID 是 1:1 模式下使用的默认 user ID。
	gatewaydDefaultUserID = "default"
)

// GatewaydMode 表示 gatewayd 管理模式。
type GatewaydMode string

const (
	// GatewaydModeSingle 1:1 模式：personal-stub 启动时创建一个 gatewayd 实例。
	GatewaydModeSingle GatewaydMode = "single"
	// GatewaydModeMulti 1:N 模式：personal-stub 按需为每个用户创建 gatewayd 实例。
	GatewaydModeMulti GatewaydMode = "multi"
)

// gatewaydInstance 记录单个 gatewayd 进程的运行状态。
type gatewaydInstance struct {
	cmd       *exec.Cmd
	userID    string
	agentPort int
	adminPort int
	startedAt time.Time
}

// GatewaydInstanceHealth 是单个 gatewayd 实例的健康状态。
type GatewaydInstanceHealth struct {
	Status    string `json:"status"`
	UserID    string `json:"userId"`
	AgentPort int    `json:"agentPort"`
	AdminPort int    `json:"adminPort"`
}

// GatewaydManager 管理 gatewayd 进程生命周期。
// personal-stub 与 gatewayd 始终同机部署，本管理器直接通过 exec.Command 启动 gatewayd 进程，
// 无需通过 HTTP 触发启动。
//
// 支持两种模式：
//   - single（1:1）：personal-stub 启动时创建一个 gatewayd 实例，所有请求共用。
//   - multi（1:N）：按需为每个 userID 创建独立的 gatewayd 实例，端口从池中分配。
type GatewaydManager struct {
	mu        sync.Mutex
	instances map[string]*gatewaydInstance // key = userID
	bin       string                       // gatewayd 二进制路径
	mode      GatewaydMode
	// 1:1 模式配置
	singleAgentPort int
	singleAdminPort int
	// 1:N 模式端口池
	portUsed map[int]bool // key = agentPort
	// 传递给 gatewayd 的环境变量
	platformURL    string // personal-stub 的 URL（gatewayd 通过此 URL 回调 personal-stub）
	platformAPIKey string // 平台 Bearer Token
	platformUserID string // 1:1 模式下的用户 ID
	runtimeID      string // 运行时 ID
	workspaceRoot  string // 工作空间根目录
}

// NewGatewaydManager 创建 gatewayd 进程管理器。
func NewGatewaydManager(bin string, mode GatewaydMode, agentPort, adminPort int,
	platformURL, platformAPIKey, platformUserID, runtimeID, workspaceRoot string) *GatewaydManager {
	return &GatewaydManager{
		instances:       make(map[string]*gatewaydInstance),
		bin:             bin,
		mode:            mode,
		singleAgentPort: agentPort,
		singleAdminPort: adminPort,
		portUsed:        make(map[int]bool),
		platformURL:     platformURL,
		platformAPIKey:  platformAPIKey,
		platformUserID:  platformUserID,
		runtimeID:       runtimeID,
		workspaceRoot:   workspaceRoot,
	}
}

// Enabled 返回管理器是否已启用（binary 路径非空）。
func (m *GatewaydManager) Enabled() bool {
	return m != nil && m.bin != ""
}

// IsMultiMode 返回是否为 1:N 模式。
func (m *GatewaydManager) IsMultiMode() bool {
	return m != nil && m.mode == GatewaydModeMulti
}

// StartSingle 在 1:1 模式下启动单个 gatewayd 实例。
// 在 personal-stub 启动时调用。
func (m *GatewaydManager) StartSingle() error {
	if !m.Enabled() {
		return fmt.Errorf("gatewayd manager not enabled")
	}
	if m.mode != GatewaydModeSingle {
		return fmt.Errorf("StartSingle only for single mode, current: %s", m.mode)
	}
	userID := m.platformUserID
	if userID == "" {
		userID = gatewaydDefaultUserID
	}
	return m.start(userID, m.singleAgentPort, m.singleAdminPort)
}

// EnsureRunning 确保指定用户的 gatewayd 实例正在运行。
// 1:1 模式：返回已启动的单实例端口。
// 1:N 模式：若实例不存在则从端口池分配并启动。
// 返回 agentPort 和 adminPort。
func (m *GatewaydManager) EnsureRunning(userID string) (int, int, error) {
	if !m.Enabled() {
		return 0, 0, fmt.Errorf("gatewayd manager not enabled")
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	// 1:1 模式：所有请求共用单实例。
	if m.mode == GatewaydModeSingle {
		inst, ok := m.instances[gatewaydDefaultUserID]
		if !ok {
			return 0, 0, fmt.Errorf("single mode gatewayd not started")
		}
		if m.processExited(inst) {
			// 进程已退出，清理后重新启动。
			m.deleteInstanceLocked(gatewaydDefaultUserID)
			m.mu.Unlock()
			err := m.start(gatewaydDefaultUserID, m.singleAgentPort, m.singleAdminPort)
			m.mu.Lock()
			if err != nil {
				return 0, 0, err
			}
			inst = m.instances[gatewaydDefaultUserID]
		}
		return inst.agentPort, inst.adminPort, nil
	}

	// 1:N 模式：按 userID 查找或创建。
	inst, ok := m.instances[userID]
	if ok && !m.processExited(inst) {
		return inst.agentPort, inst.adminPort, nil
	}
	if ok {
		// 进程已退出，清理端口。
		m.deleteInstanceLocked(userID)
	}

	// 从端口池分配。
	agentPort, adminPort, err := m.allocatePortLocked()
	if err != nil {
		return 0, 0, err
	}

	if err := m.startLocked(userID, agentPort, adminPort); err != nil {
		delete(m.portUsed, agentPort)
		return 0, 0, err
	}

	return agentPort, adminPort, nil
}

// start 启动一个 gatewayd 实例（不加锁版本，内部调用 startLocked）。
func (m *GatewaydManager) start(userID string, agentPort, adminPort int) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.startLocked(userID, agentPort, adminPort)
}

// startLocked 启动一个 gatewayd 实例（调用前必须持有 m.mu 锁）。
func (m *GatewaydManager) startLocked(userID string, agentPort, adminPort int) error {
	// 计算 gatewayd 数据目录（SQLite DB 存放位置）。
	dataDir := m.resolveDataDir(userID)
	if err := os.MkdirAll(dataDir, 0755); err != nil {
		return fmt.Errorf("create gatewayd data dir %s: %w", dataDir, err)
	}

	cmd := exec.Command(m.bin,
		"--port", fmt.Sprintf("%d", agentPort),
		"--admin-port", fmt.Sprintf("%d", adminPort),
		"--attach", "opencode",
	)

	// 构造传递给 gatewayd 的环境变量。
	// 注意：不再传递 DH_PLATFORM_WORKSPACE_ID，gatewayd 只感知 userId。
	cmd.Env = append(os.Environ(),
		fmt.Sprintf("DH_DATA_DIR=%s", dataDir),
		fmt.Sprintf("DH_PLATFORM_URL=%s", m.platformURL),
		fmt.Sprintf("DH_PLATFORM_API_KEY=%s", m.platformAPIKey),
		fmt.Sprintf("DH_PLATFORM_USER_ID=%s", userID),
		fmt.Sprintf("DH_PLATFORM_RUNTIME_ID=%s", m.runtimeID),
		"DH_PLATFORM_ENABLED=true",
	)

	// 日志输出到独立文件。
	logFile := fmt.Sprintf("/tmp/gatewayd-%s.log", userID)
	logFP, err := os.Create(logFile)
	if err != nil {
		return fmt.Errorf("create gatewayd log file: %w", err)
	}
	cmd.Stdout = logFP
	cmd.Stderr = logFP

	if err := cmd.Start(); err != nil {
		logFP.Close()
		return fmt.Errorf("start gatewayd: %w", err)
	}

	// 异步关闭日志文件（进程退出后）。
	go func(pid int, fp *os.File) {
		_ = waitForProcessExit(pid)
		fp.Close()
	}(cmd.Process.Pid, logFP)

	inst := &gatewaydInstance{
		cmd:       cmd,
		userID:    userID,
		agentPort: agentPort,
		adminPort: adminPort,
		startedAt: time.Now(),
	}
	m.instances[userID] = inst

	// 等待 admin 端口就绪。
	if !waitForPort(adminPort, gatewaydStartTimeout) {
		// 端口未就绪，检查进程是否已退出。
		if cmd.ProcessState != nil {
			m.deleteInstanceLocked(userID)
			return fmt.Errorf("gatewayd exited prematurely for user=%s, check log: %s", userID, logFile)
		}
		// 端口未就绪但进程仍在运行，继续等待（gatewayd 可能正在初始化）。
		log.Printf("[GatewaydManager] gatewayd still initializing for user=%s, proceeding", userID)
	}

	log.Printf("[GatewaydManager] gatewayd started: user=%s agentPort=%d adminPort=%d pid=%d log=%s",
		userID, agentPort, adminPort, cmd.Process.Pid, logFile)

	return nil
}

// resolveDataDir 计算 gatewayd 数据目录路径。
// 格式：/tmp/deepharness/{hostname}:{userID}
func (m *GatewaydManager) resolveDataDir(userID string) string {
	hostname, err := os.Hostname()
	if err != nil || hostname == "" {
		hostname = "localhost"
	}
	return filepath.Join(os.TempDir(), "deepharness", fmt.Sprintf("%s:%s", hostname, userID))
}

// allocatePortLocked 从端口池中分配一对可用端口（1:N 模式）。
// 调用前必须持有 m.mu 锁。
// 返回 agentPort 和 adminPort（adminPort = agentPort + 1）。
func (m *GatewaydManager) allocatePortLocked() (int, int, error) {
	for p := gatewaydMultiPortStart; p <= gatewaydMultiPortEnd; p += gatewaydMultiPortStep {
		if m.portUsed[p] {
			continue
		}
		// 检查 agent 端口和 admin 端口是否都可用。
		if !isPortAvailable(p) || !isPortAvailable(p+1) {
			continue
		}
		m.portUsed[p] = true
		return p, p + 1, nil
	}
	return 0, 0, fmt.Errorf("no available gatewayd port in range %d-%d", gatewaydMultiPortStart, gatewaydMultiPortEnd)
}

// isPortAvailable 检查端口是否可绑定。
func isPortAvailable(port int) bool {
	ln, err := net.Listen("tcp", fmt.Sprintf(":%d", port))
	if err != nil {
		return false
	}
	ln.Close()
	return true
}

// GetAdminURL 返回指定用户的 gatewayd admin API 地址。
// 1:1 模式忽略 userID，返回单实例地址。
func (m *GatewaydManager) GetAdminURL(userID string) string {
	if !m.Enabled() {
		return ""
	}
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.mode == GatewaydModeSingle {
		userID = gatewaydDefaultUserID
	}
	inst, ok := m.instances[userID]
	if !ok {
		return ""
	}
	return fmt.Sprintf("http://127.0.0.1:%d", inst.adminPort)
}

// GetAgentURL 返回指定用户的 gatewayd agent API 地址。
func (m *GatewaydManager) GetAgentURL(userID string) string {
	if !m.Enabled() {
		return ""
	}
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.mode == GatewaydModeSingle {
		userID = gatewaydDefaultUserID
	}
	inst, ok := m.instances[userID]
	if !ok {
		return ""
	}
	return fmt.Sprintf("http://127.0.0.1:%d", inst.agentPort)
}

// Stop 停止指定用户的 gatewayd 实例。
func (m *GatewaydManager) Stop(userID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.mode == GatewaydModeSingle {
		userID = gatewaydDefaultUserID
	}
	inst, ok := m.instances[userID]
	if !ok {
		return nil
	}
	m.stopProcess(inst.cmd)
	m.deleteInstanceLocked(userID)
	log.Printf("[GatewaydManager] gatewayd stopped: user=%s", userID)
	return nil
}

// StopAll 停止所有 gatewayd 实例。
func (m *GatewaydManager) StopAll() {
	m.mu.Lock()
	defer m.mu.Unlock()

	for userID, inst := range m.instances {
		m.stopProcess(inst.cmd)
		m.deleteInstanceLocked(userID)
		log.Printf("[GatewaydManager] gatewayd stopped: user=%s", userID)
	}
}

// Health 返回所有 gatewayd 实例的健康状态。
func (m *GatewaydManager) Health() map[string]GatewaydInstanceHealth {
	m.mu.Lock()
	defer m.mu.Unlock()

	result := make(map[string]GatewaydInstanceHealth)
	for userID, inst := range m.instances {
		status := "ok"
		if m.processExited(inst) {
			status = "down"
		}
		result[userID] = GatewaydInstanceHealth{
			Status:    status,
			UserID:     userID,
			AgentPort: inst.agentPort,
			AdminPort: inst.adminPort,
		}
	}
	return result
}

// processExited 检查实例的进程是否已退出。
func (m *GatewaydManager) processExited(inst *gatewaydInstance) bool {
	if inst.cmd == nil || inst.cmd.Process == nil {
		return true
	}
	return inst.cmd.ProcessState != nil
}

// deleteInstanceLocked 从管理器中删除实例记录并释放端口。
// 调用前必须持有 m.mu 锁。
func (m *GatewaydManager) deleteInstanceLocked(userID string) {
	inst, ok := m.instances[userID]
	if !ok {
		return
	}
	delete(m.instances, userID)
	if m.mode == GatewaydModeMulti {
		delete(m.portUsed, inst.agentPort)
	}
}

// stopProcess 停止一个进程：先 SIGTERM，超时后 SIGKILL。
func (m *GatewaydManager) stopProcess(cmd *exec.Cmd) {
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

// waitForProcessExit 阻塞等待进程退出。
func waitForProcessExit(pid int) error {
	proc, err := os.FindProcess(pid)
	if err != nil {
		return err
	}
	_, err = proc.Wait()
	return err
}
