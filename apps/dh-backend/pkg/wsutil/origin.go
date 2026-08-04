package wsutil

import (
	"net/http"
	"net/url"
)

// SameHostnameCheckOrigin 返回一个 websocket.CheckOrigin 函数：
//   - 无 Origin 头时放行（兼容非浏览器客户端）；
//   - 仅当 Origin 的主机名与请求 Host 的主机名一致时允许连接。
// 该策略比“允许任意 Origin”更安全，同时在开发环境（前后端不同端口）仍可工作。
func SameHostnameCheckOrigin() func(r *http.Request) bool {
	return func(r *http.Request) bool {
		origin := r.Header.Get("Origin")
		if origin == "" {
			return true
		}
		u, err := url.Parse(origin)
		if err != nil {
			return false
		}
		host := r.Host
		if host == "" {
			host = r.URL.Host
		}
		return u.Hostname() == hostnameOf(host)
	}
}

func hostnameOf(host string) string {
	// Host 可能包含端口，使用 url.Parse 提取主机名。
	if host == "" {
		return ""
	}
	u, err := url.Parse("http://" + host)
	if err != nil {
		return host
	}
	return u.Hostname()
}
