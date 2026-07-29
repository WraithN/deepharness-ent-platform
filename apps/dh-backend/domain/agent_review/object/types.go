package object

import "time"

type ReviewIssue struct {
	ID                string  `json:"id"`
	FilePath          string  `json:"filePath"`
	Line              int     `json:"line"`
	Severity          string  `json:"severity"`
	Title             string  `json:"title"`
	Description       string  `json:"description"`
	Suggestion        string  `json:"suggestion"`
	Status            string  `json:"status"`
	LinkedWorkitemID   *string `json:"linkedWorkitemId,omitempty"`
	LinkedWorkitemType *string `json:"linkedWorkitemType,omitempty"`
	CompletedAt        *string `json:"completedAt,omitempty"`
}

type AgentReviewReport struct {
	ID          string        `json:"id"`
	WorkspaceID string        `json:"workspaceId"`
	SessionID   string        `json:"sessionId"`
	ProjectPath string        `json:"projectPath"`
	ProjectName string        `json:"projectName"`
	Branch      string        `json:"branch"`
	CommitHash  string        `json:"commitHash"`
	ReportPath  string        `json:"reportPath"`
	Summary     string        `json:"summary"`
	Issues      []ReviewIssue `json:"issues"`
	CreatedAt   time.Time     `json:"createdAt"`
	UpdatedAt   time.Time     `json:"updatedAt"`
}

type AdoptReviewReportRequest struct {
	WorkspaceID string        `json:"workspaceId"`
	SessionID   string        `json:"sessionId"`
	ProjectPath string        `json:"projectPath"`
	ProjectName string        `json:"projectName"`
	Branch      string        `json:"branch"`
	CommitHash  string        `json:"commitHash"`
	ReportPath  string        `json:"reportPath"`
	Summary     string        `json:"summary"`
	Issues      []ReviewIssue `json:"issues"`
}

type UpdateIssueStatusRequest struct {
	IssueID          string `json:"issueId"`
	Status           string `json:"status"`
	LinkedWorkitemID   string `json:"linkedWorkitemId"`
	LinkedWorkitemType string `json:"linkedWorkitemType"`
}

type IssueStatus string

const (
	IssueStatusOpen       IssueStatus = "open"
	IssueStatusFixed      IssueStatus = "fixed"
	IssueStatusWontFix    IssueStatus = "wont_fix"
	IssueStatusFalseAlarm IssueStatus = "false_alarm"
)
