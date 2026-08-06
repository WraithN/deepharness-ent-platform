package service

import (
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/workspace/object"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/pkg/idutil"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/common/sqlutil"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/workspace"

	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/common"
)

// ListStandards 返回工作空间下的规范列表，支持按仓库过滤。
func (s *DBWorkspaceService) ListStandards(workspaceID string, repoID string) ([]workspace.Standard, error) {
	query := `SELECT id, workspace_id, repository_id, type, name, content, created_at, updated_at FROM workspace_standards WHERE workspace_id = $1`
	var args []any
	args = append(args, workspaceID)
	if repoID != "" {
		query += ` AND repository_id = $2`
		args = append(args, repoID)
	}
	query += ` ORDER BY created_at DESC`

	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("list standards failed: %w", err)
	}
	defer rows.Close()

	result := make([]workspace.Standard, 0)
	for rows.Next() {
		var st workspace.Standard
		var standardRepoID sql.NullString
		if err := rows.Scan(&st.ID, &st.WorkspaceID, &standardRepoID, &st.Type, &st.Name, &st.Content, &st.CreatedAt, &st.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan standard failed: %w", err)
		}
		st.RepositoryID = sqlutil.ScanNullString(standardRepoID)
		result = append(result, st)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate standards failed: %w", err)
	}
	return result, nil
}

// SaveStandard 保存规范，若提供 ID 则更新，否则新增。
func (s *DBWorkspaceService) SaveStandard(workspaceID string, req object.StandardRequest) (workspace.Standard, error) {
	now := time.Now().UTC()
	if req.ID != "" {
		return s.updateStandard(workspaceID, req, now)
	}

	if err := s.workspaceExists(workspaceID); err != nil {
		return workspace.Standard{}, err
	}

	st := workspace.Standard{
		ID:           idutil.GenerateID(),
		WorkspaceID:  workspaceID,
		RepositoryID: req.RepositoryID,
		Type:         req.Type,
		Name:         req.Name,
		Content:      req.Content,
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	_, err := s.db.Exec(`
		INSERT INTO workspace_standards (id, workspace_id, repository_id, type, name, content, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
	`, st.ID, st.WorkspaceID, st.RepositoryID, st.Type, st.Name, st.Content, st.CreatedAt, st.UpdatedAt)
	if err != nil {
		return workspace.Standard{}, fmt.Errorf("insert standard failed: %w", err)
	}
	return st, nil
}

// updateStandard 在事务中更新规范并读取最新值返回。
func (s *DBWorkspaceService) updateStandard(workspaceID string, req object.StandardRequest, now time.Time) (workspace.Standard, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return workspace.Standard{}, fmt.Errorf("begin transaction failed: %w", err)
	}
	defer tx.Rollback()

	if err := workspaceExistsTx(tx, workspaceID); err != nil {
		return workspace.Standard{}, err
	}

	res, err := tx.Exec(`
		UPDATE workspace_standards
		SET repository_id = $1, type = $2, name = $3, content = $4, updated_at = $5
		WHERE id = $6 AND workspace_id = $7
	`, sqlutil.NullString(req.RepositoryID), req.Type, req.Name, req.Content, now, req.ID, workspaceID)
	if err != nil {
		return workspace.Standard{}, fmt.Errorf("update standard failed: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return workspace.Standard{}, fmt.Errorf("get rows affected failed: %w", err)
	}
	if n == 0 {
		return workspace.Standard{}, common.NotFoundErrorf("standard not found")
	}

	st, err := getStandardTx(tx, req.ID)
	if err != nil {
		return workspace.Standard{}, err
	}

	if err := tx.Commit(); err != nil {
		return workspace.Standard{}, fmt.Errorf("commit failed: %w", err)
	}
	return st, nil
}

// DeleteStandard 删除工作空间下的规范。
func (s *DBWorkspaceService) DeleteStandard(workspaceID, standardID string) error {
	res, err := s.db.Exec(`
		DELETE FROM workspace_standards WHERE id = $1 AND workspace_id = $2
	`, standardID, workspaceID)
	if err != nil {
		return fmt.Errorf("delete standard failed: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("get rows affected failed: %w", err)
	}
	if n == 0 {
		return common.NotFoundErrorf("standard not found")
	}
	return nil
}

// getStandardTx 在事务中按 ID 查询规范。
func getStandardTx(tx *sql.Tx, id string) (workspace.Standard, error) {
	var st workspace.Standard
	var repoID sql.NullString
	err := tx.QueryRow(`
		SELECT id, workspace_id, repository_id, type, name, content, created_at, updated_at
		FROM workspace_standards WHERE id = $1
	`, id).Scan(&st.ID, &st.WorkspaceID, &repoID, &st.Type, &st.Name, &st.Content, &st.CreatedAt, &st.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return workspace.Standard{}, common.NotFoundErrorf("standard not found")
	}
	if err != nil {
		return workspace.Standard{}, fmt.Errorf("get standard failed: %w", err)
	}
	st.RepositoryID = sqlutil.ScanNullString(repoID)
	return st, nil
}
