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
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Category    string   `json:"category"`
	Tags        []string `json:"tags"`
	Downloads   int      `json:"downloads"`
	Rating      float64  `json:"rating"`
	Installed   bool     `json:"installed"`
	Icon        string   `json:"icon"`
	Phase       string   `json:"phase"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
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
	UsageCount   int          `json:"usageCount"`
	AddedToSpace bool         `json:"addedToSpace"`
	Status       PromptStatus `json:"status"`
	CreatedBy    string       `json:"createdBy,omitempty"`
	ReviewedBy   string       `json:"reviewedBy,omitempty"`
	ReviewedAt   *time.Time   `json:"reviewedAt,omitempty"`
	CreatedAt    time.Time    `json:"createdAt"`
	UpdatedAt    time.Time    `json:"updatedAt"`
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
	Total               int                    `json:"total"`
	InstalledCount      int                    `json:"installedCount"`
	CategoryDistribution []CategoryDistribution `json:"categoryDistribution"`
	TopSkills           []TopSkill             `json:"topSkills"`
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
	ListSkills(page, pageSize int) (common.PaginatedList[Skill], error)
	CreateSkill(req CreateSkillRequest) (Skill, error)
	UpdateSkill(id string, req UpdateSkillRequest) (Skill, error)
	DeleteSkill(id string) error
	ListSkillCategories() ([]SkillCategory, error)
	CreateSkillCategory(req CreateSkillCategoryRequest) (SkillCategory, error)
	DeleteSkillCategory(id string) error

	ListPromptsVisibleTo(userID string, isSuperAdmin bool, page, pageSize int) (common.PaginatedList[Prompt], error)
	CreatePrompt(req CreatePromptRequest, createdBy string) (Prompt, error)
	UpdatePrompt(id string, req UpdatePromptRequest, userID string, isSuperAdmin bool) (Prompt, error)
	DeletePrompt(id string, userID string, isSuperAdmin bool) error
	ReviewPrompt(id string, action string, reviewerID string) (Prompt, error)
	GetPrompt(id string) (Prompt, error)
	ListPromptCategories() ([]PromptCategory, error)
	CreatePromptCategory(req CreatePromptCategoryRequest) (PromptCategory, error)
	DeletePromptCategory(id string) error

	GetSkillStats() (SkillStats, error)
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
func (s *DBTeamService) ListSkills(page, pageSize int) (common.PaginatedList[Skill], error) {
	page = common.NormalizePage(page)
	pageSize = common.NormalizePageSize(pageSize, 10, 100)

	var total int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM team_skills`).Scan(&total); err != nil {
		return common.PaginatedList[Skill]{}, fmt.Errorf("count skills failed: %w", err)
	}

	rows, err := s.db.Query(`
		SELECT id, name, description, category, tags, downloads, rating, installed, icon, phase, created_at, updated_at
		FROM team_skills
		ORDER BY created_at DESC
		LIMIT $1 OFFSET $2
	`, pageSize, common.Offset(page, pageSize))
	if err != nil {
		return common.PaginatedList[Skill]{}, fmt.Errorf("list skills failed: %w", err)
	}
	defer rows.Close()

	result := make([]Skill, 0)
	for rows.Next() {
		var sk Skill
		var tags sql.NullString
		if err := rows.Scan(&sk.ID, &sk.Name, &sk.Description, &sk.Category, &tags, &sk.Downloads, &sk.Rating, &sk.Installed, &sk.Icon, &sk.Phase, &sk.CreatedAt, &sk.UpdatedAt); err != nil {
			return common.PaginatedList[Skill]{}, fmt.Errorf("scan skill failed: %w", err)
		}
		sk.Tags = parseTags(tags)
		result = append(result, sk)
	}
	if err := rows.Err(); err != nil {
		return common.PaginatedList[Skill]{}, fmt.Errorf("iterate skills failed: %w", err)
	}

	return common.PaginatedList[Skill]{
		List:     result,
		Total:    total,
		Page:     page,
		PageSize: pageSize,
	}, nil
}

