package provisioner

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"sync"
)

// ContainerInfo 描述一个已分配给用户的容器，包含 gatewayd 和 personal-stub 的地址。
// 两个服务在同一容器内，共享同一 Host，仅端口不同。
type ContainerInfo struct {
	Host       string // 容器 IP 或主机名
	AgentPort  int    // gatewayd agent API 端口（默认 2345）
	AdminPort  int    // gatewayd admin API 端口（默认 2346）
	StubPort   int    // personal-stub 端口（默认 8090）
	UserID     string // 已绑定用户 ID，空表示在池中待分配
}

// GatewaydAdminURL 返回 gatewayd admin API 地址。
func (c ContainerInfo) GatewaydAdminURL() string {
	port := c.AdminPort
	if port == 0 {
		port = defaultAdminPort
	}
	return fmt.Sprintf("http://%s:%d", c.Host, port)
}

// GatewaydAgentURL 返回 gatewayd agent API 地址。
func (c ContainerInfo) GatewaydAgentURL() string {
	port := c.AgentPort
	if port == 0 {
		port = defaultAgentPort
	}
	return fmt.Sprintf("http://%s:%d", c.Host, port)
}

// PersonalStubURL 返回 personal-stub 地址。
func (c ContainerInfo) PersonalStubURL() string {
	port := c.StubPort
	if port == 0 {
		port = defaultStubPort
	}
	return fmt.Sprintf("http://%s:%d", c.Host, port)
}

// 默认端口常量。
const (
	defaultAgentPort = 2345
	defaultAdminPort = 2346
	defaultStubPort  = 8090
)

// ErrPoolExhausted 容器池已耗尽且达到最大容器数，无法分配新容器。
var ErrPoolExhausted = errors.New("container pool exhausted: max containers reached")

// ContainerPool 管理容器的分配与释放。
// 每个容器包含 gatewayd 和 personal-stub 两个服务。
type ContainerPool interface {
	// Acquire 为用户分配容器。若用户已有容器则直接返回；
	// 否则从暖池取一个；暖池为空且未超 max 则创建；超 max 返回 ErrPoolExhausted。
	Acquire(ctx context.Context, userID string) (*ContainerInfo, error)

	// GetByUser 查找用户已分配的容器（不分配新容器）。
	GetByUser(ctx context.Context, userID string) (*ContainerInfo, error)

	// Release 释放用户的容器回池中。
	Release(ctx context.Context, userID string) error

	// Status 返回池状态摘要。
	Status(ctx context.Context) (PoolStatus, error)
}

// PoolStatus 容器池状态。
type PoolStatus struct {
	Available int `json:"available"` // 池中可用容器数
	Assigned  int `json:"assigned"`  // 已分配容器数
	Total     int `json:"total"`     // 总容器数
	Max       int `json:"max"`       // 最大容器数
	Min       int `json:"min"`       // 最小容器数
}

// --- context 集成 ---

type containerContextKey struct{}

// WithContainer 将容器信息注入 context。
func WithContainer(ctx context.Context, c *ContainerInfo) context.Context {
	return context.WithValue(ctx, containerContextKey{}, c)
}

// ContainerFromContext 从 context 中取出容器信息。
func ContainerFromContext(ctx context.Context) *ContainerInfo {
	c, _ := ctx.Value(containerContextKey{}).(*ContainerInfo)
	return c
}

// --- HTTP middleware ---

// ContainerMiddleware 创建一个中间件，为每个已认证请求解析用户的容器。
// 若容器池耗尽，返回 503 + 友好提示。
func ContainerMiddleware(pool ContainerPool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			userID := userIDFromRequest(r)
			if userID == "" {
				next.ServeHTTP(w, r)
				return
			}

			container, err := pool.Acquire(r.Context(), userID)
			if err != nil {
				if errors.Is(err, ErrPoolExhausted) {
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
	// 复用 middleware.Auth 的 context key
	// 通过 r.Context() 获取
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
