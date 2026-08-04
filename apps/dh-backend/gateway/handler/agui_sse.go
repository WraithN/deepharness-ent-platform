package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/agui"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/chat"
)

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

// streamChatResponse 将闲聊回复以 AG-UI SSE 事件格式流式发送给前端。
// 生成完整的 TEXT_MESSAGE_START -> TEXT_MESSAGE_CONTENT -> TEXT_MESSAGE_END -> RUN_FINISHED 事件序列。
func (h *AGUIHandler) streamChatResponse(ctx context.Context, w http.ResponseWriter, flusher http.Flusher, response, sessionID, runID string) {
	messageID := generateMessageID()

	// 构建并发送事件序列。
	events := []agui.Event{
		{Type: agui.EventTextMessageStart, MessageID: messageID, Role: "assistant", ThreadID: sessionID, RunID: runID},
	}

	// 将回复按行分段发送，模拟流式输出效果。
	lines := strings.Split(response, "\n")
	for _, line := range lines {
		events = append(events, agui.Event{
			Type:      agui.EventTextMessageContent,
			MessageID: messageID,
			Delta:     line + "\n",
			ThreadID:  sessionID,
			RunID:     runID,
		})
	}

	events = append(events,
		agui.Event{Type: agui.EventTextMessageEnd, MessageID: messageID, ThreadID: sessionID, RunID: runID},
		agui.Event{Type: agui.EventRunFinished, ThreadID: sessionID, RunID: runID},
	)

	// 逐个写入 SSE 并缓冲。
	for _, ev := range events {
		data, err := json.Marshal(ev)
		if err != nil {
			log.Printf("[AGUIHandler] marshal chat event failed: %v", err)
			continue
		}
		fmt.Fprintf(w, "data: %s\n\n", data)
		flusher.Flush()

		// 缓冲事件供前端重连时回放。
		if h.buffer != nil {
			if err := h.buffer.Append(ctx, sessionID, ev); err != nil {
				log.Printf("[AGUIHandler] buffer chat event failed: %v", err)
			}
		}
	}

	// 持久化助手消息。
	assistantMsg := chat.Message{
		ID:        messageID,
		SessionID: sessionID,
		Role:      "assistant",
		Type:      "text",
		Content:   response,
		Timestamp: time.Now(),
	}
	if h.messages != nil {
		if err := h.messages.Append(ctx, sessionID, assistantMsg); err != nil {
			log.Printf("[AGUIHandler] save chat assistant message failed: %v", err)
		}
	}

	log.Printf("[AGUIHandler] chat response streamed: session=%s run=%s len=%d", sessionID, runID, len(response))
}
