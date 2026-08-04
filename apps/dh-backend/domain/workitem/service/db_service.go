package service

import (
	"database/sql"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/workitem/object"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/workitem"
	"github.com/google/uuid"

	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/common"
)

// DBWorkItemService 是基于 PostgreSQL 的 WorkItemService 实现。
type DBWorkItemService struct {
	db *sql.DB
}

// NewDBWorkItemService 创建 PostgreSQL 实现的工作项服务。
func NewDBWorkItemService(db *sql.DB) *DBWorkItemService {
	return &DBWorkItemService{db: db}
}

// workItemSelectColumns 是 workitems 表的统一 SELECT 列列表（含 LEFT JOIN users 取受理人姓名）。
const workItemSelectColumns = `w.id, w.tenant_id, w.project_id, w.workspace_id, w."type", w.title, w.description, w.status, w.priority,
		w.assignee_id, COALESCE(u.name, ''), w.reporter, w.source, w.external_id, w.parent_id, w.created_at, w.updated_at`

// scanWorkItem 将一行扫描到 WorkItem 对象中，统一处理 NULL 字段。
func scanWorkItem(scanner interface{ Scan(dest ...any) error }, it *object.WorkItem) error {
	var desc, assigneeID, assigneeName, reporter, externalID, parentID sql.NullString
	err := scanner.Scan(
		&it.ID, &it.TenantID, &it.ProjectID, &it.WorkspaceID,
		&it.Type, &it.Title, &desc, &it.Status, &it.Priority,
		&assigneeID, &assigneeName, &reporter, &it.Source, &externalID, &parentID,
		&it.CreatedAt, &it.UpdatedAt,
	)
	if err != nil {
		return err
	}
	if desc.Valid {
		it.Description = desc.String
	}
	if assigneeID.Valid {
		it.AssigneeID = assigneeID.String
	}
	if assigneeName.Valid {
		it.AssigneeName = assigneeName.String
	}
	if reporter.Valid {
		it.Reporter = reporter.String
	}
	if externalID.Valid {
		it.ExternalID = externalID.String
	}
	if parentID.Valid {
		it.ParentID = parentID.String
	}
	return nil
}

// ListWorkItems 返回满足过滤条件的工作项列表。
func (s *DBWorkItemService) ListWorkItems(filter WorkItemFilter) ([]object.WorkItem, error) {
	var conditions []string
	var args []any
	argIdx := 1

	if filter.WorkspaceID != "" {
		conditions = append(conditions, fmt.Sprintf("w.workspace_id = $%d", argIdx))
		args = append(args, filter.WorkspaceID)
		argIdx++
	}
	if filter.TenantID != "" {
		conditions = append(conditions, fmt.Sprintf("w.tenant_id = $%d", argIdx))
		args = append(args, filter.TenantID)
		argIdx++
	}
	if filter.ProjectID != "" {
		conditions = append(conditions, fmt.Sprintf("w.project_id = $%d", argIdx))
		args = append(args, filter.ProjectID)
		argIdx++
	}
	if filter.Type != "" {
		conditions = append(conditions, fmt.Sprintf("w.\"type\" = $%d", argIdx))
		args = append(args, string(filter.Type))
		argIdx++
	}
	if filter.Status != "" {
		conditions = append(conditions, fmt.Sprintf("w.status = $%d", argIdx))
		args = append(args, string(filter.Status))
		argIdx++
	}
	if filter.AssigneeID != "" {
		conditions = append(conditions, fmt.Sprintf("w.assignee_id = $%d", argIdx))
		args = append(args, filter.AssigneeID)
		argIdx++
	}

	query := fmt.Sprintf(`SELECT %s FROM workitems w LEFT JOIN users u ON u.id = w.assignee_id`, workItemSelectColumns)
	if len(conditions) > 0 {
		query += " WHERE " + strings.Join(conditions, " AND ")
	}
	query += " ORDER BY w.created_at DESC"

	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("list workitems failed: %w", err)
	}
	defer rows.Close()

	result := make([]object.WorkItem, 0)
	for rows.Next() {
		var it object.WorkItem
		if err := scanWorkItem(rows, &it); err != nil {
			return nil, fmt.Errorf("scan workitem failed: %w", err)
		}
		result = append(result, it)
	}
	return result, rows.Err()
}

