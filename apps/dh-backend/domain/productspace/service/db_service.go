package service

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"path/filepath"

	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/common"
)

const (
	defaultFilePerm = 0o644
	defaultDirPerm  = 0o755

	// ItemStatusDraft 是新建产品空间条目的默认状态。
	ItemStatusDraft = "draft"

	// ItemStatusPublished 是已发布产品空间条目的状态。
	ItemStatusPublished = "published"

	versionSuffix = "-v"

	// pmSubRole 是允许访问产品空间的职能子角色。
	pmSubRole = "pm"

	// changeSummaryRestoreToVersion 是 RestoreVersion 恢复到目标版本后的变更摘要模板。
	changeSummaryRestoreToVersion = "恢复至 v%d"

	maxTitleLength         = 500
	maxChangeSummaryLength = 500

	// maxCommentLength 是原型批注内容的最大长度（按 rune 计，避免截断多字节字符）。
	maxCommentLength = 2000

	// maxSelectorLength 是元素选择器的最大长度，与数据库 VARCHAR(500) 对齐。
	maxSelectorLength = 500
	// maxTargetTextLength 是选中元素文本快照的最大长度。
	maxTargetTextLength = 500
)

const (
	errMsgInvalidItemType           = "invalid item type"
	errMsgInvalidCategory           = "invalid category"
	errMsgInvalidExtension          = "invalid file extension"
	errMsgPathTraversal             = "path traversal detected"
	errMsgFolderNotEmpty            = "folder is not empty"
	errMsgFolderNotFound            = "folder not found"
	errMsgTitleEmpty                = "title is required"
	errMsgTitlePathSeparator        = "title cannot contain path separators"
	errMsgContentRequired           = "doc content is required"
	errMsgFileDataRequired          = "prototype file data is required"
	errMsgPrototypeTooLarge         = "prototype file exceeds maximum allowed size"
	errMsgDocTooLarge               = "doc content exceeds maximum allowed size"
	errMsgFolderPathSeparator       = "folder name cannot contain path separators"
	errMsgRelativePathEmpty         = "relative path is required"
	errMsgRelativePathAbs           = "relative path must be relative"
	errMsgRelativePathDot           = "relative path cannot contain parent references"
	errMsgItemNotFound              = "product space item not found"
	errMsgItemAlreadyExists         = "product space item already exists"
	errMsgVersionNotFound           = "product space version not found"
	errMsgInvalidVersion            = "invalid version"
	errMsgTitleTooLong              = "title exceeds maximum length"
	errMsgChangeSummaryTooLong      = "change summary exceeds maximum length"
	errMsgWorkspaceOrMemberNotFound = "workspace or member not found"
	errMsgCommentEmpty              = "批注内容不能为空"
	errMsgCommentTooLong            = "批注内容超出最大长度限制"
	errMsgCommentsNotAllowed        = "该分享未开放批注权限"
	errMsgNoPrototypeInShare        = "该分享未关联原型"
	errMsgNoDocInShare              = "该分享未关联文档"
)

// DBProductSpaceService 是基于 PostgreSQL 与本地文件系统的产品空间服务实现。
type DBProductSpaceService struct {
	db               *sql.DB
	workspaceRoot    string
	workspaceService workspaceMemberRoleProvider
}

var _ ProductSpaceService = (*DBProductSpaceService)(nil)

// NewDBProductSpaceService 创建 DBProductSpaceService 实例。
// workspaceRoot 会被解析为绝对路径，避免进程工作目录变化导致已存储的路径失效。
func NewDBProductSpaceService(db *sql.DB, workspaceRoot string, workspaceService workspaceMemberRoleProvider) (*DBProductSpaceService, error) {
	if db == nil {
		return nil, errors.New("db is required")
	}
	if workspaceRoot == "" {
		return nil, errors.New("workspaceRoot is required")
	}
	if workspaceService == nil {
		return nil, errors.New("workspaceService is required")
	}
	absRoot, err := filepath.Abs(workspaceRoot)
	if err != nil {
		return nil, fmt.Errorf("resolve workspace root: %w", err)
	}
	return &DBProductSpaceService{
		db:               db,
		workspaceRoot:    absRoot,
		workspaceService: workspaceService,
	}, nil
}

// requirePM 校验当前用户在工作空间中的职能子角色包含 PM。
// 当成员不存在时返回 ErrNotFound，避免与“存在但无权限”统一返回 403 造成信息泄露。
func (s *DBProductSpaceService) requirePM(ctx context.Context, workspaceID, userID string) error {
	subRoles, err := s.workspaceService.GetMemberSubRoles(ctx, workspaceID, userID)
	if err != nil {
		if errors.Is(err, common.ErrMemberNotFound) {
			return fmt.Errorf("%w: %s", ErrNotFound, errMsgWorkspaceOrMemberNotFound)
		}
		return fmt.Errorf("%w: %w", ErrForbidden, err)
	}
	for _, r := range subRoles {
		if r == pmSubRole {
			return nil
		}
	}
	return fmt.Errorf("%w: only pm can access product space", ErrForbidden)
}

// requireMember 校验当前用户是否为工作空间成员（任意职能子角色均可）。
// 用于 /proto-make 生成内容的“自我采纳”等仅需确认成员身份的场景。
func (s *DBProductSpaceService) requireMember(ctx context.Context, workspaceID, userID string) error {
	_, err := s.workspaceService.GetMemberSubRoles(ctx, workspaceID, userID)
	if err != nil {
		if errors.Is(err, common.ErrMemberNotFound) {
			return fmt.Errorf("%w: %s", ErrNotFound, errMsgWorkspaceOrMemberNotFound)
		}
		return fmt.Errorf("%w: %w", ErrForbidden, err)
	}
	return nil
}

// scanner 抽象了 sql.Row 与 sql.Rows 的 Scan 能力，用于复用扫描逻辑。
type scanner interface {
	Scan(dest ...any) error
}

// queryRowContextExecer 抽象了 *sql.DB 与 *sql.Tx 的 QueryRowContext 能力。
type queryRowContextExecer interface {
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}
