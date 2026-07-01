package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/agui"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/chat"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/client"
	"github.com/google/uuid"
)

const (
	finishWait     = 90 * time.Second
	maxRunDuration = 10 * time.Minute
)

// USER_PROMPT_MARKER 与前端 useAgUiChat 保持一致，用于从包装后的提示词中提取原始用户输入。
const USER_PROMPT_MARKER = "__USER_PROMPT__"

// AGUIHandler 处理 AG-UI 协议的 agent run 请求。
type AGUIHandler struct {
	aguiClient *client.AGUIClient
	sessions   chat.SessionStore
	messages   chat.MessageStore
}

// NewAGUIHandler 创建 AG-UI handler。
func NewAGUIHandler(adminURL, pluginKey, workspace string, sessions chat.SessionStore, messages chat.MessageStore) *AGUIHandler {
	return &AGUIHandler{
		aguiClient: client.NewAGUIClient(adminURL, pluginKey, workspace),
		sessions:   sessions,
		messages:   messages,
	}
}

// AgentRun 是 POST /api/v1/agent 处理器。
// 接收 RunAgentInput，转发到 ent-desktop gatewayd，并以 SSE 流回传 AG-UI 事件。
func (h *AGUIHandler) AgentRun(w http.ResponseWriter, r *http.Request) {
	reqStart := time.Now()

	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, fmt.Sprintf("read body: %v", err), http.StatusBadRequest)
		return
	}
	defer r.Body.Close()

	var input agui.RunAgentInput
	if err := json.Unmarshal(body, &input); err != nil {
		http.Error(w, fmt.Sprintf("invalid json: %v", err), http.StatusBadRequest)
		return
	}

	// 确保每条 run 都有唯一 runId。
	if input.RunID == "" {
		input.RunID = uuid.New().String()
	}

	// 校验并复用已存在的后端 session；不存在时让 gatewayd 创建新 thread 后再写入。
	sessionID := input.ThreadID
	if sessionID != "" && sessionID != "main" {
		if sess, err := h.sessions.Get(r.Context(), sessionID); err == nil {
			_ = h.sessions.UpdateActivity(r.Context(), sessionID)
			log.Printf("[AGUIHandler] run=%s reuse session=%s", input.RunID, sessionID)
			// 从持久化会话中恢复创建工作目录，保证 gatewayd 在该 session 生命周期内始终使用同一工作目录。
			if sess.WorkspacePath != "" {
				input.Workspace = sess.WorkspacePath
			}
		} else {
			log.Printf("[AGUIHandler] run=%s session=%s not found, will create after run", input.RunID, sessionID)
			sessionID = ""
		}
	} else {
		sessionID = ""
	}

	// 保存用户输入消息（最后一条或全部用户消息）。
	// 使用 ON CONFLICT DO NOTHING 避免同一消息因重试或历史消息重复发送而主键冲突。
	h.saveUserMessages(r.Context(), sessionID, input.Messages)
	// 设置 SSE 响应头。
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.WriteHeader(http.StatusOK)

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}

	// gatewayd 在 /sessions/{id}/runs 中会先发送 RUN_STARTED，
	// 这里不再重复发送，避免前端收到重复的 run 开始事件。

	// 调用 gatewayd 获取 AG-UI 事件流。
	// 实际 threadId 与 input.ThreadID 相同（由 CreateSession 在 gatewayd 创建）。
	actualThreadID, events, err := h.aguiClient.Run(r.Context(), input)
	if err != nil {
		log.Printf("[AGUIHandler] run=%s run failed after %v: %v", input.RunID, time.Since(reqStart), err)
		h.writeEvent(w, flusher, agui.RunErrorEvent(FormatGatewaydError(err), "RUN_FAILED"))
		return
	}

	// 确保后端 session 记录存在（新会话在发送第一条消息前已通过 /api/v1/sessions 创建，
	// 这里作为兜底，兼容直接调用 /api/v1/agent 的场景）。
	if err := h.ensureSession(r.Context(), actualThreadID); err != nil {
		log.Printf("[AGUIHandler] run=%s ensure session failed: %v", input.RunID, err)
	}
	sessionID = actualThreadID

	finishTimer := time.NewTimer(finishWait)
	finishTimer.Stop()
	maxTimer := time.NewTimer(maxRunDuration)
	maxTimer.Stop()

	activeToolCallCount := 0
	pendingToolCallIDs := []string{}
	activeTextMessageID := ""

	// assistantBuffers 汇总每个 assistant 文本消息的内容，用于落库。
	assistantBuffers := make(map[string]string)
	var bufMu sync.Mutex

	flushPendingState := func() {
		for _, id := range pendingToolCallIDs {
			h.writeEvent(w, flusher, agui.Event{
				Type:       agui.EventToolCallEnd,
				ToolCallID: id,
				Timestamp:  float64(time.Now().UnixMilli()) / 1000,
			})
		}
		pendingToolCallIDs = pendingToolCallIDs[:0]
		activeToolCallCount = 0

		if activeTextMessageID != "" {
			h.writeEvent(w, flusher, agui.Event{
				Type:      agui.EventTextMessageEnd,
				MessageID: activeTextMessageID,
				Timestamp: float64(time.Now().UnixMilli()) / 1000,
			})
			h.persistAssistantText(r.Context(), sessionID, activeTextMessageID, assistantBuffers, &bufMu)
			activeTextMessageID = ""
		}
	}

	firstEventSeen := false
	firstContentSeen := false
	for {
		select {
		case ev, ok := <-events:
			if !ok {
				log.Printf("[AGUIHandler] run=%s event stream closed, total elapsed=%v", input.RunID, time.Since(reqStart))
				flushPendingState()
				h.writeEvent(w, flusher, agui.RunFinishedEvent(actualThreadID, input.RunID))
				h.finalizeSession(r.Context(), sessionID, input.Messages)
				return
			}
			if !firstEventSeen {
				firstEventSeen = true
				log.Printf("[AGUIHandler] run=%s first SSE event from gatewayd after %v: type=%s", input.RunID, time.Since(reqStart), ev.Type)
				maxTimer.Reset(maxRunDuration)
			}
			switch ev.Type {
			case agui.EventThinkingStart:
				log.Printf("[AGUIHandler] run=%s THINKING_START after %v", input.RunID, time.Since(reqStart))
			case agui.EventTextMessageStart:
				log.Printf("[AGUIHandler] run=%s TEXT_MESSAGE_START (TTFT) after %v", input.RunID, time.Since(reqStart))
				activeTextMessageID = ev.MessageID
			case agui.EventTextMessageContent:
				if !firstContentSeen {
					firstContentSeen = true
					log.Printf("[AGUIHandler] run=%s first TEXT_MESSAGE_CONTENT after %v", input.RunID, time.Since(reqStart))
				}
				bufMu.Lock()
				assistantBuffers[ev.MessageID] += ev.Delta
				bufMu.Unlock()
			case agui.EventTextMessageEnd:
				log.Printf("[AGUIHandler] run=%s TEXT_MESSAGE_END id=%s after %v", input.RunID, ev.MessageID, time.Since(reqStart))
				h.persistAssistantText(r.Context(), sessionID, ev.MessageID, assistantBuffers, &bufMu)
				activeTextMessageID = ""
			case agui.EventToolCallStart:
				log.Printf("[AGUIHandler] run=%s TOOL_CALL_START id=%s tool=%s after %v", input.RunID, ev.ToolCallID, ev.ToolCallName, time.Since(reqStart))
				activeToolCallCount++
				pendingToolCallIDs = append(pendingToolCallIDs, ev.ToolCallID)
			case agui.EventToolCallArgs:
				log.Printf("[AGUIHandler] run=%s TOOL_CALL_ARGS id=%s tool=%s args=%.200s after %v", input.RunID, ev.ToolCallID, ev.ToolCallName, ev.Content, time.Since(reqStart))
				if len(pendingToolCallIDs) > 0 {
					expectedID := pendingToolCallIDs[len(pendingToolCallIDs)-1]
					if ev.ToolCallID != expectedID {
						log.Printf("[AGUIHandler] run=%s rewrite TOOL_CALL_ARGS id %s -> %s", input.RunID, ev.ToolCallID, expectedID)
						ev.ToolCallID = expectedID
					}
				} else {
					log.Printf("[AGUIHandler] run=%s TOOL_CALL_ARGS id=%s but no pending tool call", input.RunID, ev.ToolCallID)
				}
			case agui.EventToolCallEnd:
				log.Printf("[AGUIHandler] run=%s TOOL_CALL_END id=%s after %v", input.RunID, ev.ToolCallID, time.Since(reqStart))
				if len(pendingToolCallIDs) > 0 {
					expectedID := pendingToolCallIDs[0]
					pendingToolCallIDs = pendingToolCallIDs[1:]
					if ev.ToolCallID != expectedID {
						log.Printf("[AGUIHandler] run=%s rewrite TOOL_CALL_END id %s -> %s", input.RunID, ev.ToolCallID, expectedID)
						ev.ToolCallID = expectedID
					}
					if activeToolCallCount > 0 {
						activeToolCallCount--
					}
				} else {
					log.Printf("[AGUIHandler] run=%s ignore orphan TOOL_CALL_END id=%s", input.RunID, ev.ToolCallID)
					continue
				}
			case agui.EventToolCallResult:
				log.Printf("[AGUIHandler] run=%s TOOL_CALL_RESULT id=%s tool=%s result=%.200s after %v", input.RunID, ev.ToolCallID, ev.ToolCallName, ev.Content, time.Since(reqStart))
				if len(pendingToolCallIDs) > 0 {
					expectedID := pendingToolCallIDs[0]
					pendingToolCallIDs = pendingToolCallIDs[1:]
					if ev.ToolCallID != expectedID {
						log.Printf("[AGUIHandler] run=%s rewrite TOOL_CALL_RESULT id %s -> %s", input.RunID, ev.ToolCallID, expectedID)
						ev.ToolCallID = expectedID
					}
					h.writeEvent(w, flusher, agui.Event{
						Type:       agui.EventToolCallEnd,
						ToolCallID: expectedID,
						Timestamp:  float64(time.Now().UnixMilli()) / 1000,
					})
					if activeToolCallCount > 0 {
						activeToolCallCount--
					}
				} else {
					log.Printf("[AGUIHandler] run=%s TOOL_CALL_RESULT id=%s but no pending tool call", input.RunID, ev.ToolCallID)
				}
			case agui.EventRunError:
				log.Printf("[AGUIHandler] run=%s RUN_ERROR after %v: %s", input.RunID, time.Since(reqStart), ev.Message)
				flushPendingState()
				h.writeEvent(w, flusher, ev)
				h.finalizeSession(r.Context(), sessionID, input.Messages)
				return
			}
			h.writeEvent(w, flusher, ev)
			if activeToolCallCount == 0 {
				finishTimer.Reset(finishWait)
			} else {
				finishTimer.Stop()
			}
		case <-finishTimer.C:
			log.Printf("[AGUIHandler] run=%s finish timer fired, total elapsed=%v", input.RunID, time.Since(reqStart))
			if activeTextMessageID != "" {
				ts := float64(time.Now().UnixMilli()) / 1000
				h.writeEvent(w, flusher, agui.Event{
					Type:      agui.EventTextMessageContent,
					MessageID: activeTextMessageID,
					Delta:     "\n\n（模型响应超时或中断，请检查模型配置、网络或账户余额后重试。）",
					Timestamp: ts,
				})
				h.writeEvent(w, flusher, agui.Event{
					Type:      agui.EventTextMessageEnd,
					MessageID: activeTextMessageID,
					Timestamp: ts,
				})
				h.persistAssistantText(r.Context(), sessionID, activeTextMessageID, assistantBuffers, &bufMu)
				activeTextMessageID = ""
			}
			flushPendingState()
			h.writeEvent(w, flusher, agui.RunFinishedEvent(actualThreadID, input.RunID))
			h.finalizeSession(r.Context(), sessionID, input.Messages)
			return
		case <-maxTimer.C:
			log.Printf("[AGUIHandler] run=%s max run duration reached, total elapsed=%v", input.RunID, time.Since(reqStart))
			if activeTextMessageID != "" {
				ts := float64(time.Now().UnixMilli()) / 1000
				h.writeEvent(w, flusher, agui.Event{
					Type:      agui.EventTextMessageContent,
					MessageID: activeTextMessageID,
					Delta:     "\n\n（模型运行超过最大时长，已自动结束。）",
					Timestamp: ts,
				})
				h.writeEvent(w, flusher, agui.Event{
					Type:      agui.EventTextMessageEnd,
					MessageID: activeTextMessageID,
					Timestamp: ts,
				})
				h.persistAssistantText(r.Context(), sessionID, activeTextMessageID, assistantBuffers, &bufMu)
				activeTextMessageID = ""
			}
			flushPendingState()
			h.writeEvent(w, flusher, agui.RunFinishedEvent(actualThreadID, input.RunID))
			h.finalizeSession(r.Context(), sessionID, input.Messages)
			return
		}
	}
}

