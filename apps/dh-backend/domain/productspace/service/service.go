// Package service 定义了 product-space 模块的领域服务接口。
package service

import (
	"context"
	"errors"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/productspace/object"
)

var (
	// ErrNotFound 表示请求的资源不存在。
	ErrNotFound = errors.New("not found")
	// ErrForbidden 表示当前用户没有权限访问该资源。
	ErrForbidden = errors.New("forbidden")
	// ErrInvalidInput 表示请求参数不合法。
	ErrInvalidInput = errors.New("invalid input")
	// ErrConflict 表示请求与现有资源冲突。
	ErrConflict = errors.New("conflict")
	// ErrUnauthorized 表示用户未认证。
	ErrUnauthorized = errors.New("unauthorized")
)

// workspaceMemberRoleProvider 抽象了获取工作空间成员职能子角色的能力。
type workspaceMemberRoleProvider interface {
	GetMemberSubRole(ctx context.Context, workspaceID, userID string) (string, error)
}

// ProductSpaceService 是产品空间模块的核心服务接口，负责文档、原型及其版本的管理。
type ProductSpaceService interface {
	GetTree(ctx context.Context, workspaceID, userID string) ([]object.ProductSpaceTreeNode, error)
	CreateItem(ctx context.Context, workspaceID, userID string, req object.CreateItemRequest) (*object.ProductSpaceItem, error)
	GetItem(ctx context.Context, workspaceID, userID, itemID string) (*object.ProductSpaceItem, []byte, error)
	UpdateContent(ctx context.Context, workspaceID, userID, itemID string, req object.UpdateContentRequest) (*object.ProductSpaceItem, error)
	ListVersions(ctx context.Context, workspaceID, userID, itemID string) ([]object.ProductSpaceVersion, error)
	RestoreVersion(ctx context.Context, workspaceID, userID, itemID string, version int) (*object.ProductSpaceItem, error)
	DeleteItem(ctx context.Context, workspaceID, userID, itemID string) error
	CreateFolder(ctx context.Context, workspaceID, userID string, req object.CreateFolderRequest) error
	DeleteFolder(ctx context.Context, workspaceID, userID string, req object.DeleteFolderRequest) error
	DownloadVersion(ctx context.Context, workspaceID, userID, itemID string, version int) (string, []byte, error)
	ListComments(ctx context.Context, workspaceID, userID, itemID string) ([]object.PrototypeComment, error)
	AddComment(ctx context.Context, workspaceID, userID, itemID, content string) (*object.PrototypeComment, error)
}
