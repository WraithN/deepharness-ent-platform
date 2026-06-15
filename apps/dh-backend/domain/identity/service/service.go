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
	GetMe() (object.User, error)
	GetByEmail(email string) (object.User, error)
	VerifyPassword(email, password string) (object.User, error)
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
		SELECT id, tenant_id, email, name, role, created_at
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
		if err := rows.Scan(&u.ID, &u.TenantID, &u.Email, &u.Name, &u.Role, &u.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan user failed: %w", err)
		}
		result = append(result, u)
	}
	return result, rows.Err()
}

func (s *DBUserService) GetMe() (object.User, error) {
	// 当前没有登录态，默认返回创建最早的 admin 用户作为当前用户。
	var u object.User
	err := s.db.QueryRow(`
		SELECT id, tenant_id, email, name, role, created_at
		FROM users
		ORDER BY created_at
		LIMIT 1
	`).Scan(&u.ID, &u.TenantID, &u.Email, &u.Name, &u.Role, &u.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return object.User{}, errors.New("no user found")
	}
	if err != nil {
		return object.User{}, fmt.Errorf("get me failed: %w", err)
	}
	return u, nil
}

func (s *DBUserService) GetByEmail(email string) (object.User, error) {
	var u object.User
	err := s.db.QueryRow(`
		SELECT id, tenant_id, email, name, role, created_at
		FROM users WHERE email = $1
	`, email).Scan(&u.ID, &u.TenantID, &u.Email, &u.Name, &u.Role, &u.CreatedAt)
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
		SELECT id, tenant_id, email, name, role, created_at, password_hash
		FROM users WHERE email = $1
	`, email).Scan(&u.ID, &u.TenantID, &u.Email, &u.Name, &u.Role, &u.CreatedAt, &hash)
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

// MockUserService 是 UserService 的内存 mock 实现，仅在无数据库时使用。
// 注意：该实现不返回任何 mock 用户，避免与真实数据混淆。
type MockUserService struct{}

func NewMockUserService() *MockUserService {
	return &MockUserService{}
}

func (s *MockUserService) ListUsers() ([]object.User, error) {
	return []object.User{}, nil
}

func (s *MockUserService) GetMe() (object.User, error) {
	return object.User{}, errors.New("no user found")
}

func (s *MockUserService) GetByEmail(email string) (object.User, error) {
	return object.User{}, errors.New("user not found")
}

func (s *MockUserService) VerifyPassword(email, password string) (object.User, error) {
	return object.User{}, errors.New("invalid email or password")
}
