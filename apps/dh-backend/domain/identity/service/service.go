package service

import (
	"time"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/identity/object"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/identity"
)

// UserService 定义用户/租户模块的服务接口。
type UserService interface {
	ListUsers() ([]object.User, error)
	GetMe() (object.User, error)
}

// MockUserService 是 UserService 的内存 mock 实现，用于开发阶段。
type MockUserService struct{}

func NewMockUserService() *MockUserService {
	return &MockUserService{}
}

func (s *MockUserService) ListUsers() ([]object.User, error) {
	return []object.User{
		{ID: "u1", TenantID: "t1", Email: "xiaoming@deepharness.com", Name: "开发者小明", Role: identity.RoleAdmin, CreatedAt: time.Date(2023, 1, 1, 0, 0, 0, 0, time.UTC)},
		{ID: "u2", TenantID: "t1", Email: "xiaohong@deepharness.com", Name: "产品小红", Role: identity.RoleUser, CreatedAt: time.Date(2023, 2, 15, 0, 0, 0, 0, time.UTC)},
		{ID: "u3", TenantID: "t1", Email: "xiaoli@deepharness.com", Name: "设计小李", Role: identity.RoleUser, CreatedAt: time.Date(2023, 3, 10, 0, 0, 0, 0, time.UTC)},
		{ID: "u4", TenantID: "t1", Email: "xiaogang@deepharness.com", Name: "测试小刚", Role: identity.RoleUser, CreatedAt: time.Date(2023, 4, 20, 0, 0, 0, 0, time.UTC)},
	}, nil
}

func (s *MockUserService) GetMe() (object.User, error) {
	return object.User{
		ID: "u1", TenantID: "t1", Email: "xiaoming@deepharness.com", Name: "开发者小明", Role: identity.RoleAdmin, CreatedAt: time.Date(2023, 1, 1, 0, 0, 0, 0, time.UTC),
	}, nil
}
