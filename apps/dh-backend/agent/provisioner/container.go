package provisioner

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"sync"

	agent "github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/agent"
)

// 以下类型与变量从 go-sdk domain/agent 包重新导出，保持向后兼容。
// 实际定义位于 packages/go-sdk/domain/agent/pool.go，
// 各 provisioner 子包（directhost/k8s/selfdefined）直接引用 agent 包以避免循环依赖。
type (
	ContainerInfo = agent.ContainerInfo
	ContainerPool = agent.ContainerPool
	PoolStatus    = agent.PoolStatus
)

// ErrPoolExhausted 重新导出 agent.ErrPoolExhausted，保持向后兼容。
var ErrPoolExhausted = agent.ErrPoolExhausted

// --- context 集成 ---

type containerContextKey struct{}

// WithContainer 将容器信息注入 context。
func WithContainer(ctx context.Context, c *agent.ContainerInfo) context.Context {
	return context.WithValue(ctx, containerContextKey{}, c)
}

// ContainerFromContext 从 context 中取出容器信息。
func ContainerFromContext(ctx context.Context) *agent.ContainerInfo {
	c, _ := ctx.Value(containerContextKey{}).(*agent.ContainerInfo)
	return c
}

// --- HTTP middleware ---

// ContainerMiddleware 创建一个中间件，为每个已认证请求解析用户的容器。
// 若容器池耗尽，返回 503 + 友好提示。
func ContainerMiddleware(pool agent.ContainerPool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			userID := userIDFromRequest(r)
			if userID == "" {
				next.ServeHTTP(w, r)
				return
			}

			container, err := pool.Acquire(r.Context(), userID)
			if err != nil {
				if errors.Is(err, agent.ErrPoolExhausted) {
					writePoolExhaustedError(w)
					return
				}
				writePoolError(w, err)
				return
			}

			ctx := WithContainer(r.Context(), container)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// userIDFromRequest 从 auth 中间件注入的 context 中提取 userID。
func userIDFromRequest(r *http.Request) string {
	return middlewareUserID(r.Context())
}

// poolExhaustedMsg 资源不足时的用户友好提示。
const poolExhaustedMsg = "当前服务器资源紧缺，请联系管理员"

// writePoolExhaustedError 返回 503 + 资源不足提示。
func writePoolExhaustedError(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusServiceUnavailable)
	_, _ = w.Write([]byte(fmt.Sprintf(`{"code":%d,"message":"%s"}`, http.StatusServiceUnavailable, poolExhaustedMsg)))
}

// writePoolError 返回 500 + 内部错误。
func writePoolError(w http.ResponseWriter, err error) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusInternalServerError)
	_, _ = w.Write([]byte(fmt.Sprintf(`{"code":%d,"message":"container pool error: %s"}`, http.StatusInternalServerError, err.Error())))
}

// middlewareUserID 从 context 中提取 auth 中间件注入的 userID。
// 通过反射引用 middleware 包的 context key，避免循环依赖。
var middlewareUserIDFunc func(context.Context) string
var middlewareUserIDOnce sync.Once

func middlewareUserID(ctx context.Context) string {
	middlewareUserIDOnce.Do(func() {
		// 在 server.go 初始化阶段通过 SetMiddlewareUserIDFunc 注入
	})
	if middlewareUserIDFunc != nil {
		return middlewareUserIDFunc(ctx)
	}
	return ""
}

// SetMiddlewareUserIDFunc 注入 auth 中间件的 userID 提取函数。
// 在 server.go 初始化阶段调用，避免 provisioner -> middleware 循环依赖。
func SetMiddlewareUserIDFunc(f func(context.Context) string) {
	middlewareUserIDFunc = f
}
