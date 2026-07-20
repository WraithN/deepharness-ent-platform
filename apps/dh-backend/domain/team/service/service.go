package service

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/common"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/common/sqlutil"
	"github.com/google/uuid"
)

// Skill 表示团队技能，与 team_skills 表对应。
type Skill struct {
	ID          string       `json:"id"`
	Name        string       `json:"name"`
	Description string       `json:"description"`
	Category    string       `json:"category"`
	// CategoryIDs 多分类链接（team_skill_category_links），为空时前端回退展示 Category 单分类。
	CategoryIDs []string     `json:"categoryIds"`
	Tags        []string     `json:"tags"`
	Downloads   int          `json:"downloads"`
	Rating      float64      `json:"rating"`
	Installed   bool         `json:"installed"`
	Icon        string       `json:"icon"`
	Phase       string       `json:"phase"`
	Status      PromptStatus `json:"status"`
	CreatedAt   time.Time    `json:"createdAt"`
	UpdatedAt   time.Time    `json:"updatedAt"`
}

// PromptStatus 表示提示词在市场中的生命周期状态。
type PromptStatus string

const (
	PromptStatusPendingReview PromptStatus = "pending_review"
	PromptStatusOnShelf       PromptStatus = "on_shelf"
	PromptStatusOffShelf      PromptStatus = "off_shelf"
	PromptStatusRejected      PromptStatus = "rejected"
)

// Prompt 表示团队提示词，与 team_prompts 表对应。
type Prompt struct {
	ID           string       `json:"id"`
	Name         string       `json:"name"`
	Description  string       `json:"description"`
	Content      string       `json:"content"`
	UseCase      string       `json:"useCase"`
	// CategoryIDs 多分类链接（team_prompt_category_links），为空时前端回退展示 UseCase。
	CategoryIDs  []string     `json:"categoryIds"`
	UsageCount   int          `json:"usageCount"`
	AddedToSpace bool         `json:"addedToSpace"`
	Status       PromptStatus `json:"status"`
	CreatedBy    string       `json:"createdBy,omitempty"`
	// CreatedByName 创建人显示名（LEFT JOIN users 容错创建人已删除，为空字符串）。
	CreatedByName string     `json:"createdByName,omitempty"`
	ReviewedBy    string     `json:"reviewedBy,omitempty"`
	ReviewedAt    *time.Time `json:"reviewedAt,omitempty"`
	CreatedAt     time.Time  `json:"createdAt"`
	UpdatedAt     time.Time  `json:"updatedAt"`
}

// CreateSkillRequest 创建技能请求。
type CreateSkillRequest struct {
	Name        string  `json:"name"`
	Description string  `json:"description"`
	Category    string  `json:"category"`
	Tags        string  `json:"tags"`
	Icon        string  `json:"icon"`
	Phase       string  `json:"phase"`
	Rating      float64 `json:"rating"`
}

// CreatePromptRequest 创建提示词请求。
type CreatePromptRequest struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Content     string `json:"content"`
	UseCase     string `json:"useCase"`
}

// UpdateSkillRequest 更新技能请求（仅支持切换 installed 状态）。
type UpdateSkillRequest struct {
	Installed *bool `json:"installed"`
}

// UpdatePromptRequest 更新提示词请求。
type UpdatePromptRequest struct {
	Name        *string `json:"name,omitempty"`
	Description *string `json:"description,omitempty"`
	Content     *string `json:"content,omitempty"`
	UseCase     *string `json:"useCase,omitempty"`
}

// ReviewPromptRequest 审核提示词请求。
type ReviewPromptRequest struct {
	Action string `json:"action"` // approve | reject | unshelf
}

// UpdateCategoriesRequest 更新技能/提示词的多分类关联。
type UpdateCategoriesRequest struct {
	CategoryIDs []string `json:"categoryIds"`
}

// 分类链接表与分类表名常量（listLinkedCategoryIDs/replaceCategoryLinks 按表名参数化复用）。
const (
	skillCategoryLinkTable  = "team_skill_category_links"
	promptCategoryLinkTable = "team_prompt_category_links"
	skillCategoryTable      = "team_skill_categories"
	promptCategoryTable     = "team_prompt_categories"
)

// SkillCategory 表示技能分类。
type SkillCategory struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Builtin   bool      `json:"builtin"`
	SortOrder int       `json:"sortOrder"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// PromptCategory 表示提示词分类。
type PromptCategory struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Builtin   bool      `json:"builtin"`
	SortOrder int       `json:"sortOrder"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// CreateSkillCategoryRequest 创建技能分类请求。
type CreateSkillCategoryRequest struct {
	Name string `json:"name"`
}

// CreatePromptCategoryRequest 创建提示词分类请求。
type CreatePromptCategoryRequest struct {
	Name string `json:"name"`
}

// CategoryDistribution 表示单个分类的分布数据。
type CategoryDistribution struct {
	Category string `json:"category"`
	Count    int    `json:"count"`
}

// StatusDistribution 表示状态分布数据。
type StatusDistribution struct {
	Status string `json:"status"`
	Count  int    `json:"count"`
}

// TopSkill 表示下载量最高的技能。
type TopSkill struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	Category  string  `json:"category"`
	Downloads int     `json:"downloads"`
	Rating    float64 `json:"rating"`
}

// TopPrompt 表示使用次数最高的提示词。
type TopPrompt struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	UseCase    string `json:"useCase"`
	UsageCount int    `json:"usageCount"`
}

// SkillStats 表示技能大盘数据。
type SkillStats struct {
	Total                int                    `json:"total"`
	InstalledCount       int                    `json:"installedCount"`
	CategoryDistribution []CategoryDistribution `json:"categoryDistribution"`
	TopSkills            []TopSkill             `json:"topSkills"`
}

// PromptStats 表示提示词大盘数据。
type PromptStats struct {
	Total                int                    `json:"total"`
	OnShelfCount         int                    `json:"onShelfCount"`
	CategoryDistribution []CategoryDistribution `json:"categoryDistribution"`
	StatusDistribution   []StatusDistribution   `json:"statusDistribution"`
	TopPrompts           []TopPrompt            `json:"topPrompts"`
}

