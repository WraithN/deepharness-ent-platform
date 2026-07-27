package service

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/workitem/object"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/workitem"
	"github.com/google/uuid"
)

// DBWorkItemService 是基于 PostgreSQL 的 WorkItemService 实现。
type DBWorkItemService struct {
	db *sql.DB
}

// NewDBWorkItemService 创建 PostgreSQL 实现的工作项服务。
func NewDBWorkItemService(db *sql.DB) *DBWorkItemService {
	return &DBWorkItemService{db: db}
}

// ListWorkItems 返回满足过滤条件的工作项列表。
func (s *DBWorkItemService) ListWorkItems(filter WorkItemFilter) ([]object.WorkItem, error) {
	var conditions []string
	var args []any
	argIdx := 1

	if filter.ProjectID != "" {
		conditions = append(conditions, fmt.Sprintf("project_id = $%d", argIdx))
		args = append(args, filter.ProjectID)
		argIdx++
	}
	if filter.Type != "" {
		conditions = append(conditions, fmt.Sprintf("\"type\" = $%d", argIdx))
		args = append(args, string(filter.Type))
		argIdx++
	}
	if filter.Status != "" {
		conditions = append(conditions, fmt.Sprintf("status = $%d", argIdx))
		args = append(args, string(filter.Status))
		argIdx++
	}
	if filter.AssigneeID != "" {
		conditions = append(conditions, fmt.Sprintf("assignee_id = $%d", argIdx))
		args = append(args, filter.AssigneeID)
		argIdx++
	}

	query := `SELECT w.id, w.tenant_id, w.project_id, w."type", w.title, w.description, w.status, w.priority,
		w.assignee_id, COALESCE(u.name, ''), w.reporter, w.source, w.external_id, w.created_at, w.updated_at
		FROM workitems w
		LEFT JOIN users u ON u.id = w.assignee_id`
	if len(conditions) > 0 {
		query += " WHERE " + strings.Join(conditions, " AND ")
	}
	query += " ORDER BY created_at DESC"

	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("list workitems failed: %w", err)
	}
	defer rows.Close()

	result := make([]object.WorkItem, 0)
	for rows.Next() {
		var it object.WorkItem
		var desc, assigneeID, assigneeName, reporter, externalID sql.NullString
		err := rows.Scan(
			&it.ID, &it.TenantID, &it.ProjectID,
			&it.Type, &it.Title, &desc, &it.Status, &it.Priority,
			&assigneeID, &assigneeName, &reporter, &it.Source, &externalID,
			&it.CreatedAt, &it.UpdatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("scan workitem failed: %w", err)
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
		result = append(result, it)
	}
	return result, rows.Err()
}

