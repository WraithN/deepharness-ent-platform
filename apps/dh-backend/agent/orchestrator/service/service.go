package service

import (
	"time"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/orchestrator/object"
)

// SessionService 定义 Agent 编排模块的服务接口。
type SessionService interface {
	ListSessions() ([]object.AgentSession, error)
}

// MockSessionService 是 SessionService 的内存 mock 实现。
type MockSessionService struct{}

func NewMockSessionService() *MockSessionService {
	return &MockSessionService{}
}

func (s *MockSessionService) ListSessions() ([]object.AgentSession, error) {
	return []object.AgentSession{
		{ID: "sess-001", Title: "实现登录页面UI", AgentType: "ui-designer", Model: "gpt-4o", Status: "completed", CreatedAt: time.Date(2026, 6, 10, 9, 0, 0, 0, time.UTC), UpdatedAt: time.Date(2026, 6, 10, 9, 15, 0, 0, time.UTC)},
		{ID: "sess-002", Title: "用户管理模块需求分析", AgentType: "requirement-analyst", Model: "gpt-4o", Status: "completed", CreatedAt: time.Date(2026, 6, 9, 14, 0, 0, 0, time.UTC), UpdatedAt: time.Date(2026, 6, 9, 14, 30, 0, 0, time.UTC)},
		{ID: "sess-003", Title: "修复API跨域问题", AgentType: "code-assistant", Model: "gpt-4o", Status: "completed", CreatedAt: time.Date(2026, 6, 8, 10, 0, 0, 0, time.UTC), UpdatedAt: time.Date(2026, 6, 8, 10, 20, 0, 0, time.UTC)},
		{ID: "sess-004", Title: "重构数据库表结构", AgentType: "code-assistant", Model: "claude-3-5-sonnet", Status: "completed", CreatedAt: time.Date(2026, 6, 7, 16, 0, 0, 0, time.UTC), UpdatedAt: time.Date(2026, 6, 7, 16, 45, 0, 0, time.UTC)},
		{ID: "sess-005", Title: "订单模块接口设计", AgentType: "api-designer", Model: "gpt-4o", Status: "active", CreatedAt: time.Date(2026, 6, 6, 9, 0, 0, 0, time.UTC), UpdatedAt: time.Date(2026, 6, 10, 8, 0, 0, 0, time.UTC)},
	}, nil
}
