package agent

import (
	"context"
	"errors"
	"fmt"
)

// 容器默认端口常量。
const (
	DefaultAgentPort = 2345
	DefaultAdminPort = 2346
	DefaultStubPort  = 8090
)

// ContainerInfo 描述一个已分配给用户的容器，包含 gatewayd 和 personal-stub 的地址。
// 两个服务在同一容器内，共享同一 Host，仅端口不同。
type ContainerInfo struct {
	Host      string // 容器 IP 或主机名
	AgentPort int    // gatewayd agent API 端口（默认 2345）
	AdminPort int    // gatewayd admin API 端口（默认 2346）
	StubPort  int    // personal-stub 端口（默认 8090）
	UserID    string // 已绑定用户 ID，空表示在池中待分配
}

// GatewaydAdminURL 返回 gatewayd admin API 地址。
func (c ContainerInfo) GatewaydAdminURL() string {
	port := c.AdminPort
	if port == 0 {
		port = DefaultAdminPort
	}
	return fmt.Sprintf("http://%s:%d", c.Host, port)
}

// GatewaydAgentURL 返回 gatewayd agent API 地址。
func (c ContainerInfo) GatewaydAgentURL() string {
	port := c.AgentPort
	if port == 0 {
		port = DefaultAgentPort
	}
	return fmt.Sprintf("http://%s:%d", c.Host, port)
}

// PersonalStubURL 返回 personal-stub 地址。
func (c ContainerInfo) PersonalStubURL() string {
	port := c.StubPort
	if port == 0 {
		port = DefaultStubPort
	}
	return fmt.Sprintf("http://%s:%d", c.Host, port)
}

// ErrPoolExhausted 容器池已耗尽且达到最大容器数，无法分配新容器。
var ErrPoolExhausted = errors.New("container pool exhausted: max containers reached")

// PoolStatus 容器池状态。
type PoolStatus struct {
	Available int `json:"available"` // 池中可用容器数
	Assigned  int `json:"assigned"`  // 已分配容器数
	Total     int `json:"total"`     // 总容器数
	Max       int `json:"max"`       // 最大容器数
	Min       int `json:"min"`       // 最小容器数
}

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
