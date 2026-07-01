package handler

import (
	"encoding/json"
	"log"
	"net/http"
	"time"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/chat"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/client"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/config"
	workspaceservice "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/workspace/service"
	"github.com/google/uuid"
)

type SessionHandler struct {
	sessions         chat.SessionStore
	messages         chat.MessageStore
	gatewaydClient   *client.GatewaydClient
	workspaceService workspaceservice.WorkspaceService
	cfg              config.Config
}

func NewSessionHandler(
	sessions chat.SessionStore,
	messages chat.MessageStore,
	gatewaydClient *client.GatewaydClient,
	workspaceService workspaceservice.WorkspaceService,
	cfg config.Config,
) *SessionHandler {
	return &SessionHandler{
		sessions:         sessions,
		messages:         messages,
		gatewaydClient:   gatewaydClient,
		workspaceService: workspaceService,
		cfg:              cfg,
	}
}

type CreateSessionRequest struct {
	WorkspaceID string         `json:"workspaceId"`
	AgentID     string         `json:"agentId"`
	AgentType   string         `json:"agentType"`
	Model       string         `json:"model"`
	ProjectID   string         `json:"projectId"`
	Context     map[string]any `json:"context"`
	PluginKey   string         `json:"pluginKey"`
	// AgentKey 是 PluginKey 的别名，前端可统一使用 agent_key 指定要加载的 agent。
	AgentKey string `json:"agent_key"`
}

// resolvePluginKey 返回请求中指定的 agent 插件 key，优先使用 agent_key。
func (r CreateSessionRequest) resolvePluginKey() string {
	if r.AgentKey != "" {
		return r.AgentKey
	}
	return r.PluginKey
}

type CreateSessionResponse struct {
	SessionID     string `json:"sessionId"`
	InstanceID    string `json:"instanceId"`
	GatewaydURL   string `json:"gatewaydUrl"`
	GatewaydWsURL string `json:"gatewaydWsUrl"`
	AgentID       string `json:"agentId"`
}

func (h *SessionHandler) Sessions(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	switch r.Method {
	case http.MethodGet:
		sessions, err := h.sessions.ListSessions(r.Context())
		if err != nil {
			http.Error(w, `{"code":1,"message":"failed to list sessions"}`, http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(sessions)
	case http.MethodPost:
		h.CreateSession(w, r)
	default:
		http.Error(w, `{"code":1,"message":"method not allowed"}`, http.StatusMethodNotAllowed)
	}
}

func (h *SessionHandler) CreateSession(w http.ResponseWriter, r *http.Request) {
	var req CreateSessionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"code":2,"message":"invalid request body"}`, http.StatusBadRequest)
		return
	}

	// 先在 gatewayd 创建 thread，再用 threadId 作为 session id，
	// 保证前端 threadId 与后端 session id 一一对应。
	// 开发或 gatewayd 未启动时，若连接被拒绝/超时，则降级为本地 UUID，
	// 避免会话创建直接 500 导致前端不可用。
	threadID, err := h.gatewaydClient.CreateThread(r.Context())
	if err != nil {
		if !IsGatewaydConnectionError(err) {
			http.Error(w, `{"code":5,"message":"failed to create gatewayd thread"}`, http.StatusInternalServerError)
			return
		}
		log.Printf("[CreateSession] gatewayd unreachable (%v), fallback to local session id", err)
		threadID = uuid.New().String()
	}

	workspaceID := req.WorkspaceID
	if workspaceID == "" {
		workspaceID = "ws-default"
	}

	// 根据 workspace 成员与配置根目录计算 gatewayd 工作目录，并确保目录存在。
	workspacePath := sanitizeWorkspacePath(resolveWorkspacePath(workspaceID, h.cfg.RepositoryRoot, h.workspaceService))
	ensureWorkspaceDir(workspacePath)

	agentID := req.AgentID
	if agentID == "" {
		agentID = "agent-default"
	}
	agentType := req.AgentType
	if agentType == "" {
		agentType = "chat"
	}

	// 根据前端指定的插件 key，在 gatewayd 上挂载对应 agent 实例，
	// 并获取 instance_id 作为智能体唯一标识返回给前端。
	// 将计算好的 workspacePath 传给 gatewayd，保证该会话下 agent 使用固定工作目录。
	instanceID := ""
	pluginKey := req.resolvePluginKey()
	if pluginKey != "" {
		if id, attachErr := h.gatewaydClient.AttachAgent(r.Context(), threadID, pluginKey, workspacePath); attachErr == nil {
			instanceID = id
		} else {
			log.Printf("[CreateSession] AttachAgent failed: %v", attachErr)
		}
	}

	// 在会话上下文中记录使用的插件与实例 id，便于历史会话恢复时正确归类。
	context := req.Context
	if context == nil {
		context = make(map[string]any)
	}
	context["pluginKey"] = pluginKey
	context["instanceId"] = instanceID

	session := chat.Session{
		ID:            threadID,
		WorkspaceID:   workspaceID,
		WorkspacePath: workspacePath,
		AgentID:       agentID,
		AgentType:     agentType,
		Model:         req.Model,
		ProjectID:     req.ProjectID,
		Context:       context,
		CreatedAt:     time.Now(),
		UpdatedAt:     time.Now(),
	}

	if err := h.sessions.Create(r.Context(), session); err != nil {
		http.Error(w, `{"code":3,"message":"failed to create session"}`, http.StatusInternalServerError)
		return
	}

	gwAgentID := instanceID
	if gwAgentID == "" {
		gwAgentID = h.gatewaydClient.AgentID()
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"code":    0,
		"message": "success",
		"data": CreateSessionResponse{
			SessionID:     session.ID,
			InstanceID:    instanceID,
			GatewaydURL:   h.gatewaydClient.AdminURL(),
			GatewaydWsURL: h.gatewaydClient.WsURL(),
			AgentID:       gwAgentID,
		},
	})
}

// DeleteSession 删除指定会话及其消息。
func (h *SessionHandler) DeleteSession(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodDelete {
		http.Error(w, `{"code":1,"message":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	id := r.PathValue("id")
	if id == "" {
		http.Error(w, `{"code":1,"message":"missing session id"}`, http.StatusBadRequest)
		return
	}

	if err := h.sessions.Delete(r.Context(), id); err != nil {
		http.Error(w, `{"code":1,"message":"failed to delete session"}`, http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(map[string]any{
		"code":    0,
		"message": "success",
	})
}

// GetMessages 返回指定会话的历史消息。
func (h *SessionHandler) GetMessages(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodGet {
		http.Error(w, `{"code":1,"message":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	id := r.PathValue("id")
	if id == "" {
		http.Error(w, `{"code":1,"message":"missing session id"}`, http.StatusBadRequest)
		return
	}

	const maxMessageHistory = 100
	messages, err := h.messages.GetHistory(r.Context(), id, maxMessageHistory)
	if err != nil {
		http.Error(w, `{"code":1,"message":"failed to get messages"}`, http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(messages)
}
