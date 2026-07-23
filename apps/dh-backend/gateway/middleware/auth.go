package middleware

import (
	"context"
	"net/http"
	"strings"
)

// authContextKey 是用户 ID 在 context 中的键类型，避免键冲突。
type authContextKey struct{}

// userIDLenLimit 限制 Authorization 中携带的用户 ID 最大长度，防止滥用。
const userIDLenLimit = 64

// Auth 解析 Authorization: Bearer <userId> 头，将 userID 注入请求上下文。
// 当前为开发期实现：token 即用户 ID，生产环境应替换为 JWT 校验。
// 未携带有效凭证时返回 401。
func Auth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token, ok := extractBearerToken(r)
		if !ok {
			writeUnauthorized(w)
			return
		}
		if len(token) == 0 || len(token) > userIDLenLimit {
			writeUnauthorized(w)
			return
		}
		ctx := context.WithValue(r.Context(), authContextKey{}, token)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// authCookieName 是鉴权 cookie 的名称，供 iframe 等无法设置 Authorization 头的请求使用。
const authCookieName = "dh_auth"

// extractBearerToken 从 Authorization 头中提取 Bearer token。
// iframe / <img> 等浏览器原生请求无法设置 Authorization 头，
// 依次回退到 ?auth= query 参数和 dh_auth cookie，使静态资源端点（如原型预览）也能通过鉴权。
func extractBearerToken(r *http.Request) (string, bool) {
	auth := r.Header.Get("Authorization")
	if auth != "" {
		const bearerPrefix = "Bearer "
		if strings.HasPrefix(auth, bearerPrefix) {
			return strings.TrimSpace(strings.TrimPrefix(auth, bearerPrefix)), true
		}
	}
	if q := r.URL.Query().Get("auth"); q != "" {
		return q, true
	}
	if c, err := r.Cookie(authCookieName); err == nil && c.Value != "" {
		return c.Value, true
	}
	return "", false
}

// UserIDFromContext 从请求上下文中取出 auth 中间件注入的用户 ID。
func UserIDFromContext(ctx context.Context) (string, bool) {
	v, ok := ctx.Value(authContextKey{}).(string)
	return v, ok
}

// BearerAuth 返回一个校验固定 Bearer Token 的中间件，供外部系统（如 gatewayd / personal-stub）上报状态使用。
// token 为空时所有请求都会被拒绝，避免未配置时意外开放接口。
func BearerAuth(token string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			bearer, ok := extractBearerToken(r)
			if !ok || bearer != token || token == "" {
				writeUnauthorized(w)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func writeUnauthorized(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusUnauthorized)
	w.Write([]byte(`{"code":2,"message":"unauthorized"}`))
}