// GetWorkItem 按 ID 获取单个工作项详情。
func (s *DBWorkItemService) GetWorkItem(id string) (object.WorkItem, error) {
	var it object.WorkItem
	row := s.db.QueryRow(fmt.Sprintf(`
		SELECT %s FROM workitems w LEFT JOIN users u ON u.id = w.assignee_id WHERE w.id = $1
	`, workItemSelectColumns), id)
	if err := scanWorkItem(row, &it); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return object.WorkItem{}, common.NotFoundErrorf("workitem not found")
		}
		return object.WorkItem{}, fmt.Errorf("get workitem failed: %w", err)
	}
	return it, nil
}

// CreateWorkItem 创建新的工作项并返回创建后的记录。
func (s *DBWorkItemService) CreateWorkItem(req object.CreateWorkItemRequest) (object.WorkItem, error) {
	now := time.Now().UTC()
	if req.CreatedAt.IsZero() {
		req.CreatedAt = now
	}
	if req.UpdatedAt.IsZero() {
		req.UpdatedAt = now
	}
	if req.Type == "" {
		req.Type = workitem.TypeRequirement
	}
	if req.Priority == "" {
		req.Priority = workitem.PriorityMedium
	}
	if req.Source == "" {
		req.Source = workitem.SourceInternal
	}
	if req.Status == "" {
		req.Status = workitem.StatusBacklog
	}

	id := uuid.New().String()
	_, err := s.db.Exec(`
		INSERT INTO workitems (id, tenant_id, project_id, workspace_id, "type", title, description, status, priority,
			assignee_id, reporter, source, external_id, parent_id, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
	`, id, req.TenantID, req.ProjectID, req.WorkspaceID, string(req.Type), req.Title, req.Description,
		string(req.Status), string(req.Priority), req.AssigneeID, req.Reporter,
		string(req.Source), "", sql.NullString{String: req.ParentID, Valid: req.ParentID != ""}, req.CreatedAt, req.UpdatedAt,
	)
	if err != nil {
		return object.WorkItem{}, fmt.Errorf("create workitem failed: %w", err)
	}

	// 重新查询以获取完整的 JOIN 字段（assignee_name 等）
	return s.reloadWorkItem(id)
}

// UpdateWorkItemStatus 更新指定工作项的状态。
func (s *DBWorkItemService) UpdateWorkItemStatus(id string, status workitem.Status) (object.WorkItem, error) {
	now := time.Now().UTC()
	_, err := s.db.Exec(`UPDATE workitems SET status = $1, updated_at = $2 WHERE id = $3`, string(status), now, id)
	if err != nil {
		return object.WorkItem{}, fmt.Errorf("update workitem status failed: %w", err)
	}
	return s.reloadWorkItem(id)
}

// UpdateWorkItemAssignee 更新指定工作项的受理人，并自动关联用户姓名。
// assigneeID 为空字符串时表示清空受理人。
func (s *DBWorkItemService) UpdateWorkItemAssignee(id string, assigneeID string) (object.WorkItem, error) {
	now := time.Now().UTC()
	_, err := s.db.Exec(`UPDATE workitems SET assignee_id = $1, updated_at = $2 WHERE id = $3`,
		sql.NullString{String: assigneeID, Valid: assigneeID != ""}, now, id)
	if err != nil {
		return object.WorkItem{}, fmt.Errorf("update workitem assignee failed: %w", err)
	}
	return s.reloadWorkItem(id)
}

// ValidateAssigneeTenant 校验待指派用户是否属于指定租户。
func (s *DBWorkItemService) ValidateAssigneeTenant(assigneeID string, tenantID string) error {
	if assigneeID == "" || tenantID == "" {
		return errors.New("assigneeId or tenantId is empty")
	}
	var userTenantID string
	err := s.db.QueryRow(`SELECT tenant_id FROM users WHERE id = $1`, assigneeID).Scan(&userTenantID)
	if errors.Is(err, sql.ErrNoRows) {
		return common.NotFoundErrorf("assignee user not found")
	}
	if err != nil {
		return fmt.Errorf("validate assignee tenant failed: %w", err)
	}
	if userTenantID != tenantID {
		return errors.New("assignee does not belong to the same tenant")
	}
	return nil
}

// reloadWorkItem 重新查询工作项详情（含 JOIN 字段），用于 UPDATE 后返回完整对象。
func (s *DBWorkItemService) reloadWorkItem(id string) (object.WorkItem, error) {
	var it object.WorkItem
	row := s.db.QueryRow(fmt.Sprintf(`
		SELECT %s FROM workitems w LEFT JOIN users u ON u.id = w.assignee_id WHERE w.id = $1
	`, workItemSelectColumns), id)
	if err := scanWorkItem(row, &it); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return object.WorkItem{}, common.NotFoundErrorf("workitem not found")
		}
		return object.WorkItem{}, fmt.Errorf("reload workitem failed: %w", err)
	}
	return it, nil
}

