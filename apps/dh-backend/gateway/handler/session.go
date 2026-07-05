package handler

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"time"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/agui/buffer"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/chat"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/client"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/config"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/agentconfig/service"
	workspaceservice "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/workspace/service"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/agent"
	"github.com/google/uuid"
)

type SessionHandler struct {
	sessions           chat.SessionStore
	messages           chat.MessageStore
	gatewaydClient     *client.GatewaydClient
	workspaceService   workspaceservice.WorkspaceService
	agentConfigService service.AgentConfigService
	cfg                config.Config
	buffer             buffer.SSEBuffer
}

func NewSessionHandler(
	sessions chat.SessionStore,
	messages chat.MessageStore,
	gatewaydClient *client.GatewaydClient,
	workspaceService workspaceservice.WorkspaceService,
	agentConfigService service.AgentConfigService,
	cfg config.Config,
	buf buffer.SSEBuffer,
) *SessionHandler {
	return &SessionHandler{
		sessions:           sessions,
		messages:           messages,
		gatewaydClient:     gatewaydClient,
		workspaceService:   workspaceService,
		agentConfigService: agentConfigService,
		cfg:                cfg,
		buffer:             buf,
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
	workspacePath, err := resolveWorkspacePath(workspaceID, h.cfg.WorkspaceRoot, h.workspaceService)
	if err != nil {
		WriteJSONError(w, http.StatusInternalServerError, 1, err.Error())
		return
	}
	ensureWorkspaceDir(workspacePath)

	agentID := req.AgentID
	if agentID == "" {
		agentID = "agent-default"
	}
	agentType := req.AgentType
	if agentType == "" {
		agentType = "chat"
	}

	// 校验前端指定的插件 key 是否在当前空间可用。
	pluginKey := req.resolvePluginKey()
	if pluginKey != "" && h.agentConfigService != nil {
		available, availErr := h.agentConfigService.ListAvailableAgents(workspaceID)
		if availErr != nil {
			log.Printf("[CreateSession] failed to list available agents: %v", availErr)
		} else if !isAgentAvailable(pluginKey, available) {
			WriteJSONError(w, http.StatusForbidden, 1, "agent not available in this workspace")
			return
		}
	}

	// 查询当前智能体配置，用于同步给 gatewayd。
	model := req.Model
	var cfg agent.WorkspaceAgentConfig
	var cfgErr error
	if h.agentConfigService != nil && pluginKey != "" {
		cfg, cfgErr = h.agentConfigService.GetWorkspaceConfig(workspaceID, pluginKey)
		if cfgErr == nil && model == "" && cfg.Model != "" {
			model = cfg.Model
		}
	}

	// 向 gatewayd 注入上下文（agent_type / model / workspace），
	// 使 gatewayd 审计与后续 LLM 路由能感知当前会话使用的智能体与模型。
	if pluginKey != "" {
		if ctxErr := h.gatewaydClient.SetContext(r.Context(), pluginKey, threadID, workspacePath, model); ctxErr != nil {
			log.Printf("[CreateSession] SetContext failed: %v", ctxErr)
		}
	}

	// 根据前端指定的插件 key，在 gatewayd 上挂载对应 agent 实例，
	// 并获取 instance_id 作为智能体唯一标识返回给前端。
	// 将计算好的 workspacePath 传给 gatewayd，保证该会话下 agent 使用固定工作目录。
	instanceID := ""
	if pluginKey != "" {
		if id, attachErr := h.gatewaydClient.AttachAgent(r.Context(), threadID, pluginKey, workspacePath); attachErr == nil {
			instanceID = id
		} else {
			log.Printf("[CreateSession] AttachAgent failed: %v", attachErr)
		}
	}

	// 把 workspace 级别的模型配置同步到 gatewayd，使运行时能感知租户自定义的
	// 模型、base_url、api_key、temperature、max_tokens 等参数。
	if instanceID != "" {
		if cfgErr == nil {
			updateReq := client.UpdateAgentConfigRequest{
				Model:     cfg.Model,
				ModelType: cfg.ModelSource,
				BaseURL:   cfg.BaseURL,
				APIKey:    cfg.APIKey,
			}
			if cfg.Temperature != nil {
				updateReq.Temperature = cfg.Temperature
			}
			if cfg.AdvancedConfig != nil && cfg.AdvancedConfig.MaxTokens != nil {
				updateReq.MaxTokens = cfg.AdvancedConfig.MaxTokens
			}
			if syncErr := h.gatewaydClient.UpdateAgentConfig(r.Context(), threadID, instanceID, updateReq); syncErr != nil {
				log.Printf("[CreateSession] UpdateAgentConfig failed: %v", syncErr)
			}
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
			GatewaydWsURL: h.gatewaydClient.WsURLForSession(session.ID),
			AgentID:       gwAgentID,
		},
	})
}

