package service

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/pkg/idutil"
)

// WorkItemCommit 需求开发提交记录。
type WorkItemCommit struct {
	ID            string    `json:"id"`
	WorkitemID    string    `json:"workitemId"`
	WorkspaceID   string    `json:"workspaceId"`
	SessionID     string    `json:"sessionId"`
	RepositoryID  string    `json:"repositoryId,omitempty"`
	CommitHash    string    `json:"commitHash"`
	CommitMessage string    `json:"commitMessage,omitempty"`
	Author        string    `json:"author,omitempty"`
	CommittedAt   time.Time `json:"committedAt"`
}

// RecordCommitRequest 记录一条需求开发提交。
type RecordCommitRequest struct {
	WorkitemID    string
	WorkspaceID   string
	SessionID     string
	RepositoryID  string
	CommitHash    string
	CommitMessage string
	Author        string
	CommittedAt   time.Time
}

// commitSelectColumns 是 workitem_commits 表 SELECT 的统一列列表，
// 使用 COALESCE 将可空列转为空串，简化扫描逻辑。
const commitSelectColumns = `id, workitem_id, workspace_id, session_id, COALESCE(repository_id, ''),
       commit_hash, COALESCE(commit_message, ''), COALESCE(author, ''), committed_at`

// RecordCommit 幂等记录一条需求开发提交（workitem_id+commit_hash 唯一，重复忽略）。
func (s *DBWorkItemService) RecordCommit(ctx context.Context, req RecordCommitRequest) error {
	if req.WorkitemID == "" || req.CommitHash == "" {
		return errors.New("workitemID and commitHash are required")
	}
	committedAt := req.CommittedAt
	if committedAt.IsZero() {
		committedAt = time.Now().UTC()
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO workitem_commits
			(id, workitem_id, workspace_id, session_id, repository_id, commit_hash, commit_message, author, committed_at, created_at)
		VALUES ($1, $2, $3, $4, NULLIF($5, ''), $6, NULLIF($7, ''), NULLIF($8, ''), $9, NOW())
		ON CONFLICT (workitem_id, commit_hash) DO NOTHING
	`, idutil.GenerateID(), req.WorkitemID, req.WorkspaceID, req.SessionID,
		req.RepositoryID, req.CommitHash, req.CommitMessage, req.Author, committedAt)
	if err != nil {
		return fmt.Errorf("record workitem commit failed: %w", err)
	}
	return nil
}

// ListCommits 按需求 ID 查询开发提交列表，按提交时间倒序。
func (s *DBWorkItemService) ListCommits(workitemID string) ([]WorkItemCommit, error) {
	rows, err := s.db.Query(fmt.Sprintf(`
		SELECT %s
		FROM workitem_commits
		WHERE workitem_id = $1
		ORDER BY committed_at DESC
	`, commitSelectColumns), workitemID)
	if err != nil {
		return nil, fmt.Errorf("list workitem commits failed: %w", err)
	}
	defer rows.Close()
	result := make([]WorkItemCommit, 0)
	for rows.Next() {
		var c WorkItemCommit
		if err := rows.Scan(&c.ID, &c.WorkitemID, &c.WorkspaceID, &c.SessionID,
			&c.RepositoryID, &c.CommitHash, &c.CommitMessage, &c.Author, &c.CommittedAt); err != nil {
			return nil, fmt.Errorf("scan workitem commit failed: %w", err)
		}
		result = append(result, c)
	}
	return result, rows.Err()
}
