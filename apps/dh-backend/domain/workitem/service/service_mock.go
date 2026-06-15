package service

import (
	"errors"
	"sync"
	"time"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/workitem/object"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/workitem"
)

// MockWorkItemService 是 WorkItemService 的内存 mock 实现，
// 用于无数据库时返回工作项数据。
type MockWorkItemService struct {
	mu    sync.RWMutex
	items []object.WorkItem
}

// NewMockWorkItemService 创建一个预置了示例数据的 MockWorkItemService。
func NewMockWorkItemService() *MockWorkItemService {
	return &MockWorkItemService{
		items: []object.WorkItem{
			{ID: "REQ-001", TenantID: "t1", ProjectID: "p1", Type: workitem.TypeRequirement, Title: "实现多租户登录功能", Description: "支持不同租户间的数据隔离和单点登录，需要实现OAuth2.0协议和JWT Token验证机制。", Status: workitem.StatusDone, Priority: workitem.PriorityHigh, AssigneeID: "u1", Reporter: "产品小红", Source: workitem.SourceInternal, ExternalID: "MEEGO-101", CreatedAt: time.Date(2026, 5, 20, 0, 0, 0, 0, time.UTC), UpdatedAt: time.Date(2026, 5, 25, 0, 0, 0, 0, time.UTC)},
			{ID: "REQ-002", TenantID: "t1", ProjectID: "p1", Type: workitem.TypeRequirement, Title: "数据大盘图表展示", Description: "集成ECharts实现多维度数据可视化，支持折线图、柱状图、饼图等常见图表类型。", Status: workitem.StatusInProgress, Priority: workitem.PriorityHigh, AssigneeID: "u1", Reporter: "产品小红", Source: workitem.SourceInternal, ExternalID: "MEEGO-102", CreatedAt: time.Date(2026, 5, 22, 0, 0, 0, 0, time.UTC), UpdatedAt: time.Date(2026, 6, 5, 0, 0, 0, 0, time.UTC)},
			{ID: "REQ-003", TenantID: "t1", ProjectID: "p1", Type: workitem.TypeRequirement, Title: "UI设计对话助手", Description: "基于自然语言理解，自动生成UI组件建议和设计方案，支持多轮对话迭代。", Status: workitem.StatusTodo, Priority: workitem.PriorityMedium, AssigneeID: "u3", Reporter: "设计小李", Source: workitem.SourceInternal, ExternalID: "MEEGO-103", CreatedAt: time.Date(2026, 5, 25, 0, 0, 0, 0, time.UTC), UpdatedAt: time.Date(2026, 5, 25, 0, 0, 0, 0, time.UTC)},
			{ID: "REQ-004", TenantID: "t1", ProjectID: "p1", Type: workitem.TypeRequirement, Title: "智能评审结果展示", Description: "将代码评审结果以结构化方式展示，支持按严重程度和文件分组。", Status: workitem.StatusBacklog, Priority: workitem.PriorityMedium, AssigneeID: "u4", Reporter: "设计小李", Source: workitem.SourceInternal, ExternalID: "MEEGO-104", CreatedAt: time.Date(2026, 5, 27, 0, 0, 0, 0, time.UTC), UpdatedAt: time.Date(2026, 5, 27, 0, 0, 0, 0, time.UTC)},
			{ID: "REQ-005", TenantID: "t1", ProjectID: "p1", Type: workitem.TypeRequirement, Title: "API 网关限流配置", Description: "基于令牌桶算法实现API限流，支持按用户、IP、接口维度配置限流规则。", Status: workitem.StatusTodo, Priority: workitem.PriorityHigh, AssigneeID: "u1", Reporter: "产品小红", Source: workitem.SourceInternal, ExternalID: "MEEGO-105", CreatedAt: time.Date(2026, 5, 28, 0, 0, 0, 0, time.UTC), UpdatedAt: time.Date(2026, 5, 28, 0, 0, 0, 0, time.UTC)},
			{ID: "BUG-001", TenantID: "t1", ProjectID: "p1", Type: workitem.TypeDefect, Title: "登录页面验证码不刷新", Description: "点击验证码图片后，网络请求返回200但图片未更新，需要排查缓存策略。", Status: workitem.StatusOpen, Priority: workitem.PriorityHigh, AssigneeID: "u1", Reporter: "测试小刚", Source: workitem.SourceInternal, ExternalID: "MEEGO-201", CreatedAt: time.Date(2026, 5, 26, 0, 0, 0, 0, time.UTC), UpdatedAt: time.Date(2026, 5, 26, 0, 0, 0, 0, time.UTC)},
			{ID: "BUG-002", TenantID: "t1", ProjectID: "p1", Type: workitem.TypeDefect, Title: "数据大盘图表数据异常", Description: "当选择时间范围超过30天时，折线图数据点重叠导致渲染性能下降。", Status: workitem.StatusInProgress, Priority: workitem.PriorityMedium, AssigneeID: "u1", Reporter: "测试小刚", Source: workitem.SourceInternal, ExternalID: "MEEGO-202", CreatedAt: time.Date(2026, 5, 27, 0, 0, 0, 0, time.UTC), UpdatedAt: time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)},
			{ID: "BUG-003", TenantID: "t1", ProjectID: "p1", Type: workitem.TypeDefect, Title: "移动端菜单无法展开", Description: "在iOS Safari浏览器中，侧边栏菜单按钮点击无响应，需要检查事件绑定。", Status: workitem.StatusFixed, Priority: workitem.PriorityHigh, AssigneeID: "u2", Reporter: "产品小红", Source: workitem.SourceInternal, ExternalID: "MEEGO-203", CreatedAt: time.Date(2026, 5, 25, 0, 0, 0, 0, time.UTC), UpdatedAt: time.Date(2026, 5, 29, 0, 0, 0, 0, time.UTC)},
			{ID: "BUG-004", TenantID: "t1", ProjectID: "p1", Type: workitem.TypeDefect, Title: "导出PDF文件乱码", Description: "中文字体在导出PDF时出现方块，需要嵌入字体文件并配置字体映射。", Status: workitem.StatusClosed, Priority: workitem.PriorityLow, AssigneeID: "u3", Reporter: "设计小李", Source: workitem.SourceInternal, ExternalID: "MEEGO-204", CreatedAt: time.Date(2026, 5, 20, 0, 0, 0, 0, time.UTC), UpdatedAt: time.Date(2026, 5, 22, 0, 0, 0, 0, time.UTC)},
			{ID: "TC-001", TenantID: "t1", ProjectID: "p1", Type: workitem.TypeCase, Title: "登录功能-正常登录验证", Description: "验证用户使用正确的账号密码可以成功登录系统。", Status: workitem.StatusPassed, Priority: workitem.PriorityHigh, AssigneeID: "u4", Reporter: "测试小刚", Source: workitem.SourceInternal, ExternalID: "MEEGO-301", CreatedAt: time.Date(2026, 5, 22, 0, 0, 0, 0, time.UTC), UpdatedAt: time.Date(2026, 5, 23, 0, 0, 0, 0, time.UTC)},
			{ID: "TC-002", TenantID: "t1", ProjectID: "p1", Type: workitem.TypeCase, Title: "登录功能-密码错误处理", Description: "验证输入错误密码时系统给出正确的错误提示。", Status: workitem.StatusPassed, Priority: workitem.PriorityMedium, AssigneeID: "u4", Reporter: "测试小刚", Source: workitem.SourceInternal, ExternalID: "MEEGO-302", CreatedAt: time.Date(2026, 5, 22, 0, 0, 0, 0, time.UTC), UpdatedAt: time.Date(2026, 5, 23, 0, 0, 0, 0, time.UTC)},
			{ID: "TC-003", TenantID: "t1", ProjectID: "p1", Type: workitem.TypeCase, Title: "数据大盘-时间范围筛选", Description: "验证时间范围选择器正确过滤图表数据。", Status: workitem.StatusFailed, Priority: workitem.PriorityMedium, AssigneeID: "u4", Reporter: "产品小红", Source: workitem.SourceInternal, ExternalID: "MEEGO-303", CreatedAt: time.Date(2026, 5, 27, 0, 0, 0, 0, time.UTC), UpdatedAt: time.Date(2026, 5, 28, 0, 0, 0, 0, time.UTC)},
			{ID: "TC-004", TenantID: "t1", ProjectID: "p1", Type: workitem.TypeCase, Title: "权限管理-角色分配", Description: "验证管理员可以正确分配用户角色。", Status: workitem.StatusDraft, Priority: workitem.PriorityHigh, AssigneeID: "u4", Reporter: "产品小红", Source: workitem.SourceInternal, ExternalID: "MEEGO-304", CreatedAt: time.Date(2026, 5, 28, 0, 0, 0, 0, time.UTC), UpdatedAt: time.Date(2026, 5, 28, 0, 0, 0, 0, time.UTC)},
			{ID: "TC-005", TenantID: "t1", ProjectID: "p1", Type: workitem.TypeCase, Title: "API限流-超限响应验证", Description: "验证超过限流阈值后接口返回429状态码。", Status: workitem.StatusReady, Priority: workitem.PriorityHigh, AssigneeID: "u4", Reporter: "测试小刚", Source: workitem.SourceInternal, ExternalID: "MEEGO-305", CreatedAt: time.Date(2026, 5, 28, 0, 0, 0, 0, time.UTC), UpdatedAt: time.Date(2026, 5, 28, 0, 0, 0, 0, time.UTC)},
		},
	}
}

