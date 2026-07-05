package handler

import (
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
)

// StubProxy 是将文件/工程/预览请求反向代理到 agent-stub 的处理器。
// agent-stub 部署在 WORKSPACE_ROOT 所在服务器上，直接操作文件系统和 git。
type StubProxy struct {
	proxy *httputil.ReverseProxy
}

// NewStubProxy 创建指向 agent-stub 的反向代理。
func NewStubProxy(stubURL string) *StubProxy {
	target, err := url.Parse(stubURL)
	if err != nil {
		log.Fatalf("[StubProxy] invalid agent_stub url: %v", err)
	}

	proxy := httputil.NewSingleHostReverseProxy(target)
	// 支持 WebSocket（Vite HMR 等场景需要）。
	proxy.FlushInterval = -1

	log.Printf("[StubProxy] proxying to agent-stub at %s", stubURL)

	return &StubProxy{proxy: proxy}
}

// ServeHTTP 实现 http.Handler，将请求透传到 agent-stub。
func (sp *StubProxy) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	sp.proxy.ServeHTTP(w, r)
}

// IsStubRoute 判断请求路径是否需要代理到 agent-stub。
// 包括：文件操作、工程管理、项目预览。
func IsStubRoute(path string) bool {
	return strings.HasPrefix(path, "/api/v1/files/") ||
		strings.HasPrefix(path, "/api/v1/projects/") ||
		strings.HasPrefix(path, "/api/v1/preview/")
}
