package service

import (
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/workspace/object"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/common/sqlutil"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/workspace"
	"github.com/google/uuid"

	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/common"
)

// GetCICD 获取工作空间的 CI/CD 配置。
func (s *DBWorkspaceService) GetCICD(workspaceID string) (workspace.CICD, error) {
	var c workspace.CICD
	var config sql.NullString
	err := s.db.QueryRow(`
		SELECT id, workspace_id, trigger_branches, webhook_url, script, config, created_at, updated_at
		FROM workspace_cicd WHERE workspace_id = $1
	`, workspaceID).Scan(&c.ID, &c.WorkspaceID, &c.TriggerBranches, &c.WebhookURL, &c.Script, &config, &c.CreatedAt, &c.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return workspace.CICD{}, common.NotFoundErrorf("cicd not found")
	}
	if err != nil {
		return workspace.CICD{}, fmt.Errorf("get cicd failed: %w", err)
	}
	c.Config, err = sqlutil.UnmarshalConfig(config)
	if err != nil {
		return workspace.CICD{}, fmt.Errorf("unmarshal cicd config failed: %w", err)
	}
	return c, nil
}

// SaveCICD 保存工作空间的 CI/CD 配置，按 workspace_id 进行 upsert。
func (s *DBWorkspaceService) SaveCICD(workspaceID string, req object.CICDRequest) (workspace.CICD, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return workspace.CICD{}, fmt.Errorf("begin transaction failed: %w", err)
	}
	defer tx.Rollback()

	if err := workspaceExistsTx(tx, workspaceID); err != nil {
		return workspace.CICD{}, err
	}

	now := time.Now().UTC()
	_, err = tx.Exec(`
		INSERT INTO workspace_cicd (id, workspace_id, trigger_branches, webhook_url, script, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		ON CONFLICT (workspace_id) DO UPDATE SET
			trigger_branches = EXCLUDED.trigger_branches,
			webhook_url = EXCLUDED.webhook_url,
			script = EXCLUDED.script,
			updated_at = EXCLUDED.updated_at
	`, uuid.New().String(), workspaceID, req.TriggerBranches, req.WebhookURL, req.Script, now, now)
	if err != nil {
		return workspace.CICD{}, fmt.Errorf("save cicd failed: %w", err)
	}

	cicd, err := getCICDTx(tx, workspaceID)
	if err != nil {
		return workspace.CICD{}, err
	}

	if err := tx.Commit(); err != nil {
		return workspace.CICD{}, fmt.Errorf("commit failed: %w", err)
	}
	return cicd, nil
}

// getCICDTx 在事务中获取工作空间的 CI/CD 配置。
func getCICDTx(tx *sql.Tx, workspaceID string) (workspace.CICD, error) {
	var c workspace.CICD
	var config sql.NullString
	err := tx.QueryRow(`
		SELECT id, workspace_id, trigger_branches, webhook_url, script, config, created_at, updated_at
		FROM workspace_cicd WHERE workspace_id = $1
	`, workspaceID).Scan(&c.ID, &c.WorkspaceID, &c.TriggerBranches, &c.WebhookURL, &c.Script, &config, &c.CreatedAt, &c.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return workspace.CICD{}, common.NotFoundErrorf("cicd not found")
	}
	if err != nil {
		return workspace.CICD{}, fmt.Errorf("get cicd failed: %w", err)
	}
	c.Config, err = sqlutil.UnmarshalConfig(config)
	if err != nil {
		return workspace.CICD{}, fmt.Errorf("unmarshal cicd config failed: %w", err)
	}
	return c, nil
}