// writeEvent 将 AG-UI 事件以 SSE data: 格式写入响应。
func (h *AGUIHandler) writeEvent(w http.ResponseWriter, flusher http.Flusher, ev agui.Event) {
	data, err := json.Marshal(ev)
	if err != nil {
		log.Printf("[AGUIHandler] marshal event failed: %v", err)
		return
	}
	fmt.Fprintf(w, "data: %s\n\n", data)
	flusher.Flush()
}

// ensureSession 保证指定 session id 在数据库中存在。
func (h *AGUIHandler) ensureSession(ctx context.Context, sessionID string) error {
	if sessionID == "" {
		return nil
	}
	_, err := h.sessions.Get(ctx, sessionID)
	if err == nil {
		return nil
	}
	sess := chat.Session{
		ID:          sessionID,
		WorkspaceID: "ws-default",
		AgentID:     "agent-default",
		AgentType:   "chat",
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}
	return h.sessions.Create(ctx, sess)
}

// saveUserMessages 将用户输入消息持久化到数据库，并在第一条用户消息到达时生成会话标题。
func (h *AGUIHandler) saveUserMessages(ctx context.Context, sessionID string, messages []agui.Message) {
	if sessionID == "" {
		log.Printf("[AGUIHandler] saveUserMessages skipped: empty sessionID, count=%d", len(messages))
		return
	}
	log.Printf("[AGUIHandler] saveUserMessages session=%s count=%d", sessionID, len(messages))
	for _, m := range messages {
		content := m.ContentText()
		metadata := map[string]any{}
		if m.Role == agui.RoleUser {
			original := extractOriginalUserPrompt(content)
			if original != "" && original != content {
				metadata["originalText"] = original
			}
		}
		msg := chat.Message{
			ID:        m.ID,
			SessionID: sessionID,
			Role:      string(m.Role),
			Type:      "text",
			Content:   content,
			Metadata:  metadata,
			Timestamp: time.Now(),
		}
		if err := h.messages.Append(ctx, sessionID, msg); err != nil {
			log.Printf("[AGUIHandler] save user message failed: %v", err)
		} else {
			log.Printf("[AGUIHandler] saved user message id=%s role=%s", msg.ID, msg.Role)
		}
	}
	// 若会话尚无标题，取第一条用户消息生成标题。
	sess, err := h.sessions.Get(ctx, sessionID)
	if err == nil && sess.Title == "" {
		for _, m := range messages {
			if m.Role == agui.RoleUser {
				title := deriveSessionTitle(m.ContentText())
				if title != "" {
					_ = h.sessions.UpdateTitle(ctx, sessionID, title)
				}
				break
			}
		}
	}
}

