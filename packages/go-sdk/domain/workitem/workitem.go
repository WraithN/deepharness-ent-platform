package workitem

import "time"

// WorkItem 统一工作项（需求/缺陷/任务）
type WorkItem struct {
	ID          string
	TenantID    string
	ProjectID   string
	Title       string
	Description string
	Status      Status
	Priority    Priority
	AssigneeID  string
	Source      Source
	ExternalID  string
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

// Status 工作项状态
type Status string

const (
	StatusTodo       Status = "todo"
	StatusInProgress Status = "in_progress"
	StatusDone       Status = "done"
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
