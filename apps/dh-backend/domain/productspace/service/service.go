// Package service 定义了 product-space 模块的领域服务接口。
package service

import (
	"context"
	"errors"

	productdocobject "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/productdoc/object"
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
	// ImportPrototype 将原型工程目录导入产品空间，返回导入条目 ID 列表。
	ImportPrototype(ctx context.Context, workspaceID, userID, folder string) ([]string, error)
	DownloadVersion(ctx context.Context, workspaceID, userID, itemID string, version int) (string, []byte, error)
	ListComments(ctx context.Context, workspaceID, userID, itemID string) ([]object.PrototypeComment, error)
	AddComment(ctx context.Context, workspaceID, userID, itemID string, req object.AddCommentRequest) (*object.PrototypeComment, error)
	ServeFile(ctx context.Context, workspaceID, userID, relativePath string) ([]byte, string, error)

	// CreatePrototypeShare 为指定产品（prototypes 一级目录）创建免登录分享链接，幂等。
	CreatePrototypeShare(ctx context.Context, workspaceID, userID, productFolder string) (object.PrototypeShare, error)
	// GetSharedPrototype 免登录：按 token 解析分享产品信息与页面列表。
	GetSharedPrototype(token string) (object.SharedPrototypeView, error)
	// ServeSharedFile 免登录：按 token 校验后 serve 产品目录下的文件，返回内容与 MIME 类型。
	ServeSharedFile(token, relativePath string) ([]byte, string, error)
	// ListSharedComments 免登录：按 token 校验后列出指定页面的批注。
	ListSharedComments(token, itemID string) ([]object.PrototypeComment, error)

	// CreateRequirementShare 为指定需求创建统一的文档+原型分享链接，幂等。
	CreateRequirementShare(ctx context.Context, workspaceID, userID string, req object.CreateRequirementShareRequest) (object.RequirementShare, error)
	// GetSharedRequirement 免登录：按 token 解析需求级统一分享视图。
	GetSharedRequirement(token string) (object.SharedRequirementView, error)
	// ServeSharedRequirementFile 免登录：按 token 校验后 serve 原型文件。
	ServeSharedRequirementFile(token, relativePath string) ([]byte, string, error)
	// ListRequirementShareComments 免登录：按需求分享 token 校验后列出指定原型页面的批注。
	ListRequirementShareComments(token, itemID string) ([]object.PrototypeComment, error)
	// AddRequirementSharePrototypeComment 免登录：访客为需求分享中的原型页面添加批注。
	AddRequirementSharePrototypeComment(token, itemID string, req object.AddCommentRequest) (*object.PrototypeComment, error)
	// AddRequirementShareDocComment 免登录：访客为需求分享中的文档添加文本批注。
	AddRequirementShareDocComment(token string, req object.AddRequirementShareDocCommentRequest) (*productdocobject.ShareComment, error)
	// ListRequirementShareDocComments 免登录：按需求分享 token 列出关联文档的文本批注。
	ListRequirementShareDocComments(token string) ([]productdocobject.ShareComment, error)
}