// GetWorkItem 按 ID 获取单个工作项详情。
func (s *DBWorkItemService) GetWorkItem(id string) (object.WorkItem, error) {
	var it object.WorkItem
	var desc, assigneeID, assigneeName, reporter, externalID sql.NullString
	err := s.db.QueryRow(`
		SELECT w.id, w.tenant_id, w.project_id, w."type", w.title, w.description, w.status, w.priority,
			w.assignee_id, COALESCE(u.name, ''), w.reporter, w.source, w.external_id, w.created_at, w.updated_at
		FROM workitems w
		LEFT JOIN users u ON u.id = w.assignee_id
		WHERE w.id = $1
	`, id).Scan(
		&it.ID, &it.TenantID, &it.ProjectID,
		&it.Type, &it.Title, &desc, &it.Status, &it.Priority,
		&assigneeID, &assigneeName, &reporter, &it.Source, &externalID,
		&it.CreatedAt, &it.UpdatedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return object.WorkItem{}, errors.New("workitem not found")
	}
	if err != nil {
		return object.WorkItem{}, fmt.Errorf("get workitem failed: %w", err)
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
	var it object.WorkItem
	var desc, assigneeID, reporter, externalID sql.NullString

	err := s.db.QueryRow(`
		INSERT INTO workitems (id, tenant_id, project_id, "type", title, description, status, priority,
			assignee_id, reporter, source, external_id, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
		RETURNING id, tenant_id, project_id, "type", title, description, status, priority,
			assignee_id, reporter, source, external_id, created_at, updated_at
	`, id, req.TenantID, req.ProjectID, string(req.Type), req.Title, req.Description,
		string(req.Status), string(req.Priority), req.AssigneeID, req.Reporter,
		string(req.Source), "", req.CreatedAt, req.UpdatedAt,
	).Scan(
		&it.ID, &it.TenantID, &it.ProjectID,
		&it.Type, &it.Title, &desc, &it.Status, &it.Priority,
		&assigneeID, &reporter, &it.Source, &externalID,
		&it.CreatedAt, &it.UpdatedAt,
	)
	if err != nil {
		return object.WorkItem{}, fmt.Errorf("create workitem failed: %w", err)
	}
	if desc.Valid {
		it.Description = desc.String
	}
	if assigneeID.Valid {
		it.AssigneeID = assigneeID.String
	}
	if reporter.Valid {
		it.Reporter = reporter.String
	}
	if externalID.Valid {
		it.ExternalID = externalID.String
	}
	return it, nil
}

// UpdateWorkItemStatus 更新指定工作项的状态。
func (s *DBWorkItemService) UpdateWorkItemStatus(id string, status workitem.Status) (object.WorkItem, error) {
	now := time.Now().UTC()
	var it object.WorkItem
	var desc, assigneeID, assigneeName, reporter, externalID sql.NullString
	err := s.db.QueryRow(`
		UPDATE workitems SET status = $1, updated_at = $2 WHERE id = $3
		RETURNING id, tenant_id, project_id, "type", title, description, status, priority,
			assignee_id, reporter, source, external_id, created_at, updated_at
	`, string(status), now, id).Scan(
		&it.ID, &it.TenantID, &it.ProjectID,
		&it.Type, &it.Title, &desc, &it.Status, &it.Priority,
		&assigneeID, &reporter, &it.Source, &externalID,
		&it.CreatedAt, &it.UpdatedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return object.WorkItem{}, errors.New("workitem not found")
	}
	if err != nil {
		return object.WorkItem{}, fmt.Errorf("update workitem status failed: %w", err)
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
	return it, nil
}

// UpdateWorkItemAssignee 更新指定工作项的受理人，并自动关联用户姓名。
// assigneeID 为空字符串时表示清空受理人。
func (s *DBWorkItemService) UpdateWorkItemAssignee(id string, assigneeID string) (object.WorkItem, error) {
	now := time.Now().UTC()
	var it object.WorkItem
	var desc, newAssigneeID, assigneeName, reporter, externalID sql.NullString
	err := s.db.QueryRow(`
		UPDATE workitems SET assignee_id = $1, updated_at = $2 WHERE id = $3
		RETURNING id, tenant_id, project_id, "type", title, description, status, priority,
			assignee_id, reporter, source, external_id, created_at, updated_at
	`, sql.NullString{String: assigneeID, Valid: assigneeID != ""}, now, id).Scan(
		&it.ID, &it.TenantID, &it.ProjectID,
		&it.Type, &it.Title, &desc, &it.Status, &it.Priority,
		&newAssigneeID, &reporter, &it.Source, &externalID,
		&it.CreatedAt, &it.UpdatedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return object.WorkItem{}, errors.New("workitem not found")
	}
	if err != nil {
		return object.WorkItem{}, fmt.Errorf("update workitem assignee failed: %w", err)
	}
	if desc.Valid {
		it.Description = desc.String
	}
	if newAssigneeID.Valid {
		it.AssigneeID = newAssigneeID.String
	}
	if it.AssigneeID != "" {
		_ = s.db.QueryRow(`SELECT COALESCE(name, '') FROM users WHERE id = $1`, it.AssigneeID).Scan(&assigneeName)
		if assigneeName.Valid {
			it.AssigneeName = assigneeName.String
		}
	}
	if reporter.Valid {
		it.Reporter = reporter.String
	}
	if externalID.Valid {
		it.ExternalID = externalID.String
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
