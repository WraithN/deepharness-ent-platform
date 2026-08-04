package service

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/workspace/object"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/common"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/common/sqlutil"
	"github.com/google/uuid"
)

// WorkspacePromptService 定义工作空间提示词服务接口。
type WorkspacePromptService interface {
	List(workspaceID string) ([]object.WorkspacePrompt, error)
	Add(workspaceID string, req object.AddWorkspacePromptRequest, userID string) (object.WorkspacePrompt, error)
	Remove(workspaceID, promptID string) error
	UpdateCategories(workspaceID, promptID string, req object.UpdateWorkspacePromptCategoryRequest) (object.WorkspacePrompt, error)
	UpdateEnabled(workspaceID, promptID string, req object.UpdateWorkspacePromptEnabledRequest) (object.WorkspacePrompt, error)
	UpdateContent(workspaceID, promptID string, req object.UpdateWorkspacePromptContentRequest) (object.WorkspacePrompt, error)
	// RecordUsage 记录一次使用：空间提示词 usage_count +1；若来源于市场，关联市场提示词 usage_count 同步 +1。
	RecordUsage(workspaceID, promptID string) (object.WorkspacePrompt, error)
	// Copy 将市场来源的提示词复制为空间内可编辑的自定义副本，原市场提示词 usage_count +1。
	Copy(workspaceID, promptID, userID string) (object.WorkspacePrompt, error)
	// Share 将空间自定义提示词分享到市场，创建 pending_review 审核条目。
	Share(workspaceID, promptID, userID string) (object.WorkspacePrompt, error)

	ListCategories(workspaceID string) ([]object.PromptCategory, error)
	CreateCategory(workspaceID, name string) (object.PromptCategory, error)
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

// List 返回工作空间下的提示词列表（包含关联的多个分类、创建人姓名与分享审核状态）。
// LEFT JOIN users/team_prompts 均为容错关联：创建人删除或未分享时返回空值。
func (s *DBWorkspacePromptService) List(workspaceID string) ([]object.WorkspacePrompt, error) {
	rows, err := s.db.Query(`
		SELECT p.id, p.workspace_id, p.library_prompt_id, p.name, p.description, p.content, p.use_case,
		       p.usage_count, p.is_custom, p.added_to_space, p.enabled, p.created_by, COALESCE(u.name, ''),
		       p.shared_prompt_id, COALESCE(tp.status, ''), p.created_at, p.updated_at
		FROM workspace_prompts p
		LEFT JOIN users u ON u.id = p.created_by
		LEFT JOIN team_prompts tp ON tp.id = p.shared_prompt_id
		WHERE p.workspace_id = $1
		ORDER BY p.created_at DESC
	`, workspaceID)
	if err != nil {
		return nil, fmt.Errorf("list workspace prompts failed: %w", err)
	}
	defer rows.Close()

	prompts := make([]object.WorkspacePrompt, 0)
	promptIDs := make([]string, 0)
	for rows.Next() {
		var p object.WorkspacePrompt
		var libID, desc, createdBy, sharedPromptID sql.NullString
		err := rows.Scan(&p.ID, &p.WorkspaceID, &libID, &p.Name, &desc, &p.Content, &p.UseCase,
			&p.UsageCount, &p.IsCustom, &p.AddedToSpace, &p.Enabled, &createdBy, &p.CreatedByName,
			&sharedPromptID, &p.ShareStatus, &p.CreatedAt, &p.UpdatedAt)
		if err != nil {
			return nil, fmt.Errorf("scan workspace prompt failed: %w", err)
		}
		p.LibraryPromptID = sqlutil.ScanNullStringPtr(libID)
		p.Description = sqlutil.ScanNullString(desc)
		p.CreatedBy = sqlutil.ScanNullString(createdBy)
		p.SharedPromptID = sqlutil.ScanNullStringPtr(sharedPromptID)
		p.Categories = []object.PromptCategory{}
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
				prompts[i].Categories = []object.PromptCategory{}
			}
		}
	}

	return prompts, nil
}

