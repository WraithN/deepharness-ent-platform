// Package service 实现平台模板模块的业务逻辑与数据访问。
package service

import (
	"database/sql"
	"errors"
	"fmt"
	"sync"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/platformtemplate/object"
	"github.com/lib/pq"
)

// PlatformTemplateService 定义平台模板模块的服务接口。
type PlatformTemplateService interface {
	ListByCategory(category string) ([]object.PlatformTemplate, error)
	Create(tmpl object.PlatformTemplate) (object.PlatformTemplate, error)
	Update(key, category string, tmpl object.PlatformTemplate) (object.PlatformTemplate, error)
	Delete(key, category string) error
}

// DBPlatformTemplateService 是基于 PostgreSQL 的 PlatformTemplateService 实现。
type DBPlatformTemplateService struct {
	db       *sql.DB
	seedOnce sync.Once
	seedErr  error
}

// NewDBPlatformTemplateService 创建基于 PostgreSQL 的平台模板服务。
func NewDBPlatformTemplateService(db *sql.DB) *DBPlatformTemplateService {
	return &DBPlatformTemplateService{db: db}
}

// ensureSeeded 在首次调用时检查表是否为空，若为空则插入默认模板。
func (s *DBPlatformTemplateService) ensureSeeded() error {
	s.seedOnce.Do(func() {
		s.seedErr = s.seed()
	})
	return s.seedErr
}

// seed 将平台默认模板写入数据库，仅在表为空时执行。
func (s *DBPlatformTemplateService) seed() error {
	var count int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM platform_templates`).Scan(&count); err != nil {
		return fmt.Errorf("count platform templates failed: %w", err)
	}
	if count > 0 {
		return nil
	}

	for _, tmpl := range defaultTemplates() {
		if _, err := s.db.Exec(`
			INSERT INTO platform_templates (category, key, label, content)
			VALUES ($1, $2, $3, $4)
		`, tmpl.Category, tmpl.Key, tmpl.Label, tmpl.Content); err != nil {
			return fmt.Errorf("seed platform template %s/%s failed: %w", tmpl.Category, tmpl.Key, err)
		}
	}
	return nil
}

// isValidCategory 校验分类是否属于预定义值。
func isValidCategory(category string) bool {
	switch category {
	case object.TemplateCategoryProduct, object.TemplateCategoryDesign, object.TemplateCategoryDevelopment:
		return true
	}
	return false
}

// ListByCategory 按分类查询平台模板列表，首次调用会自动初始化默认模板。
func (s *DBPlatformTemplateService) ListByCategory(category string) ([]object.PlatformTemplate, error) {
	if err := s.ensureSeeded(); err != nil {
		return nil, err
	}
	if !isValidCategory(category) {
		return nil, errors.New("invalid category")
	}

	rows, err := s.db.Query(`
		SELECT id, category, key, label, content, created_at, updated_at
		FROM platform_templates
		WHERE category = $1
		ORDER BY id
	`, category)
	if err != nil {
		return nil, fmt.Errorf("list templates by category failed: %w", err)
	}
	defer rows.Close()

	result := make([]object.PlatformTemplate, 0)
	for rows.Next() {
		var t object.PlatformTemplate
		if err := rows.Scan(&t.ID, &t.Category, &t.Key, &t.Label, &t.Content, &t.CreatedAt, &t.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan template failed: %w", err)
		}
		result = append(result, t)
	}
	return result, rows.Err()
}

// Create 创建新的平台模板，category/key/label 为必填项。
func (s *DBPlatformTemplateService) Create(tmpl object.PlatformTemplate) (object.PlatformTemplate, error) {
	if err := s.ensureSeeded(); err != nil {
		return object.PlatformTemplate{}, err
	}
	if !isValidCategory(tmpl.Category) {
		return object.PlatformTemplate{}, errors.New("invalid category")
	}
	if tmpl.Key == "" {
		return object.PlatformTemplate{}, errors.New("key is required")
	}
	if tmpl.Label == "" {
		return object.PlatformTemplate{}, errors.New("label is required")
	}

	var created object.PlatformTemplate
	err := s.db.QueryRow(`
		INSERT INTO platform_templates (category, key, label, content)
		VALUES ($1, $2, $3, $4)
		RETURNING id, category, key, label, content, created_at, updated_at
	`, tmpl.Category, tmpl.Key, tmpl.Label, tmpl.Content).Scan(
		&created.ID, &created.Category, &created.Key, &created.Label, &created.Content, &created.CreatedAt, &created.UpdatedAt,
	)
	if err != nil {
		if isUniqueViolation(err) {
			return object.PlatformTemplate{}, errors.New("template already exists")
		}
		return object.PlatformTemplate{}, fmt.Errorf("create template failed: %w", err)
	}
	return created, nil
}

// Update 更新指定 category/key 的平台模板，允许修改 label 与 content。
func (s *DBPlatformTemplateService) Update(key, category string, tmpl object.PlatformTemplate) (object.PlatformTemplate, error) {
	if err := s.ensureSeeded(); err != nil {
		return object.PlatformTemplate{}, err
	}
	if key == "" || category == "" {
		return object.PlatformTemplate{}, errors.New("key and category are required")
	}
	if !isValidCategory(category) {
		return object.PlatformTemplate{}, errors.New("invalid category")
	}

	var updated object.PlatformTemplate
	err := s.db.QueryRow(`
		UPDATE platform_templates
		SET label = $1, content = $2
		WHERE category = $3 AND key = $4
		RETURNING id, category, key, label, content, created_at, updated_at
	`, tmpl.Label, tmpl.Content, category, key).Scan(
		&updated.ID, &updated.Category, &updated.Key, &updated.Label, &updated.Content, &updated.CreatedAt, &updated.UpdatedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return object.PlatformTemplate{}, errors.New("template not found")
	}
	if err != nil {
		return object.PlatformTemplate{}, fmt.Errorf("update template failed: %w", err)
	}
	return updated, nil
}

// Delete 删除指定 category/key 的平台模板。
func (s *DBPlatformTemplateService) Delete(key, category string) error {
	if err := s.ensureSeeded(); err != nil {
		return err
	}
	if key == "" || category == "" {
		return errors.New("key and category are required")
	}

	res, err := s.db.Exec(`DELETE FROM platform_templates WHERE category = $1 AND key = $2`, category, key)
	if err != nil {
		return fmt.Errorf("delete template failed: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return errors.New("template not found")
	}
	return nil
}

// isUniqueViolation 判断错误是否为唯一约束冲突。
func isUniqueViolation(err error) bool {
	if pgErr, ok := err.(*pq.Error); ok {
		return pgErr.Code == "23505"
	}
	return false
}
