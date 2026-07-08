package service

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/productdoc/object"
	"github.com/google/uuid"
)

// DBProductDocService 是基于 PostgreSQL 的 ProductDocService 实现。
type DBProductDocService struct {
	db *sql.DB
}

// NewDBProductDocService 创建 PostgreSQL 实现的产品文档服务。
func NewDBProductDocService(db *sql.DB) *DBProductDocService {
	return &DBProductDocService{db: db}
}

// ListDocs 返回满足过滤条件的产品文档列表。
func (s *DBProductDocService) ListDocs(filter ProductDocFilter) ([]object.ProductDoc, error) {
	var conditions []string
	var args []any
	argIdx := 1

	if filter.WorkspaceID != "" {
		conditions = append(conditions, fmt.Sprintf("workspace_id = $%d", argIdx))
		args = append(args, filter.WorkspaceID)
		argIdx++
	}
	if filter.Status != "" {
		conditions = append(conditions, fmt.Sprintf("status = $%d", argIdx))
		args = append(args, string(filter.Status))
		argIdx++
	}
	if filter.Category != "" {
		conditions = append(conditions, fmt.Sprintf("category = $%d", argIdx))
		args = append(args, filter.Category)
		argIdx++
	}

	query := `SELECT id, workspace_id, title, slug, content, status, category, created_by, created_at, updated_at
		FROM product_docs`
	if len(conditions) > 0 {
		query += " WHERE " + strings.Join(conditions, " AND ")
	}
	query += " ORDER BY updated_at DESC"

	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("list product docs failed: %w", err)
	}
	defer rows.Close()

	result := make([]object.ProductDoc, 0)
	for rows.Next() {
		var doc object.ProductDoc
		var content, category, createdBy sql.NullString
		err := rows.Scan(
			&doc.ID, &doc.WorkspaceID, &doc.Title, &doc.Slug,
			&content, &doc.Status, &category, &createdBy,
			&doc.CreatedAt, &doc.UpdatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("scan product doc failed: %w", err)
		}
		if content.Valid {
			doc.Content = content.String
		}
		if category.Valid {
			doc.Category = category.String
		}
		if createdBy.Valid {
			doc.CreatedBy = createdBy.String
		}
		result = append(result, doc)
	}
	return result, rows.Err()
}

// GetDoc 按 ID 获取单个产品文档详情。
func (s *DBProductDocService) GetDoc(id string) (object.ProductDoc, error) {
	var doc object.ProductDoc
	var content, category, createdBy sql.NullString
	err := s.db.QueryRow(`
		SELECT id, workspace_id, title, slug, content, status, category, created_by, created_at, updated_at
		FROM product_docs WHERE id = $1
	`, id).Scan(
		&doc.ID, &doc.WorkspaceID, &doc.Title, &doc.Slug,
		&content, &doc.Status, &category, &createdBy,
		&doc.CreatedAt, &doc.UpdatedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return object.ProductDoc{}, errors.New("product doc not found")
	}
	if err != nil {
		return object.ProductDoc{}, fmt.Errorf("get product doc failed: %w", err)
	}
	if content.Valid {
		doc.Content = content.String
	}
	if category.Valid {
		doc.Category = category.String
	}
	if createdBy.Valid {
		doc.CreatedBy = createdBy.String
	}
	return doc, nil
}

// CreateDoc 创建新的产品文档并返回创建后的记录。
func (s *DBProductDocService) CreateDoc(req object.CreateProductDocRequest) (object.ProductDoc, error) {
	now := time.Now().UTC()
	if req.Status == "" {
		req.Status = object.DocStatusDraft
	}

	id := uuid.New().String()
	if req.Slug == "" {
		req.Slug = uuid.New().String()
	}

	var doc object.ProductDoc
	var content, category, createdBy sql.NullString
	err := s.db.QueryRow(`
		INSERT INTO product_docs (id, workspace_id, title, slug, content, status, category, created_by, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		RETURNING id, workspace_id, title, slug, content, status, category, created_by, created_at, updated_at
	`, id, req.WorkspaceID, req.Title, req.Slug, req.Content, string(req.Status), req.Category, req.CreatedBy, now, now).Scan(
		&doc.ID, &doc.WorkspaceID, &doc.Title, &doc.Slug,
		&content, &doc.Status, &category, &createdBy,
		&doc.CreatedAt, &doc.UpdatedAt,
	)
	if err != nil {
		return object.ProductDoc{}, fmt.Errorf("create product doc failed: %w", err)
	}
	if content.Valid {
		doc.Content = content.String
	}
	if category.Valid {
		doc.Category = category.String
	}
	if createdBy.Valid {
		doc.CreatedBy = createdBy.String
	}
	return doc, nil
}