// listCategoriesForPrompts 查询一组提示词关联的分类，按 prompt_id 聚合。
func (s *DBWorkspacePromptService) listCategoriesForPrompts(promptIDs []string) (map[string][]object.PromptCategory, error) {
	placeholders := make([]string, len(promptIDs))
	args := make([]any, len(promptIDs))
	for i, id := range promptIDs {
		placeholders[i] = fmt.Sprintf("$%d", i+1)
		args[i] = id
	}
	query := fmt.Sprintf(`
		SELECT l.prompt_id, c.id, c.workspace_id, c.name, c.is_builtin, c.created_at, c.updated_at
		FROM workspace_prompt_category_links l
		JOIN workspace_prompt_categories c ON c.id = l.category_id
		WHERE l.prompt_id IN (%s)
		ORDER BY c.is_builtin DESC, c.created_at ASC
	`, strings.Join(placeholders, ", "))
	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("list categories for prompts failed: %w", err)
	}
	defer rows.Close()

	result := make(map[string][]object.PromptCategory)
	for rows.Next() {
		var promptID string
		var c object.PromptCategory
		if err := rows.Scan(&promptID, &c.ID, &c.WorkspaceID, &c.Name, &c.IsBuiltin, &c.CreatedAt, &c.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan prompt category link failed: %w", err)
		}
		result[promptID] = append(result[promptID], c)
	}
	return result, rows.Err()
}

// Add 从 team_prompts 添加一个已上架提示词到工作空间，同时市场提示词使用次数 +1。
// userID 记录为 created_by，用于卡片展示创建人。
func (s *DBWorkspacePromptService) Add(workspaceID string, req object.AddWorkspacePromptRequest, userID string) (object.WorkspacePrompt, error) {
	if req.LibraryPromptID == "" {
		return object.WorkspacePrompt{}, fmt.Errorf("%w: libraryPromptId is required", common.ErrInvalidInput)
	}

	var name, content, useCase string
	var desc sql.NullString
	err := s.db.QueryRow(`
		SELECT name, description, content, use_case
		FROM team_prompts
		WHERE id = $1 AND status = $2
	`, req.LibraryPromptID, object.PromptStatusOnShelf).Scan(&name, &desc, &content, &useCase)
	if errors.Is(err, sql.ErrNoRows) {
		return object.WorkspacePrompt{}, common.NotFoundErrorf("library prompt not found or not on shelf")
	}
	if err != nil {
		return object.WorkspacePrompt{}, fmt.Errorf("get library prompt failed: %w", err)
	}

	// 幂等：同一 library_prompt_id 在同一 workspace 下只保留一条。
	var existingID string
	err = s.db.QueryRow(`
		SELECT id FROM workspace_prompts
		WHERE workspace_id = $1 AND library_prompt_id = $2
	`, workspaceID, req.LibraryPromptID).Scan(&existingID)
	if err == nil {
		return object.WorkspacePrompt{}, fmt.Errorf("%w: prompt already added to workspace", common.ErrAlreadyExists)
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return object.WorkspacePrompt{}, fmt.Errorf("check existing workspace prompt failed: %w", err)
	}

	now := time.Now().UTC()
	p := object.WorkspacePrompt{
		ID:              uuid.New().String(),
		WorkspaceID:     workspaceID,
		LibraryPromptID: &req.LibraryPromptID,
		Name:            name,
		Description:     sqlutil.ScanNullString(desc),
		Content:         content,
		UseCase:         useCase,
		Categories:      []object.PromptCategory{},
		UsageCount:      0,
		IsCustom:        false,
		AddedToSpace:    true,
		CreatedBy:       userID,
		CreatedAt:       now,
		UpdatedAt:       now,
	}

	tx, err := s.db.Begin()
	if err != nil {
		return object.WorkspacePrompt{}, fmt.Errorf("begin transaction failed: %w", err)
	}
	defer tx.Rollback()

	_, err = tx.Exec(`
		INSERT INTO workspace_prompts (id, workspace_id, library_prompt_id, name, description, content, use_case,
		                               usage_count, is_custom, added_to_space, created_by, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
	`, p.ID, p.WorkspaceID, p.LibraryPromptID, p.Name, p.Description, p.Content, p.UseCase,
		p.UsageCount, p.IsCustom, p.AddedToSpace, p.CreatedBy, p.CreatedAt, p.UpdatedAt)
	if err != nil {
		return object.WorkspacePrompt{}, fmt.Errorf("insert workspace prompt failed: %w", err)
	}

	// 从市场加入空间视为一次复制使用，市场提示词 usage_count +1。
	if err := incrementLibraryPromptUsage(tx, req.LibraryPromptID); err != nil {
		return object.WorkspacePrompt{}, err
	}
	if err := tx.Commit(); err != nil {
		return object.WorkspacePrompt{}, fmt.Errorf("commit failed: %w", err)
	}
	// 重新查询以返回完整的 enabled 默认值、创建人姓名等数据库侧字段。
	return s.get(workspaceID, p.ID)
}

