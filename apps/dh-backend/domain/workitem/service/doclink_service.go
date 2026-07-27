package service

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/workitem/object"
	"github.com/google/uuid"
)

// 常量：关联条目类型
const (
	DocLinkTypeDoc       = "doc"
	DocLinkTypePrototype = "prototype"
)

// ListDocLinks 返回指定需求关联的全部产品空间条目（文档/原型）。
func (s *DBWorkItemService) ListDocLinks(workitemID string) ([]object.WorkItemDocLink, error) {
	rows, err := s.db.Query(`
		SELECT id, workitem_id, product_space_item_id, workspace_id, item_type, created_at
		FROM workitem_doc_links
		WHERE workitem_id = $1
		ORDER BY created_at ASC
	`, workitemID)
	if err != nil {
		return nil, fmt.Errorf("list doc links failed: %w", err)
	}
	defer rows.Close()

	result := make([]object.WorkItemDocLink, 0)
	for rows.Next() {
		var link object.WorkItemDocLink
		if err := rows.Scan(&link.ID, &link.WorkItemID, &link.ProductSpaceItemID, &link.WorkspaceID, &link.ItemType, &link.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan doc link failed: %w", err)
		}
		result = append(result, link)
	}
	return result, rows.Err()
}

// CreateDocLink 创建需求与产品空间条目的关联，幂等：已存在则返回现有记录。
func (s *DBWorkItemService) CreateDocLink(workitemID string, req object.CreateDocLinkRequest) (object.WorkItemDocLink, error) {
	if req.ProductSpaceItemID == "" || req.WorkspaceID == "" {
		return object.WorkItemDocLink{}, errors.New("productSpaceItemId and workspaceId are required")
	}
	if req.ItemType == "" {
		req.ItemType = DocLinkTypeDoc
	}

	var link object.WorkItemDocLink
	err := s.db.QueryRow(`
		INSERT INTO workitem_doc_links (id, workitem_id, product_space_item_id, workspace_id, item_type, created_at)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (workitem_id, product_space_item_id) DO UPDATE SET item_type = EXCLUDED.item_type
		RETURNING id, workitem_id, product_space_item_id, workspace_id, item_type, created_at
	`, uuid.New().String(), workitemID, req.ProductSpaceItemID, req.WorkspaceID, req.ItemType, time.Now().UTC()).Scan(
		&link.ID, &link.WorkItemID, &link.ProductSpaceItemID, &link.WorkspaceID, &link.ItemType, &link.CreatedAt,
	)
	if err != nil {
		return object.WorkItemDocLink{}, fmt.Errorf("create doc link failed: %w", err)
	}
	return link, nil
}

// DeleteDocLink 删除需求与产品空间条目之间的关联。
func (s *DBWorkItemService) DeleteDocLink(workitemID, productSpaceItemID string) error {
	result, err := s.db.Exec(`
		DELETE FROM workitem_doc_links
		WHERE workitem_id = $1 AND product_space_item_id = $2
	`, workitemID, productSpaceItemID)
	if err != nil {
		return fmt.Errorf("delete doc link failed: %w", err)
	}
	rows, _ := result.RowsAffected()
	if rows == 0 {
		return sql.ErrNoRows
	}
	return nil
}

// CreateDesignVersion 为指定需求创建一个产品设计版本。
// 会快照当前需求关联的所有文档和原型条目的当前版本号。
func (s *DBWorkItemService) CreateDesignVersion(workitemID, workspaceID, userID, changeSummary string) (object.DesignVersion, error) {
	if workitemID == "" || workspaceID == "" || userID == "" {
		return object.DesignVersion{}, errors.New("workitemId, workspaceId and userId are required")
	}

	tx, err := s.db.Begin()
	if err != nil {
		return object.DesignVersion{}, fmt.Errorf("begin transaction failed: %w", err)
	}
	defer tx.Rollback()

	var versionNumber int
	err = tx.QueryRow(`
		SELECT COALESCE(MAX(version_number), 0) + 1
		FROM workitem_design_versions
		WHERE workitem_id = $1
	`, workitemID).Scan(&versionNumber)
	if err != nil {
		return object.DesignVersion{}, fmt.Errorf("compute version number failed: %w", err)
	}

	id := uuid.NewString()
	createdAt := time.Now().UTC()
	if changeSummary == "" {
		changeSummary = "采纳原型"
	}

	_, err = tx.Exec(`
		INSERT INTO workitem_design_versions (id, workitem_id, workspace_id, user_id, version_number, change_summary, created_by, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
	`, id, workitemID, workspaceID, userID, versionNumber, changeSummary, userID, createdAt)
	if err != nil {
		return object.DesignVersion{}, fmt.Errorf("insert design version failed: %w", err)
	}

	links, err := s.listDocLinksTx(tx, workitemID)
	if err != nil {
		return object.DesignVersion{}, err
	}

	items := make([]object.DesignVersionItem, 0, len(links))
	for _, link := range links {
		var currentVersion int
		err := tx.QueryRow(`
			SELECT COALESCE(current_version, 1)
			FROM product_docs
			WHERE id = $1
		`, link.ProductSpaceItemID).Scan(&currentVersion)
		if err != nil {
			// 关联条目不存在时跳过，不影响版本创建。
			if errors.Is(err, sql.ErrNoRows) {
				continue
			}
			return object.DesignVersion{}, fmt.Errorf("query product doc version failed: %w", err)
		}

		itemID := uuid.NewString()
		_, err = tx.Exec(`
			INSERT INTO workitem_design_version_items (id, design_version_id, product_space_item_id, product_doc_version_id, item_type, created_at)
			VALUES ($1, $2, $3, $4, $5, $6)
		`, itemID, id, link.ProductSpaceItemID, currentVersion, link.ItemType, createdAt)
		if err != nil {
			return object.DesignVersion{}, fmt.Errorf("insert design version item failed: %w", err)
		}
		items = append(items, object.DesignVersionItem{
			ID:                  itemID,
			DesignVersionID:     id,
			ProductSpaceItemID:  link.ProductSpaceItemID,
			ProductDocVersionID: currentVersion,
			ItemType:            link.ItemType,
			CreatedAt:           createdAt,
		})
	}

	if err := tx.Commit(); err != nil {
		return object.DesignVersion{}, fmt.Errorf("commit transaction failed: %w", err)
	}

	return object.DesignVersion{
		ID:            id,
		WorkItemID:    workitemID,
		WorkspaceID:   workspaceID,
		UserID:        userID,
		VersionNumber: versionNumber,
		ChangeSummary: changeSummary,
		CreatedBy:     userID,
		CreatedAt:     createdAt,
		Items:         items,
	}, nil
}

