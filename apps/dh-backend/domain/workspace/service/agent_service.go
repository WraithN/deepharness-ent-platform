package service

import (
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/workspace/object"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/pkg/idutil"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/common/sqlutil"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/agent"

	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/common"
)

// ListAgents 返回工作空间下的 Agent 列表。
func (s *DBWorkspaceService) ListAgents(workspaceID string) ([]agent.Agent, error) {
	rows, err := s.db.Query(`
		SELECT id, workspace_id, name, role, description, config, is_default, created_by_user_id, created_at, updated_at
		FROM agents WHERE workspace_id = $1 ORDER BY created_at DESC
	`, workspaceID)
	if err != nil {
		return nil, fmt.Errorf("list agents failed: %w", err)
	}
	defer rows.Close()

	result := make([]agent.Agent, 0)
	for rows.Next() {
		var a agent.Agent
		var role, description, createdBy sql.NullString
		var config sql.NullString
		if err := rows.Scan(&a.ID, &a.WorkspaceID, &a.Name, &role, &description, &config, &a.IsDefault, &createdBy, &a.CreatedAt, &a.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan agent failed: %w", err)
		}
		a.Role = sqlutil.ScanNullString(role)
		a.Description = sqlutil.ScanNullString(description)
		a.CreatedByUserID = sqlutil.ScanNullString(createdBy)
		a.Config, err = sqlutil.UnmarshalConfig(config)
		if err != nil {
			return nil, fmt.Errorf("unmarshal agent config failed: %w", err)
		}
		result = append(result, a)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate agents failed: %w", err)
	}
	return result, nil
}

// CreateAgent 在工作空间下创建 Agent，必要时清空原有默认 Agent。
func (s *DBWorkspaceService) CreateAgent(workspaceID string, req object.AgentRequest) (agent.Agent, error) {
	if err := s.workspaceExists(workspaceID); err != nil {
		return agent.Agent{}, err
	}

	now := time.Now().UTC()
	a := agent.Agent{
		ID:          idutil.GenerateID(),
		WorkspaceID: workspaceID,
		Name:        req.Name,
		Role:        req.Role,
		Description: req.Description,
		Config:      req.Config,
		IsDefault:   req.IsDefault,
		CreatedAt:   now,
		UpdatedAt:   now,
	}

	configStr, err := sqlutil.MarshalConfig(req.Config)
	if err != nil {
		return agent.Agent{}, fmt.Errorf("marshal agent config failed: %w", err)
	}

	tx, err := s.db.Begin()
	if err != nil {
		return agent.Agent{}, fmt.Errorf("begin transaction failed: %w", err)
	}
	defer tx.Rollback()

	if req.IsDefault {
		if _, err := tx.Exec(`UPDATE agents SET is_default = false WHERE workspace_id = $1`, workspaceID); err != nil {
			return agent.Agent{}, fmt.Errorf("clear default agent failed: %w", err)
		}
	}

	_, err = tx.Exec(`
		INSERT INTO agents (id, workspace_id, name, role, description, config, is_default, created_by_user_id, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
	`, a.ID, a.WorkspaceID, a.Name, a.Role, a.Description, configStr, a.IsDefault, a.CreatedByUserID, a.CreatedAt, a.UpdatedAt)
	if err != nil {
		return agent.Agent{}, fmt.Errorf("insert agent failed: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return agent.Agent{}, fmt.Errorf("commit failed: %w", err)
	}
	return a, nil
}

// GetDefaultAgent 返回工作空间的默认 Agent。
func (s *DBWorkspaceService) GetDefaultAgent(workspaceID string) (agent.Agent, error) {
	var a agent.Agent
	var role, description, createdBy sql.NullString
	var config sql.NullString
	err := s.db.QueryRow(`
		SELECT id, workspace_id, name, role, description, config, is_default, created_by_user_id, created_at, updated_at
		FROM agents WHERE workspace_id = $1 AND is_default = true
	`, workspaceID).Scan(&a.ID, &a.WorkspaceID, &a.Name, &role, &description, &config, &a.IsDefault, &createdBy, &a.CreatedAt, &a.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return agent.Agent{}, common.NotFoundErrorf("default agent not found")
	}
	if err != nil {
		return agent.Agent{}, fmt.Errorf("get default agent failed: %w", err)
	}
	a.Role = sqlutil.ScanNullString(role)
	a.Description = sqlutil.ScanNullString(description)
	a.CreatedByUserID = sqlutil.ScanNullString(createdBy)
	a.Config, err = sqlutil.UnmarshalConfig(config)
	if err != nil {
		return agent.Agent{}, fmt.Errorf("unmarshal default agent config failed: %w", err)
	}
	return a, nil
}
