package workitem

import "time"

// WorkItem 统一工作项（需求/缺陷/用例）
type WorkItem struct {
	ID          string    `json:"id"`
	TenantID    string    `json:"tenantId"`
	ProjectID   string    `json:"projectId"`
	Type        Type      `json:"type"`
	Title       string    `json:"title"`
	Description string    `json:"description"`
	Status      Status    `json:"status"`
	Priority    Priority  `json:"priority"`
	AssigneeID  string    `json:"assigneeId"`
	Reporter    string    `json:"reporter"`
	Source      Source    `json:"source"`
	ExternalID  string    `json:"externalId"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

// Type 工作项类型
type Type string

const (
	TypeRequirement Type = "requirement"
	TypeDefect      Type = "defect"
	TypeCase        Type = "case"
)

// Status 工作项状态
type Status string

const (
	StatusBacklog    Status = "backlog"
	StatusTodo       Status = "todo"
	StatusInProgress Status = "in_progress"
	StatusDone       Status = "done"
	StatusOpen       Status = "open"
	StatusFixed      Status = "fixed"
	StatusClosed     Status = "closed"
	StatusDraft      Status = "draft"
	StatusReady      Status = "ready"
	StatusPassed     Status = "passed"
	StatusFailed     Status = "failed"
	StatusBlocked    Status = "blocked"
)

// Priority 优先级
type Priority string

const (
	PriorityLow    Priority = "low"
	PriorityMedium Priority = "medium"
	PriorityHigh   Priority = "high"
)

// Source 来源平台
type Source string

const (
	SourceMeego      Source = "meego"
	SourcePingCode   Source = "pingcode"
	SourceJira       Source = "jira"
	SourceAzureDevOps Source = "azure_devops"
	SourceGitHub     Source = "github"
	SourceInternal   Source = "internal"
)
