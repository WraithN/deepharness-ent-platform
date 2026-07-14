package service

import (
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/productdoc/object"
	"github.com/google/uuid"
)

const (
	// MaxFolderDepth 目录最多支持的层级数。
	MaxFolderDepth = 6
	// DefaultFolderName 默认目录名称，未归类文档归属该目录。
	DefaultFolderName = "未分类"
)

// folderSelectCols 目录查询的统一列（含 is_default）。
const folderSelectCols = "id, workspace_id, COALESCE(parent_id, ''), name, pinned, is_default, sort_order, created_at, updated_at"

// ListFolders 返回工作空间下的全部目录，按置顶优先、排序值、名称升序排列。
// 返回前确保默认"未分类"目录存在（每个工作空间有且仅有一个）。
func (s *DBProductDocService) ListFolders(workspaceID string) ([]object.ProductDocFolder, error) {
	if err := s.ensureDefaultFolder(workspaceID); err != nil {
		return nil, err
	}

	rows, err := s.db.Query(fmt.Sprintf(`
		SELECT %s
		FROM product_doc_folders
		WHERE workspace_id = $1
		ORDER BY is_default DESC, pinned DESC, sort_order ASC, name ASC
	`, folderSelectCols), workspaceID)
	if err != nil {
		return nil, fmt.Errorf("list product doc folders failed: %w", err)
	}
	defer rows.Close()

	result := make([]object.ProductDocFolder, 0)
	for rows.Next() {
		var f object.ProductDocFolder
		if err := rows.Scan(&f.ID, &f.WorkspaceID, &f.ParentID, &f.Name, &f.Pinned, &f.IsDefault, &f.SortOrder, &f.CreatedAt, &f.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan product doc folder failed: %w", err)
		}
		result = append(result, f)
	}
	return result, rows.Err()
}

// ensureDefaultFolder 懒创建默认"未分类"目录；已存在时无操作。
func (s *DBProductDocService) ensureDefaultFolder(workspaceID string) error {
	now := time.Now().UTC()
	_, err := s.db.Exec(`
		INSERT INTO product_doc_folders (id, workspace_id, name, is_default, sort_order, created_at, updated_at)
		SELECT $1, $2::varchar, $3, TRUE,
		       COALESCE((SELECT MAX(sort_order) + 1 FROM product_doc_folders WHERE workspace_id = $2::varchar), 0),
		       $4, $5
		WHERE NOT EXISTS (
			SELECT 1 FROM product_doc_folders WHERE workspace_id = $2::varchar AND is_default
		)
	`, uuid.New().String(), workspaceID, DefaultFolderName, now, now)
	if err != nil {
		return fmt.Errorf("ensure default folder failed: %w", err)
	}
	return nil
}

// CreateFolder 创建目录。指定 ParentID 时创建子目录，目录层级最多 MaxFolderDepth 层。
func (s *DBProductDocService) CreateFolder(req object.CreateFolderRequest) (object.ProductDocFolder, error) {
	if req.Name == "" {
		return object.ProductDocFolder{}, errors.New("folder name is required")
	}
	if req.ParentID != "" {
		if err := s.ensureParentDepthAllowed(req.WorkspaceID, req.ParentID); err != nil {
			return object.ProductDocFolder{}, err
		}
	}

	now := time.Now().UTC()
	id := uuid.New().String()

	// 新目录排在同级的末尾
	var nextOrder int
	err := s.db.QueryRow(
		"SELECT COALESCE(MAX(sort_order), -1) + 1 FROM product_doc_folders WHERE workspace_id = $1 AND COALESCE(parent_id, '') = $2",
		req.WorkspaceID, req.ParentID,
	).Scan(&nextOrder)
	if err != nil {
		return object.ProductDocFolder{}, fmt.Errorf("resolve folder sort order failed: %w", err)
	}

	var f object.ProductDocFolder
	err = s.db.QueryRow(fmt.Sprintf(`
		INSERT INTO product_doc_folders (id, workspace_id, parent_id, name, sort_order, created_at, updated_at)
		VALUES ($1, $2, NULLIF($3, ''), $4, $5, $6, $7)
		RETURNING %s
	`, folderSelectCols), id, req.WorkspaceID, req.ParentID, req.Name, nextOrder, now, now).Scan(
		&f.ID, &f.WorkspaceID, &f.ParentID, &f.Name, &f.Pinned, &f.IsDefault, &f.SortOrder, &f.CreatedAt, &f.UpdatedAt,
	)
	if err != nil {
		return object.ProductDocFolder{}, fmt.Errorf("create product doc folder failed: %w", err)
	}
	return f, nil
}

