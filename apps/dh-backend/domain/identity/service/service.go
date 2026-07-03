package service

import (
	"database/sql"
	"errors"
	"fmt"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/identity/object"
	"golang.org/x/crypto/bcrypt"
)

// UserService 定义用户/租户模块的服务接口。
type UserService interface {
	ListUsers() ([]object.User, error)
	GetByID(userID string) (object.User, error)
	GetByEmail(email string) (object.User, error)
	VerifyPassword(email, password string) (object.User, error)
	GetProfile(userID string) (object.Profile, error)
	SaveProfile(userID, name, avatarURL, description, sshKey string) (object.Profile, error)
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

