package handler

import (
	"encoding/json"
	"net/http"

	agent "github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/agent"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/provisioner"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/middleware"
)

// AgentStatusHandler 前端查询 Agent 实例状态的 HTTP handler。
type AgentStatusHandler struct {
	provisioner agent.AgentProvisioner
	tracker     *provisioner.StatusTracker
}

// NewAgentStatusHandler 创建 Agent 状态查询 handler。
func NewAgentStatusHandler(p agent.AgentProvisioner, tracker *provisioner.StatusTracker) *AgentStatusHandler {
	return &AgentStatusHandler{
		provisioner: p,
		tracker:     tracker,
	}
}

type agentStatusResponse struct {
	HasInstance    bool                        `json:"hasInstance"`
	InstanceStatus string                     `json:"instanceStatus,omitempty"`
	Provisioning   *provisioner.ProvisioningState `json:"provisioning,omitempty"`
}

// GetStatus GET /api/v1/workspaces/{id}/agent-status
// 返回当前 Workspace 下用户的 Agent 实例状态和 provisioning 进度。
func (h *AgentStatusHandler) GetStatus(w http.ResponseWriter, r *http.Request) {
	workspaceID := r.PathValue("id")
	userID, ok := middleware.UserIDFromContext(r.Context())
	if workspaceID == "" || !ok || userID == "" {
		WriteJSONError(w, http.StatusBadRequest, ErrCodeGeneral, "workspaceId and userId are required")
		return
	}

	resp := agentStatusResponse{}

	inst, err := h.provisioner.FindByUser(r.Context(), workspaceID, userID)
	if err == nil && inst != nil {
		resp.HasInstance = true
		resp.InstanceStatus = string(inst.Status)
	}

	if provState := h.tracker.Get(workspaceID, userID); provState != nil {
		resp.Provisioning = provState
	}

	SetJSONHeader(w)
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(resp)
}
