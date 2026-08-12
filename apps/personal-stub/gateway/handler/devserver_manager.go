package handler

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

const (
	previewPortStart      = 4000
	previewPortEnd        = 4100
	previewTimeoutMinutes = 30
	previewStartTimeout   = 30 * time.Second
	// previewOutputBufferBytes 是每个 dev server 进程输出采集缓冲的容量上限
	//（超出后丢弃最旧内容，保留尾部用于报错分析）。
	previewOutputBufferBytes = 64 * 1024
	// previewErrorExcerptBytes 是报错摘要的最大长度（超出截断并标注）。
	previewErrorExcerptBytes = 3 * 1024
)

// previewErrorPatterns 是 dev server 终端输出中的报错特征（Next/Vite 等框架通用）。
var previewErrorPatterns = []string{
	"Failed to compile", "Build Error", "Module not found",
	"Failed to resolve", "Type error", "⨯", "Error:",
}

// previewSuccessPatterns 是编译/启动成功特征；成功输出晚于报错时视为已恢复。
var previewSuccessPatterns = []string{
	"✓ Compiled", "compiled successfully", "✓ Ready", "ready in",
}

// devServer 记录单个 dev server 的运行状态。
type devServer struct {
	cmd        *exec.Cmd
	port       int
	projectPath string
	startedAt  time.Time
	lastAccess time.Time
	// output 持续采集进程 stdout/stderr 的有界缓冲，供报错分析端点使用。
	output     *serverOutput
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

	// 如果 node_modules 不存在，先安装依赖，否则 npm run dev 会找不到框架 CLI。
	nodeModulesPath := filepath.Join(projectPath, "node_modules")
	if _, err := os.Stat(nodeModulesPath); os.IsNotExist(err) {
		log.Printf("[Preview] node_modules not found, installing dependencies for %s", projectPath)
		if err := installDependencies(projectPath); err != nil {
			delete(m.portUsed, port)
			return 0, fmt.Errorf("dependency installation failed: %w", err)
		}
	}

	// 根据框架类型构建启动参数。
	args := buildDevServerArgs(projectPath, port)
	cmd := exec.Command("npm", args...)
	cmd.Dir = projectPath
	// 设置环境变量，确保 dev server 不打开浏览器。
	cmd.Env = append(os.Environ(), "BROWSER=none")
	// 持续采集 stdout/stderr 到有界缓冲，供 /preview/errors 报错分析；
	// stderr 同时保留给启动失败诊断。
	output := newServerOutput(previewOutputBufferBytes)
	var stderr strings.Builder
	cmd.Stdout = output
	cmd.Stderr = io.MultiWriter(&stderr, output)
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
		output:      output,
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

// packageManager 根据锁文件判断项目使用的包管理器。
// 默认返回 npm；存在 pnpm-lock.yaml 返回 pnpm，存在 yarn.lock 返回 yarn。
func packageManager(projectPath string) string {
	if _, err := os.Stat(filepath.Join(projectPath, "pnpm-lock.yaml")); err == nil {
		return "pnpm"
	}
	if _, err := os.Stat(filepath.Join(projectPath, "yarn.lock")); err == nil {
		return "yarn"
	}
	return "npm"
}

// installDependencies 为项目安装依赖。
// 使用项目对应的包管理器执行 install，确保 dev server 启动时 CLI 可用。
func installDependencies(projectPath string) error {
	pm := packageManager(projectPath)
	var args []string
	switch pm {
	case "pnpm":
		args = []string{"install"}
	case "yarn":
		args = []string{"install"}
	default:
		args = []string{"install"}
	}

	cmd := exec.Command(pm, args...)
	cmd.Dir = projectPath
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("%s install failed: %w (output: %s)", pm, err, string(out))
	}
	return nil
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

// frontendDeps 是常见前端框架依赖名，用于判定 Node 前端工程。
var frontendDeps = []string{
	"react", "vue", "next", "nuxt", "vite", "@angular/core",
	"svelte", "@sveltejs/kit", "solid-js", "preact", "astro",
	"@remix-run/react", "gatsby",
}

// monorepoSubdirParents 是 monorepo 中前端子工程常见的父目录名（下钻一层扫描）。
var monorepoSubdirParents = []string{"apps", "packages"}

// monorepoDirectSubdirs 是前端子工程常见的直接子目录名。
var monorepoDirectSubdirs = []string{"web", "frontend", "client"}

// IsNodeFrontendProject 检查目录是否为（或包含）Node 前端应用。
// 通过读取 package.json 中的依赖判断；支持 monorepo（下钻一层子目录）。
func IsNodeFrontendProject(projectPath string) bool {
	_, ok := FindFrontendDir(projectPath)
	return ok
}

// FindFrontendDir 定位工程内的前端目录：根 package.json 含前端依赖时返回根目录；
// 否则按常见 monorepo 布局（apps/*、packages/*、web/、frontend/、client/）下钻一层，
// 返回第一个含前端依赖的子目录；均未命中返回 ("", false)。
// dev server 预览必须在返回的目录中启动（monorepo 根目录通常没有可运行的 dev 脚本）。
func FindFrontendDir(projectPath string) (string, bool) {
	if hasFrontendDeps(filepath.Join(projectPath, "package.json")) {
		return projectPath, true
	}
	for _, sub := range monorepoCandidates(projectPath) {
		if hasFrontendDeps(filepath.Join(sub, "package.json")) {
			return sub, true
		}
	}
	return "", false
}

// monorepoCandidates 按确定性顺序列出候选前端子目录（仅返回实际存在的目录）。
// os.ReadDir 返回条目按文件名排序，保证多次调用结果一致。
func monorepoCandidates(projectPath string) []string {
	var candidates []string
	for _, parent := range monorepoSubdirParents {
		entries, err := os.ReadDir(filepath.Join(projectPath, parent))
		if err != nil {
			continue
		}
		for _, entry := range entries {
			if entry.IsDir() {
				candidates = append(candidates, filepath.Join(projectPath, parent, entry.Name()))
			}
		}
	}
	for _, name := range monorepoDirectSubdirs {
		dir := filepath.Join(projectPath, name)
		if info, err := os.Stat(dir); err == nil && info.IsDir() {
			candidates = append(candidates, dir)
		}
	}
	return candidates
}

// hasFrontendDeps 判断指定 package.json 是否声明了前端框架依赖。
func hasFrontendDeps(pkgPath string) bool {
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

// serverOutput 是线程安全的有界输出缓冲：持续追加进程输出（ANSI 控制序列已剥离），
// 超出容量时丢弃最旧内容（可能从行中间截断，对报错扫描无影响）。
type serverOutput struct {
	mu    sync.Mutex
	buf   []byte
	limit int
}

// ansiEscapePattern 匹配终端颜色/样式控制序列。Next 等框架即使输出被管道化仍
// 默认带颜色，剥离后摘要才可读（注入会话或前端展示时不夹杂乱码）。
var ansiEscapePattern = regexp.MustCompile("\x1b\\[[0-9;?]*[a-zA-Z]")

func newServerOutput(limit int) *serverOutput {
	return &serverOutput{limit: limit}
}

func (o *serverOutput) Write(p []byte) (int, error) {
	o.mu.Lock()
	defer o.mu.Unlock()
	o.buf = append(o.buf, ansiEscapePattern.ReplaceAll(p, nil)...)
	if len(o.buf) > o.limit {
		o.buf = o.buf[len(o.buf)-o.limit:]
	}
	return len(p), nil
}

// Snapshot 返回当前缓冲内容（可能不是完整输出的全部，仅尾部窗口）。
func (o *serverOutput) Snapshot() string {
	o.mu.Lock()
	defer o.mu.Unlock()
	return string(o.buf)
}

// AnalyzeOutput 分析指定项目 dev server 的最近输出，返回是否处于报错状态及错误摘要。
// 项目未运行或无输出缓冲时返回 (false, "")。
func (m *DevServerManager) AnalyzeOutput(projectPath string) (bool, string) {
	m.mu.Lock()
	srv, ok := m.servers[projectPath]
	m.mu.Unlock()
	if !ok || srv.output == nil {
		return false, ""
	}
	return analyzePreviewOutput(srv.output.Snapshot())
}

// analyzePreviewOutput 扫描 dev server 输出，判断最近状态是否为报错。
// 规则：最后一个报错特征的位置晚于最后一个成功特征（或成功从未出现）→ 视为报错中；
// excerpt 取自最后一个报错特征所在行的行首，上限 previewErrorExcerptBytes。
// 已知限制：仅覆盖 dev server 终端可见的构建/运行报错（不含浏览器 console 错误）；
// 瞬时报错会保留到下一次成功编译输出才清除。
func analyzePreviewOutput(output string) (bool, string) {
	lastErr := lastIndexOfAny(output, previewErrorPatterns)
	lastOK := lastIndexOfAny(output, previewSuccessPatterns)
	if lastErr == -1 || lastOK > lastErr {
		return false, ""
	}
	// 从最后一个报错特征所在行的行首开始截取（无换行时 LastIndex 返回 -1，+1 后为 0）。
	lineStart := strings.LastIndex(output[:lastErr], "\n") + 1
	excerpt := strings.TrimSpace(output[lineStart:])
	if len(excerpt) > previewErrorExcerptBytes {
		excerpt = excerpt[:previewErrorExcerptBytes] + "\n...（摘要过长已截断）"
	}
	return true, excerpt
}

// lastIndexOfAny 返回任一模式在 s 中最后出现的位置（取各模式中的最大值），均未命中返回 -1。
func lastIndexOfAny(s string, patterns []string) int {
	last := -1
	for _, pat := range patterns {
		if idx := strings.LastIndex(s, pat); idx > last {
			last = idx
		}
	}
	return last
}