// listDocLinksTx 在事务内查询需求关联的产品空间条目。
func (s *DBWorkItemService) listDocLinksTx(tx *sql.Tx, workitemID string) ([]object.WorkItemDocLink, error) {
	rows, err := tx.Query(`
		SELECT id, workitem_id, product_space_item_id, workspace_id, item_type, created_at
		FROM workitem_doc_links
		WHERE workitem_id = $1
		ORDER BY created_at ASC
	`, workitemID)
	if err != nil {
		return nil, fmt.Errorf("list doc links failed: %w", err)
	}
	defer rows.Close()

	result := make([]object.WorkItemDocLink, 0)
	for rows.Next() {
		var link object.WorkItemDocLink
		if err := rows.Scan(&link.ID, &link.WorkItemID, &link.ProductSpaceItemID, &link.WorkspaceID, &link.ItemType, &link.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan doc link failed: %w", err)
		}
		result = append(result, link)
	}
	return result, rows.Err()
}

// ListDesignVersions 查询指定需求的所有产品设计版本，按版本号倒序排列。
func (s *DBWorkItemService) ListDesignVersions(workitemID string) ([]object.DesignVersion, error) {
	if workitemID == "" {
		return nil, errors.New("workitemId is required")
	}

	rows, err := s.db.Query(`
		SELECT id, workitem_id, workspace_id, user_id, version_number, change_summary, created_by, created_at
		FROM workitem_design_versions
		WHERE workitem_id = $1
		ORDER BY version_number DESC
	`, workitemID)
	if err != nil {
		return nil, fmt.Errorf("list design versions failed: %w", err)
	}
	defer rows.Close()

	versions := make([]object.DesignVersion, 0)
	versionIDs := make([]string, 0)
	for rows.Next() {
		var v object.DesignVersion
		if err := rows.Scan(&v.ID, &v.WorkItemID, &v.WorkspaceID, &v.UserID, &v.VersionNumber, &v.ChangeSummary, &v.CreatedBy, &v.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan design version failed: %w", err)
		}
		versions = append(versions, v)
		versionIDs = append(versionIDs, v.ID)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate design versions failed: %w", err)
	}
	if len(versionIDs) == 0 {
		return versions, nil
	}

	itemsMap, err := s.listDesignVersionItems(versionIDs)
	if err != nil {
		return nil, err
	}
	for i := range versions {
		versions[i].Items = itemsMap[versions[i].ID]
	}
	return versions, nil
}

// listDesignVersionItems 批量查询多个设计版本包含的条目。
func (s *DBWorkItemService) listDesignVersionItems(versionIDs []string) (map[string][]object.DesignVersionItem, error) {
	placeholders := make([]string, len(versionIDs))
	args := make([]any, len(versionIDs))
	for i, id := range versionIDs {
		placeholders[i] = fmt.Sprintf("$%d", i+1)
		args[i] = id
	}
	query := fmt.Sprintf(`
		SELECT id, design_version_id, product_space_item_id, product_doc_version_id, item_type, created_at
		FROM workitem_design_version_items
		WHERE design_version_id IN (%s)
		ORDER BY created_at ASC
	`, strings.Join(placeholders, ","))

	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("list design version items failed: %w", err)
	}
	defer rows.Close()

	result := make(map[string][]object.DesignVersionItem)
	for rows.Next() {
		var item object.DesignVersionItem
		if err := rows.Scan(&item.ID, &item.DesignVersionID, &item.ProductSpaceItemID, &item.ProductDocVersionID, &item.ItemType, &item.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan design version item failed: %w", err)
		}
		result[item.DesignVersionID] = append(result[item.DesignVersionID], item)
	}
	return result, rows.Err()
}