// incrementLibraryPromptUsage 将市场提示词（team_prompts）使用次数 +1。
func incrementLibraryPromptUsage(tx *sql.Tx, libraryPromptID string) error {
	if _, err := tx.Exec(`
		UPDATE team_prompts SET usage_count = usage_count + 1, updated_at = $1 WHERE id = $2
	`, time.Now().UTC(), libraryPromptID); err != nil {
		return fmt.Errorf("increment library prompt usage failed: %w", err)
	}
	return nil
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
		return common.NotFoundErrorf("workspace prompt not found")
	}
	return tx.Commit()
}

// UpdateCategories 更新空间提示词的分类关联（支持多个）。
// 市场来源提示词（library_prompt_id 非空）分类同样锁定只读，需先 Copy 为自定义副本。
func (s *DBWorkspacePromptService) UpdateCategories(workspaceID, promptID string, req object.UpdateWorkspacePromptCategoryRequest) (object.WorkspacePrompt, error) {
	// 校验提示词存在，且非市场来源。
	p, err := s.get(workspaceID, promptID)
	if err != nil {
		return object.WorkspacePrompt{}, err
	}
	if p.LibraryPromptID != nil && *p.LibraryPromptID != "" {
		return object.WorkspacePrompt{}, fmt.Errorf("%w: library prompt categories cannot be modified", common.ErrForbidden)
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
			return object.WorkspacePrompt{}, fmt.Errorf("validate categories failed: %w", err)
		}
		if validCount != len(req.CategoryIDs) {
			return object.WorkspacePrompt{}, fmt.Errorf("%w: some categories do not belong to workspace", common.ErrInvalidInput)
		}
	}

	tx, err := s.db.Begin()
	if err != nil {
		return object.WorkspacePrompt{}, fmt.Errorf("begin transaction failed: %w", err)
	}
	defer tx.Rollback()

	if _, err := tx.Exec(`DELETE FROM workspace_prompt_category_links WHERE prompt_id = $1`, promptID); err != nil {
		return object.WorkspacePrompt{}, fmt.Errorf("delete old category links failed: %w", err)
	}

	for _, categoryID := range req.CategoryIDs {
		if categoryID == "" {
			continue
		}
		if _, err := tx.Exec(`
			INSERT INTO workspace_prompt_category_links (prompt_id, category_id)
			VALUES ($1, $2)
		`, promptID, categoryID); err != nil {
			return object.WorkspacePrompt{}, fmt.Errorf("insert category link failed: %w", err)
		}
	}

	if _, err := tx.Exec(`
		UPDATE workspace_prompts SET updated_at = $1 WHERE workspace_id = $2 AND id = $3
	`, time.Now().UTC(), workspaceID, promptID); err != nil {
		return object.WorkspacePrompt{}, fmt.Errorf("update prompt updated_at failed: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return object.WorkspacePrompt{}, fmt.Errorf("commit failed: %w", err)
	}

	return s.get(workspaceID, promptID)
}