// DeleteSession 删除指定会话及其消息。
// isAgentAvailable 检查 pluginKey 是否在可用智能体列表中。
func isAgentAvailable(pluginKey string, available []agent.AvailableAgent) bool {
	for _, a := range available {
		if a.AgentKey == pluginKey {
			return true
		}
	}
	return false
}

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

	// 崩溃恢复：检查 buffer 中是否有未持久化的 run 状态（checkpoint），
	// 若有则将其落库，防止服务器崩溃导致 assistant 消息丢失。
	h.recoverPendingRuns(r.Context(), id)

	const maxMessageHistory = 100
	messages, err := h.messages.GetHistory(r.Context(), id, maxMessageHistory)
	if err != nil {
		http.Error(w, `{"code":1,"message":"failed to get messages"}`, http.StatusInternalServerError)
		return
	}
	// 兼容历史数据：前端曾用 JSON.stringify 双重编码 content，导致持久化的
	// originalText 包含字面量 \n 前缀。这里在返回前重新提取，确保前端拿到干净的原始文本。
	for i := range messages {
		if messages[i].Role != "user" {
			continue
		}
		original := extractOriginalUserPrompt(messages[i].Content)
		if original == "" {
			continue
		}
		if messages[i].Metadata == nil {
			messages[i].Metadata = map[string]any{}
		}
		messages[i].Metadata["originalText"] = original
	}
	json.NewEncoder(w).Encode(messages)
}

// recoverPendingRuns 检查 buffer 中的 run 级 checkpoint，
// 将因服务器崩溃未持久化的 assistant 消息落库。
// 每个 checkpoint 是一次 run 中累积的 contentPart 列表（JSON），
// 包含 reasoning / text / tool-call 部件，按实际事件顺序排列。
func (h *SessionHandler) recoverPendingRuns(ctx context.Context, sessionID string) {
	if h.buffer == nil {
		return
	}
	states, err := h.buffer.LoadPendingRunStates(ctx, sessionID)
	if err != nil {
		log.Printf("[SessionHandler] recover: load pending run states failed: %v", err)
		return
	}
	for runID, state := range states {
		var parts []contentPart
		if err := json.Unmarshal(state, &parts); err != nil {
			log.Printf("[SessionHandler] recover: unmarshal run state failed runID=%s: %v", runID, err)
			_ = h.buffer.ClearRunState(ctx, sessionID, runID)
			continue
		}
		// 从 parts 中提取纯文本作为 Message.Content
		var textContent string
		for _, p := range parts {
			if p.Type == "text" {
				textContent += p.Text
			}
		}
		if len(parts) == 0 && textContent == "" {
			_ = h.buffer.ClearRunState(ctx, sessionID, runID)
			continue
		}
		metadata := map[string]any{}
		if len(parts) > 0 {
			metadata["contentParts"] = parts
		}
		msg := chat.Message{
			ID:        uuid.New().String(),
			SessionID: sessionID,
			Role:      "assistant",
			Type:      "text",
			Content:   textContent,
			Metadata:  metadata,
			Timestamp: time.Now(),
		}
		if err := h.messages.Append(ctx, sessionID, msg); err != nil {
			log.Printf("[SessionHandler] recover: persist run state failed runID=%s: %v", runID, err)
			continue
		}
		log.Printf("[SessionHandler] recover: persisted crashed run runID=%s parts=%d", runID, len(parts))
		_ = h.buffer.ClearRunState(ctx, sessionID, runID)
	}
}
