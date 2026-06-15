package handler

import (
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
)

// ServiceProxy 封装反向代理逻辑
type ServiceProxy struct {
	proxy  *httputil.ReverseProxy
	prefix string
}

// NewServiceProxy 创建反向代理
// targetURL: 目标服务地址，如 http://localhost:8081
// gatewayPrefix: Gateway 上的路径前缀，如 /api/v1/identity
// backendPrefix: 后端服务上的路径前缀，如 /api/v1；为空表示不做替换
func NewServiceProxy(targetURL, gatewayPrefix, backendPrefix string) *ServiceProxy {
	target, err := url.Parse(targetURL)
	if err != nil {
		log.Fatalf("Invalid proxy target URL %s: %v", targetURL, err)
	}
	proxy := httputil.NewSingleHostReverseProxy(target)
	originalDirector := proxy.Director
	proxy.Director = func(req *http.Request) {
		originalDirector(req)
		if gatewayPrefix != "" && backendPrefix != "" {
			req.URL.Path = strings.Replace(req.URL.Path, gatewayPrefix, backendPrefix, 1)
			if req.URL.Path == "" {
				req.URL.Path = "/"
			}
		}
		// 去除尾部斜杠，避免后端 404
		req.URL.Path = strings.TrimSuffix(req.URL.Path, "/")
		if req.URL.Path == "" {
			req.URL.Path = "/"
		}
		req.Host = target.Host
	}
	return &ServiceProxy{proxy: proxy, prefix: gatewayPrefix}
}

func (p *ServiceProxy) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	p.proxy.ServeHTTP(w, r)
}