// CreateSkill 创建新技能。
func (s *DBTeamService) CreateSkill(req CreateSkillRequest) (Skill, error) {
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

	_, err := s.db.Exec(`
		INSERT INTO team_skills (id, name, description, category, tags, downloads, rating, installed, icon, phase, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
	`, skill.ID, skill.Name, skill.Description, skill.Category, strings.Join(skill.Tags, ","), skill.Downloads, skill.Rating, skill.Installed, skill.Icon, skill.Phase, skill.CreatedAt, skill.UpdatedAt)
	if err != nil {
		return Skill{}, fmt.Errorf("insert skill failed: %w", err)
	}
	return skill, nil
}

// UpdateSkill 更新技能状态。
func (s *DBTeamService) UpdateSkill(id string, req UpdateSkillRequest) (Skill, error) {
	skill, err := s.getSkill(id)
	if err != nil {
		return Skill{}, err
	}
	if req.Installed != nil {
		skill.Installed = *req.Installed
	}

	_, err = s.db.Exec(`
		UPDATE team_skills SET installed = $1, updated_at = $2 WHERE id = $3
	`, skill.Installed, time.Now().UTC(), id)
	if err != nil {
		return Skill{}, fmt.Errorf("update skill failed: %w", err)
	}
	return skill, nil
}