// TeamService 定义团队技能/提示词服务接口。
type TeamService interface {
	// ListSkills 返回技能列表；workspaceID 非空时按工作区过滤并返回该工作区的安装状态。
	ListSkills(workspaceID string, page, pageSize int) (common.PaginatedList[Skill], error)
	CreateSkill(req CreateSkillRequest, workspaceID string) (Skill, error)
	UpdateSkill(id string, req UpdateSkillRequest, workspaceID string) (Skill, error)
	DeleteSkill(id string, workspaceID string) error
	ReviewSkill(id string, action string, reviewerID string, workspaceID string) (Skill, error)
	UpdateSkillCategories(id string, workspaceID string, categoryIDs []string) (Skill, error)
	ListSkillCategories(workspaceID string) ([]SkillCategory, error)
	CreateSkillCategory(req CreateSkillCategoryRequest, workspaceID string) (SkillCategory, error)
	DeleteSkillCategory(id string, workspaceID string) error

	ListPromptsVisibleTo(userID string, isSuperAdmin bool, page, pageSize int) (common.PaginatedList[Prompt], error)
	CreatePrompt(req CreatePromptRequest, createdBy string) (Prompt, error)
	UpdatePrompt(id string, req UpdatePromptRequest, userID string, isSuperAdmin bool) (Prompt, error)
	DeletePrompt(id string, userID string, isSuperAdmin bool) error
	ReviewPrompt(id string, action string, reviewerID string) (Prompt, error)
	UpdatePromptCategories(id string, categoryIDs []string) (Prompt, error)
	GetPrompt(id string) (Prompt, error)
	// RecordPromptUsage 记录一次复制使用，同一用户同一提示词每天只计数一次。
	RecordPromptUsage(id string, userID string) (Prompt, error)
	ListPromptCategories() ([]PromptCategory, error)
	CreatePromptCategory(req CreatePromptCategoryRequest) (PromptCategory, error)
	DeletePromptCategory(id string) error

	GetSkillStats(workspaceID string) (SkillStats, error)
	GetPromptStats() (PromptStats, error)
}

// DBTeamService 是基于 MySQL 的 TeamService 实现。
type DBTeamService struct {
	db *sql.DB
}

// NewDBTeamService 创建 MySQL 实现的团队服务。
func NewDBTeamService(db *sql.DB) *DBTeamService {
	return &DBTeamService{db: db}
}

// ListSkills 返回团队技能列表，支持服务端分页。
// workspaceID 非空时，仅返回该工作区的技能（含全局技能），并以 workspace_skill_installs 中的安装状态覆盖全局默认值。
func (s *DBTeamService) ListSkills(workspaceID string, page, pageSize int) (common.PaginatedList[Skill], error) {
	page = common.NormalizePage(page)
	pageSize = common.NormalizePageSize(pageSize, 10, 100)

	var total int
	var rows *sql.Rows
	var err error

	if workspaceID == "" {
		if err := s.db.QueryRow(`SELECT COUNT(*) FROM team_skills`).Scan(&total); err != nil {
			return common.PaginatedList[Skill]{}, fmt.Errorf("count skills failed: %w", err)
		}
		rows, err = s.db.Query(`
			SELECT id, name, description, category, tags, downloads, rating, installed, icon, phase, status, created_at, updated_at
			FROM team_skills
			ORDER BY created_at DESC
			LIMIT $1 OFFSET $2
		`, pageSize, common.Offset(page, pageSize))
	} else {
		if err := s.db.QueryRow(`
			SELECT COUNT(*) FROM team_skills
			WHERE workspace_id = $1 OR workspace_id IS NULL
		`, workspaceID).Scan(&total); err != nil {
			return common.PaginatedList[Skill]{}, fmt.Errorf("count skills failed: %w", err)
		}
		rows, err = s.db.Query(`
			SELECT s.id, s.name, s.description, s.category, s.tags, s.downloads, s.rating,
			       COALESCE(wsi.installed, s.installed) AS installed, s.icon, s.phase, s.status, s.created_at, s.updated_at
			FROM team_skills s
			LEFT JOIN workspace_skill_installs wsi ON wsi.skill_id = s.id AND wsi.workspace_id = $1
			WHERE s.workspace_id = $1 OR s.workspace_id IS NULL
			ORDER BY s.created_at DESC
			LIMIT $2 OFFSET $3
		`, workspaceID, pageSize, common.Offset(page, pageSize))
	}
	if err != nil {
		return common.PaginatedList[Skill]{}, fmt.Errorf("list skills failed: %w", err)
	}
	defer rows.Close()

	result := make([]Skill, 0)
	skillIDs := make([]string, 0)
	for rows.Next() {
		var sk Skill
		var tags sql.NullString
		if err := rows.Scan(&sk.ID, &sk.Name, &sk.Description, &sk.Category, &tags, &sk.Downloads, &sk.Rating, &sk.Installed, &sk.Icon, &sk.Phase, &sk.Status, &sk.CreatedAt, &sk.UpdatedAt); err != nil {
			return common.PaginatedList[Skill]{}, fmt.Errorf("scan skill failed: %w", err)
		}
		sk.Tags = parseTags(tags)
		sk.CategoryIDs = []string{}
		result = append(result, sk)
		skillIDs = append(skillIDs, sk.ID)
	}
	if err := rows.Err(); err != nil {
		return common.PaginatedList[Skill]{}, fmt.Errorf("iterate skills failed: %w", err)
	}

	// 批量补充多分类链接（避免逐行 N+1 查询）。
	categoryMap, err := s.listLinkedCategoryIDs(skillCategoryLinkTable, "skill_id", skillIDs)
	if err != nil {
		return common.PaginatedList[Skill]{}, err
	}
	for i := range result {
		if ids, ok := categoryMap[result[i].ID]; ok {
			result[i].CategoryIDs = ids
		}
	}

	return common.PaginatedList[Skill]{
		List:     result,
		Total:    total,
		Page:     page,
		PageSize: pageSize,
	}, nil
}

