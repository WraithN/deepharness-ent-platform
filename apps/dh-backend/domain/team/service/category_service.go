package service

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/team/object"
	"github.com/google/uuid"

	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/common"
)

// ListSkillCategories 返回技能分类。
// workspaceID 非空时，仅返回该工作区的分类及全局内置分类。
func (s *DBTeamService) ListSkillCategories(workspaceID string) ([]object.SkillCategory, error) {
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

	result := make([]object.SkillCategory, 0)
	for rows.Next() {
		var c object.SkillCategory
		if err := rows.Scan(&c.ID, &c.Name, &c.Builtin, &c.SortOrder, &c.CreatedAt, &c.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan skill category failed: %w", err)
		}
		result = append(result, c)
	}
	return result, rows.Err()
}

// CreateSkillCategory 创建新技能分类。
// workspaceID 非空时，分类归属到该工作区。
func (s *DBTeamService) CreateSkillCategory(req object.CreateSkillCategoryRequest, workspaceID string) (object.SkillCategory, error) {
	if strings.TrimSpace(req.Name) == "" {
		return object.SkillCategory{}, errors.New("name is required")
	}
	now := time.Now().UTC()
	category := object.SkillCategory{
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
		return object.SkillCategory{}, fmt.Errorf("insert skill category failed: %w", err)
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
		return common.NotFoundErrorf("skill category not found")
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
func (s *DBTeamService) ListPromptCategories() ([]object.PromptCategory, error) {
	rows, err := s.db.Query(`
		SELECT id, name, builtin, sort_order, created_at, updated_at
		FROM team_prompt_categories
		ORDER BY sort_order ASC, created_at ASC
	`)
	if err != nil {
		return nil, fmt.Errorf("list prompt categories failed: %w", err)
	}
	defer rows.Close()

	result := make([]object.PromptCategory, 0)
	for rows.Next() {
		var c object.PromptCategory
		if err := rows.Scan(&c.ID, &c.Name, &c.Builtin, &c.SortOrder, &c.CreatedAt, &c.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan prompt category failed: %w", err)
		}
		result = append(result, c)
	}
	return result, rows.Err()
}

// CreatePromptCategory 创建新提示词分类。
func (s *DBTeamService) CreatePromptCategory(req object.CreatePromptCategoryRequest) (object.PromptCategory, error) {
	if strings.TrimSpace(req.Name) == "" {
		return object.PromptCategory{}, errors.New("name is required")
	}
	now := time.Now().UTC()
	category := object.PromptCategory{
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
		return object.PromptCategory{}, fmt.Errorf("insert prompt category failed: %w", err)
	}
	return category, nil
}

// DeletePromptCategory 删除提示词分类，内置分类不可删除。
func (s *DBTeamService) DeletePromptCategory(id string) error {
	var builtin bool
	err := s.db.QueryRow(`SELECT builtin FROM team_prompt_categories WHERE id = $1`, id).Scan(&builtin)
	if errors.Is(err, sql.ErrNoRows) {
		return common.NotFoundErrorf("prompt category not found")
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