// UpdateDoc 更新指定产品文档。
func (s *DBProductDocService) UpdateDoc(id string, req object.UpdateProductDocRequest) (object.ProductDoc, error) {
	now := time.Now().UTC()
	var setClauses []string
	var args []any
	argIdx := 1

	if req.Title != nil {
		setClauses = append(setClauses, fmt.Sprintf("title = $%d", argIdx))
		args = append(args, *req.Title)
		argIdx++
	}
	if req.Content != nil {
		setClauses = append(setClauses, fmt.Sprintf("content = $%d", argIdx))
		args = append(args, *req.Content)
		argIdx++
	}
	if req.Status != nil {
		setClauses = append(setClauses, fmt.Sprintf("status = $%d", argIdx))
		args = append(args, string(*req.Status))
		argIdx++
	}
	if req.Category != nil {
		setClauses = append(setClauses, fmt.Sprintf("category = $%d", argIdx))
		args = append(args, *req.Category)
		argIdx++
	}

	if len(setClauses) == 0 {
		return s.GetDoc(id)
	}

	setClauses = append(setClauses, fmt.Sprintf("updated_at = $%d", argIdx))
	args = append(args, now)
	argIdx++

	query := fmt.Sprintf("UPDATE product_docs SET %s WHERE id = $%d RETURNING id, workspace_id, title, slug, content, status, category, created_by, created_at, updated_at",
		strings.Join(setClauses, ", "), argIdx)
	args = append(args, id)

	var doc object.ProductDoc
	var content, category, createdBy sql.NullString
	err := s.db.QueryRow(query, args...).Scan(
		&doc.ID, &doc.WorkspaceID, &doc.Title, &doc.Slug,
		&content, &doc.Status, &category, &createdBy,
		&doc.CreatedAt, &doc.UpdatedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return object.ProductDoc{}, errors.New("product doc not found")
	}
	if err != nil {
		return object.ProductDoc{}, fmt.Errorf("update product doc failed: %w", err)
	}
	if content.Valid {
		doc.Content = content.String
	}
	if category.Valid {
		doc.Category = category.String
	}
	if createdBy.Valid {
		doc.CreatedBy = createdBy.String
	}
	return doc, nil
}

// DeleteDoc 删除指定产品文档及其版本历史。
func (s *DBProductDocService) DeleteDoc(id string) error {
	res, err := s.db.Exec("DELETE FROM product_docs WHERE id = $1", id)
	if err != nil {
		return fmt.Errorf("delete product doc failed: %w", err)
	}
	rows, _ := res.RowsAffected()
	if rows == 0 {
		return errors.New("product doc not found")
	}
	return nil
}

// ListVersions 返回指定文档的版本历史列表。
func (s *DBProductDocService) ListVersions(docID string) ([]object.ProductDocVersion, error) {
	rows, err := s.db.Query(`
		SELECT id, doc_id, version, title, content, change_summary, created_by, created_at
		FROM product_doc_versions
		WHERE doc_id = $1
		ORDER BY version DESC
	`, docID)
	if err != nil {
		return nil, fmt.Errorf("list product doc versions failed: %w", err)
	}
	defer rows.Close()

	result := make([]object.ProductDocVersion, 0)
	for rows.Next() {
		var v object.ProductDocVersion
		var content, title, changeSummary, createdBy sql.NullString
		err := rows.Scan(
			&v.ID, &v.DocID, &v.Version,
			&title, &content, &changeSummary, &createdBy,
			&v.CreatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("scan product doc version failed: %w", err)
		}
		if title.Valid {
			v.Title = title.String
		}
		if content.Valid {
			v.Content = content.String
		}
		if changeSummary.Valid {
			v.ChangeSummary = changeSummary.String
		}
		if createdBy.Valid {
			v.CreatedBy = createdBy.String
		}
		result = append(result, v)
	}
	return result, rows.Err()
}

// PublishVersion 发布新版本：把当前文档内容快照到版本历史表。
func (s *DBProductDocService) PublishVersion(docID string, req object.PublishProductDocRequest) (object.ProductDocVersion, error) {
	doc, err := s.GetDoc(docID)
	if err != nil {
		return object.ProductDocVersion{}, err
	}

	now := time.Now().UTC()
	id := uuid.New().String()

	var nextVersion int
	err = s.db.QueryRow("SELECT COALESCE(MAX(version), 0) + 1 FROM product_doc_versions WHERE doc_id = $1", docID).Scan(&nextVersion)
	if err != nil {
		return object.ProductDocVersion{}, fmt.Errorf("resolve next version failed: %w", err)
	}

	var v object.ProductDocVersion
	var content, title, changeSummary, createdBy sql.NullString
	err = s.db.QueryRow(`
		INSERT INTO product_doc_versions (id, doc_id, version, title, content, change_summary, created_by, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING id, doc_id, version, title, content, change_summary, created_by, created_at
	`, id, docID, nextVersion, doc.Title, doc.Content, req.ChangeSummary, req.CreatedBy, now).Scan(
		&v.ID, &v.DocID, &v.Version,
		&title, &content, &changeSummary, &createdBy,
		&v.CreatedAt,
	)
	if err != nil {
		return object.ProductDocVersion{}, fmt.Errorf("publish product doc version failed: %w", err)
	}
	if title.Valid {
		v.Title = title.String
	}
	if content.Valid {
		v.Content = content.String
	}
	if changeSummary.Valid {
		v.ChangeSummary = changeSummary.String
	}
	if createdBy.Valid {
		v.CreatedBy = createdBy.String
	}

	// 发布成功后把文档状态改为已发布
	_, err = s.db.Exec("UPDATE product_docs SET status = $1, updated_at = $2 WHERE id = $3", string(object.DocStatusPublished), now, docID)
	if err != nil {
		return v, fmt.Errorf("update doc status after publish failed: %w", err)
	}

	return v, nil
}
