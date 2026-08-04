package service

import (
	"database/sql"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/team/object"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/common"
)

// TeamService 定义团队技能/提示词服务接口。
type TeamService interface {
	// ListSkills 返回技能列表；workspaceID 非空时按工作区过滤并返回该工作区的安装状态。
	ListSkills(workspaceID string, page, pageSize int) (common.PaginatedList[object.Skill], error)
	CreateSkill(req object.CreateSkillRequest, workspaceID string) (object.Skill, error)
	UpdateSkill(id string, req object.UpdateSkillRequest, workspaceID string) (object.Skill, error)
	DeleteSkill(id string, workspaceID string) error
	ReviewSkill(id string, action string, reviewerID string, workspaceID string) (object.Skill, error)
	UpdateSkillCategories(id string, workspaceID string, categoryIDs []string) (object.Skill, error)
	ListSkillCategories(workspaceID string) ([]object.SkillCategory, error)
	CreateSkillCategory(req object.CreateSkillCategoryRequest, workspaceID string) (object.SkillCategory, error)
	DeleteSkillCategory(id string, workspaceID string) error

	ListPromptsVisibleTo(userID string, isSuperAdmin bool, page, pageSize int) (common.PaginatedList[object.Prompt], error)
	CreatePrompt(req object.CreatePromptRequest, createdBy string) (object.Prompt, error)
	UpdatePrompt(id string, req object.UpdatePromptRequest, userID string, isSuperAdmin bool) (object.Prompt, error)
	DeletePrompt(id string, userID string, isSuperAdmin bool) error
	ReviewPrompt(id string, action string, reviewerID string) (object.Prompt, error)
	UpdatePromptCategories(id string, categoryIDs []string) (object.Prompt, error)
	GetPrompt(id string) (object.Prompt, error)
	// RecordPromptUsage 记录一次复制使用，同一用户同一提示词每天只计数一次。
	RecordPromptUsage(id string, userID string) (object.Prompt, error)
	ListPromptCategories() ([]object.PromptCategory, error)
	CreatePromptCategory(req object.CreatePromptCategoryRequest) (object.PromptCategory, error)
	DeletePromptCategory(id string) error

	GetSkillStats(workspaceID string) (object.SkillStats, error)
	GetPromptStats() (object.PromptStats, error)
}

// DBTeamService 是基于 MySQL 的 TeamService 实现。
type DBTeamService struct {
	db *sql.DB
}

// NewDBTeamService 创建 MySQL 实现的团队服务。
func NewDBTeamService(db *sql.DB) *DBTeamService {
	return &DBTeamService{db: db}
}