// CountWorkItems 统计指定项目在最近 days 天内更新的工作项数量。
func (s *DBWorkItemService) CountWorkItems(projectID string, status workitem.Status, days int) (int, error) {
	var count int
	err := s.db.QueryRow(`
		SELECT COUNT(*) FROM workitems
		WHERE project_id = $1 AND "type" = 'requirement' AND status = $2 AND updated_at >= NOW() - INTERVAL '1 day' * $3
	`, projectID, string(status), days).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("count workitems failed: %w", err)
	}
	return count, nil
}

// CountWorkItemsPrevPeriod 统计上一个同等周期的工作项数量。
func (s *DBWorkItemService) CountWorkItemsPrevPeriod(projectID string, status workitem.Status, days int) (int, error) {
	var count int
	err := s.db.QueryRow(`
		SELECT COUNT(*) FROM workitems
		WHERE project_id = $1 AND "type" = 'requirement' AND status = $2
		AND updated_at >= NOW() - INTERVAL '1 day' * ($3 * 2) AND updated_at < NOW() - INTERVAL '1 day' * $4
	`, projectID, string(status), days, days).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("count workitems prev period failed: %w", err)
	}
	return count, nil
}

// ListRequirementsWithDesignItems 按工作空间查询包含文档或原型关联的需求列表。
// 每个需求聚合其最新的一篇文档与最新的一个原型（按 product_docs.updated_at 倒序取第一条），
// 结果按需求 updated_at 倒序排列，供智能会话「设计」菜单按需求名分组展示。
func (s *DBWorkItemService) ListRequirementsWithDesignItems(workspaceID string) ([]object.RequirementWithDesignItems, error) {
	rows, err := s.db.Query(`
		SELECT
			w.id AS workitem_id,
			w.title AS workitem_title,
			w.status AS workitem_status,
			w.updated_at AS workitem_updated_at,
			d.id AS item_id,
			d.type AS item_type,
			d.title AS item_title,
			d.relative_path,
			d.status AS item_status,
			d.current_version,
			d.updated_at AS item_updated_at
		FROM workitems w
		JOIN workitem_doc_links l ON l.workitem_id = w.id
		JOIN product_docs d ON d.id = l.product_space_item_id
		WHERE w.workspace_id = $1 AND w."type" = 'requirement'
		ORDER BY w.updated_at DESC, d.type, d.updated_at DESC
	`, workspaceID)
	if err != nil {
		return nil, fmt.Errorf("list requirements with design items failed: %w", err)
	}
	defer rows.Close()

	grouped := make(map[string]*object.RequirementWithDesignItems)
	for rows.Next() {
		var wiID, wiTitle, wiStatus string
		var wiUpdatedAt time.Time
		var item object.LinkedProductSpaceItem
		var itemUpdatedAt time.Time
		if err := rows.Scan(
			&wiID, &wiTitle, &wiStatus, &wiUpdatedAt,
			&item.ID, &item.Type, &item.Title, &item.RelativePath,
			&item.Status, &item.CurrentVersion, &itemUpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan requirement design item failed: %w", err)
		}
		item.UpdatedAt = itemUpdatedAt

		req, ok := grouped[wiID]
		if !ok {
			req = &object.RequirementWithDesignItems{
				WorkitemID:    wiID,
				WorkitemTitle: wiTitle,
				Status:        wiStatus,
				UpdatedAt:     wiUpdatedAt,
			}
			grouped[wiID] = req
		}

		// 每个需求只保留最新的一篇文档和最新的一个原型。
		switch item.Type {
		case "doc":
			if req.Doc == nil || item.UpdatedAt.After(req.Doc.UpdatedAt) {
				req.Doc = &item
			}
		case "prototype":
			if req.Prototype == nil || item.UpdatedAt.After(req.Prototype.UpdatedAt) {
				req.Prototype = &item
			}
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate requirement design items failed: %w", err)
	}

	result := make([]object.RequirementWithDesignItems, 0, len(grouped))
	for _, req := range grouped {
		result = append(result, *req)
	}

	// 按需求更新时间倒序，与 SQL 排序保持一致。
	sort.Slice(result, func(i, j int) bool {
		return result[i].UpdatedAt.After(result[j].UpdatedAt)
	})
	return result, nil
}
