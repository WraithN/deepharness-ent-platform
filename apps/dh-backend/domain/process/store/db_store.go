package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/process/object"
)

// DBProcessStore PostgreSQL 实现
type DBProcessStore struct {
	db *sql.DB
}

// NewDBProcessStore 创建 DB 流程存储
func NewDBProcessStore(db *sql.DB) *DBProcessStore {
	return &DBProcessStore{db: db}
}

// processColumns 统一的 SELECT 列列表
const processColumns = `id, workspace_id, workitem_id, title, type, stages, created_at, updated_at`

// scanProcess 扫描单行流程数据
func scanProcess(scanner interface{ Scan(dest ...any) error }, p *object.Process) error {
	var stagesJSON string
	err := scanner.Scan(&p.ID, &p.WorkspaceID, &p.WorkitemID, &p.Title, &p.Type, &stagesJSON, &p.CreatedAt, &p.UpdatedAt)
	if err != nil {
		return err
	}
	if stagesJSON != "" && stagesJSON != "null" {
		if err := json.Unmarshal([]byte(stagesJSON), &p.Stages); err != nil {
			return fmt.Errorf("unmarshal stages: %w", err)
		}
	}
	return nil
}

// Create 创建流程
func (s *DBProcessStore) Create(ctx context.Context, p object.Process) error {
	stagesJSON, _ := json.Marshal(p.Stages)
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO processes (id, workspace_id, workitem_id, title, type, stages, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
	`, p.ID, p.WorkspaceID, p.WorkitemID, p.Title, p.Type, string(stagesJSON), p.CreatedAt, p.UpdatedAt)
	if err != nil {
		return fmt.Errorf("create process: %w", err)
	}
	return nil
}

// GetByID 按 ID 查询流程
func (s *DBProcessStore) GetByID(ctx context.Context, id string) (object.Process, error) {
	var p object.Process
	err := s.db.QueryRowContext(ctx,
		fmt.Sprintf(`SELECT %s FROM processes WHERE id = $1`, processColumns), id,
	).Scan(&p.ID, &p.WorkspaceID, &p.WorkitemID, &p.Title, &p.Type, &sql.NullString{}, &p.CreatedAt, &p.UpdatedAt)
	if err != nil {
		return object.Process{}, fmt.Errorf("process not found: %s", id)
	}
	// 重新查询以正确解析 stages JSON
	row := s.db.QueryRowContext(ctx,
		fmt.Sprintf(`SELECT %s FROM processes WHERE id = $1`, processColumns), id)
	if err := scanProcess(row, &p); err != nil {
		return object.Process{}, fmt.Errorf("get process rescan: %w", err)
	}
	return p, nil
}

// ListByWorkspace 按工作空间查询流程（按创建时间倒序）
func (s *DBProcessStore) ListByWorkspace(ctx context.Context, workspaceID string) ([]object.Process, error) {
	rows, err := s.db.QueryContext(ctx,
		fmt.Sprintf(`SELECT %s FROM processes WHERE workspace_id = $1 ORDER BY created_at DESC`, processColumns),
		workspaceID,
	)
	if err != nil {
		return nil, fmt.Errorf("list processes: %w", err)
	}
	defer rows.Close()

	var list []object.Process
	for rows.Next() {
		var p object.Process
		if err := scanProcess(rows, &p); err != nil {
			continue
		}
		list = append(list, p)
	}
	return list, nil
}

// Update 更新流程
func (s *DBProcessStore) Update(ctx context.Context, id string, p object.Process) error {
	stagesJSON, _ := json.Marshal(p.Stages)
	_, err := s.db.ExecContext(ctx, `
		UPDATE processes SET workspace_id = $2, workitem_id = $3, title = $4, type = $5, stages = $6, updated_at = $7
		WHERE id = $1
	`, id, p.WorkspaceID, p.WorkitemID, p.Title, p.Type, string(stagesJSON), p.UpdatedAt)
	if err != nil {
		return fmt.Errorf("update process: %w", err)
	}
	return nil
}
