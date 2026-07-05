package handler

import (
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const (
	previewPortStart      = 4000
	previewPortEnd        = 4100
	previewTimeoutMinutes = 30
	previewStartTimeout   = 10 * time.Second
)

// devServer 记录单个 dev server 的运行状态。
type devServer struct {
	cmd        *exec.Cmd
	port       int
	projectPath string
	startedAt  time.Time
	lastAccess time.Time
}

// DevServerManager 管理项目预览的 dev server 生命周期。
// 负责端口分配、进程启停、超时清理和反向代理。
type DevServerManager struct {
	mu       sync.Mutex
	servers  map[string]*devServer // key = projectPath
	portUsed map[int]bool
}

// NewDevServerManager 创建 dev server 管理器。
func NewDevServerManager() *DevServerManager {
	m := &DevServerManager{
		servers:  make(map[string]*devServer),
		portUsed: make(map[int]bool),
	}
	go m.cleanupLoop()
	return m
}

// allocatePort 从端口池中分配一个空闲端口。
func (m *DevServerManager) allocatePort() (int, error) {
	for p := previewPortStart; p <= previewPortEnd; p++ {
		if m.portUsed[p] {
			continue
		}
		// 检查端口是否真正可用。
		ln, err := net.Listen("tcp", fmt.Sprintf(":%d", p))
		if err != nil {
			continue
		}
		ln.Close()
		m.portUsed[p] = true
		return p, nil
	}
	return 0, fmt.Errorf("no available port in range %d-%d", previewPortStart, previewPortEnd)
}

// Start 为指定项目启动 npm run dev。
// 返回分配的端口号。会根据框架类型选择正确的启动参数，并等待端口就绪。
func (m *DevServerManager) Start(projectPath string) (int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	// 已有运行中的 dev server，直接返回。
	if srv, ok := m.servers[projectPath]; ok {
		srv.lastAccess = time.Now()
		return srv.port, nil
	}

	port, err := m.allocatePort()
	if err != nil {
		return 0, err
	}

	// 根据框架类型构建启动参数。
	args := buildDevServerArgs(projectPath, port)
	cmd := exec.Command("npm", args...)
	cmd.Dir = projectPath
	// 设置环境变量，确保 dev server 不打开浏览器。
	cmd.Env = append(os.Environ(), "BROWSER=none")
	// 捕获 stderr 用于失败诊断。
	var stderr strings.Builder
	cmd.Stderr = &stderr
	if err := cmd.Start(); err != nil {
		delete(m.portUsed, port)
		return 0, fmt.Errorf("failed to start npm run dev: %w", err)
	}

	// 等待端口就绪或进程退出，超时则清理。
	ready := make(chan bool, 1)
	go func() {
		ready <- waitForPort(port, previewStartTimeout)
	}()

	select {
	case <-ready:
		// 端口已就绪，dev server 启动成功。
	case <-time.After(previewStartTimeout):
		_ = cmd.Process.Kill()
		delete(m.portUsed, port)
		return 0, fmt.Errorf("dev server failed to start within %s: %s", previewStartTimeout, stderr.String())
	}

	// 检查进程是否已退出（可能端口刚就绪就崩溃了）。
	if cmd.ProcessState != nil {
		delete(m.portUsed, port)
		return 0, fmt.Errorf("dev server exited prematurely: %s", stderr.String())
	}

	m.servers[projectPath] = &devServer{
		cmd:         cmd,
		port:        port,
		projectPath: projectPath,
		startedAt:   time.Now(),
		lastAccess:  time.Now(),
	}

	log.Printf("[Preview] dev server started: path=%s port=%d pid=%d", projectPath, port, cmd.Process.Pid)

	// 异步等待进程退出，清理状态。
	go func() {
		_ = cmd.Wait()
		m.mu.Lock()
		delete(m.servers, projectPath)
		delete(m.portUsed, port)
		m.mu.Unlock()
		log.Printf("[Preview] dev server exited: path=%s port=%d", projectPath, port)
	}()

	return port, nil
}

// buildDevServerArgs 根据项目框架类型构建 npm run dev 的参数。
// Vite 使用 --host，Next.js 使用 --hostname，其他项目通过 PORT 环境变量传端口。
func buildDevServerArgs(projectPath string, port int) []string {
	args := []string{"run", "dev", "--", "--port", fmt.Sprintf("%d", port)}
	framework := detectDevFramework(projectPath)
	switch framework {
	case "next":
		// Next.js 使用 --hostname 而非 --host。
		args = append(args, "--hostname", "0.0.0.0")
	case "vite":
		// Vite 使用 --host。
		args = append(args, "--host", "0.0.0.0")
	default:
		// 其他框架仅传 --port，依赖环境变量绑定 host。
		args = append(args, "--host", "0.0.0.0")
	}
	return args
}

// detectDevFramework 通过 package.json 依赖检测前端框架类型。
func detectDevFramework(projectPath string) string {
	pkgPath := filepath.Join(projectPath, "package.json")
	data, err := os.ReadFile(pkgPath)
	if err != nil {
		return ""
	}
	var pkg struct {
		Dependencies    map[string]string `json:"dependencies"`
		DevDependencies map[string]string `json:"devDependencies"`
	}
	if err := json.Unmarshal(data, &pkg); err != nil {
		return ""
	}
	allDeps := make(map[string]bool)
	for dep := range pkg.Dependencies {
		allDeps[dep] = true
	}
	for dep := range pkg.DevDependencies {
		allDeps[dep] = true
	}
	if allDeps["next"] {
		return "next"
	}
	if allDeps["vite"] {
		return "vite"
	}
	if allDeps["nuxt"] || allDeps["@nuxt/kit"] {
		return "nuxt"
	}
	return ""
}

// waitForPort 轮询检查端口是否可连接，超时返回 false。
func waitForPort(port int, timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	addr := fmt.Sprintf("localhost:%d", port)
	for time.Now().Before(deadline) {
		conn, err := net.DialTimeout("tcp", addr, 500*time.Millisecond)
		if err == nil {
			conn.Close()
			return true
		}
		time.Sleep(300 * time.Millisecond)
	}
	return false
}

// Stop 停止指定项目的 dev server。
func (m *DevServerManager) Stop(projectPath string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	srv, ok := m.servers[projectPath]
	if !ok {
		return nil
	}
	if srv.cmd != nil && srv.cmd.Process != nil {
		_ = srv.cmd.Process.Kill()
	}
	delete(m.servers, projectPath)
	delete(m.portUsed, srv.port)
	log.Printf("[Preview] dev server stopped: path=%s port=%d", projectPath, srv.port)
	return nil
}

// GetPort 返回指定项目的 dev server 端口。
func (m *DevServerManager) GetPort(projectPath string) (int, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	srv, ok := m.servers[projectPath]
	if !ok {
		return 0, false
	}
	srv.lastAccess = time.Now()
	return srv.port, true
}

// Touch 更新指定项目的最后访问时间。
func (m *DevServerManager) Touch(projectPath string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if srv, ok := m.servers[projectPath]; ok {
		srv.lastAccess = time.Now()
	}
}

// cleanupLoop 定期清理超时的 dev server。
func (m *DevServerManager) cleanupLoop() {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for range ticker.C {
		m.mu.Lock()
		now := time.Now()
		for path, srv := range m.servers {
			if now.Sub(srv.lastAccess) > previewTimeoutMinutes*time.Minute {
				log.Printf("[Preview] timeout cleanup: path=%s port=%d idle=%v", path, srv.port, now.Sub(srv.lastAccess))
				if srv.cmd != nil && srv.cmd.Process != nil {
					_ = srv.cmd.Process.Kill()
				}
				delete(m.servers, path)
				delete(m.portUsed, srv.port)
			}
		}
		m.mu.Unlock()
	}
}

// ProxyHandler 返回反向代理 handler，将请求转发到指定端口的 dev server。
func (m *DevServerManager) ProxyHandler(port int) http.Handler {
	target := &url.URL{
		Scheme: "http",
		Host:   fmt.Sprintf("localhost:%d", port),
	}
	proxy := httputil.NewSingleHostReverseProxy(target)
	// 支持 WebSocket（Vite HMR 需要）。
	proxy.FlushInterval = -1
	return proxy
}

// IsNodeFrontendProject 检查目录是否为 Node 前端应用。
// 通过读取 package.json 中的依赖判断。
func IsNodeFrontendProject(projectPath string) bool {
	pkgPath := filepath.Join(projectPath, "package.json")
	data, err := os.ReadFile(pkgPath)
	if err != nil {
		return false
	}

	// 解析 package.json 中的依赖字段。
	var pkg struct {
		Dependencies    map[string]string `json:"dependencies"`
		DevDependencies map[string]string `json:"devDependencies"`
	}
	if err := json.Unmarshal(data, &pkg); err != nil {
		return false
	}

	// 检查是否包含常见前端框架依赖。
	frontendDeps := []string{
		"react", "vue", "next", "nuxt", "vite", "@angular/core",
		"svelte", "@sveltejs/kit", "solid-js", "preact", "astro",
		"@remix-run/react", "gatsby",
	}
	for dep := range pkg.Dependencies {
		if containsAny(dep, frontendDeps) {
			return true
		}
	}
	for dep := range pkg.DevDependencies {
		if containsAny(dep, frontendDeps) {
			return true
		}
	}
	return false
}

// containsAny 检查字符串是否匹配列表中的任意一项（精确匹配或前缀匹配）。
func containsAny(s string, list []string) bool {
	for _, item := range list {
		if s == item || strings.HasPrefix(s, item+"/") {
			return true
		}
	}
	return false
}
