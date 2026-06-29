package handler

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"time"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/agui"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/client"
	"github.com/google/uuid"
)

// AGUIHandler 处理 AG-UI 协议的 agent run 请求。
type AGUIHandler struct {
	aguiClient *client.AGUIClient
}

// NewAGUIHandler 创建 AG-UI handler。
func NewAGUIHandler(adminURL, pluginKey, workspace string) *AGUIHandler {
	return &AGUIHandler{
		aguiClient: client.NewAGUIClient(adminURL, pluginKey, workspace),
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
	// 实际 threadId 可能与 input.ThreadID 不同（session 失效时会自动重建）。
	actualThreadID, events, err := h.aguiClient.Run(r.Context(), input)
	if err != nil {
		log.Printf("[AGUIHandler] run failed after %v: %v", time.Since(reqStart), err)
		log.Printf("[AGUIHandler] run failed: %v", err)
		// AG-UI client 在收到 RUN_ERROR 后会把 run 标记为失败，
		// 此时再发 RUN_FINISHED 会触发前端状态机错误，因此只发 RUN_ERROR。
		h.writeEvent(w, flusher, agui.RunErrorEvent(err.Error(), "RUN_FAILED"))
		return
	}

	// gatewayd 在某些 agent 实现下不会主动发送 RUN_FINISHED，导致连接一直挂起。
	// 这里在收到最后一条文本消息结束事件后，等待一小段时间无新事件则主动结束响应。
	const finishWait = 5 * time.Second
	finishTimer := time.NewTimer(finishWait)
	finishTimer.Stop()

	firstEventSeen := false
	firstContentSeen := false
	for {
		select {
		case ev, ok := <-events:
			if !ok {
				log.Printf("[AGUIHandler] run=%s event stream closed, total elapsed=%v", input.RunID, time.Since(reqStart))
				h.writeEvent(w, flusher, agui.RunFinishedEvent(actualThreadID, input.RunID))
				return
			}
			if !firstEventSeen {
				firstEventSeen = true
				log.Printf("[AGUIHandler] run=%s first SSE event from gatewayd after %v: type=%s", input.RunID, time.Since(reqStart), ev.Type)
			}
			switch ev.Type {
			case agui.EventThinkingStart:
				log.Printf("[AGUIHandler] run=%s THINKING_START after %v", input.RunID, time.Since(reqStart))
			case agui.EventTextMessageStart:
				log.Printf("[AGUIHandler] run=%s TEXT_MESSAGE_START (TTFT) after %v", input.RunID, time.Since(reqStart))
			case agui.EventTextMessageContent:
				if !firstContentSeen {
					firstContentSeen = true
					log.Printf("[AGUIHandler] run=%s first TEXT_MESSAGE_CONTENT after %v", input.RunID, time.Since(reqStart))
				}
			}
			h.writeEvent(w, flusher, ev)
			if ev.Type == agui.EventTextMessageEnd {
				finishTimer.Reset(finishWait)
			}
		case <-finishTimer.C:
			log.Printf("[AGUIHandler] run=%s finish timer fired, total elapsed=%v", input.RunID, time.Since(reqStart))
			h.writeEvent(w, flusher, agui.RunFinishedEvent(actualThreadID, input.RunID))
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
