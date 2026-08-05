package service

import (
	"database/sql"
	"errors"
	"fmt"

	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/common"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/common/sqlutil"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/workspace"
)

// GetCICD 获取工作空间关联的 CI/CD 配置（读取视图）。
// 实际数据源为工作空间所属租户关联的全局 cicd_configs 记录。
func (s *DBWorkspaceService) GetCICD(workspaceID string) (workspace.CICD, error) {
	var tenantID, cicdConfigID sql.NullString
	err := s.db.QueryRow(`
		SELECT t.id, t.cicd_config_id
		FROM workspaces w
		JOIN tenants t ON w.tenant_id = t.id
		WHERE w.id = $1
	`, workspaceID).Scan(&tenantID, &cicdConfigID)
	if errors.Is(err, sql.ErrNoRows) {
		return workspace.CICD{}, common.NotFoundErrorf("workspace not found")
	}
	if err != nil {
		return workspace.CICD{}, fmt.Errorf("get workspace tenant failed: %w", err)
	}
	if cicdConfigID.String == "" {
		return workspace.CICD{}, common.NotFoundErrorf("cicd not configured for tenant")
	}

	var c workspace.CICD
	var config sql.NullString
	var name, triggerBranches, webhookURL, script sql.NullString
	err = s.db.QueryRow(`
		SELECT id, tenant_id, name, trigger_branches, webhook_url, script, config, created_at, updated_at
		FROM cicd_configs WHERE id = $1
	`, cicdConfigID.String).Scan(&c.ID, &c.TenantID, &name, &triggerBranches, &webhookURL, &script, &config, &c.CreatedAt, &c.UpdatedAt)
	c.Name = name.String
	c.TriggerBranches = triggerBranches.String
	c.WebhookURL = webhookURL.String
	c.Script = script.String
	if errors.Is(err, sql.ErrNoRows) {
		return workspace.CICD{}, common.NotFoundErrorf("cicd config not found")
	}
	if err != nil {
		return workspace.CICD{}, fmt.Errorf("get cicd config failed: %w", err)
	}
	c.WorkspaceID = workspaceID
	c.Config, err = sqlutil.UnmarshalConfig(config)
	if err != nil {
		return workspace.CICD{}, fmt.Errorf("unmarshal cicd config failed: %w", err)
	}
	return c, nil
}
