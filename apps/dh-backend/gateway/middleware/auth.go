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

// extractBearerToken 从 Authorization 头中提取 Bearer token。
func extractBearerToken(r *http.Request) (string, bool) {
	auth := r.Header.Get("Authorization")
	if auth == "" {
		return "", false
	}
	const bearerPrefix = "Bearer "
	if !strings.HasPrefix(auth, bearerPrefix) {
		return "", false
	}
	return strings.TrimSpace(strings.TrimPrefix(auth, bearerPrefix)), true
}

// UserIDFromContext 从请求上下文中取出 auth 中间件注入的用户 ID。
func UserIDFromContext(ctx context.Context) (string, bool) {
	v, ok := ctx.Value(authContextKey{}).(string)
	return v, ok
}

func writeUnauthorized(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusUnauthorized)
	w.Write([]byte(`{"code":2,"message":"unauthorized"}`))
}
