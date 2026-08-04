package service

import (
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/team/object"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/common"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/common/sqlutil"
	"github.com/google/uuid"
)

// ListPromptsVisibleTo 返回指定用户可见的提示词，支持服务端分页。
// 规则：on_shelf 全员可见；pending_review/rejected 仅创建人和超管可见；off_shelf 仅超管可见。
func (s *DBTeamService) ListPromptsVisibleTo(userID string, isSuperAdmin bool, page, pageSize int) (common.PaginatedList[object.Prompt], error) {
	page = common.NormalizePage(page)
	pageSize = common.NormalizePageSize(pageSize, 10, 100)

	var total int
	if isSuperAdmin {
		if err := s.db.QueryRow(`SELECT COUNT(*) FROM team_prompts`).Scan(&total); err != nil {
			return common.PaginatedList[object.Prompt]{}, fmt.Errorf("count prompts failed: %w", err)
		}
	} else {
		if err := s.db.QueryRow(`
			SELECT COUNT(*) FROM team_prompts
			WHERE status = $1 OR (status IN ($2, $3) AND created_by = $4)
		`, object.PromptStatusOnShelf, object.PromptStatusPendingReview, object.PromptStatusRejected, userID).Scan(&total); err != nil {
			return common.PaginatedList[object.Prompt]{}, fmt.Errorf("count prompts failed: %w", err)
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
		`, object.PromptStatusOnShelf, object.PromptStatusPendingReview, object.PromptStatusRejected, userID, pageSize, common.Offset(page, pageSize))
	}
	if err != nil {
		return common.PaginatedList[object.Prompt]{}, fmt.Errorf("list prompts failed: %w", err)
	}
	defer rows.Close()

	result := make([]object.Prompt, 0)
	promptIDs := make([]string, 0)
	for rows.Next() {
		var p object.Prompt
		var reviewedAt sql.NullTime
		var createdBy, reviewedBy sql.NullString
		if err := rows.Scan(&p.ID, &p.Name, &p.Description, &p.Content, &p.UseCase, &p.UsageCount, &p.AddedToSpace,
			&p.Status, &createdBy, &p.CreatedByName, &reviewedBy, &reviewedAt, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return common.PaginatedList[object.Prompt]{}, fmt.Errorf("scan prompt failed: %w", err)
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
		return common.PaginatedList[object.Prompt]{}, fmt.Errorf("iterate prompts failed: %w", err)
	}

	// 批量补充多分类链接（避免逐行 N+1 查询）。
	categoryMap, err := s.listLinkedCategoryIDs(promptCategoryLinkTable, "prompt_id", promptIDs)
	if err != nil {
		return common.PaginatedList[object.Prompt]{}, err
	}
	for i := range result {
		if ids, ok := categoryMap[result[i].ID]; ok {
			result[i].CategoryIDs = ids
		}
	}

	return common.PaginatedList[object.Prompt]{
		List:     result,
		Total:    total,
		Page:     page,
		PageSize: pageSize,
	}, nil
}

// CreatePrompt 创建新提示词，默认进入审核中状态。
func (s *DBTeamService) CreatePrompt(req object.CreatePromptRequest, createdBy string) (object.Prompt, error) {
	now := time.Now().UTC()
	prompt := object.Prompt{
		ID:           uuid.New().String(),
		Name:         req.Name,
		Description:  req.Description,
		Content:      req.Content,
		UseCase:      req.UseCase,
		UsageCount:   0,
		AddedToSpace: true,
		Status:       object.PromptStatusPendingReview,
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
		return object.Prompt{}, fmt.Errorf("insert prompt failed: %w", err)
	}
	return prompt, nil
}

// UpdatePrompt 允许创建人修改 pending/rejected 状态的提示词，超管可修改任意。
func (s *DBTeamService) UpdatePrompt(id string, req object.UpdatePromptRequest, userID string, isSuperAdmin bool) (object.Prompt, error) {
	prompt, err := s.getPrompt(id)
	if err != nil {
		return object.Prompt{}, err
	}
	if !isSuperAdmin && prompt.CreatedBy != userID {
		return object.Prompt{}, errors.New("forbidden: not the creator")
	}
	if !isSuperAdmin && prompt.Status != object.PromptStatusPendingReview && prompt.Status != object.PromptStatusRejected {
		return object.Prompt{}, errors.New("forbidden: can only edit pending or rejected prompts")
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
		return object.Prompt{}, fmt.Errorf("update prompt failed: %w", err)
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
	if !isSuperAdmin && prompt.Status != object.PromptStatusPendingReview && prompt.Status != object.PromptStatusRejected {
		return errors.New("forbidden: can only delete pending or rejected prompts")
	}

	res, err := s.db.Exec(`DELETE FROM team_prompts WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("delete prompt failed: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return common.NotFoundErrorf("prompt not found")
	}
	return nil
}

// ReviewPrompt 超级管理员审核提示词。
func (s *DBTeamService) ReviewPrompt(id string, action string, reviewerID string) (object.Prompt, error) {
	prompt, err := s.getPrompt(id)
	if err != nil {
		return object.Prompt{}, err
	}

	now := time.Now().UTC()
	var status object.PromptStatus
	switch action {
	case "approve":
		status = object.PromptStatusOnShelf
	case "reject":
		status = object.PromptStatusRejected
	case "unshelf":
		if prompt.Status != object.PromptStatusOnShelf {
			return object.Prompt{}, errors.New("prompt is not on shelf")
		}
		status = object.PromptStatusOffShelf
	default:
		return object.Prompt{}, errors.New("invalid review action")
	}

	_, err = s.db.Exec(`
		UPDATE team_prompts
		SET status = $1, reviewed_by = $2, reviewed_at = $3, updated_at = $4
		WHERE id = $5
	`, status, reviewerID, now, now, id)
	if err != nil {
		return object.Prompt{}, fmt.Errorf("review prompt failed: %w", err)
	}
	return s.getPrompt(id)
}

// UpdatePromptCategories 更新提示词的多分类关联（替换语义，仅超管）。
func (s *DBTeamService) UpdatePromptCategories(id string, categoryIDs []string) (object.Prompt, error) {
	if _, err := s.getPrompt(id); err != nil {
		return object.Prompt{}, err
	}
	if err := s.replaceCategoryLinks(promptCategoryLinkTable, promptCategoryTable, "prompt_id", id, categoryIDs, ""); err != nil {
		return object.Prompt{}, err
	}
	return s.getPrompt(id)
}

// GetPrompt 按 ID 查询提示词。
func (s *DBTeamService) GetPrompt(id string) (object.Prompt, error) {
	return s.getPrompt(id)
}

// RecordPromptUsage 记录一次市场提示词的复制使用并返回最新提示词。
// 去重策略：同一用户（userID）对同一提示词每天（UTC 日期）只计数一次--
// 先向去重表插入（冲突即当日已计数），仅插入成功时才递增 usage_count。
// 采用登录用户 ID 而非 User-Agent 作为去重维度：市场接口均需登录，用户 ID 不可伪造，
// 且同一用户跨浏览器复制同一提示词也应视为同一次使用。
func (s *DBTeamService) RecordPromptUsage(id string, userID string) (object.Prompt, error) {
	if _, err := s.getPrompt(id); err != nil {
		return object.Prompt{}, err
	}

	tx, err := s.db.Begin()
	if err != nil {
		return object.Prompt{}, fmt.Errorf("begin transaction failed: %w", err)
	}
	defer tx.Rollback()

	res, err := tx.Exec(`
		INSERT INTO team_prompt_usage_daily (prompt_id, user_id, usage_date)
		VALUES ($1, $2, CURRENT_DATE)
		ON CONFLICT DO NOTHING
	`, id, userID)
	if err != nil {
		return object.Prompt{}, fmt.Errorf("insert prompt usage dedup failed: %w", err)
	}

	// RowsAffected 为 0 表示当日已计数，跳过递增。
	if n, _ := res.RowsAffected(); n > 0 {
		if _, err := tx.Exec(`
			UPDATE team_prompts SET usage_count = usage_count + 1, updated_at = $1 WHERE id = $2
		`, time.Now().UTC(), id); err != nil {
			return object.Prompt{}, fmt.Errorf("increment prompt usage failed: %w", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return object.Prompt{}, fmt.Errorf("commit failed: %w", err)
	}
	return s.getPrompt(id)
}

func (s *DBTeamService) getPrompt(id string) (object.Prompt, error) {
	var p object.Prompt
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
		return object.Prompt{}, common.NotFoundErrorf("prompt not found")
	}
	if err != nil {
		return object.Prompt{}, fmt.Errorf("get prompt failed: %w", err)
	}
	p.CreatedBy = sqlutil.ScanNullString(createdBy)
	p.ReviewedBy = sqlutil.ScanNullString(reviewedBy)
	p.CategoryIDs = []string{}
	if reviewedAt.Valid {
		p.ReviewedAt = &reviewedAt.Time
	}
	categoryMap, err := s.listLinkedCategoryIDs(promptCategoryLinkTable, "prompt_id", []string{id})
	if err != nil {
		return object.Prompt{}, err
	}
	if ids, ok := categoryMap[id]; ok {
		p.CategoryIDs = ids
	}
	return p, nil
}
