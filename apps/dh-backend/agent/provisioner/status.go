package provisioner

import (
	"sync"
	"time"
)

// ProvisioningState provisioning 过程中的中间状态。
type ProvisioningState struct {
	Status       string    `json:"status"`
	Stage        string    `json:"stage"`
	EstimatedSec int       `json:"estimatedSec"`
	InstanceID   string    `json:"instanceId"`
	StartedAt    time.Time `json:"startedAt"`
	CompletedAt  time.Time `json:"completedAt"`
	Error        string    `json:"error,omitempty"`
}

// StatusKey 构建 status key（workspaceID:userID）。
func StatusKey(workspaceID, userID string) string {
	return workspaceID + ":" + userID
}

// StatusTracker provisioning 状态追踪器（内存实现，单实例 dh-backend）。
type StatusTracker struct {
	mu     sync.RWMutex
	states map[string]*ProvisioningState
}

// NewStatusTracker 创建新的状态追踪器。
func NewStatusTracker() *StatusTracker {
	return &StatusTracker{
		states: make(map[string]*ProvisioningState),
	}
}

// Begin 开始追踪 provisioning。
func (t *StatusTracker) Begin(workspaceID, userID, stage, status string, estimatedSec int) {
	t.mu.Lock()
	defer t.mu.Unlock()

	key := StatusKey(workspaceID, userID)
	t.states[key] = &ProvisioningState{
		Status:       status,
		Stage:        stage,
		EstimatedSec: estimatedSec,
		StartedAt:    time.Now(),
	}
}

// Update 更新 provisioning 阶段信息。
func (t *StatusTracker) Update(workspaceID, userID, instanceID, stage, status string, estimatedSec int) {
	t.mu.Lock()
	defer t.mu.Unlock()

	key := StatusKey(workspaceID, userID)
	if s, ok := t.states[key]; ok {
		s.Stage = stage
		s.Status = status
		s.EstimatedSec = estimatedSec
		s.InstanceID = instanceID
	}
}

// Complete 标记 provisioning 完成。
func (t *StatusTracker) Complete(workspaceID, userID, instanceID string) {
	t.mu.Lock()
	defer t.mu.Unlock()

	key := StatusKey(workspaceID, userID)
	if s, ok := t.states[key]; ok {
		s.Status = "ready"
		s.Stage = "ready"
		s.EstimatedSec = 0
		s.InstanceID = instanceID
		s.CompletedAt = time.Now()
	}
}

// Fail 标记 provisioning 失败。
func (t *StatusTracker) Fail(workspaceID, userID, errMsg string) {
	t.mu.Lock()
	defer t.mu.Unlock()

	key := StatusKey(workspaceID, userID)
	if s, ok := t.states[key]; ok {
		s.Status = "error"
		s.Error = errMsg
		s.CompletedAt = time.Now()
	}
}

// Get 获取当前 provisioning 状态。
func (t *StatusTracker) Get(workspaceID, userID string) *ProvisioningState {
	t.mu.RLock()
	defer t.mu.RUnlock()

	key := StatusKey(workspaceID, userID)
	if s, ok := t.states[key]; ok {
		cp := *s
		return &cp
	}
	return nil
}

// Cleanup 清除指定 key 的状态记录。
func (t *StatusTracker) Cleanup(workspaceID, userID string) {
	t.mu.Lock()
	defer t.mu.Unlock()

	key := StatusKey(workspaceID, userID)
	delete(t.states, key)
}
