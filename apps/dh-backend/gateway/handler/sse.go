package handler

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/agui/buffer"
)

// SSEReplayHandler 回放缓冲的 AG-UI 事件，用于前端断连后恢复会话状态。
type SSEReplayHandler struct {
	buffer buffer.SSEBuffer
}

func NewSSEReplayHandler(buf buffer.SSEBuffer) *SSEReplayHandler {
	return &SSEReplayHandler{buffer: buf}
}

// ServeSSE 处理 GET /api/v1/sessions/{id}/sse。
// 原子地返回该 session 所有缓冲事件并清除 buffer。
func (h *SSEReplayHandler) ServeSSE(w http.ResponseWriter, r *http.Request) {
	sessionID := r.PathValue("id")
	if sessionID == "" {
		http.Error(w, `{"code":1,"message":"missing session id"}`, http.StatusBadRequest)
		return
	}

	events, err := h.buffer.PopPending(r.Context(), sessionID)
	if err != nil {
		log.Printf("[SSEReplay] PopPending failed: %v", err)
		http.Error(w, `{"code":1,"message":"internal error"}`, http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.WriteHeader(http.StatusOK)

	flusher, ok := w.(http.Flusher)
	if !ok {
		return
	}

	if len(events) == 0 {
		fmt.Fprintf(w, "data: %s\n\n", `{"type":"NO_PENDING_EVENTS"}`)
		flusher.Flush()
		return
	}

	log.Printf("[SSEReplay] replaying %d events for session %s", len(events), sessionID)
	for _, ev := range events {
		data, err := json.Marshal(ev)
		if err != nil {
			log.Printf("[SSEReplay] marshal event failed: %v", err)
			continue
		}
		fmt.Fprintf(w, "data: %s\n\n", data)
		flusher.Flush()
	}
}
