package service

import (
	"time"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/audit/object"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/audit"
)

// EventService 定义 audit 模块的服务接口。
type EventService interface {
	ListEvents() ([]object.Event, error)
}

// MockEventService 是 EventService 的内存 mock 实现。
type MockEventService struct{}

func NewMockEventService() *MockEventService {
	return &MockEventService{}
}

func (s *MockEventService) ListEvents() ([]object.Event, error) {
	return []audit.Event{
		{ID: "evt-001", TenantID: "t1", UserID: "u1", Action: "login", Resource: "user", Details: map[string]any{"ip": "192.168.1.100", "device": "Chrome/macOS"}, CreatedAt: time.Date(2026, 6, 10, 8, 30, 0, 0, time.UTC)},
		{ID: "evt-002", TenantID: "t1", UserID: "u2", Action: "create_workitem", Resource: "requirement", Details: map[string]any{"workitemId": "REQ-005", "title": "API 网关限流配置"}, CreatedAt: time.Date(2026, 6, 9, 14, 20, 0, 0, time.UTC)},
		{ID: "evt-003", TenantID: "t1", UserID: "u1", Action: "update_workitem", Resource: "defect", Details: map[string]any{"workitemId": "BUG-002", "field": "status", "oldValue": "open", "newValue": "in_progress"}, CreatedAt: time.Date(2026, 6, 9, 10, 15, 0, 0, time.UTC)},
		{ID: "evt-004", TenantID: "t1", UserID: "u4", Action: "run_testcase", Resource: "testcase", Details: map[string]any{"workitemId": "TC-003", "result": "failed"}, CreatedAt: time.Date(2026, 6, 8, 16, 45, 0, 0, time.UTC)},
		{ID: "evt-005", TenantID: "t1", UserID: "u3", Action: "create_skill", Resource: "skill", Details: map[string]any{"skillId": "s9", "name": "前端性能优化助手"}, CreatedAt: time.Date(2026, 6, 7, 9, 0, 0, 0, time.UTC)},
	}, nil
}
