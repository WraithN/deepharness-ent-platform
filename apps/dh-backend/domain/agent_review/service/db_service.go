package service

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/agent_review/object"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/pkg/idutil"
)

type DBAgentReviewService struct {
	db *sql.DB
}

func NewDBAgentReviewService(db *sql.DB) *DBAgentReviewService {
	return &DBAgentReviewService{db: db}
}

func (s *DBAgentReviewService) AdoptReviewReport(req object.AdoptReviewReportRequest) (object.AgentReviewReport, error) {
	id := idutil.GenerateID()
	now := time.Now().UTC()

	issuesJSON, err := json.Marshal(req.Issues)
	if err != nil {
		return object.AgentReviewReport{}, fmt.Errorf("marshal issues: %w", err)
	}

	report := object.AgentReviewReport{
		ID:          id,
		WorkspaceID: req.WorkspaceID,
		SessionID:   req.SessionID,
		ProjectPath: req.ProjectPath,
		ProjectName: req.ProjectName,
		Branch:      req.Branch,
		CommitHash:  req.CommitHash,
		ReportPath:  req.ReportPath,
		Summary:     req.Summary,
		Issues:      req.Issues,
		CreatedAt:   now,
		UpdatedAt:   now,
	}

	_, err = s.db.Exec(`
		INSERT INTO agent_review_reports (id, workspace_id, session_id, project_path, project_name, branch, commit_hash, report_path, summary, issues, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
	`, id, req.WorkspaceID, req.SessionID, req.ProjectPath, req.ProjectName, req.Branch, req.CommitHash, req.ReportPath, req.Summary, issuesJSON, now, now)
	if err != nil {
		return object.AgentReviewReport{}, fmt.Errorf("insert report: %w", err)
	}

	return report, nil
}

func (s *DBAgentReviewService) ListAgentReviewReports(workspaceID string) ([]object.AgentReviewReport, error) {
	rows, err := s.db.Query(`
		SELECT id, workspace_id, session_id, project_path, project_name, branch, commit_hash, report_path, summary, issues, created_at, updated_at
		FROM agent_review_reports
		WHERE workspace_id = $1
		ORDER BY created_at DESC
	`, workspaceID)
	if err != nil {
		return nil, fmt.Errorf("query reports: %w", err)
	}
	defer rows.Close()

	var reports []object.AgentReviewReport
	for rows.Next() {
		var r object.AgentReviewReport
		var issuesBytes []byte
		var sessionID, summary sql.NullString
		if err := rows.Scan(&r.ID, &r.WorkspaceID, &sessionID, &r.ProjectPath, &r.ProjectName, &r.Branch, &r.CommitHash, &r.ReportPath, &summary, &issuesBytes, &r.CreatedAt, &r.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan report: %w", err)
		}
		r.SessionID = sessionID.String
		r.Summary = summary.String
		if len(issuesBytes) > 0 {
			if err := json.Unmarshal(issuesBytes, &r.Issues); err != nil {
				return nil, fmt.Errorf("unmarshal issues: %w", err)
			}
		}
		reports = append(reports, r)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("rows iteration: %w", err)
	}

	return reports, nil
}

func (s *DBAgentReviewService) GetAgentReviewReport(id string) (object.AgentReviewReport, error) {
	var r object.AgentReviewReport
	var issuesBytes []byte
	var sessionID, summary sql.NullString

	err := s.db.QueryRow(`
		SELECT id, workspace_id, session_id, project_path, project_name, branch, commit_hash, report_path, summary, issues, created_at, updated_at
		FROM agent_review_reports
		WHERE id = $1
	`, id).Scan(&r.ID, &r.WorkspaceID, &sessionID, &r.ProjectPath, &r.ProjectName, &r.Branch, &r.CommitHash, &r.ReportPath, &summary, &issuesBytes, &r.CreatedAt, &r.UpdatedAt)
	if err != nil {
		return object.AgentReviewReport{}, fmt.Errorf("query report: %w", err)
	}
	r.SessionID = sessionID.String
	r.Summary = summary.String
	if len(issuesBytes) > 0 {
		if err := json.Unmarshal(issuesBytes, &r.Issues); err != nil {
			return object.AgentReviewReport{}, fmt.Errorf("unmarshal issues: %w", err)
		}
	}

	return r, nil
}

func (s *DBAgentReviewService) UpdateIssueStatus(reportID string, req object.UpdateIssueStatusRequest) (object.AgentReviewReport, error) {
	report, err := s.GetAgentReviewReport(reportID)
	if err != nil {
		return object.AgentReviewReport{}, err
	}

	now := time.Now()
	nowStr := now.Format(time.RFC3339)
	found := false
	for i := range report.Issues {
		if report.Issues[i].ID == req.IssueID {
			// 更新状态（如果提供了非空值）
			if req.Status != "" {
				report.Issues[i].Status = req.Status
				if req.Status == string(object.IssueStatusFixed) {
					report.Issues[i].CompletedAt = &nowStr
				}
			}
			// 更新关联工作项 ID（如果提供了非空值）
			if req.LinkedWorkitemID != "" {
				report.Issues[i].LinkedWorkitemID = &req.LinkedWorkitemID
			}
			// 更新关联工作项类型（如果提供了非空值）
			if req.LinkedWorkitemType != "" {
				report.Issues[i].LinkedWorkitemType = &req.LinkedWorkitemType
			}
			found = true
			break
		}
	}
	if !found {
		return object.AgentReviewReport{}, fmt.Errorf("issue %s not found in report %s", req.IssueID, reportID)
	}

	issuesJSON, err := json.Marshal(report.Issues)
	if err != nil {
		return object.AgentReviewReport{}, fmt.Errorf("marshal issues: %w", err)
	}

	_, err = s.db.Exec(`
		UPDATE agent_review_reports SET issues = $1, updated_at = $2 WHERE id = $3
	`, issuesJSON, now, reportID)
	if err != nil {
		return object.AgentReviewReport{}, fmt.Errorf("update issues: %w", err)
	}

	report.UpdatedAt = now
	return report, nil
}
