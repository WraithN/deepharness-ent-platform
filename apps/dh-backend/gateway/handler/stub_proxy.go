package handler

import (
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/provisioner"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/stubclient"
)

// StubProxy 是将文件/工程/预览请求反向代理到 personal-stub 的处理器。
// 支持按用户路由：若 context 中有 ContainerInfo，代理到用户容器的 personal-stub；
// 否则降级到全局默认地址。
type StubProxy struct {
	defaultProxy *httputil.ReverseProxy
	defaultURL   string
}

// NewStubProxy 创建指向 personal-stub 的反向代理。
// stubURL 为全局默认地址（降级使用）。
func NewStubProxy(stubURL string) *StubProxy {
	target, err := url.Parse(stubURL)
	if err != nil {
		log.Fatalf("[StubProxy] invalid personal_stub url: %v", err)
	}

	proxy := httputil.NewSingleHostReverseProxy(target)
	proxy.FlushInterval = -1

	log.Printf("[StubProxy] default personal-stub at %s", stubURL)

	return &StubProxy{
		defaultProxy: proxy,
		defaultURL:   stubURL,
	}
}

// ServeHTTP 实现 http.Handler。
// 优先使用 context 中用户容器的 personal-stub 地址，降级到全局默认。
func (sp *StubProxy) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	container := provisioner.ContainerFromContext(r.Context())
	if container != nil {
		stubURL := container.PersonalStubURL()
		// 同时注入 stubclient 到 context，供下游 service 层使用
		r = r.WithContext(stubclient.WithClient(r.Context(), stubclient.New(stubURL)))

		target, err := url.Parse(stubURL)
		if err != nil {
			log.Printf("[StubProxy] invalid container stub url %s: %v", stubURL, err)
			sp.defaultProxy.ServeHTTP(w, r)
			return
		}
		perUserProxy := httputil.NewSingleHostReverseProxy(target)
		perUserProxy.FlushInterval = -1
		perUserProxy.ServeHTTP(w, r)
		return
	}

	// 降级：使用全局默认 proxy
	sp.defaultProxy.ServeHTTP(w, r)
}

// IsStubRoute 判断请求路径是否需要代理到 personal-stub。
func IsStubRoute(path string) bool {
	return strings.HasPrefix(path, "/api/v1/files/") ||
		strings.HasPrefix(path, "/api/v1/projects/") ||
		strings.HasPrefix(path, "/api/v1/preview/")
}
