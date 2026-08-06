// Package service 定义了 product-space 模块的领域服务接口。
package service

import (
	"context"
	"errors"
	"time"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/productspace/object"

	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/common"
)

var (
	// ErrNotFound 表示请求的资源不存在。
	ErrNotFound = common.NotFoundErrorf("not found")
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
	GetMemberSubRoles(ctx context.Context, workspaceID, userID string) ([]string, error)
}

type ProductSpaceItemService interface {
	GetTree(ctx context.Context, workspaceID, userID string) ([]object.ProductSpaceTreeNode, error)
	CreateItem(ctx context.Context, workspaceID, userID string, req object.CreateItemRequest) (*object.ProductSpaceItem, error)
	GetItem(ctx context.Context, workspaceID, userID, itemID string) (*object.ProductSpaceItem, []byte, error)
	UpdateContent(ctx context.Context, workspaceID, userID, itemID string, req object.UpdateContentRequest) (*object.ProductSpaceItem, error)
	DeleteItem(ctx context.Context, workspaceID, userID, itemID string) error
	ListVersions(ctx context.Context, workspaceID, userID, itemID string) ([]object.ProductSpaceVersion, error)
	RestoreVersion(ctx context.Context, workspaceID, userID, itemID string, version int) (*object.ProductSpaceItem, error)
	DownloadVersion(ctx context.Context, workspaceID, userID, itemID string, version int) (string, []byte, error)
}

type ProductSpaceFolderService interface {
	CreateFolder(ctx context.Context, workspaceID, userID string, req object.CreateFolderRequest) error
	DeleteFolder(ctx context.Context, workspaceID, userID string, req object.DeleteFolderRequest) error
}

type ProductSpaceCommentService interface {
	ListComments(ctx context.Context, workspaceID, userID, itemID string) ([]object.PrototypeComment, error)
	AddComment(ctx context.Context, workspaceID, userID, itemID string, req object.AddCommentRequest) (*object.PrototypeComment, error)
}

type ProductSpaceFileService interface {
	ServeFile(ctx context.Context, workspaceID, userID, relativePath string) ([]byte, string, error)
}

type ProductSpacePrototypeShareService interface {
	CreatePrototypeShare(ctx context.Context, workspaceID, userID, productFolder string) (object.PrototypeShare, error)
	GetSharedPrototype(token string) (object.SharedPrototypeView, error)
	ServeSharedFile(token, relativePath string) ([]byte, string, error)
	ListSharedComments(token, itemID string) ([]object.PrototypeComment, error)
}

type ProductSpaceRequirementShareService interface {
	CreateRequirementShare(ctx context.Context, workspaceID, userID string, req object.CreateRequirementShareRequest) (object.RequirementShare, error)
	GetOrCreateRequirementShare(ctx context.Context, workspaceID, userID string, req object.CreateRequirementShareRequest) (object.RequirementShare, error)
	GetSharedRequirement(token string) (object.SharedRequirementView, error)
	ServeSharedRequirementFile(token, relativePath string) ([]byte, string, error)
	ListRequirementShareComments(token, itemID string) ([]object.PrototypeComment, error)
	AddRequirementSharePrototypeComment(token, itemID string, req object.AddCommentRequest) (*object.PrototypeComment, error)
	AddRequirementShareDocComment(token string, req object.AddRequirementShareDocCommentRequest) (*object.DocShareComment, error)
	ListRequirementShareDocComments(token string) ([]object.DocShareComment, error)
}

type ProductSpaceImportService interface {
	ImportPrototype(ctx context.Context, workspaceID, userID, folder string) ([]string, error)
	ImportDoc(ctx context.Context, workspaceID, userID string, req object.ImportDocRequest) (*object.ProductSpaceItem, error)
	GetDocImportStatus(ctx context.Context, workspaceID, userID, sourcePath string) (*object.ProductSpaceItem, error)
	ImportProcessDeliverable(ctx context.Context, workspaceID, actingUserID, ownerUserID, workitemTitle, deliverableType, path string) (object.RequirementShare, error)
}

type ProductSpaceCleanupTaskService interface {
	StartDocAdoptionCleanupTask(ctx context.Context, interval time.Duration, retentionDays int) func()
}

// ProductSpaceService 是产品空间模块的核心服务接口，负责文档、原型及其版本的管理。
type ProductSpaceService interface {
	ProductSpaceItemService
	ProductSpaceFolderService
	ProductSpaceCommentService
	ProductSpaceFileService
	ProductSpacePrototypeShareService
	ProductSpaceRequirementShareService
	ProductSpaceImportService
	ProductSpaceCleanupTaskService
}
