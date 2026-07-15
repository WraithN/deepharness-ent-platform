package service

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/identity/object"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/agent"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/identity"
	"github.com/google/uuid"
	"github.com/lib/pq"
	"golang.org/x/crypto/bcrypt"
)

// TenantPolicy 表示超管为租户设置的智能体策略。
type TenantPolicy struct {
	AgentConfigLocked   bool                           `json:"agentConfigLocked"`
	LockedAgentKeys     []string                       `json:"lockedAgentKeys"`
	AllowedAgentKeys    []string                       `json:"allowedAgentKeys"`
	DefaultAgentConfigs map[string]AgentConfigSnapshot `json:"defaultAgentConfigs"`
}

// AgentConfigSnapshot 表示超管为某个 agent 预设的默认配置快照。
type AgentConfigSnapshot struct {
	Enabled        bool                       `json:"enabled"`
	Model          string                     `json:"model"`
	ModelSource    string                     `json:"modelSource"`
	BaseURL        string                     `json:"baseUrl"`
	APIKey         string                     `json:"apiKey"`
	Temperature    *float64                   `json:"temperature,omitempty"`
	AdvancedConfig *agent.AdvancedAgentConfig `json:"advancedConfig,omitempty"`
}

// TenantMember 表示租户下的成员信息。
type TenantMember struct {
	ID           string                `json:"id"`
	Name         string                `json:"name"`
	Email        string                `json:"email"`
	PlatformRole identity.PlatformRole `json:"platformRole"`
}

// UserService 定义用户/租户模块的服务接口。
type UserService interface {
	ListUsers() ([]object.User, error)
	GetByID(userID string) (object.User, error)
	GetByEmail(email string) (object.User, error)
	VerifyPassword(email, password string) (object.User, error)
	GetProfile(userID string) (object.Profile, error)
	SaveProfile(userID, name, avatarURL, description, sshKey string) (object.Profile, error)

	ListTenants() ([]identity.Tenant, error)
	GetTenant(id string) (identity.Tenant, error)
	CreateTenant(name string, policy TenantPolicy) (identity.Tenant, error)
	UpdateTenant(id, name string, policy TenantPolicy) (identity.Tenant, error)
	DeleteTenant(id string) error
	ListTenantMembers(tenantID string) ([]TenantMember, error)
	AddTenantMember(tenantID, email, name string) (TenantMember, error)
	SetTenantAdmin(tenantID, userID string, isAdmin bool) error
}

// DBUserService 是基于 PostgreSQL 的 UserService 实现。
type DBUserService struct {
	db *sql.DB
}

func NewDBUserService(db *sql.DB) *DBUserService {
	return &DBUserService{db: db}
}

func (s *DBUserService) ListUsers() ([]object.User, error) {
	rows, err := s.db.Query(`
		SELECT id, tenant_id, email, name, platform_role, created_at
		FROM users
		ORDER BY created_at
	`)
	if err != nil {
		return nil, fmt.Errorf("list users failed: %w", err)
	}
	defer rows.Close()

	result := make([]object.User, 0)
	for rows.Next() {
		var u object.User
		if err := rows.Scan(&u.ID, &u.TenantID, &u.Email, &u.Name, &u.PlatformRole, &u.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan user failed: %w", err)
		}
		result = append(result, u)
	}
	return result, rows.Err()
}

func (s *DBUserService) GetByID(userID string) (object.User, error) {
	var u object.User
	err := s.db.QueryRow(`
		SELECT id, tenant_id, email, name, platform_role, created_at
		FROM users WHERE id = $1
	`, userID).Scan(&u.ID, &u.TenantID, &u.Email, &u.Name, &u.PlatformRole, &u.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return object.User{}, errors.New("user not found")
	}
	if err != nil {
		return object.User{}, fmt.Errorf("get user by id failed: %w", err)
	}
	return u, nil
}

func (s *DBUserService) GetByEmail(email string) (object.User, error) {
	var u object.User
	err := s.db.QueryRow(`
		SELECT id, tenant_id, email, name, platform_role, created_at
		FROM users WHERE email = $1
	`, email).Scan(&u.ID, &u.TenantID, &u.Email, &u.Name, &u.PlatformRole, &u.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return object.User{}, errors.New("user not found")
	}
	if err != nil {
		return object.User{}, fmt.Errorf("get user by email failed: %w", err)
	}
	return u, nil
}

func (s *DBUserService) VerifyPassword(email, password string) (object.User, error) {
	var u object.User
	var hash string
	err := s.db.QueryRow(`
		SELECT id, tenant_id, email, name, platform_role, created_at, password_hash
		FROM users WHERE email = $1
	`, email).Scan(&u.ID, &u.TenantID, &u.Email, &u.Name, &u.PlatformRole, &u.CreatedAt, &hash)
	if errors.Is(err, sql.ErrNoRows) {
		return object.User{}, errors.New("invalid email or password")
	}
	if err != nil {
		return object.User{}, fmt.Errorf("verify password failed: %w", err)
	}
	if err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)); err != nil {
		return object.User{}, errors.New("invalid email or password")
	}
	return u, nil
}

