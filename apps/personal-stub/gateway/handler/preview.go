package handler

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
)

// 全局 dev server 管理器实例。
var devServerMgr = NewDevServerManager()

// previewStartRequest 启动预览请求体。
type previewStartRequest struct {
	Path string `json:"path"`
}

// previewStartResponse 启动预览响应。
type previewStartResponse struct {
	Port       int  `json:"port"`
	IsFrontend bool `json:"isFrontend"`
}

// PreviewStart 处理 POST /api/v1/preview/start。
// 检测项目类型，若为 Node 前端应用则启动 dev server。
func PreviewStart(w http.ResponseWriter, r *http.Request) {
	var req previewStartRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if req.Path == "" {
		http.Error(w, "path is required", http.StatusBadRequest)
		return
	}

	// 将项目路径加入允许访问的根目录，使文件树和文件内容 API 能正常工作。
	// 必须在 dev server 启动之前调用，确保即使 dev server 启动失败，
	// 代码模式的文件浏览功能仍可正常使用。
	AddAllowedRoot(req.Path)

	// monorepo 工程的前端可能在子目录（如 apps/web），dev server 必须在前端
	// 目录中启动；servers 表也以该目录为键，Stop/Status 需做同样的换算。
	frontendDir, isFrontend := FindFrontendDir(req.Path)
	resp := previewStartResponse{
		IsFrontend: isFrontend,
	}

	if isFrontend {
		port, err := devServerMgr.Start(frontendDir)
		if err != nil {
			log.Printf("[Preview] start failed: path=%s frontendDir=%s err=%v", req.Path, frontendDir, err)
			http.Error(w, fmt.Sprintf("failed to start dev server: %v", err), http.StatusInternalServerError)
			return
		}
		resp.Port = port
	}

	SetJSONHeader(w)
	json.NewEncoder(w).Encode(resp)
}

// resolveServerKey 将请求中的工程根目录换算为 dev server 的实际启动目录
//（monorepo 时为前端子目录），与 PreviewStart 中的键保持一致。
func resolveServerKey(path string) string {
	if dir, ok := FindFrontendDir(path); ok {
		return dir
	}
	return path
}

// PreviewStop 处理 POST /api/v1/preview/stop。
func PreviewStop(w http.ResponseWriter, r *http.Request) {
	var req previewStartRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	devServerMgr.Stop(resolveServerKey(req.Path))
	w.WriteHeader(http.StatusNoContent)
}

// PreviewStatus 处理 GET /api/v1/preview/status?path=...。
func PreviewStatus(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Query().Get("path")
	port, running := devServerMgr.GetPort(resolveServerKey(path))
	resp := map[string]any{
		"running": running,
		"port":    port,
	}
	SetJSONHeader(w)
	json.NewEncoder(w).Encode(resp)
}

// PreviewErrors 处理 GET /api/v1/preview/errors?path=...。
// 分析 dev server 进程输出，返回当前是否处于报错状态及错误摘要，
// 供前端轮询并在报错时展示"修复"入口。server 未运行时 hasError 恒为 false。
func PreviewErrors(w http.ResponseWriter, r *http.Request) {
	key := resolveServerKey(r.URL.Query().Get("path"))
	_, running := devServerMgr.GetPort(key)
	hasError, excerpt := false, ""
	if running {
		hasError, excerpt = devServerMgr.AnalyzeOutput(key)
	}
	resp := map[string]any{
		"running":  running,
		"hasError": hasError,
		"excerpt":  excerpt,
	}
	SetJSONHeader(w)
	json.NewEncoder(w).Encode(resp)
}

// PreviewProxy 处理 GET /api/v1/preview/proxy/{port}/{path...}。
// 将请求反向代理到指定端口的 dev server。
func PreviewProxy(w http.ResponseWriter, r *http.Request) {
	// 解析路径：/api/v1/preview/proxy/{port}/{rest...}
	parts := strings.SplitN(r.URL.Path, "/preview/proxy/", 2)
	if len(parts) < 2 {
		http.Error(w, "invalid proxy path", http.StatusBadRequest)
		return
	}
	rest := parts[1]
	slashIdx := strings.Index(rest, "/")
	if slashIdx == -1 {
		http.Error(w, "missing port", http.StatusBadRequest)
		return
	}
	portStr := rest[:slashIdx]
	port, err := strconv.Atoi(portStr)
	if err != nil {
		http.Error(w, "invalid port", http.StatusBadRequest)
		return
	}

	// 重写 URL 路径为 dev server 上的原始路径。
	r.URL.Path = rest[slashIdx:]
	if r.URL.Path == "" || r.URL.Path == "/" {
		r.URL.Path = "/"
	}

	proxy := devServerMgr.ProxyHandler(port)
	proxy.ServeHTTP(w, r)
}
