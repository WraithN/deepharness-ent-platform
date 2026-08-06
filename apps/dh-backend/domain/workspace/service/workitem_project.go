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

// SetWorkitemProject 设置工作空间的工作项项目，使用 workspace_id 作为唯一键进行 upsert。
func (s *DBWorkspaceService) SetWorkitemProject(workspaceID string, req object.WorkitemProjectRequest) (workspace.WorkitemProject, error) {
	now := time.Now().UTC()

	tx, err := s.db.Begin()
	if err != nil {
		return workspace.WorkitemProject{}, fmt.Errorf("begin transaction failed: %w", err)
	}
	defer tx.Rollback()

	if err := workspaceExistsTx(tx, workspaceID); err != nil {
		return workspace.WorkitemProject{}, err
	}

	_, err = tx.Exec(`
		INSERT INTO workitem_projects (id, workspace_id, platform, external_key, name, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		ON CONFLICT (workspace_id) DO UPDATE SET
			platform = EXCLUDED.platform,
			external_key = EXCLUDED.external_key,
			name = EXCLUDED.name,
			updated_at = EXCLUDED.updated_at
	`, idutil.GenerateID(), workspaceID, req.Platform, req.ExternalKey, req.Name, now, now)
	if err != nil {
		return workspace.WorkitemProject{}, fmt.Errorf("set workitem project failed: %w", err)
	}

	wp, err := getWorkitemProjectTx(tx, workspaceID)
	if err != nil {
		return workspace.WorkitemProject{}, err
	}

	if err := tx.Commit(); err != nil {
		return workspace.WorkitemProject{}, fmt.Errorf("commit failed: %w", err)
	}
	return wp, nil
}

// GetWorkitemProject 获取工作空间的工作项项目。
func (s *DBWorkspaceService) GetWorkitemProject(workspaceID string) (workspace.WorkitemProject, error) {
	var wp workspace.WorkitemProject
	var config sql.NullString
	err := s.db.QueryRow(`
		SELECT id, workspace_id, platform, external_key, name, config, created_at, updated_at
		FROM workitem_projects WHERE workspace_id = $1
	`, workspaceID).Scan(&wp.ID, &wp.WorkspaceID, &wp.Platform, &wp.ExternalKey, &wp.Name, &config, &wp.CreatedAt, &wp.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return workspace.WorkitemProject{}, common.NotFoundErrorf("workitem project not found")
	}
	if err != nil {
		return workspace.WorkitemProject{}, fmt.Errorf("get workitem project failed: %w", err)
	}
	wp.Config, err = sqlutil.UnmarshalConfig(config)
	if err != nil {
		return workspace.WorkitemProject{}, fmt.Errorf("unmarshal workitem project config failed: %w", err)
	}
	return wp, nil
}

// getWorkitemProjectTx 在事务中获取工作空间的工作项项目。
func getWorkitemProjectTx(tx *sql.Tx, workspaceID string) (workspace.WorkitemProject, error) {
	var wp workspace.WorkitemProject
	var config sql.NullString
	err := tx.QueryRow(`
		SELECT id, workspace_id, platform, external_key, name, config, created_at, updated_at
		FROM workitem_projects WHERE workspace_id = $1
	`, workspaceID).Scan(&wp.ID, &wp.WorkspaceID, &wp.Platform, &wp.ExternalKey, &wp.Name, &config, &wp.CreatedAt, &wp.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return workspace.WorkitemProject{}, common.NotFoundErrorf("workitem project not found")
	}
	if err != nil {
		return workspace.WorkitemProject{}, fmt.Errorf("get workitem project failed: %w", err)
	}
	wp.Config, err = sqlutil.UnmarshalConfig(config)
	if err != nil {
		return workspace.WorkitemProject{}, fmt.Errorf("unmarshal workitem project config failed: %w", err)
	}
	return wp, nil
}
