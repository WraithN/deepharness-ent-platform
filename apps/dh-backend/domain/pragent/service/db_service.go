package service

import (
	"database/sql"
	"encoding/json"
	"fmt"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/pragent/object"
)

// DBReviewService 是基于 PostgreSQL 的 ReviewService 实现。
type DBReviewService struct {
	db *sql.DB
}

// NewDBReviewService 创建 PostgreSQL 实现的评审服务。
func NewDBReviewService(db *sql.DB) *DBReviewService {
	return &DBReviewService{db: db}
}

// ListReviews 返回全部评审结果列表。
func (s *DBReviewService) ListReviews() ([]object.ReviewResult, error) {
	rows, err := s.db.Query(`
		SELECT id, repo, pr_id, title, summary, issues, created_at
		FROM review_results
		ORDER BY created_at DESC
	`)
	if err != nil {
		return nil, fmt.Errorf("list reviews failed: %w", err)
	}
	defer rows.Close()

	result := make([]object.ReviewResult, 0)
	for rows.Next() {
		var r object.ReviewResult
		var summary sql.NullString
		var issuesJSON []byte
		err := rows.Scan(&r.ID, &r.Repo, &r.PRID, &r.Title, &summary, &issuesJSON, &r.CreatedAt)
		if err != nil {
			return nil, fmt.Errorf("scan review failed: %w", err)
		}
		if summary.Valid {
			r.Summary = summary.String
		}
		r.Issues = make([]object.ReviewIssue, 0)
		if len(issuesJSON) > 0 {
			if err := json.Unmarshal(issuesJSON, &r.Issues); err != nil {
				return nil, fmt.Errorf("unmarshal review issues failed: %w", err)
			}
		}
		result = append(result, r)
	}
	return result, rows.Err()
}