// ensureParentDepthAllowed 校验父目录存在且其层级小于 MaxFolderDepth（在其下创建子目录后不超过最大层数）。
func (s *DBProductDocService) ensureParentDepthAllowed(workspaceID, parentID string) error {
	// 递归向上计算父目录所处层级（根目录为第 1 层）
	var depth int
	err := s.db.QueryRow(`
		WITH RECURSIVE ancestors AS (
			SELECT id, parent_id, 1 AS lvl FROM product_doc_folders WHERE id = $1 AND workspace_id = $2
			UNION ALL
			SELECT f.id, f.parent_id, a.lvl + 1
			FROM product_doc_folders f
			JOIN ancestors a ON f.id = a.parent_id
		)
		SELECT MAX(lvl) FROM ancestors
	`, parentID, workspaceID).Scan(&depth)
	if err != nil || depth == 0 {
		return errors.New("parent folder not found")
	}
	if depth >= MaxFolderDepth {
		return fmt.Errorf("最多支持 %d 层目录", MaxFolderDepth)
	}
	// 默认“未分类”目录仅收纳未归类文档，不可在其下创建子目录
	var isDefault bool
	if err := s.db.QueryRow(
		`SELECT is_default FROM product_doc_folders WHERE id = $1 AND workspace_id = $2`,
		parentID, workspaceID,
	).Scan(&isDefault); err != nil {
		return errors.New("parent folder not found")
	}
	if isDefault {
		return errors.New("默认目录不可创建子目录")
	}
	return nil
}

// UpdateFolder 更新目录（重命名 / 置顶切换）。默认“未分类”目录始终置顶，不可改名或取消置顶。
func (s *DBProductDocService) UpdateFolder(id string, req object.UpdateFolderRequest) (object.ProductDocFolder, error) {
	folder, err := s.getFolder(id)
	if err != nil {
		return object.ProductDocFolder{}, err
	}
	if folder.IsDefault {
		return object.ProductDocFolder{}, errors.New("默认目录不可改名或取消置顶")
	}
	if req.Name == nil && req.Pinned == nil {
		return folder, nil
	}

	now := time.Now().UTC()
	var f object.ProductDocFolder
	err = s.db.QueryRow(fmt.Sprintf(`
		UPDATE product_doc_folders
		SET name = COALESCE($1, name),
		    pinned = COALESCE($2, pinned),
		    updated_at = $3
		WHERE id = $4
		RETURNING %s
	`, folderSelectCols), req.Name, req.Pinned, now, id).Scan(
		&f.ID, &f.WorkspaceID, &f.ParentID, &f.Name, &f.Pinned, &f.IsDefault, &f.SortOrder, &f.CreatedAt, &f.UpdatedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return object.ProductDocFolder{}, errors.New("folder not found")
	}
	if err != nil {
		return object.ProductDocFolder{}, fmt.Errorf("update product doc folder failed: %w", err)
	}
	return f, nil
}

// getFolder 按 ID 获取目录。
func (s *DBProductDocService) getFolder(id string) (object.ProductDocFolder, error) {
	var f object.ProductDocFolder
	err := s.db.QueryRow(fmt.Sprintf(`
		SELECT %s
		FROM product_doc_folders WHERE id = $1
	`, folderSelectCols), id).Scan(&f.ID, &f.WorkspaceID, &f.ParentID, &f.Name, &f.Pinned, &f.IsDefault, &f.SortOrder, &f.CreatedAt, &f.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return object.ProductDocFolder{}, errors.New("folder not found")
	}
	if err != nil {
		return object.ProductDocFolder{}, fmt.Errorf("get product doc folder failed: %w", err)
	}
	return f, nil
}

// DeleteFolder 删除目录。默认"未分类"目录不可删除；
// 其下子目录级联删除，目录内文档因外键 ON DELETE SET NULL 回到未分类。
func (s *DBProductDocService) DeleteFolder(id string) error {
	res, err := s.db.Exec("DELETE FROM product_doc_folders WHERE id = $1 AND NOT is_default", id)
	if err != nil {
		return fmt.Errorf("delete product doc folder failed: %w", err)
	}
	rows, _ := res.RowsAffected()
	if rows == 0 {
		return errors.New("默认目录不可删除或目录不存在")
	}
	return nil
}