// CreateSkill 创建新技能。
// workspaceID 非空时，技能归属到该工作区；为空时创建为全局技能。
func (s *DBTeamService) CreateSkill(req CreateSkillRequest, workspaceID string) (Skill, error) {
	now := time.Now().UTC()
	skill := Skill{
		ID:          uuid.New().String(),
		Name:        req.Name,
		Description: req.Description,
		Category:    req.Category,
		Tags:        parseTagsInput(req.Tags),
		Downloads:   0,
		Rating:      req.Rating,
		Installed:   true,
		Icon:        defaultIcon(req.Icon),
		Phase:       defaultPhase(req.Phase),
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	if skill.Rating == 0 {
		skill.Rating = 5.0
	}

	var workspaceIDArg interface{}
	if workspaceID != "" {
		workspaceIDArg = workspaceID
	}

	_, err := s.db.Exec(`
		INSERT INTO team_skills (id, name, description, category, tags, downloads, rating, installed, icon, phase, workspace_id, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
	`, skill.ID, skill.Name, skill.Description, skill.Category, strings.Join(skill.Tags, ","), skill.Downloads, skill.Rating, skill.Installed, skill.Icon, skill.Phase, workspaceIDArg, skill.CreatedAt, skill.UpdatedAt)
	if err != nil {
		return Skill{}, fmt.Errorf("insert skill failed: %w", err)
	}
	return skill, nil
}

// UpdateSkill 更新技能状态。
// workspaceID 非空时，安装/卸载状态写入 workspace_skill_installs，避免影响其他工作区；为空时修改全局默认状态。
func (s *DBTeamService) UpdateSkill(id string, req UpdateSkillRequest, workspaceID string) (Skill, error) {
	skill, err := s.getSkill(id, workspaceID)
	if err != nil {
		return Skill{}, err
	}
	if req.Installed != nil {
		skill.Installed = *req.Installed
		if workspaceID != "" {
			_, err = s.db.Exec(`
				INSERT INTO workspace_skill_installs (workspace_id, skill_id, installed, created_at, updated_at)
				VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
				ON CONFLICT (workspace_id, skill_id)
				DO UPDATE SET installed = EXCLUDED.installed, updated_at = CURRENT_TIMESTAMP
			`, workspaceID, id, *req.Installed)
			if err != nil {
				return Skill{}, fmt.Errorf("upsert skill install state failed: %w", err)
			}
		} else {
			_, err = s.db.Exec(`
				UPDATE team_skills SET installed = $1, updated_at = $2 WHERE id = $3
			`, skill.Installed, time.Now().UTC(), id)
			if err != nil {
				return Skill{}, fmt.Errorf("update skill failed: %w", err)
			}
		}
	}

	return skill, nil
}

// DeleteSkill 删除技能。
// workspaceID 非空时，仅允许删除属于该工作区或全局的技能，防止跨工作区误删。
func (s *DBTeamService) DeleteSkill(id string, workspaceID string) error {
	query := `DELETE FROM team_skills WHERE id = $1`
	args := []any{id}
	if workspaceID != "" {
		query = `DELETE FROM team_skills WHERE id = $1 AND (workspace_id = $2 OR workspace_id IS NULL)`
		args = append(args, workspaceID)
	}
	res, err := s.db.Exec(query, args...)
	if err != nil {
		return fmt.Errorf("delete skill failed: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return errors.New("skill not found")
	}
	return nil
}

// ReviewSkill 超级管理员审核技能（状态机与 ReviewPrompt 对称）。
// workspaceID 非空时仅审核该工作区可见的技能。
func (s *DBTeamService) ReviewSkill(id string, action string, reviewerID string, workspaceID string) (Skill, error) {
	skill, err := s.getSkill(id, workspaceID)
	if err != nil {
		return Skill{}, err
	}

	now := time.Now().UTC()
	var status PromptStatus
	switch action {
	case "approve":
		status = PromptStatusOnShelf
	case "reject":
		status = PromptStatusRejected
	case "unshelf":
		if skill.Status != PromptStatusOnShelf {
			return Skill{}, errors.New("skill is not on shelf")
		}
		status = PromptStatusOffShelf
	default:
		return Skill{}, errors.New("invalid review action")
	}

	_, err = s.db.Exec(`
		UPDATE team_skills
		SET status = $1, reviewed_by = $2, reviewed_at = $3, updated_at = $4
		WHERE id = $5
	`, status, reviewerID, now, now, id)
	if err != nil {
		return Skill{}, fmt.Errorf("review skill failed: %w", err)
	}
	return s.getSkill(id, workspaceID)
}

// UpdateSkillCategories 更新技能的多分类关联（替换语义）。
// workspaceID 用于校验分类是否属于当前工作区或全局分类。
func (s *DBTeamService) UpdateSkillCategories(id string, workspaceID string, categoryIDs []string) (Skill, error) {
	if _, err := s.getSkill(id, workspaceID); err != nil {
		return Skill{}, err
	}
	if err := s.replaceCategoryLinks(skillCategoryLinkTable, skillCategoryTable, "skill_id", id, categoryIDs, workspaceID); err != nil {
		return Skill{}, err
	}
	return s.getSkill(id, workspaceID)
}

func (s *DBTeamService) getSkill(id string, workspaceID string) (Skill, error) {
	var sk Skill
	var tags sql.NullString
	var err error

	if workspaceID == "" {
		err = s.db.QueryRow(`
			SELECT id, name, description, category, tags, downloads, rating, installed, icon, phase, status, created_at, updated_at
			FROM team_skills WHERE id = $1
		`, id).Scan(&sk.ID, &sk.Name, &sk.Description, &sk.Category, &tags, &sk.Downloads, &sk.Rating, &sk.Installed, &sk.Icon, &sk.Phase, &sk.Status, &sk.CreatedAt, &sk.UpdatedAt)
	} else {
		err = s.db.QueryRow(`
			SELECT s.id, s.name, s.description, s.category, s.tags, s.downloads, s.rating,
			       COALESCE(wsi.installed, s.installed) AS installed, s.icon, s.phase, s.status, s.created_at, s.updated_at
			FROM team_skills s
			LEFT JOIN workspace_skill_installs wsi ON wsi.skill_id = s.id AND wsi.workspace_id = $2
			WHERE s.id = $1 AND (s.workspace_id = $2 OR s.workspace_id IS NULL)
		`, id, workspaceID).Scan(&sk.ID, &sk.Name, &sk.Description, &sk.Category, &tags, &sk.Downloads, &sk.Rating, &sk.Installed, &sk.Icon, &sk.Phase, &sk.Status, &sk.CreatedAt, &sk.UpdatedAt)
	}
	if errors.Is(err, sql.ErrNoRows) {
		return Skill{}, errors.New("skill not found")
	}
	if err != nil {
		return Skill{}, fmt.Errorf("get skill failed: %w", err)
	}
	sk.Tags = parseTags(tags)
	sk.CategoryIDs = []string{}
	categoryMap, err := s.listLinkedCategoryIDs(skillCategoryLinkTable, "skill_id", []string{id})
	if err != nil {
		return Skill{}, err
	}
	if ids, ok := categoryMap[id]; ok {
		sk.CategoryIDs = ids
	}
	return sk, nil
}

// ListPromptsVisibleTo 返回指定用户可见的提示词，支持服务端分页。
// 规则：on_shelf 全员可见；pending_review/rejected 仅创建人和超管可见；off_shelf 仅超管可见。
func (s *DBTeamService) ListPromptsVisibleTo(userID string, isSuperAdmin bool, page, pageSize int) (common.PaginatedList[Prompt], error) {
	page = common.NormalizePage(page)
	pageSize = common.NormalizePageSize(pageSize, 10, 100)

	var total int
	if isSuperAdmin {
		if err := s.db.QueryRow(`SELECT COUNT(*) FROM team_prompts`).Scan(&total); err != nil {
			return common.PaginatedList[Prompt]{}, fmt.Errorf("count prompts failed: %w", err)
		}
	} else {
		if err := s.db.QueryRow(`
			SELECT COUNT(*) FROM team_prompts
			WHERE status = $1 OR (status IN ($2, $3) AND created_by = $4)
		`, PromptStatusOnShelf, PromptStatusPendingReview, PromptStatusRejected, userID).Scan(&total); err != nil {
			return common.PaginatedList[Prompt]{}, fmt.Errorf("count prompts failed: %w", err)
		}
	}

	var rows *sql.Rows
	var err error
	if isSuperAdmin {
		rows, err = s.db.Query(`
			SELECT p.id, p.name, p.description, p.content, p.use_case, p.usage_count, p.added_to_space,
			       p.status, p.created_by, COALESCE(u.name, ''), p.reviewed_by, p.reviewed_at, p.created_at, p.updated_at
			FROM team_prompts p
			LEFT JOIN users u ON u.id = p.created_by
			ORDER BY p.created_at DESC
			LIMIT $1 OFFSET $2
		`, pageSize, common.Offset(page, pageSize))
	} else {
		rows, err = s.db.Query(`
			SELECT p.id, p.name, p.description, p.content, p.use_case, p.usage_count, p.added_to_space,
			       p.status, p.created_by, COALESCE(u.name, ''), p.reviewed_by, p.reviewed_at, p.created_at, p.updated_at
			FROM team_prompts p
			LEFT JOIN users u ON u.id = p.created_by
			WHERE p.status = $1
			   OR (p.status IN ($2, $3) AND p.created_by = $4)
			ORDER BY p.created_at DESC
			LIMIT $5 OFFSET $6
		`, PromptStatusOnShelf, PromptStatusPendingReview, PromptStatusRejected, userID, pageSize, common.Offset(page, pageSize))
	}
	if err != nil {
		return common.PaginatedList[Prompt]{}, fmt.Errorf("list prompts failed: %w", err)
	}
	defer rows.Close()

	result := make([]Prompt, 0)
	promptIDs := make([]string, 0)
	for rows.Next() {
		var p Prompt
		var reviewedAt sql.NullTime
		var createdBy, reviewedBy sql.NullString
		if err := rows.Scan(&p.ID, &p.Name, &p.Description, &p.Content, &p.UseCase, &p.UsageCount, &p.AddedToSpace,
			&p.Status, &createdBy, &p.CreatedByName, &reviewedBy, &reviewedAt, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return common.PaginatedList[Prompt]{}, fmt.Errorf("scan prompt failed: %w", err)
		}
		p.CreatedBy = sqlutil.ScanNullString(createdBy)
		p.ReviewedBy = sqlutil.ScanNullString(reviewedBy)
		p.CategoryIDs = []string{}
		if reviewedAt.Valid {
			p.ReviewedAt = &reviewedAt.Time
		}
		result = append(result, p)
		promptIDs = append(promptIDs, p.ID)
	}
	if err := rows.Err(); err != nil {
		return common.PaginatedList[Prompt]{}, fmt.Errorf("iterate prompts failed: %w", err)
	}

	// 批量补充多分类链接（避免逐行 N+1 查询）。
	categoryMap, err := s.listLinkedCategoryIDs(promptCategoryLinkTable, "prompt_id", promptIDs)
	if err != nil {
		return common.PaginatedList[Prompt]{}, err
	}
	for i := range result {
		if ids, ok := categoryMap[result[i].ID]; ok {
			result[i].CategoryIDs = ids
		}
	}

	return common.PaginatedList[Prompt]{
		List:     result,
		Total:    total,
		Page:     page,
		PageSize: pageSize,
	}, nil
}

// CreatePrompt 创建新提示词，默认进入审核中状态。
func (s *DBTeamService) CreatePrompt(req CreatePromptRequest, createdBy string) (Prompt, error) {
	now := time.Now().UTC()
	prompt := Prompt{
		ID:           uuid.New().String(),
		Name:         req.Name,
		Description:  req.Description,
		Content:      req.Content,
		UseCase:      req.UseCase,
		UsageCount:   0,
		AddedToSpace: true,
		Status:       PromptStatusPendingReview,
		CreatedBy:    createdBy,
		CreatedAt:    now,
		UpdatedAt:    now,
	}

	_, err := s.db.Exec(`
		INSERT INTO team_prompts (id, name, description, content, use_case, usage_count, added_to_space,
		                         status, created_by, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
	`, prompt.ID, prompt.Name, prompt.Description, prompt.Content, prompt.UseCase, prompt.UsageCount, prompt.AddedToSpace,
		prompt.Status, prompt.CreatedBy, prompt.CreatedAt, prompt.UpdatedAt)
	if err != nil {
		return Prompt{}, fmt.Errorf("insert prompt failed: %w", err)
	}
	return prompt, nil
}

// UpdatePrompt 允许创建人修改 pending/rejected 状态的提示词，超管可修改任意。
func (s *DBTeamService) UpdatePrompt(id string, req UpdatePromptRequest, userID string, isSuperAdmin bool) (Prompt, error) {
	prompt, err := s.getPrompt(id)
	if err != nil {
		return Prompt{}, err
	}
	if !isSuperAdmin && prompt.CreatedBy != userID {
		return Prompt{}, errors.New("forbidden: not the creator")
	}
	if !isSuperAdmin && prompt.Status != PromptStatusPendingReview && prompt.Status != PromptStatusRejected {
		return Prompt{}, errors.New("forbidden: can only edit pending or rejected prompts")
	}

	if req.Name != nil {
		prompt.Name = *req.Name
	}
	if req.Description != nil {
		prompt.Description = *req.Description
	}
	if req.Content != nil {
		prompt.Content = *req.Content
	}
	if req.UseCase != nil {
		prompt.UseCase = *req.UseCase
	}

	_, err = s.db.Exec(`
		UPDATE team_prompts
		SET name = $1, description = $2, content = $3, use_case = $4, updated_at = $5
		WHERE id = $6
	`, prompt.Name, prompt.Description, prompt.Content, prompt.UseCase, time.Now().UTC(), id)
	if err != nil {
		return Prompt{}, fmt.Errorf("update prompt failed: %w", err)
	}
	return s.getPrompt(id)
}

// DeletePrompt 删除提示词，权限规则同 UpdatePrompt。
func (s *DBTeamService) DeletePrompt(id string, userID string, isSuperAdmin bool) error {
	prompt, err := s.getPrompt(id)
	if err != nil {
		return err
	}
	if !isSuperAdmin && prompt.CreatedBy != userID {
		return errors.New("forbidden: not the creator")
	}
	if !isSuperAdmin && prompt.Status != PromptStatusPendingReview && prompt.Status != PromptStatusRejected {
		return errors.New("forbidden: can only delete pending or rejected prompts")
	}

	res, err := s.db.Exec(`DELETE FROM team_prompts WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("delete prompt failed: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return errors.New("prompt not found")
	}
	return nil
}

// ReviewPrompt 超级管理员审核提示词。
func (s *DBTeamService) ReviewPrompt(id string, action string, reviewerID string) (Prompt, error) {
	prompt, err := s.getPrompt(id)
	if err != nil {
		return Prompt{}, err
	}

	now := time.Now().UTC()
	var status PromptStatus
	switch action {
	case "approve":
		status = PromptStatusOnShelf
	case "reject":
		status = PromptStatusRejected
	case "unshelf":
		if prompt.Status != PromptStatusOnShelf {
			return Prompt{}, errors.New("prompt is not on shelf")
		}
		status = PromptStatusOffShelf
	default:
		return Prompt{}, errors.New("invalid review action")
	}

	_, err = s.db.Exec(`
		UPDATE team_prompts
		SET status = $1, reviewed_by = $2, reviewed_at = $3, updated_at = $4
		WHERE id = $5
	`, status, reviewerID, now, now, id)
	if err != nil {
		return Prompt{}, fmt.Errorf("review prompt failed: %w", err)
	}
	return s.getPrompt(id)
}

// UpdatePromptCategories 更新提示词的多分类关联（替换语义，仅超管）。
func (s *DBTeamService) UpdatePromptCategories(id string, categoryIDs []string) (Prompt, error) {
	if _, err := s.getPrompt(id); err != nil {
		return Prompt{}, err
	}
	if err := s.replaceCategoryLinks(promptCategoryLinkTable, promptCategoryTable, "prompt_id", id, categoryIDs, ""); err != nil {
		return Prompt{}, err
	}
	return s.getPrompt(id)
}

// GetPrompt 按 ID 查询提示词。
func (s *DBTeamService) GetPrompt(id string) (Prompt, error) {
	return s.getPrompt(id)
}

// RecordPromptUsage 记录一次市场提示词的复制使用并返回最新提示词。
// 去重策略：同一用户（userID）对同一提示词每天（UTC 日期）只计数一次——
// 先向去重表插入（冲突即当日已计数），仅插入成功时才递增 usage_count。
// 采用登录用户 ID 而非 User-Agent 作为去重维度：市场接口均需登录，用户 ID 不可伪造，
// 且同一用户跨浏览器复制同一提示词也应视为同一次使用。
func (s *DBTeamService) RecordPromptUsage(id string, userID string) (Prompt, error) {
	if _, err := s.getPrompt(id); err != nil {
		return Prompt{}, err
	}

	tx, err := s.db.Begin()
	if err != nil {
		return Prompt{}, fmt.Errorf("begin transaction failed: %w", err)
	}
	defer tx.Rollback()

	res, err := tx.Exec(`
		INSERT INTO team_prompt_usage_daily (prompt_id, user_id, usage_date)
		VALUES ($1, $2, CURRENT_DATE)
		ON CONFLICT DO NOTHING
	`, id, userID)
	if err != nil {
		return Prompt{}, fmt.Errorf("insert prompt usage dedup failed: %w", err)
	}

	// RowsAffected 为 0 表示当日已计数，跳过递增。
	if n, _ := res.RowsAffected(); n > 0 {
		if _, err := tx.Exec(`
			UPDATE team_prompts SET usage_count = usage_count + 1, updated_at = $1 WHERE id = $2
		`, time.Now().UTC(), id); err != nil {
			return Prompt{}, fmt.Errorf("increment prompt usage failed: %w", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return Prompt{}, fmt.Errorf("commit failed: %w", err)
	}
	return s.getPrompt(id)
}

func (s *DBTeamService) getPrompt(id string) (Prompt, error) {
	var p Prompt
	var reviewedAt sql.NullTime
	var createdBy, reviewedBy sql.NullString
	err := s.db.QueryRow(`
		SELECT p.id, p.name, p.description, p.content, p.use_case, p.usage_count, p.added_to_space,
		       p.status, p.created_by, COALESCE(u.name, ''), p.reviewed_by, p.reviewed_at, p.created_at, p.updated_at
		FROM team_prompts p
		LEFT JOIN users u ON u.id = p.created_by
		WHERE p.id = $1
	`, id).Scan(&p.ID, &p.Name, &p.Description, &p.Content, &p.UseCase, &p.UsageCount, &p.AddedToSpace,
		&p.Status, &createdBy, &p.CreatedByName, &reviewedBy, &reviewedAt, &p.CreatedAt, &p.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Prompt{}, errors.New("prompt not found")
	}
	if err != nil {
		return Prompt{}, fmt.Errorf("get prompt failed: %w", err)
	}
	p.CreatedBy = sqlutil.ScanNullString(createdBy)
	p.ReviewedBy = sqlutil.ScanNullString(reviewedBy)
	p.CategoryIDs = []string{}
	if reviewedAt.Valid {
		p.ReviewedAt = &reviewedAt.Time
	}
	categoryMap, err := s.listLinkedCategoryIDs(promptCategoryLinkTable, "prompt_id", []string{id})
	if err != nil {
		return Prompt{}, err
	}
	if ids, ok := categoryMap[id]; ok {
		p.CategoryIDs = ids
	}
	return p, nil
}

func parseTags(ns sql.NullString) []string {
	if !ns.Valid || strings.TrimSpace(ns.String) == "" {
		return []string{}
	}
	parts := strings.Split(ns.String, ",")
	result := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			result = append(result, p)
		}
	}
	return result
}

func parseTagsInput(s string) []string {
	if strings.TrimSpace(s) == "" {
		return []string{}
	}
	parts := strings.Split(s, ",")
	result := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			result = append(result, p)
		}
	}
	return result
}

func defaultIcon(icon string) string {
	if strings.TrimSpace(icon) == "" {
		return "Puzzle"
	}
	return icon
}

func defaultPhase(phase string) string {
	if strings.TrimSpace(phase) == "" {
		return "代码开发"
	}
	return phase
}

// listLinkedCategoryIDs 按链接表批量查询实体的分类 ID 并按实体 ID 分组。
// 技能链接表（skill_id）与提示词链接表（prompt_id）结构一致，通过表名/列名参数化复用（规则6）。
func (s *DBTeamService) listLinkedCategoryIDs(linkTable, idColumn string, ids []string) (map[string][]string, error) {
	result := make(map[string][]string)
	if len(ids) == 0 {
		return result, nil
	}
	placeholders := make([]string, len(ids))
	args := make([]any, len(ids))
	for i, id := range ids {
		placeholders[i] = fmt.Sprintf("$%d", i+1)
		args[i] = id
	}
	query := fmt.Sprintf(`
		SELECT %s, category_id FROM %s WHERE %s IN (%s)
	`, idColumn, linkTable, idColumn, strings.Join(placeholders, ", "))
	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("list category links failed: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var entityID, categoryID string
		if err := rows.Scan(&entityID, &categoryID); err != nil {
			return nil, fmt.Errorf("scan category link failed: %w", err)
		}
		result[entityID] = append(result[entityID], categoryID)
	}
	return result, rows.Err()
}

// replaceCategoryLinks 以事务替换实体的分类链接：先校验分类 ID 均存在于分类表，再 delete + insert。
// workspaceID 非空时，仅允许使用属于该工作区或全局的分类（用于技能分类隔离）。
func (s *DBTeamService) replaceCategoryLinks(linkTable, categoryTable, idColumn, id string, categoryIDs []string, workspaceID string) error {
	// 去重并过滤空 ID，避免主键冲突与脏数据。
	deduped := make([]string, 0, len(categoryIDs))
	seen := make(map[string]bool, len(categoryIDs))
	for _, cid := range categoryIDs {
		if cid == "" || seen[cid] {
			continue
		}
		seen[cid] = true
		deduped = append(deduped, cid)
	}

	if len(deduped) > 0 {
		placeholders := make([]string, len(deduped))
		args := make([]any, len(deduped))
		for i, cid := range deduped {
			placeholders[i] = fmt.Sprintf("$%d", i+1)
			args[i] = cid
		}
		var query string
		if workspaceID != "" {
			workspacePlaceholder := fmt.Sprintf("$%d", len(deduped)+1)
			query = fmt.Sprintf(`SELECT COUNT(*) FROM %s WHERE id IN (%s) AND (workspace_id = %s OR workspace_id IS NULL)`, categoryTable, strings.Join(placeholders, ", "), workspacePlaceholder)
			args = append(args, workspaceID)
		} else {
			query = fmt.Sprintf(`SELECT COUNT(*) FROM %s WHERE id IN (%s)`, categoryTable, strings.Join(placeholders, ", "))
		}
		var validCount int
		if err := s.db.QueryRow(query, args...).Scan(&validCount); err != nil {
			return fmt.Errorf("validate categories failed: %w", err)
		}
		if validCount != len(deduped) {
			return errors.New("some categories do not exist")
		}
	}

	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("begin transaction failed: %w", err)
	}
	defer tx.Rollback()

	deleteQuery := fmt.Sprintf(`DELETE FROM %s WHERE %s = $1`, linkTable, idColumn)
	if _, err := tx.Exec(deleteQuery, id); err != nil {
		return fmt.Errorf("delete old category links failed: %w", err)
	}

	insertQuery := fmt.Sprintf(`INSERT INTO %s (%s, category_id) VALUES ($1, $2)`, linkTable, idColumn)
	for _, cid := range deduped {
		if _, err := tx.Exec(insertQuery, id, cid); err != nil {
			return fmt.Errorf("insert category link failed: %w", err)
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit failed: %w", err)
	}
	return nil
}

// ListSkillCategories 返回技能分类。
// workspaceID 非空时，仅返回该工作区的分类及全局内置分类。
func (s *DBTeamService) ListSkillCategories(workspaceID string) ([]SkillCategory, error) {
	var rows *sql.Rows
	var err error
	if workspaceID == "" {
		rows, err = s.db.Query(`
			SELECT id, name, builtin, sort_order, created_at, updated_at
			FROM team_skill_categories
			ORDER BY sort_order ASC, created_at ASC
		`)
	} else {
		rows, err = s.db.Query(`
			SELECT id, name, builtin, sort_order, created_at, updated_at
			FROM team_skill_categories
			WHERE workspace_id = $1 OR workspace_id IS NULL
			ORDER BY sort_order ASC, created_at ASC
		`, workspaceID)
	}
	if err != nil {
		return nil, fmt.Errorf("list skill categories failed: %w", err)
	}
	defer rows.Close()

	result := make([]SkillCategory, 0)
	for rows.Next() {
		var c SkillCategory
		if err := rows.Scan(&c.ID, &c.Name, &c.Builtin, &c.SortOrder, &c.CreatedAt, &c.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan skill category failed: %w", err)
		}
		result = append(result, c)
	}
	return result, rows.Err()
}

// CreateSkillCategory 创建新技能分类。
// workspaceID 非空时，分类归属到该工作区。
func (s *DBTeamService) CreateSkillCategory(req CreateSkillCategoryRequest, workspaceID string) (SkillCategory, error) {
	if strings.TrimSpace(req.Name) == "" {
		return SkillCategory{}, errors.New("name is required")
	}
	now := time.Now().UTC()
	category := SkillCategory{
		ID:        uuid.New().String(),
		Name:      strings.TrimSpace(req.Name),
		Builtin:   false,
		SortOrder: 0,
		CreatedAt: now,
		UpdatedAt: now,
	}
	var workspaceIDArg interface{}
	if workspaceID != "" {
		workspaceIDArg = workspaceID
	}
	_, err := s.db.Exec(`
		INSERT INTO team_skill_categories (id, name, workspace_id, builtin, sort_order, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
	`, category.ID, category.Name, workspaceIDArg, category.Builtin, category.SortOrder, category.CreatedAt, category.UpdatedAt)
	if err != nil {
		return SkillCategory{}, fmt.Errorf("insert skill category failed: %w", err)
	}
	return category, nil
}

// DeleteSkillCategory 删除技能分类，内置分类不可删除。
// workspaceID 非空时，仅允许删除属于该工作区的非内置分类，防止误删全局分类。
func (s *DBTeamService) DeleteSkillCategory(id string, workspaceID string) error {
	var builtin bool
	var categoryWorkspaceID sql.NullString
	err := s.db.QueryRow(`
		SELECT builtin, workspace_id FROM team_skill_categories WHERE id = $1
	`, id).Scan(&builtin, &categoryWorkspaceID)
	if errors.Is(err, sql.ErrNoRows) {
		return errors.New("skill category not found")
	}
	if err != nil {
		return fmt.Errorf("get skill category failed: %w", err)
	}
	if builtin {
		return errors.New("cannot delete builtin category")
	}
	if workspaceID != "" {
		if categoryWorkspaceID.Valid && categoryWorkspaceID.String != workspaceID {
			return errors.New("cannot delete category from another workspace")
		}
		if !categoryWorkspaceID.Valid {
			return errors.New("cannot delete global category from workspace context")
		}
	}
	if _, err := s.db.Exec(`DELETE FROM team_skill_categories WHERE id = $1`, id); err != nil {
		return fmt.Errorf("delete skill category failed: %w", err)
	}
	return nil
}

// ListPromptCategories 返回所有提示词分类，按排序权重和创建时间排序。
func (s *DBTeamService) ListPromptCategories() ([]PromptCategory, error) {
	rows, err := s.db.Query(`
		SELECT id, name, builtin, sort_order, created_at, updated_at
		FROM team_prompt_categories
		ORDER BY sort_order ASC, created_at ASC
	`)
	if err != nil {
		return nil, fmt.Errorf("list prompt categories failed: %w", err)
	}
	defer rows.Close()

	result := make([]PromptCategory, 0)
	for rows.Next() {
		var c PromptCategory
		if err := rows.Scan(&c.ID, &c.Name, &c.Builtin, &c.SortOrder, &c.CreatedAt, &c.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan prompt category failed: %w", err)
		}
		result = append(result, c)
	}
	return result, rows.Err()
}

// CreatePromptCategory 创建新提示词分类。
func (s *DBTeamService) CreatePromptCategory(req CreatePromptCategoryRequest) (PromptCategory, error) {
	if strings.TrimSpace(req.Name) == "" {
		return PromptCategory{}, errors.New("name is required")
	}
	now := time.Now().UTC()
	category := PromptCategory{
		ID:        uuid.New().String(),
		Name:      strings.TrimSpace(req.Name),
		Builtin:   false,
		SortOrder: 0,
		CreatedAt: now,
		UpdatedAt: now,
	}
	_, err := s.db.Exec(`
		INSERT INTO team_prompt_categories (id, name, builtin, sort_order, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6)
	`, category.ID, category.Name, category.Builtin, category.SortOrder, category.CreatedAt, category.UpdatedAt)
	if err != nil {
		return PromptCategory{}, fmt.Errorf("insert prompt category failed: %w", err)
	}
	return category, nil
}

// DeletePromptCategory 删除提示词分类，内置分类不可删除。
func (s *DBTeamService) DeletePromptCategory(id string) error {
	var builtin bool
	err := s.db.QueryRow(`SELECT builtin FROM team_prompt_categories WHERE id = $1`, id).Scan(&builtin)
	if errors.Is(err, sql.ErrNoRows) {
		return errors.New("prompt category not found")
	}
	if err != nil {
		return fmt.Errorf("get prompt category failed: %w", err)
	}
	if builtin {
		return errors.New("cannot delete builtin category")
	}
	if _, err := s.db.Exec(`DELETE FROM team_prompt_categories WHERE id = $1`, id); err != nil {
		return fmt.Errorf("delete prompt category failed: %w", err)
	}
	return nil
}

// GetSkillStats 返回技能大盘统计数据。
// workspaceID 非空时，统计数据按工作区隔离（安装状态以 workspace_skill_installs 为准）。
func (s *DBTeamService) GetSkillStats(workspaceID string) (SkillStats, error) {
	stats := SkillStats{
		CategoryDistribution: make([]CategoryDistribution, 0),
		TopSkills:            make([]TopSkill, 0),
	}

	if workspaceID == "" {
		if err := s.db.QueryRow(`SELECT COUNT(*), COUNT(*) FILTER (WHERE installed = TRUE) FROM team_skills`).Scan(&stats.Total, &stats.InstalledCount); err != nil {
			return SkillStats{}, fmt.Errorf("count skill stats failed: %w", err)
		}
	} else {
		if err := s.db.QueryRow(`
			SELECT COUNT(*), COUNT(*) FILTER (WHERE COALESCE(wsi.installed, s.installed) = TRUE)
			FROM team_skills s
			LEFT JOIN workspace_skill_installs wsi ON wsi.skill_id = s.id AND wsi.workspace_id = $1
			WHERE s.workspace_id = $1 OR s.workspace_id IS NULL
		`, workspaceID).Scan(&stats.Total, &stats.InstalledCount); err != nil {
			return SkillStats{}, fmt.Errorf("count skill stats failed: %w", err)
		}
	}

	var rows *sql.Rows
	var err error
	if workspaceID == "" {
		rows, err = s.db.Query(`
			SELECT category, COUNT(*) AS count
			FROM team_skills
			GROUP BY category
			ORDER BY count DESC
		`)
	} else {
		rows, err = s.db.Query(`
			SELECT category, COUNT(*) AS count
			FROM team_skills
			WHERE workspace_id = $1 OR workspace_id IS NULL
			GROUP BY category
			ORDER BY count DESC
		`, workspaceID)
	}
	if err != nil {
		return SkillStats{}, fmt.Errorf("list skill category distribution failed: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var d CategoryDistribution
		if err := rows.Scan(&d.Category, &d.Count); err != nil {
			return SkillStats{}, fmt.Errorf("scan skill category distribution failed: %w", err)
		}
		stats.CategoryDistribution = append(stats.CategoryDistribution, d)
	}
	if err := rows.Err(); err != nil {
		return SkillStats{}, fmt.Errorf("iterate skill category distribution failed: %w", err)
	}

	var topRows *sql.Rows
	if workspaceID == "" {
		topRows, err = s.db.Query(`
			SELECT id, name, category, downloads, rating
			FROM team_skills
			ORDER BY downloads DESC
			LIMIT 10
		`)
	} else {
		topRows, err = s.db.Query(`
			SELECT id, name, category, downloads, rating
			FROM team_skills
			WHERE workspace_id = $1 OR workspace_id IS NULL
			ORDER BY downloads DESC
			LIMIT 10
		`, workspaceID)
	}
	if err != nil {
		return SkillStats{}, fmt.Errorf("list top skills failed: %w", err)
	}
	defer topRows.Close()
	for topRows.Next() {
		var t TopSkill
		if err := topRows.Scan(&t.ID, &t.Name, &t.Category, &t.Downloads, &t.Rating); err != nil {
			return SkillStats{}, fmt.Errorf("scan top skill failed: %w", err)
		}
		stats.TopSkills = append(stats.TopSkills, t)
	}
	if err := topRows.Err(); err != nil {
		return SkillStats{}, fmt.Errorf("iterate top skills failed: %w", err)
	}

	return stats, nil
}

// GetPromptStats 返回提示词大盘统计数据。
func (s *DBTeamService) GetPromptStats() (PromptStats, error) {
	stats := PromptStats{
		CategoryDistribution: make([]CategoryDistribution, 0),
		StatusDistribution:   make([]StatusDistribution, 0),
		TopPrompts:           make([]TopPrompt, 0),
	}

	if err := s.db.QueryRow(`
		SELECT COUNT(*), COUNT(*) FILTER (WHERE status = $1)
		FROM team_prompts
	`, PromptStatusOnShelf).Scan(&stats.Total, &stats.OnShelfCount); err != nil {
		return PromptStats{}, fmt.Errorf("count prompt stats failed: %w", err)
	}

	catRows, err := s.db.Query(`
		SELECT use_case, COUNT(*) AS count
		FROM team_prompts
		GROUP BY use_case
		ORDER BY count DESC
	`)
	if err != nil {
		return PromptStats{}, fmt.Errorf("list prompt category distribution failed: %w", err)
	}
	defer catRows.Close()
	for catRows.Next() {
		var d CategoryDistribution
		if err := catRows.Scan(&d.Category, &d.Count); err != nil {
			return PromptStats{}, fmt.Errorf("scan prompt category distribution failed: %w", err)
		}
		stats.CategoryDistribution = append(stats.CategoryDistribution, d)
	}
	if err := catRows.Err(); err != nil {
		return PromptStats{}, fmt.Errorf("iterate prompt category distribution failed: %w", err)
	}

	statusRows, err := s.db.Query(`
		SELECT status, COUNT(*) AS count
		FROM team_prompts
		GROUP BY status
		ORDER BY count DESC
	`)
	if err != nil {
		return PromptStats{}, fmt.Errorf("list prompt status distribution failed: %w", err)
	}
	defer statusRows.Close()
	for statusRows.Next() {
		var d StatusDistribution
		if err := statusRows.Scan(&d.Status, &d.Count); err != nil {
			return PromptStats{}, fmt.Errorf("scan prompt status distribution failed: %w", err)
		}
		stats.StatusDistribution = append(stats.StatusDistribution, d)
	}
	if err := statusRows.Err(); err != nil {
		return PromptStats{}, fmt.Errorf("iterate prompt status distribution failed: %w", err)
	}

	topRows, err := s.db.Query(`
		SELECT id, name, use_case, usage_count
		FROM team_prompts
		ORDER BY usage_count DESC
		LIMIT 10
	`)
	if err != nil {
		return PromptStats{}, fmt.Errorf("list top prompts failed: %w", err)
	}
	defer topRows.Close()
	for topRows.Next() {
		var t TopPrompt
		if err := topRows.Scan(&t.ID, &t.Name, &t.UseCase, &t.UsageCount); err != nil {
			return PromptStats{}, fmt.Errorf("scan top prompt failed: %w", err)
		}
		stats.TopPrompts = append(stats.TopPrompts, t)
	}
	if err := topRows.Err(); err != nil {
		return PromptStats{}, fmt.Errorf("iterate top prompts failed: %w", err)
	}

	return stats, nil
}