// GetProfile 获取用户个人信息，不存在时返回空 Profile。
func (s *DBUserService) GetProfile(userID string) (object.Profile, error) {
	var p object.Profile
	var avatarURL, description, sshKey sql.NullString
	err := s.db.QueryRow(`
		SELECT user_id, avatar_url, description, ssh_key, updated_at
		FROM user_profiles WHERE user_id = $1
	`, userID).Scan(&p.UserID, &avatarURL, &description, &sshKey, &p.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		// 用户尚未填写个人信息，返回空 Profile
		return object.Profile{UserID: userID}, nil
	}
	if err != nil {
		return object.Profile{}, fmt.Errorf("get profile failed: %w", err)
	}
	p.AvatarURL = avatarURL.String
	p.Description = description.String
	p.SSHKey = sshKey.String
	return p, nil
}

// SaveProfile 保存用户个人信息（upsert），同时同步更新 users.name 昵称。
func (s *DBUserService) SaveProfile(userID, name, avatarURL, description, sshKey string) (object.Profile, error) {
	// 同步更新昵称到 users 表
	if name != "" {
		if _, err := s.db.Exec(`UPDATE users SET name = $1 WHERE id = $2`, name, userID); err != nil {
			return object.Profile{}, fmt.Errorf("update user name failed: %w", err)
		}
	}

	// upsert user_profiles
	var p object.Profile
	err := s.db.QueryRow(`
		INSERT INTO user_profiles (user_id, avatar_url, description, ssh_key, updated_at)
		VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
		ON CONFLICT (user_id) DO UPDATE SET
			avatar_url = EXCLUDED.avatar_url,
			description = EXCLUDED.description,
			ssh_key = EXCLUDED.ssh_key,
			updated_at = CURRENT_TIMESTAMP
		RETURNING user_id, avatar_url, description, ssh_key, updated_at
	`, userID, avatarURL, description, sshKey).Scan(&p.UserID, &p.AvatarURL, &p.Description, &p.SSHKey, &p.UpdatedAt)
	if err != nil {
		return object.Profile{}, fmt.Errorf("save profile failed: %w", err)
	}
	return p, nil
}

// ── 租户管理 ──

const (
	systemTenantID        = "__system__"
	defaultMemberPassword = "123456"
)

func scanTenant(row interface {
	Scan(dest ...any) error
}) (identity.Tenant, error) {
	var t identity.Tenant
	var lockedKeys, allowedKeys pq.StringArray
	var defaultConfigs []byte
	var displayID sql.NullString
	err := row.Scan(&t.ID, &displayID, &t.Name, &t.AgentConfigLocked, &lockedKeys, &allowedKeys, &defaultConfigs, &t.CreatedAt)
	if err != nil {
		return identity.Tenant{}, err
	}
	t.DisplayID = displayID.String
	t.LockedAgentKeys = []string(lockedKeys)
	t.AllowedAgentKeys = []string(allowedKeys)
	if len(defaultConfigs) > 0 {
		t.DefaultAgentConfigs = json.RawMessage(defaultConfigs)
	}
	return t, nil
}

func (s *DBUserService) ListTenants() ([]identity.Tenant, error) {
	rows, err := s.db.Query(`
		SELECT id, display_id, name, agent_config_locked, locked_agent_keys, allowed_agent_keys, default_agent_configs, created_at
		FROM tenants WHERE id <> $1 ORDER BY created_at
	`, systemTenantID)
	if err != nil {
		return nil, fmt.Errorf("list tenants failed: %w", err)
	}
	defer rows.Close()
	result := make([]identity.Tenant, 0)
	for rows.Next() {
		t, err := scanTenant(rows)
		if err != nil {
			return nil, fmt.Errorf("scan tenant failed: %w", err)
		}
		result = append(result, t)
	}
	return result, rows.Err()
}