// UpdateEnabled 更新空间提示词的启用状态。
func (s *DBWorkspacePromptService) UpdateEnabled(workspaceID, promptID string, req object.UpdateWorkspacePromptEnabledRequest) (object.WorkspacePrompt, error) {
	if req.Enabled == nil {
		return object.WorkspacePrompt{}, fmt.Errorf("%w: enabled is required", common.ErrInvalidInput)
	}
	res, err := s.db.Exec(`
		UPDATE workspace_prompts SET enabled = $1, updated_at = $2
		WHERE workspace_id = $3 AND id = $4
	`, *req.Enabled, time.Now().UTC(), workspaceID, promptID)
	if err != nil {
		return object.WorkspacePrompt{}, fmt.Errorf("update prompt enabled failed: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return object.WorkspacePrompt{}, common.NotFoundErrorf("workspace prompt not found")
	}
	return s.get(workspaceID, promptID)
}

// UpdateContent 更新空间自定义提示词的名称/描述/内容/场景。
// 市场来源提示词（library_prompt_id 非空）为只读快照，禁止修改，需先 Copy 为自定义副本。
func (s *DBWorkspacePromptService) UpdateContent(workspaceID, promptID string, req object.UpdateWorkspacePromptContentRequest) (object.WorkspacePrompt, error) {
	if strings.TrimSpace(req.Name) == "" {
		return object.WorkspacePrompt{}, fmt.Errorf("%w: name is required", common.ErrInvalidInput)
	}
	if strings.TrimSpace(req.Content) == "" {
		return object.WorkspacePrompt{}, fmt.Errorf("%w: content is required", common.ErrInvalidInput)
	}
	res, err := s.db.Exec(`
		UPDATE workspace_prompts
		SET name = $1, description = $2, content = $3, use_case = $4, updated_at = $5
		WHERE workspace_id = $6 AND id = $7 AND library_prompt_id IS NULL
	`, req.Name, req.Description, req.Content, req.UseCase, time.Now().UTC(), workspaceID, promptID)
	if err != nil {
		return object.WorkspacePrompt{}, fmt.Errorf("update workspace prompt content failed: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return object.WorkspacePrompt{}, common.NotFoundErrorf("workspace prompt not found or not editable")
	}
	return s.get(workspaceID, promptID)
}

// RecordUsage 记录一次提示词使用：空间提示词 usage_count +1；
// 若该提示词来源于市场（library_prompt_id 非空），同事务内将市场提示词 usage_count +1。
func (s *DBWorkspacePromptService) RecordUsage(workspaceID, promptID string) (object.WorkspacePrompt, error) {
	p, err := s.get(workspaceID, promptID)
	if err != nil {
		return object.WorkspacePrompt{}, err
	}

	tx, err := s.db.Begin()
	if err != nil {
		return object.WorkspacePrompt{}, fmt.Errorf("begin transaction failed: %w", err)
	}
	defer tx.Rollback()

	if _, err := tx.Exec(`
		UPDATE workspace_prompts SET usage_count = usage_count + 1, updated_at = $1
		WHERE workspace_id = $2 AND id = $3
	`, time.Now().UTC(), workspaceID, promptID); err != nil {
		return object.WorkspacePrompt{}, fmt.Errorf("increment workspace prompt usage failed: %w", err)
	}

	if p.LibraryPromptID != nil && *p.LibraryPromptID != "" {
		if err := incrementLibraryPromptUsage(tx, *p.LibraryPromptID); err != nil {
			return object.WorkspacePrompt{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return object.WorkspacePrompt{}, fmt.Errorf("commit failed: %w", err)
	}
	return s.get(workspaceID, promptID)
}

// Copy 将空间内提示词复制为可编辑的自定义副本（is_custom=true, library_prompt_id=NULL），
// 并复制原提示词的分类关联；若原提示词来源于市场，市场提示词 usage_count +1（每复制一次计一次）。
func (s *DBWorkspacePromptService) Copy(workspaceID, promptID, userID string) (object.WorkspacePrompt, error) {
	src, err := s.get(workspaceID, promptID)
	if err != nil {
		return object.WorkspacePrompt{}, err
	}

	now := time.Now().UTC()
	copyID := uuid.New().String()
	tx, err := s.db.Begin()
	if err != nil {
		return object.WorkspacePrompt{}, fmt.Errorf("begin transaction failed: %w", err)
	}
	defer tx.Rollback()

	if _, err := tx.Exec(`
		INSERT INTO workspace_prompts (id, workspace_id, library_prompt_id, name, description, content, use_case,
		                               usage_count, is_custom, added_to_space, created_by, created_at, updated_at)
		VALUES ($1, $2, NULL, $3, $4, $5, $6, 0, TRUE, TRUE, $7, $8, $9)
	`, copyID, workspaceID, src.Name, src.Description, src.Content, src.UseCase, userID, now, now); err != nil {
		return object.WorkspacePrompt{}, fmt.Errorf("insert copied workspace prompt failed: %w", err)
	}

	// 复制原提示词的分类关联，保持副本与原提示词分类一致。
	if _, err := tx.Exec(`
		INSERT INTO workspace_prompt_category_links (prompt_id, category_id)
		SELECT $1, category_id FROM workspace_prompt_category_links WHERE prompt_id = $2
	`, copyID, promptID); err != nil {
		return object.WorkspacePrompt{}, fmt.Errorf("copy prompt category links failed: %w", err)
	}

	if src.LibraryPromptID != nil && *src.LibraryPromptID != "" {
		if err := incrementLibraryPromptUsage(tx, *src.LibraryPromptID); err != nil {
			return object.WorkspacePrompt{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return object.WorkspacePrompt{}, fmt.Errorf("commit failed: %w", err)
	}
	return s.get(workspaceID, copyID)
}

// Share 将空间自定义提示词分享到市场：在 team_prompts 创建 pending_review 审核条目，
// 并回写 workspace_prompts.shared_prompt_id。仅允许自定义（非市场来源）且未分享过的提示词。
func (s *DBWorkspacePromptService) Share(workspaceID, promptID, userID string) (object.WorkspacePrompt, error) {
	p, err := s.get(workspaceID, promptID)
	if err != nil {
		return object.WorkspacePrompt{}, err
	}
	if p.LibraryPromptID != nil && *p.LibraryPromptID != "" {
		return object.WorkspacePrompt{}, fmt.Errorf("%w: library prompt cannot be shared", common.ErrForbidden)
	}
	if p.SharedPromptID != nil && *p.SharedPromptID != "" {
		return object.WorkspacePrompt{}, fmt.Errorf("%w: prompt already shared", common.ErrAlreadyExists)
	}

	now := time.Now().UTC()
	sharedID := uuid.New().String()
	tx, err := s.db.Begin()
	if err != nil {
		return object.WorkspacePrompt{}, fmt.Errorf("begin transaction failed: %w", err)
	}
	defer tx.Rollback()

	// 审核条目初始状态为 pending_review，由超级管理员在提示词市场审核后上架。
	if _, err := tx.Exec(`
		INSERT INTO team_prompts (id, name, description, content, use_case, usage_count, added_to_space,
		                         status, created_by, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, 0, TRUE, $6, $7, $8, $9)
	`, sharedID, p.Name, p.Description, p.Content, p.UseCase, object.PromptStatusPendingReview, userID, now, now); err != nil {
		return object.WorkspacePrompt{}, fmt.Errorf("insert shared team prompt failed: %w", err)
	}

	if _, err := tx.Exec(`
		UPDATE workspace_prompts SET shared_prompt_id = $1, updated_at = $2
		WHERE workspace_id = $3 AND id = $4
	`, sharedID, now, workspaceID, promptID); err != nil {
		return object.WorkspacePrompt{}, fmt.Errorf("update workspace prompt shared id failed: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return object.WorkspacePrompt{}, fmt.Errorf("commit failed: %w", err)
	}
	return s.get(workspaceID, promptID)
}

func (s *DBWorkspacePromptService) get(workspaceID, promptID string) (object.WorkspacePrompt, error) {
	var p object.WorkspacePrompt
	var libID, desc, createdBy, sharedPromptID sql.NullString
	err := s.db.QueryRow(`
		SELECT p.id, p.workspace_id, p.library_prompt_id, p.name, p.description, p.content, p.use_case,
		       p.usage_count, p.is_custom, p.added_to_space, p.enabled, p.created_by, COALESCE(u.name, ''),
		       p.shared_prompt_id, COALESCE(tp.status, ''), p.created_at, p.updated_at
		FROM workspace_prompts p
		LEFT JOIN users u ON u.id = p.created_by
		LEFT JOIN team_prompts tp ON tp.id = p.shared_prompt_id
		WHERE p.workspace_id = $1 AND p.id = $2
	`, workspaceID, promptID).Scan(&p.ID, &p.WorkspaceID, &libID, &p.Name, &desc, &p.Content, &p.UseCase,
		&p.UsageCount, &p.IsCustom, &p.AddedToSpace, &p.Enabled, &createdBy, &p.CreatedByName,
		&sharedPromptID, &p.ShareStatus, &p.CreatedAt, &p.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return object.WorkspacePrompt{}, common.NotFoundErrorf("workspace prompt not found")
	}
	if err != nil {
		return object.WorkspacePrompt{}, fmt.Errorf("get workspace prompt failed: %w", err)
	}
	p.LibraryPromptID = sqlutil.ScanNullStringPtr(libID)
	p.Description = sqlutil.ScanNullString(desc)
	p.CreatedBy = sqlutil.ScanNullString(createdBy)
	p.SharedPromptID = sqlutil.ScanNullStringPtr(sharedPromptID)
	p.Categories = []object.PromptCategory{}

	categoriesMap, err := s.listCategoriesForPrompts([]string{p.ID})
	if err != nil {
		return object.WorkspacePrompt{}, err
	}
	if cats, ok := categoriesMap[p.ID]; ok {
		p.Categories = cats
	}
	return p, nil
}

// ListCategories 返回工作空间下的所有提示词分类。
func (s *DBWorkspacePromptService) ListCategories(workspaceID string) ([]object.PromptCategory, error) {
	rows, err := s.db.Query(`
		SELECT id, workspace_id, name, is_builtin, created_at, updated_at
		FROM workspace_prompt_categories
		WHERE workspace_id = $1
		ORDER BY is_builtin DESC, created_at ASC
	`, workspaceID)
	if err != nil {
		return nil, fmt.Errorf("list prompt categories failed: %w", err)
	}
	defer rows.Close()

	result := make([]object.PromptCategory, 0)
	for rows.Next() {
		var c object.PromptCategory
		if err := rows.Scan(&c.ID, &c.WorkspaceID, &c.Name, &c.IsBuiltin, &c.CreatedAt, &c.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan prompt category failed: %w", err)
		}
		result = append(result, c)
	}
	return result, rows.Err()
}

// CreateCategory 为工作空间创建一个提示词分类。
func (s *DBWorkspacePromptService) CreateCategory(workspaceID, name string) (object.PromptCategory, error) {
	if name = cleanCategoryName(name); name == "" {
		return object.PromptCategory{}, fmt.Errorf("%w: category name is required", common.ErrInvalidInput)
	}

	// 同一空间下分类名称去重。
	var existingID string
	err := s.db.QueryRow(`
		SELECT id FROM workspace_prompt_categories
		WHERE workspace_id = $1 AND name = $2
	`, workspaceID, name).Scan(&existingID)
	if err == nil {
		return object.PromptCategory{}, fmt.Errorf("%w: category already exists", common.ErrAlreadyExists)
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return object.PromptCategory{}, fmt.Errorf("check existing category failed: %w", err)
	}

	now := time.Now().UTC()
	c := object.PromptCategory{
		ID:          uuid.New().String(),
		WorkspaceID: workspaceID,
		Name:        name,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	_, err = s.db.Exec(`
		INSERT INTO workspace_prompt_categories (id, workspace_id, name, is_builtin, created_at, updated_at)
		VALUES ($1, $2, $3, FALSE, $4, $5)
	`, c.ID, c.WorkspaceID, c.Name, c.CreatedAt, c.UpdatedAt)
	if err != nil {
		return object.PromptCategory{}, fmt.Errorf("create prompt category failed: %w", err)
	}
	return c, nil
}

// DeleteCategory 删除工作空间下的提示词分类。
// 系统内置分类不可删除；如果该分类下仍有提示词，也不允许删除，避免数据丢失。
func (s *DBWorkspacePromptService) DeleteCategory(workspaceID, categoryID string) error {
	var isBuiltin bool
	err := s.db.QueryRow(`
		SELECT is_builtin FROM workspace_prompt_categories
		WHERE workspace_id = $1 AND id = $2
	`, workspaceID, categoryID).Scan(&isBuiltin)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return common.NotFoundErrorf("category not found")
		}
		return fmt.Errorf("query category failed: %w", err)
	}
	if isBuiltin {
		return fmt.Errorf("%w: builtin category cannot be deleted", common.ErrForbidden)
	}

	var count int
	err = s.db.QueryRow(`
		SELECT COUNT(*) FROM workspace_prompt_category_links
		WHERE category_id = $1
	`, categoryID).Scan(&count)
	if err != nil {
		return fmt.Errorf("count prompts by category failed: %w", err)
	}
	if count > 0 {
		return fmt.Errorf("%w: category is in use", common.ErrForbidden)
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
		return common.NotFoundErrorf("category not found")
	}
	return nil
}

// BuiltinPromptCategoryNames 是系统内置提示词分类，按展示顺序排列。
var BuiltinPromptCategoryNames = []string{"通用", "代码开发", "需求分析", "产品设计", "测试", "运维", "文档"}

// SeedBuiltinPromptCategories 为指定工作空间插入内置提示词分类。
func SeedBuiltinPromptCategories(tx *sql.Tx, workspaceID string) error {
	now := time.Now().UTC()
	for _, name := range BuiltinPromptCategoryNames {
		if _, err := tx.Exec(`
			INSERT INTO workspace_prompt_categories (id, workspace_id, name, is_builtin, created_at, updated_at)
			VALUES ($1, $2, $3, TRUE, $4, $5)
			ON CONFLICT DO NOTHING
		`, uuid.New().String(), workspaceID, name, now, now); err != nil {
			return fmt.Errorf("seed builtin category %s failed: %w", name, err)
		}
	}
	return nil
}

func cleanCategoryName(name string) string {
	return strings.TrimSpace(name)
}
