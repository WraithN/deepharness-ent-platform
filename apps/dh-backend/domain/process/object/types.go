package object

import "time"

// 流程阶段名称常量（通用，其他流程可复用）
const (
	StageRequirement  = "requirement"  // 需求受理
	StageDevelopment  = "development"  // 需求开发
	StageReview       = "review"       // 代码Review
)

// 流程阶段展示标签
var StageLabels = map[string]string{
	StageRequirement: "需求受理",
	StageDevelopment: "需求开发",
	StageReview:      "代码Review",
}

// 阶段状态常量
const (
	StageStatusPending    = "pending"
	StageStatusInProgress = "in_progress"
	StageStatusCompleted  = "completed"
	StageStatusFailed     = "failed"
)

// 流程类型常量
const (
	ProcessTypeAIDev = "ai_dev"
)

// ProcessStage 流程阶段
type ProcessStage struct {
	Name        string     `json:"name"`
	Label       string     `json:"label"`
	Status      string     `json:"status"`
	SessionID   string     `json:"sessionId,omitempty"`
	StartedAt   *time.Time `json:"startedAt,omitempty"`
	CompletedAt *time.Time `json:"completedAt,omitempty"`
	Error       string     `json:"error,omitempty"`
}

// Process 流程实体
type Process struct {
	ID          string         `json:"id"`
	WorkspaceID string         `json:"workspaceId"`
	WorkitemID  string         `json:"workitemId"`
	Title       string         `json:"title"`
	Type        string         `json:"type"`
	Stages      []ProcessStage `json:"stages"`
	CreatedAt   time.Time      `json:"createdAt"`
	UpdatedAt   time.Time      `json:"updatedAt"`
}

// CreateProcessRequest 创建流程请求
type CreateProcessRequest struct {
	WorkspaceID string           `json:"workspaceId"`
	WorkitemID  string           `json:"workitemId"`
	Title       string           `json:"title"`
	Type        string           `json:"type"`
	Stages      []ProcessStage   `json:"stages"`
}

// UpdateStageRequest 更新阶段状态请求
type UpdateStageRequest struct {
	Status    string `json:"status"`
	SessionID string `json:"sessionId,omitempty"`
	Error     string `json:"error,omitempty"`
}

// NewAIDevProcess 创建 AI 开发流程（含预定义阶段）
func NewAIDevProcess(workspaceID, workitemID, title string) *Process {
	now := time.Now()
	stages := make([]ProcessStage, 0, 3)
	for _, name := range []string{StageRequirement, StageDevelopment, StageReview} {
		stages = append(stages, ProcessStage{
			Name:   name,
			Label:  StageLabels[name],
			Status: StageStatusPending,
		})
	}
	return &Process{
		ID:          "",
		WorkspaceID: workspaceID,
		WorkitemID:  workitemID,
		Title:       title,
		Type:        ProcessTypeAIDev,
		Stages:      stages,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
}