// persistAssistantText 将 assistant 文本消息内容落库。
func (h *AGUIHandler) persistAssistantText(ctx context.Context, sessionID, messageID string, buffers map[string]string, mu *sync.Mutex) {
	if sessionID == "" || messageID == "" {
		return
	}
	mu.Lock()
	text := buffers[messageID]
	delete(buffers, messageID)
	mu.Unlock()
	if text == "" {
		return
	}
	msg := chat.Message{
		ID:        messageID,
		SessionID: sessionID,
		Role:      "assistant",
		Type:      "text",
		Content:   text,
		Metadata:  map[string]any{},
		Timestamp: time.Now(),
	}
	if err := h.messages.Append(ctx, sessionID, msg); err != nil {
		log.Printf("[AGUIHandler] save assistant message failed: %v", err)
	}
}

// finalizeSession 更新会话活动时间，并根据第一条用户消息生成标题。
func (h *AGUIHandler) finalizeSession(ctx context.Context, sessionID string, inputMessages []agui.Message) {
	if sessionID == "" {
		return
	}
	_ = h.sessions.UpdateActivity(ctx, sessionID)

	sess, err := h.sessions.Get(ctx, sessionID)
	if err != nil {
		log.Printf("[AGUIHandler] get session for title failed: %v", err)
		return
	}
	if sess.Title != "" {
		return
	}
	for _, m := range inputMessages {
		if m.Role == agui.RoleUser {
			title := deriveSessionTitle(m.ContentText())
			if title != "" {
				_ = h.sessions.UpdateTitle(ctx, sessionID, title)
			}
			break
		}
	}
}

// extractOriginalUserPrompt 从包装后的提示词模板中提取用户原始输入。
func extractOriginalUserPrompt(text string) string {
	idx := strings.Index(text, USER_PROMPT_MARKER)
	if idx == -1 {
		return ""
	}
	return strings.TrimSpace(text[idx+len(USER_PROMPT_MARKER):])
}

// deriveSessionTitle 根据用户提示词生成会话标题，最多 30 个字符。
func deriveSessionTitle(text string) string {
	text = strings.TrimSpace(text)
	if text == "" {
		return "新会话"
	}
	// 优先使用原始提示词（如果包含模板标记）。
	original := extractOriginalUserPrompt(text)
	if original != "" {
		text = original
	}
	text = strings.ReplaceAll(text, "\n", " ")
	if utf8.RuneCountInString(text) <= 30 {
		return text
	}
	return string([]rune(text)[:30]) + "..."
}