// ListWorkItems 返回满足过滤条件的工作项列表。
func (s *MockWorkItemService) ListWorkItems(filter WorkItemFilter) ([]object.WorkItem, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	result := make([]object.WorkItem, 0, len(s.items))
	for _, it := range s.items {
		if filter.ProjectID != "" && it.ProjectID != filter.ProjectID {
			continue
		}
		if filter.Type != "" && it.Type != filter.Type {
			continue
		}
		if filter.Status != "" && it.Status != filter.Status {
			continue
		}
		if filter.AssigneeID != "" && it.AssigneeID != filter.AssigneeID {
			continue
		}
		result = append(result, it)
	}
	return result, nil
}

// GetWorkItem 按 ID 获取单个工作项详情。
func (s *MockWorkItemService) GetWorkItem(id string) (object.WorkItem, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	for _, it := range s.items {
		if it.ID == id {
			return it, nil
		}
	}
	return object.WorkItem{}, errors.New("workitem not found")
}

// UpdateWorkItemStatus 更新指定工作项的状态。
func (s *MockWorkItemService) UpdateWorkItemStatus(id string, status workitem.Status) (object.WorkItem, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	for i := range s.items {
		if s.items[i].ID == id {
			s.items[i].Status = status
			s.items[i].UpdatedAt = time.Now().UTC()
			return s.items[i], nil
		}
	}
	return object.WorkItem{}, errors.New("workitem not found")
}
