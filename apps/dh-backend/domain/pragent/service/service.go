package service

import (
	"time"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/pragent/object"
)

// ReviewService 定义 PR-Agent 模块的服务接口。
type ReviewService interface {
	ListReviews() ([]object.ReviewResult, error)
}

// MockReviewService 是 ReviewService 的内存 mock 实现。
type MockReviewService struct{}

func NewMockReviewService() *MockReviewService {
	return &MockReviewService{}
}

func (s *MockReviewService) ListReviews() ([]object.ReviewResult, error) {
	return []object.ReviewResult{
		{
			ID: "rev-001", Repo: "frontend-web", PRID: 42, Title: "feat: 新增登录页面",
			Summary: "代码整体结构良好，但存在2处潜在问题和1个优化建议。",
			Issues: []object.ReviewIssue{
				{ID: "iss-001", File: "src/pages/Login.tsx", Line: 34, Severity: "high", Message: "密码输入框缺少 autocomplete 属性，可能导致浏览器无法正确识别"},
				{ID: "iss-002", File: "src/hooks/useAuth.ts", Line: 12, Severity: "medium", Message: "JWT Token 未设置过期时间检查，存在安全风险"},
				{ID: "iss-003", File: "src/utils/validator.ts", Line: 8, Severity: "low", Message: "邮箱正则表达式可以优化，当前不支持部分新顶级域名"},
			},
			CreatedAt: time.Date(2026, 6, 9, 10, 0, 0, 0, time.UTC),
		},
		{
			ID: "rev-002", Repo: "backend-api", PRID: 38, Title: "fix: 修复数据大盘查询性能",
			Summary: "SQL 查询优化显著提升了性能，但建议补充单元测试覆盖边界情况。",
			Issues: []object.ReviewIssue{
				{ID: "iss-004", File: "internal/dashboard/service.go", Line: 56, Severity: "medium", Message: "时间范围参数未做上限校验，可能导致大量数据查询"},
				{ID: "iss-005", File: "internal/dashboard/service.go", Line: 78, Severity: "low", Message: "建议将 magic number 30 提取为常量"},
			},
			CreatedAt: time.Date(2026, 6, 8, 15, 30, 0, 0, time.UTC),
		},
		{
			ID: "rev-003", Repo: "ui-components", PRID: 15, Title: "refactor: 重构 Button 组件",
			Summary: "重构逻辑清晰，组件复用性提升。无严重问题。",
			Issues: []object.ReviewIssue{
				{ID: "iss-006", File: "src/components/Button.tsx", Line: 22, Severity: "low", Message: "variant prop 可以进一步约束为联合类型"},
			},
			CreatedAt: time.Date(2026, 6, 7, 9, 0, 0, 0, time.UTC),
		},
	}, nil
}
