package service

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/common/sqlutil"
	"github.com/google/uuid"
)

// WorkspacePrompt 表示某个工作空间下的提示词引用或自定义提示词。
type WorkspacePrompt struct {
	ID              string           `json:"id"`
	WorkspaceID     string           `json:"workspaceId"`
	LibraryPromptID *string          `json:"libraryPromptId,omitempty"`
	Categories      []PromptCategory `json:"categories"`
	Name            string           `json:"name"`
	Description     string           `json:"description"`
	Content         string           `json:"content"`
	UseCase         string           `json:"useCase"`
	UsageCount      int              `json:"usageCount"`
	IsCustom        bool             `json:"isCustom"`
	AddedToSpace    bool             `json:"addedToSpace"`
	CreatedAt       time.Time        `json:"createdAt"`
	UpdatedAt       time.Time        `json:"updatedAt"`
}

// PromptCategory 表示某个工作空间下的提示词分类，每个空间独立管理。
type PromptCategory struct {
	ID          string    `json:"id"`
	WorkspaceID string    `json:"workspaceId"`
	Name        string    `json:"name"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

// AddWorkspacePromptRequest 从提示词库添加到工作空间的请求。
type AddWorkspacePromptRequest struct {
	LibraryPromptID string `json:"libraryPromptId"`
}

// UpdateWorkspacePromptCategoryRequest 更新空间提示词分类的请求。
type UpdateWorkspacePromptCategoryRequest struct {
	CategoryIDs []string `json:"categoryIds"`
}

// WorkspacePromptService 定义工作空间提示词服务接口。
type WorkspacePromptService interface {
	List(workspaceID string) ([]WorkspacePrompt, error)
	Add(workspaceID string, req AddWorkspacePromptRequest) (WorkspacePrompt, error)
	Remove(workspaceID, promptID string) error
	UpdateCategories(workspaceID, promptID string, req UpdateWorkspacePromptCategoryRequest) (WorkspacePrompt, error)

	ListCategories(workspaceID string) ([]PromptCategory, error)
	CreateCategory(workspaceID, name string) (PromptCategory, error)
	DeleteCategory(workspaceID, categoryID string) error
}

// DBWorkspacePromptService 是基于 PostgreSQL 的 WorkspacePromptService 实现。
type DBWorkspacePromptService struct {
	db *sql.DB
}

// NewDBWorkspacePromptService 创建 PostgreSQL 实现的工作空间提示词服务。
func NewDBWorkspacePromptService(db *sql.DB) *DBWorkspacePromptService {
	return &DBWorkspacePromptService{db: db}
}

// List 返回工作空间下的提示词列表（包含关联的多个分类）。
func (s *DBWorkspacePromptService) List(workspaceID string) ([]WorkspacePrompt, error) {
	rows, err := s.db.Query(`
		SELECT id, workspace_id, library_prompt_id, name, description, content, use_case,
		       usage_count, is_custom, added_to_space, created_at, updated_at
		FROM workspace_prompts
		WHERE workspace_id = $1
		ORDER BY created_at DESC
	`, workspaceID)
	if err != nil {
		return nil, fmt.Errorf("list workspace prompts failed: %w", err)
	}
	defer rows.Close()

	prompts := make([]WorkspacePrompt, 0)
	promptIDs := make([]string, 0)
	for rows.Next() {
		var p WorkspacePrompt
		var libID sql.NullString
		var desc sql.NullString
		err := rows.Scan(&p.ID, &p.WorkspaceID, &libID, &p.Name, &desc, &p.Content, &p.UseCase,
			&p.UsageCount, &p.IsCustom, &p.AddedToSpace, &p.CreatedAt, &p.UpdatedAt)
		if err != nil {
			return nil, fmt.Errorf("scan workspace prompt failed: %w", err)
		}
		p.LibraryPromptID = sqlutil.ScanNullStringPtr(libID)
		p.Description = sqlutil.ScanNullString(desc)
		p.Categories = []PromptCategory{}
		prompts = append(prompts, p)
		promptIDs = append(promptIDs, p.ID)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	if len(promptIDs) > 0 {
		categoriesMap, err := s.listCategoriesForPrompts(promptIDs)
		if err != nil {
			return nil, err
		}
		for i := range prompts {
			if cats, ok := categoriesMap[prompts[i].ID]; ok {
				prompts[i].Categories = cats
			} else {
				prompts[i].Categories = []PromptCategory{}
			}
		}
	}

	return prompts, nil
}

// listCategoriesForPrompts 查询一组提示词关联的分类，按 prompt_id 聚合。
func (s *DBWorkspacePromptService) listCategoriesForPrompts(promptIDs []string) (map[string][]PromptCategory, error) {
	placeholders := make([]string, len(promptIDs))
	args := make([]any, len(promptIDs))
	for i, id := range promptIDs {
		placeholders[i] = fmt.Sprintf("$%d", i+1)
		args[i] = id
	}
	query := fmt.Sprintf(`
		SELECT l.prompt_id, c.id, c.workspace_id, c.name, c.created_at, c.updated_at
		FROM workspace_prompt_category_links l
		JOIN workspace_prompt_categories c ON c.id = l.category_id
		WHERE l.prompt_id IN (%s)
		ORDER BY c.created_at ASC
	`, strings.Join(placeholders, ", "))
	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("list categories for prompts failed: %w", err)
	}
	defer rows.Close()

	result := make(map[string][]PromptCategory)
	for rows.Next() {
		var promptID string
		var c PromptCategory
		if err := rows.Scan(&promptID, &c.ID, &c.WorkspaceID, &c.Name, &c.CreatedAt, &c.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan prompt category link failed: %w", err)
		}
		result[promptID] = append(result[promptID], c)
	}
	return result, rows.Err()
}

// Add 从 team_prompts 添加一个已上架提示词到工作空间。
func (s *DBWorkspacePromptService) Add(workspaceID string, req AddWorkspacePromptRequest) (WorkspacePrompt, error) {
	if req.LibraryPromptID == "" {
		return WorkspacePrompt{}, errors.New("libraryPromptId is required")
	}

	var name, content, useCase string
	var desc sql.NullString
	err := s.db.QueryRow(`
		SELECT name, description, content, use_case
		FROM team_prompts
		WHERE id = $1 AND status = $2
	`, req.LibraryPromptID, "on_shelf").Scan(&name, &desc, &content, &useCase)
	if errors.Is(err, sql.ErrNoRows) {
		return WorkspacePrompt{}, errors.New("library prompt not found or not on shelf")
	}
	if err != nil {
		return WorkspacePrompt{}, fmt.Errorf("get library prompt failed: %w", err)
	}

	// 幂等：同一 library_prompt_id 在同一 workspace 下只保留一条。
	var existingID string
	err = s.db.QueryRow(`
		SELECT id FROM workspace_prompts
		WHERE workspace_id = $1 AND library_prompt_id = $2
	`, workspaceID, req.LibraryPromptID).Scan(&existingID)
	if err == nil {
		return WorkspacePrompt{}, errors.New("prompt already added to workspace")
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return WorkspacePrompt{}, fmt.Errorf("check existing workspace prompt failed: %w", err)
	}

	now := time.Now().UTC()
	p := WorkspacePrompt{
		ID:              uuid.New().String(),
		WorkspaceID:     workspaceID,
		LibraryPromptID: &req.LibraryPromptID,
		Name:            name,
		Description:     sqlutil.ScanNullString(desc),
		Content:         content,
		UseCase:         useCase,
		Categories:      []PromptCategory{},
		UsageCount:      0,
		IsCustom:        false,
		AddedToSpace:    true,
		CreatedAt:       now,
		UpdatedAt:       now,
	}

	_, err = s.db.Exec(`
		INSERT INTO workspace_prompts (id, workspace_id, library_prompt_id, name, description, content, use_case,
		                               usage_count, is_custom, added_to_space, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
	`, p.ID, p.WorkspaceID, p.LibraryPromptID, p.Name, p.Description, p.Content, p.UseCase,
		p.UsageCount, p.IsCustom, p.AddedToSpace, p.CreatedAt, p.UpdatedAt)
	if err != nil {
		return WorkspacePrompt{}, fmt.Errorf("insert workspace prompt failed: %w", err)
	}
	return p, nil
}

// Remove 从工作空间移除提示词引用。
func (s *DBWorkspacePromptService) Remove(workspaceID, promptID string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("begin transaction failed: %w", err)
	}
	defer tx.Rollback()

	if _, err := tx.Exec(`DELETE FROM workspace_prompt_category_links WHERE prompt_id = $1`, promptID); err != nil {
		return fmt.Errorf("delete prompt category links failed: %w", err)
	}

	res, err := tx.Exec(`
		DELETE FROM workspace_prompts WHERE workspace_id = $1 AND id = $2
	`, workspaceID, promptID)
	if err != nil {
		return fmt.Errorf("delete workspace prompt failed: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return errors.New("workspace prompt not found")
	}
	return tx.Commit()
}

// UpdateCategories 更新空间提示词的分类关联（支持多个）。
func (s *DBWorkspacePromptService) UpdateCategories(workspaceID, promptID string, req UpdateWorkspacePromptCategoryRequest) (WorkspacePrompt, error) {
	// 校验提示词存在。
	if _, err := s.get(workspaceID, promptID); err != nil {
		return WorkspacePrompt{}, err
	}

	// 校验所有 category_id 都属于当前空间。
	if len(req.CategoryIDs) > 0 {
		placeholders := make([]string, len(req.CategoryIDs))
		args := make([]any, len(req.CategoryIDs)+1)
		args[0] = workspaceID
		for i, id := range req.CategoryIDs {
			placeholders[i] = fmt.Sprintf("$%d", i+2)
			args[i+1] = id
		}
		query := fmt.Sprintf(`
			SELECT COUNT(*) FROM workspace_prompt_categories
			WHERE workspace_id = $1 AND id IN (%s)
		`, strings.Join(placeholders, ", "))
		var validCount int
		if err := s.db.QueryRow(query, args...).Scan(&validCount); err != nil {
			return WorkspacePrompt{}, fmt.Errorf("validate categories failed: %w", err)
		}
		if validCount != len(req.CategoryIDs) {
			return WorkspacePrompt{}, errors.New("some categories do not belong to workspace")
		}
	}

	tx, err := s.db.Begin()
	if err != nil {
		return WorkspacePrompt{}, fmt.Errorf("begin transaction failed: %w", err)
	}
	defer tx.Rollback()

	if _, err := tx.Exec(`DELETE FROM workspace_prompt_category_links WHERE prompt_id = $1`, promptID); err != nil {
		return WorkspacePrompt{}, fmt.Errorf("delete old category links failed: %w", err)
	}

	for _, categoryID := range req.CategoryIDs {
		if categoryID == "" {
			continue
		}
		if _, err := tx.Exec(`
			INSERT INTO workspace_prompt_category_links (prompt_id, category_id)
			VALUES ($1, $2)
		`, promptID, categoryID); err != nil {
			return WorkspacePrompt{}, fmt.Errorf("insert category link failed: %w", err)
		}
	}

	if _, err := tx.Exec(`
		UPDATE workspace_prompts SET updated_at = $1 WHERE workspace_id = $2 AND id = $3
	`, time.Now().UTC(), workspaceID, promptID); err != nil {
		return WorkspacePrompt{}, fmt.Errorf("update prompt updated_at failed: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return WorkspacePrompt{}, fmt.Errorf("commit failed: %w", err)
	}

	return s.get(workspaceID, promptID)
}

func (s *DBWorkspacePromptService) get(workspaceID, promptID string) (WorkspacePrompt, error) {
	var p WorkspacePrompt
	var libID sql.NullString
	var desc sql.NullString
	err := s.db.QueryRow(`
		SELECT id, workspace_id, library_prompt_id, name, description, content, use_case,
		       usage_count, is_custom, added_to_space, created_at, updated_at
		FROM workspace_prompts
		WHERE workspace_id = $1 AND id = $2
	`, workspaceID, promptID).Scan(&p.ID, &p.WorkspaceID, &libID, &p.Name, &desc, &p.Content, &p.UseCase,
		&p.UsageCount, &p.IsCustom, &p.AddedToSpace, &p.CreatedAt, &p.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return WorkspacePrompt{}, errors.New("workspace prompt not found")
	}
	if err != nil {
		return WorkspacePrompt{}, fmt.Errorf("get workspace prompt failed: %w", err)
	}
	p.LibraryPromptID = sqlutil.ScanNullStringPtr(libID)
	p.Description = sqlutil.ScanNullString(desc)
	p.Categories = []PromptCategory{}

	categoriesMap, err := s.listCategoriesForPrompts([]string{p.ID})
	if err != nil {
		return WorkspacePrompt{}, err
	}
	if cats, ok := categoriesMap[p.ID]; ok {
		p.Categories = cats
	}
	return p, nil
}

// ListCategories 返回工作空间下的所有提示词分类。
func (s *DBWorkspacePromptService) ListCategories(workspaceID string) ([]PromptCategory, error) {
	rows, err := s.db.Query(`
		SELECT id, workspace_id, name, created_at, updated_at
		FROM workspace_prompt_categories
		WHERE workspace_id = $1
		ORDER BY created_at ASC
	`, workspaceID)
	if err != nil {
		return nil, fmt.Errorf("list prompt categories failed: %w", err)
	}
	defer rows.Close()

	result := make([]PromptCategory, 0)
	for rows.Next() {
		var c PromptCategory
		if err := rows.Scan(&c.ID, &c.WorkspaceID, &c.Name, &c.CreatedAt, &c.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan prompt category failed: %w", err)
		}
		result = append(result, c)
	}
	return result, rows.Err()
}

// CreateCategory 为工作空间创建一个提示词分类。
func (s *DBWorkspacePromptService) CreateCategory(workspaceID, name string) (PromptCategory, error) {
	if name = cleanCategoryName(name); name == "" {
		return PromptCategory{}, errors.New("category name is required")
	}

	// 同一空间下分类名称去重。
	var existingID string
	err := s.db.QueryRow(`
		SELECT id FROM workspace_prompt_categories
		WHERE workspace_id = $1 AND name = $2
	`, workspaceID, name).Scan(&existingID)
	if err == nil {
		return PromptCategory{}, errors.New("category already exists")
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return PromptCategory{}, fmt.Errorf("check existing category failed: %w", err)
	}

	now := time.Now().UTC()
	c := PromptCategory{
		ID:          uuid.New().String(),
		WorkspaceID: workspaceID,
		Name:        name,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	_, err = s.db.Exec(`
		INSERT INTO workspace_prompt_categories (id, workspace_id, name, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5)
	`, c.ID, c.WorkspaceID, c.Name, c.CreatedAt, c.UpdatedAt)
	if err != nil {
		return PromptCategory{}, fmt.Errorf("create prompt category failed: %w", err)
	}
	return c, nil
}

// DeleteCategory 删除工作空间下的提示词分类。
// 如果该分类下仍有提示词，则不允许删除，避免数据丢失。
func (s *DBWorkspacePromptService) DeleteCategory(workspaceID, categoryID string) error {
	var count int
	err := s.db.QueryRow(`
		SELECT COUNT(*) FROM workspace_prompt_category_links
		WHERE category_id = $1
	`, categoryID).Scan(&count)
	if err != nil {
		return fmt.Errorf("count prompts by category failed: %w", err)
	}
	if count > 0 {
		return errors.New("category is in use")
	}

	res, err := s.db.Exec(`
		DELETE FROM workspace_prompt_categories
		WHERE workspace_id = $1 AND id = $2
	`, workspaceID, categoryID)
	if err != nil {
		return fmt.Errorf("delete prompt category failed: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return errors.New("category not found")
	}
	return nil
}

func cleanCategoryName(name string) string {
	return strings.TrimSpace(name)
}