// DeleteSkill 删除技能。
func (s *DBTeamService) DeleteSkill(id string) error {
	res, err := s.db.Exec(`DELETE FROM team_skills WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("delete skill failed: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return errors.New("skill not found")
	}
	return nil
}

func (s *DBTeamService) getSkill(id string) (Skill, error) {
	var sk Skill
	var tags sql.NullString
	err := s.db.QueryRow(`
		SELECT id, name, description, category, tags, downloads, rating, installed, icon, phase, created_at, updated_at
		FROM team_skills WHERE id = $1
	`, id).Scan(&sk.ID, &sk.Name, &sk.Description, &sk.Category, &tags, &sk.Downloads, &sk.Rating, &sk.Installed, &sk.Icon, &sk.Phase, &sk.CreatedAt, &sk.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Skill{}, errors.New("skill not found")
	}
	if err != nil {
		return Skill{}, fmt.Errorf("get skill failed: %w", err)
	}
	sk.Tags = parseTags(tags)
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
			SELECT id, name, description, content, use_case, usage_count, added_to_space,
			       status, created_by, reviewed_by, reviewed_at, created_at, updated_at
			FROM team_prompts
			ORDER BY created_at DESC
			LIMIT $1 OFFSET $2
		`, pageSize, common.Offset(page, pageSize))
	} else {
		rows, err = s.db.Query(`
			SELECT id, name, description, content, use_case, usage_count, added_to_space,
			       status, created_by, reviewed_by, reviewed_at, created_at, updated_at
			FROM team_prompts
			WHERE status = $1
			   OR (status IN ($2, $3) AND created_by = $4)
			ORDER BY created_at DESC
			LIMIT $5 OFFSET $6
		`, PromptStatusOnShelf, PromptStatusPendingReview, PromptStatusRejected, userID, pageSize, common.Offset(page, pageSize))
	}
	if err != nil {
		return common.PaginatedList[Prompt]{}, fmt.Errorf("list prompts failed: %w", err)
	}
	defer rows.Close()

	result := make([]Prompt, 0)
	for rows.Next() {
		var p Prompt
		var reviewedAt sql.NullTime
		var createdBy, reviewedBy sql.NullString
		if err := rows.Scan(&p.ID, &p.Name, &p.Description, &p.Content, &p.UseCase, &p.UsageCount, &p.AddedToSpace,
			&p.Status, &createdBy, &reviewedBy, &reviewedAt, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return common.PaginatedList[Prompt]{}, fmt.Errorf("scan prompt failed: %w", err)
		}
		p.CreatedBy = sqlutil.ScanNullString(createdBy)
		p.ReviewedBy = sqlutil.ScanNullString(reviewedBy)
		if reviewedAt.Valid {
			p.ReviewedAt = &reviewedAt.Time
		}
		result = append(result, p)
	}
	if err := rows.Err(); err != nil {
		return common.PaginatedList[Prompt]{}, fmt.Errorf("iterate prompts failed: %w", err)
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

// GetPrompt 按 ID 查询提示词。
func (s *DBTeamService) GetPrompt(id string) (Prompt, error) {
	return s.getPrompt(id)
}

func (s *DBTeamService) getPrompt(id string) (Prompt, error) {
	var p Prompt
	var reviewedAt sql.NullTime
	var createdBy, reviewedBy sql.NullString
	err := s.db.QueryRow(`
		SELECT id, name, description, content, use_case, usage_count, added_to_space,
		       status, created_by, reviewed_by, reviewed_at, created_at, updated_at
		FROM team_prompts WHERE id = $1
	`, id).Scan(&p.ID, &p.Name, &p.Description, &p.Content, &p.UseCase, &p.UsageCount, &p.AddedToSpace,
		&p.Status, &createdBy, &reviewedBy, &reviewedAt, &p.CreatedAt, &p.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Prompt{}, errors.New("prompt not found")
	}
	if err != nil {
		return Prompt{}, fmt.Errorf("get prompt failed: %w", err)
	}
	p.CreatedBy = sqlutil.ScanNullString(createdBy)
	p.ReviewedBy = sqlutil.ScanNullString(reviewedBy)
	if reviewedAt.Valid {
		p.ReviewedAt = &reviewedAt.Time
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

// ListSkillCategories 返回所有技能分类，按排序权重和创建时间排序。
func (s *DBTeamService) ListSkillCategories() ([]SkillCategory, error) {
	rows, err := s.db.Query(`
		SELECT id, name, builtin, sort_order, created_at, updated_at
		FROM team_skill_categories
		ORDER BY sort_order ASC, created_at ASC
	`)
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
func (s *DBTeamService) CreateSkillCategory(req CreateSkillCategoryRequest) (SkillCategory, error) {
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
	_, err := s.db.Exec(`
		INSERT INTO team_skill_categories (id, name, builtin, sort_order, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6)
	`, category.ID, category.Name, category.Builtin, category.SortOrder, category.CreatedAt, category.UpdatedAt)
	if err != nil {
		return SkillCategory{}, fmt.Errorf("insert skill category failed: %w", err)
	}
	return category, nil
}

// DeleteSkillCategory 删除技能分类，内置分类不可删除。
func (s *DBTeamService) DeleteSkillCategory(id string) error {
	var builtin bool
	err := s.db.QueryRow(`SELECT builtin FROM team_skill_categories WHERE id = $1`, id).Scan(&builtin)
	if errors.Is(err, sql.ErrNoRows) {
		return errors.New("skill category not found")
	}
	if err != nil {
		return fmt.Errorf("get skill category failed: %w", err)
	}
	if builtin {
		return errors.New("cannot delete builtin category")
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
func (s *DBTeamService) GetSkillStats() (SkillStats, error) {
	stats := SkillStats{
		CategoryDistribution: make([]CategoryDistribution, 0),
		TopSkills:            make([]TopSkill, 0),
	}

	if err := s.db.QueryRow(`SELECT COUNT(*), COUNT(*) FILTER (WHERE installed = TRUE) FROM team_skills`).Scan(&stats.Total, &stats.InstalledCount); err != nil {
		return SkillStats{}, fmt.Errorf("count skill stats failed: %w", err)
	}

	rows, err := s.db.Query(`
		SELECT category, COUNT(*) AS count
		FROM team_skills
		GROUP BY category
		ORDER BY count DESC
	`)
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

	topRows, err := s.db.Query(`
		SELECT id, name, category, downloads, rating
		FROM team_skills
		ORDER BY downloads DESC
		LIMIT 10
	`)
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