func (s *DBUserService) GetTenant(id string) (identity.Tenant, error) {
	t, err := scanTenant(s.db.QueryRow(`
		SELECT id, display_id, name, agent_config_locked, locked_agent_keys, allowed_agent_keys, default_agent_configs, created_at
		FROM tenants WHERE id = $1
	`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return identity.Tenant{}, errors.New("tenant not found")
	}
	if err != nil {
		return identity.Tenant{}, fmt.Errorf("get tenant failed: %w", err)
	}
	return t, nil
}

func (s *DBUserService) CreateTenant(name string, policy TenantPolicy) (identity.Tenant, error) {
	if name == "" {
		return identity.Tenant{}, errors.New("tenant name is required")
	}
	defaultConfigsJSON, err := json.Marshal(policy.DefaultAgentConfigs)
	if err != nil {
		return identity.Tenant{}, fmt.Errorf("marshal default agent configs failed: %w", err)
	}
	id := generateID()
	// 从序列生成 display_id（自增数字）
	var displayID string
	err = s.db.QueryRow(`SELECT nextval('tenant_display_id_seq')::text`).Scan(&displayID)
	if err != nil {
		return identity.Tenant{}, fmt.Errorf("generate tenant display_id failed: %w", err)
	}
	_, err = s.db.Exec(`
		INSERT INTO tenants (id, display_id, name, agent_config_locked, locked_agent_keys, allowed_agent_keys, default_agent_configs)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
	`, id, displayID, name, policy.AgentConfigLocked, pq.Array(policy.LockedAgentKeys), pq.Array(policy.AllowedAgentKeys), defaultConfigsJSON)
	if err != nil {
		return identity.Tenant{}, fmt.Errorf("create tenant failed: %w", err)
	}
	return s.GetTenant(id)
}

func (s *DBUserService) UpdateTenant(id, name string, policy TenantPolicy) (identity.Tenant, error) {
	if id == "" {
		return identity.Tenant{}, errors.New("tenant id is required")
	}
	if id == systemTenantID {
		return identity.Tenant{}, errors.New("cannot modify system tenant")
	}
	if name == "" {
		return identity.Tenant{}, errors.New("tenant name is required")
	}
	defaultConfigsJSON, err := json.Marshal(policy.DefaultAgentConfigs)
	if err != nil {
		return identity.Tenant{}, fmt.Errorf("marshal default agent configs failed: %w", err)
	}
	_, err = s.db.Exec(`
		UPDATE tenants SET name = $1, agent_config_locked = $2, locked_agent_keys = $3, allowed_agent_keys = $4, default_agent_configs = $5
		WHERE id = $6
	`, name, policy.AgentConfigLocked, pq.Array(policy.LockedAgentKeys), pq.Array(policy.AllowedAgentKeys), defaultConfigsJSON, id)
	if err != nil {
		return identity.Tenant{}, fmt.Errorf("update tenant failed: %w", err)
	}
	return s.GetTenant(id)
}

func (s *DBUserService) DeleteTenant(id string) error {
	if id == "" {
		return errors.New("tenant id is required")
	}
	if id == systemTenantID {
		return errors.New("cannot delete system tenant")
	}
	_, err := s.db.Exec(`DELETE FROM tenants WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("delete tenant failed: %w", err)
	}
	return nil
}

func (s *DBUserService) ListTenantMembers(tenantID string) ([]TenantMember, error) {
	rows, err := s.db.Query(`
		SELECT id, name, email, platform_role FROM users WHERE tenant_id = $1 ORDER BY created_at
	`, tenantID)
	if err != nil {
		return nil, fmt.Errorf("list tenant members failed: %w", err)
	}
	defer rows.Close()
	result := make([]TenantMember, 0)
	for rows.Next() {
		var m TenantMember
		if err := rows.Scan(&m.ID, &m.Name, &m.Email, &m.PlatformRole); err != nil {
			return nil, fmt.Errorf("scan tenant member failed: %w", err)
		}
		result = append(result, m)
	}
	return result, rows.Err()
}

func (s *DBUserService) AddTenantMember(tenantID, email, name string) (TenantMember, error) {
	var member TenantMember
	if tenantID == "" {
		return TenantMember{}, errors.New("tenant id is required")
	}
	if tenantID == systemTenantID {
		return TenantMember{}, errors.New("cannot add member to system tenant")
	}
	// 校验目标租户存在
	if _, err := s.GetTenant(tenantID); err != nil {
		return TenantMember{}, err
	}
	if email == "" {
		return TenantMember{}, errors.New("email is required")
	}
	if name == "" {
		return TenantMember{}, errors.New("name is required")
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(defaultMemberPassword), bcrypt.DefaultCost)
	if err != nil {
		return TenantMember{}, fmt.Errorf("hash password failed: %w", err)
	}

	id := generateID()
	err = s.db.QueryRow(`
		INSERT INTO users (id, tenant_id, email, name, platform_role, password_hash)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id, name, email, platform_role
	`, id, tenantID, email, name, identity.PlatformRoleUser, string(hash)).Scan(&member.ID, &member.Name, &member.Email, &member.PlatformRole)
	if err != nil {
		return TenantMember{}, fmt.Errorf("add tenant member failed: %w", err)
	}
	return member, nil
}

func (s *DBUserService) SetTenantAdmin(tenantID, userID string, isAdmin bool) error {
	if tenantID == systemTenantID {
		return errors.New("cannot set admin for system tenant")
	}
	role := identity.PlatformRoleUser
	if isAdmin {
		role = identity.PlatformRoleTenantAdmin
	}
	res, err := s.db.Exec(`UPDATE users SET platform_role = $1 WHERE id = $2 AND tenant_id = $3`, role, userID, tenantID)
	if err != nil {
		return fmt.Errorf("set tenant admin failed: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return errors.New("user not found in this tenant")
	}
	return nil
}

// generateID 生成 uuid4 去横线的 32 字符 ID。
func generateID() string {
	return strings.ReplaceAll(uuid.New().String(), "-", "")
}
