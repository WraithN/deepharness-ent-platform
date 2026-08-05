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
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/identity"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/workspace"
	"github.com/google/uuid"
)

// CICDConfigService 定义全局 CICD 配置的服务接口。
// 所有配置归属 tenant_id = __system__，平台级，所有租户可见可选。
type CICDConfigService interface {
	ListCICDConfigs() ([]workspace.CICDConfig, error)
	GetCICDConfig(id string) (workspace.CICDConfig, error)
	CreateCICDConfig(req object.CICDConfigRequest) (workspace.CICDConfig, error)
	UpdateCICDConfig(id string, req object.CICDConfigRequest) (workspace.CICDConfig, error)
	DeleteCICDConfig(id string) error
}

// Ensure DBWorkspaceService implements CICDConfigService.
var _ CICDConfigService = (*DBWorkspaceService)(nil)

// ListCICDConfigs 列出全部平台级 CICD 配置（按创建时间升序）。
func (s *DBWorkspaceService) ListCICDConfigs() ([]workspace.CICDConfig, error) {
	rows, err := s.db.Query(`
		SELECT id, tenant_id, name, trigger_branches, webhook_url, script, config, created_at, updated_at
		FROM cicd_configs
		WHERE tenant_id = $1
		ORDER BY created_at
	`, identity.SystemTenantID)
	if err != nil {
		return nil, fmt.Errorf("list cicd configs failed: %w", err)
	}
	defer rows.Close()

	result := make([]workspace.CICDConfig, 0)
	for rows.Next() {
		c, err := scanCICDConfig(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, c)
	}
	return result, rows.Err()
}

// GetCICDConfig 根据 ID 获取平台级 CICD 配置。
func (s *DBWorkspaceService) GetCICDConfig(id string) (workspace.CICDConfig, error) {
	c, err := scanCICDConfig(s.db.QueryRow(`
		SELECT id, tenant_id, name, trigger_branches, webhook_url, script, config, created_at, updated_at
		FROM cicd_configs
		WHERE id = $1 AND tenant_id = $2
	`, id, identity.SystemTenantID))
	if errors.Is(err, sql.ErrNoRows) {
		return workspace.CICDConfig{}, common.NotFoundErrorf("cicd config not found")
	}
	if err != nil {
		return workspace.CICDConfig{}, fmt.Errorf("get cicd config failed: %w", err)
	}
	return c, nil
}

// CreateCICDConfig 创建新的平台级 CICD 配置。
func (s *DBWorkspaceService) CreateCICDConfig(req object.CICDConfigRequest) (workspace.CICDConfig, error) {
	if req.Name == "" {
		return workspace.CICDConfig{}, errors.New("cicd config name is required")
	}
	configJSON, err := sqlutil.MarshalConfig(req.Config)
	if err != nil {
		return workspace.CICDConfig{}, fmt.Errorf("marshal cicd config failed: %w", err)
	}
	now := time.Now().UTC()
	id := strings.ReplaceAll(uuid.New().String(), "-", "")
	_, err = s.db.Exec(`
		INSERT INTO cicd_configs (id, tenant_id, name, trigger_branches, webhook_url, script, config, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
	`, id, identity.SystemTenantID, req.Name, req.TriggerBranches, req.WebhookURL, req.Script, configJSON, now, now)
	if err != nil {
		return workspace.CICDConfig{}, fmt.Errorf("create cicd config failed: %w", err)
	}
	return s.GetCICDConfig(id)
}

// UpdateCICDConfig 更新平台级 CICD 配置。
func (s *DBWorkspaceService) UpdateCICDConfig(id string, req object.CICDConfigRequest) (workspace.CICDConfig, error) {
	if id == "" {
		return workspace.CICDConfig{}, errors.New("cicd config id is required")
	}
	if req.Name == "" {
		return workspace.CICDConfig{}, errors.New("cicd config name is required")
	}
	configJSON, err := sqlutil.MarshalConfig(req.Config)
	if err != nil {
		return workspace.CICDConfig{}, fmt.Errorf("marshal cicd config failed: %w", err)
	}
	_, err = s.db.Exec(`
		UPDATE cicd_configs
		SET name = $1, trigger_branches = $2, webhook_url = $3, script = $4, config = $5
		WHERE id = $6 AND tenant_id = $7
	`, req.Name, req.TriggerBranches, req.WebhookURL, req.Script, configJSON, id, identity.SystemTenantID)
	if err != nil {
		return workspace.CICDConfig{}, fmt.Errorf("update cicd config failed: %w", err)
	}
	return s.GetCICDConfig(id)
}

// DeleteCICDConfig 删除平台级 CICD 配置。
func (s *DBWorkspaceService) DeleteCICDConfig(id string) error {
	if id == "" {
		return errors.New("cicd config id is required")
	}
	_, err := s.db.Exec(`DELETE FROM cicd_configs WHERE id = $1 AND tenant_id = $2`, id, identity.SystemTenantID)
	if err != nil {
		return fmt.Errorf("delete cicd config failed: %w", err)
	}
	return nil
}

// scanCICDConfig 从数据库行扫描 CICDConfig。
func scanCICDConfig(row interface {
	Scan(dest ...any) error
}) (workspace.CICDConfig, error) {
	var c workspace.CICDConfig
	var config sql.NullString
	var name, triggerBranches, webhookURL, script sql.NullString
	err := row.Scan(&c.ID, &c.TenantID, &name, &triggerBranches, &webhookURL, &script, &config, &c.CreatedAt, &c.UpdatedAt)
	if err != nil {
		return workspace.CICDConfig{}, err
	}
	c.Name = name.String
	c.TriggerBranches = triggerBranches.String
	c.WebhookURL = webhookURL.String
	c.Script = script.String
	c.Config, err = sqlutil.UnmarshalConfig(config)
	if err != nil {
		return workspace.CICDConfig{}, fmt.Errorf("unmarshal cicd config failed: %w", err)
	}
	return c, nil
}
