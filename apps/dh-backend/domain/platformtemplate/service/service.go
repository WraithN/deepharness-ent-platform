// Package service 实现平台模板模块的业务逻辑与数据访问。
package service

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"sync"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/platformtemplate/object"
	"github.com/lib/pq"
)

// PlatformTemplateService 定义平台模板模块的服务接口。
type PlatformTemplateService interface {
	ListByCategory(category string, publishedOnly bool) ([]object.PlatformTemplate, error)
	Create(tmpl object.PlatformTemplate) (object.PlatformTemplate, error)
	Update(key, category string, tmpl object.PlatformTemplate) (object.PlatformTemplate, error)
	Delete(key, category string) error
	UpdateOrder(category string, keys []string) error
	Publish(key, category string, published bool) error
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

	for i, tmpl := range defaultTemplates() {
		if _, err := s.db.Exec(`
			INSERT INTO platform_templates (category, key, label, content, sort_order, published)
			VALUES ($1, $2, $3, $4, $5, $6)
		`, tmpl.Category, tmpl.Key, tmpl.Label, tmpl.Content, i+1, tmpl.Published); err != nil {
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
// publishedOnly 为 true 时只返回已发布模板，供普通业务页面使用；
// 为 false 时返回全部模板，供超管管理页使用。
func (s *DBPlatformTemplateService) ListByCategory(category string, publishedOnly bool) ([]object.PlatformTemplate, error) {
	if err := s.ensureSeeded(); err != nil {
		return nil, err
	}
	if !isValidCategory(category) {
		return nil, errors.New("invalid category")
	}

	query := `
		SELECT id, category, key, label, content, sort_order, published, created_at, updated_at
		FROM platform_templates
		WHERE category = $1
	`
	args := []any{category}
	if publishedOnly {
		query += ` AND published = true`
	}
	query += ` ORDER BY sort_order ASC, id ASC`

	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("list templates by category failed: %w", err)
	}
	defer rows.Close()

	result := make([]object.PlatformTemplate, 0)
	for rows.Next() {
		var t object.PlatformTemplate
		if err := rows.Scan(&t.ID, &t.Category, &t.Key, &t.Label, &t.Content, &t.SortOrder, &t.Published, &t.CreatedAt, &t.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan template failed: %w", err)
		}
		result = append(result, t)
	}
	return result, rows.Err()
}

// Create 创建新的平台模板，category/key/label 为必填项。
// 新建模板默认为未发布状态，需要超管手动发布后才可在业务页面可见。
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

	count, err := s.countByCategory(tmpl.Category)
	if err != nil {
		return object.PlatformTemplate{}, err
	}
	if count >= object.MaxTemplatesPerCategory {
		return object.PlatformTemplate{}, errors.New("category template limit reached")
	}

	if exists, err := s.labelExists(tmpl.Category, tmpl.Label, ""); err != nil {
		return object.PlatformTemplate{}, err
	} else if exists {
		return object.PlatformTemplate{}, errors.New("template label already exists")
	}

	var nextSortOrder int
	if err := s.db.QueryRow(`
		SELECT COALESCE(MAX(sort_order), 0) + 1
		FROM platform_templates
		WHERE category = $1
	`, tmpl.Category).Scan(&nextSortOrder); err != nil {
		return object.PlatformTemplate{}, fmt.Errorf("compute sort order failed: %w", err)
	}

	var created object.PlatformTemplate
	err = s.db.QueryRow(`
		INSERT INTO platform_templates (category, key, label, content, sort_order, published)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id, category, key, label, content, sort_order, published, created_at, updated_at
	`, tmpl.Category, tmpl.Key, tmpl.Label, tmpl.Content, nextSortOrder, tmpl.Published).Scan(
		&created.ID, &created.Category, &created.Key, &created.Label, &created.Content, &created.SortOrder, &created.Published, &created.CreatedAt, &created.UpdatedAt,
	)
	if err != nil {
		if isUniqueViolation(err) {
			return object.PlatformTemplate{}, errors.New("template already exists")
		}
		return object.PlatformTemplate{}, fmt.Errorf("create template failed: %w", err)
	}
	return created, nil
}

// Update 更新指定 category/key 的平台模板。
// label 与 content 均为可选：传空字符串表示保持原值，避免覆盖历史数据。
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

	if tmpl.Label != "" {
		if exists, err := s.labelExists(category, tmpl.Label, key); err != nil {
			return object.PlatformTemplate{}, err
		} else if exists {
			return object.PlatformTemplate{}, errors.New("template label already exists")
		}
	}

	var updated object.PlatformTemplate
	err := s.db.QueryRow(`
		UPDATE platform_templates
		SET label = CASE WHEN $1 <> '' THEN $1 ELSE label END,
		    content = CASE WHEN $2 <> '' THEN $2 ELSE content END
		WHERE category = $3 AND key = $4
		RETURNING id, category, key, label, content, sort_order, published, created_at, updated_at
	`, tmpl.Label, tmpl.Content, category, key).Scan(
		&updated.ID, &updated.Category, &updated.Key, &updated.Label, &updated.Content, &updated.SortOrder, &updated.Published, &updated.CreatedAt, &updated.UpdatedAt,
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

// UpdateOrder 更新同一分类下模板的排序，keys 顺序即为目标顺序。
func (s *DBPlatformTemplateService) UpdateOrder(category string, keys []string) error {
	if err := s.ensureSeeded(); err != nil {
		return err
	}
	if !isValidCategory(category) {
		return errors.New("invalid category")
	}
	if len(keys) == 0 {
		return nil
	}

	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("begin transaction failed: %w", err)
	}
	defer tx.Rollback()

	for i, key := range keys {
		res, err := tx.Exec(`
			UPDATE platform_templates
			SET sort_order = $1
			WHERE category = $2 AND key = $3
		`, i+1, category, key)
		if err != nil {
			return fmt.Errorf("update order for %s failed: %w", key, err)
		}
		n, _ := res.RowsAffected()
		if n == 0 {
			return fmt.Errorf("template %s not found", key)
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit order update failed: %w", err)
	}
	return nil
}

// Publish 设置指定模板的发布状态。
func (s *DBPlatformTemplateService) Publish(key, category string, published bool) error {
	if err := s.ensureSeeded(); err != nil {
		return err
	}
	if key == "" || category == "" {
		return errors.New("key and category are required")
	}

	res, err := s.db.Exec(`
		UPDATE platform_templates
		SET published = $1
		WHERE category = $2 AND key = $3
	`, published, category, key)
	if err != nil {
		return fmt.Errorf("publish template failed: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return errors.New("template not found")
	}
	return nil
}

// countByCategory 返回指定分类下的模板数量。
func (s *DBPlatformTemplateService) countByCategory(category string) (int, error) {
	var count int
	if err := s.db.QueryRow(`
		SELECT COUNT(*) FROM platform_templates WHERE category = $1
	`, category).Scan(&count); err != nil {
		return 0, fmt.Errorf("count templates failed: %w", err)
	}
	return count, nil
}

// labelExists 判断同一分类下是否已存在相同 label 的模板。
// 传入 excludeKey 可排除自身（更新场景），传空字符串不排除。
func (s *DBPlatformTemplateService) labelExists(category, label, excludeKey string) (bool, error) {
	if strings.TrimSpace(label) == "" {
		return false, nil
	}
	var count int
	var err error
	if excludeKey == "" {
		err = s.db.QueryRow(`
			SELECT COUNT(*) FROM platform_templates
			WHERE category = $1 AND LOWER(label) = LOWER($2)
		`, category, label).Scan(&count)
	} else {
		err = s.db.QueryRow(`
			SELECT COUNT(*) FROM platform_templates
			WHERE category = $1 AND LOWER(label) = LOWER($2) AND key <> $3
		`, category, label, excludeKey).Scan(&count)
	}
	if err != nil {
		return false, fmt.Errorf("check duplicate label failed: %w", err)
	}
	return count > 0, nil
}

// isUniqueViolation 判断错误是否为唯一约束冲突。
func isUniqueViolation(err error) bool {
	if pgErr, ok := err.(*pq.Error); ok {
		return pgErr.Code == "23505"
	}
	return false
}
