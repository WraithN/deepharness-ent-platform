package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"
)

const (
	DEFAULT_PORT = "9090"
)

// SSEEvent represents a single Server-Sent Event
type SSEEvent struct {
	Type       string          `json:"type"`
	Properties json.RawMessage `json:"properties"`
}

// MessagePart represents a part of a message
type MessagePart struct {
	ID      string `json:"id"`
	Type    string `json:"type"`   // text | reasoning | tool_use | tool_result
	Content string `json:"content,omitempty"`
	Delta   string `json:"delta,omitempty"`
	Name    string `json:"name,omitempty"`    // for tool_use
	Input   string `json:"input,omitempty"`   // for tool_use
	Output  string `json:"output,omitempty"`  // for tool_result
	Status  string `json:"status,omitempty"`  // pending | completed | failed
}

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = DEFAULT_PORT
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", handleHealth)
	mux.HandleFunc("/session/", handleSession)
	mux.HandleFunc("/event", handleGlobalEvent)

	log.Printf("Agent Mock Service starting on port %s", port)
	log.Fatal(http.ListenAndServe(":"+port, mux))
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"status":  "ok",
		"version": "mock-1.0.0",
	})
}

func handleGlobalEvent(w http.ResponseWriter, r *http.Request) {
	setupSSE(w)
	
	sendEvent(w, "server.connected", map[string]any{
		"timestamp": time.Now().Unix(),
	})
	
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	
	for {
		select {
		case <-ticker.C:
			sendEvent(w, "heartbeat", map[string]any{
				"timestamp": time.Now().Unix(),
			})
		case <-r.Context().Done():
			return
		}
	}
}

func handleSession(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/session/")
	parts := strings.Split(path, "/")
	if len(parts) < 1 || parts[0] == "" {
		http.Error(w, `{"error":"invalid session id"}`, http.StatusBadRequest)
		return
	}
	
	sessionID := parts[0]
	
	switch {
	case len(parts) == 1 && r.Method == http.MethodPost:
		handleCreateSession(w, r, sessionID)
	case len(parts) >= 2 && parts[1] == "prompt" && r.Method == http.MethodPost:
		handlePrompt(w, r, sessionID)
	case len(parts) >= 2 && parts[1] == "prompt_async" && r.Method == http.MethodPost:
		w.WriteHeader(http.StatusNoContent)
	default:
		http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
	}
}

func handleCreateSession(w http.ResponseWriter, r *http.Request, sessionID string) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"id":        sessionID,
		"status":    "active",
		"createdAt": time.Now().Format(time.RFC3339),
	})
}

func handlePrompt(w http.ResponseWriter, r *http.Request, sessionID string) {
	var req struct {
		Parts []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"parts"`
	}
	
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid request"}`, http.StatusBadRequest)
		return
	}
	
	var promptText string
	for _, part := range req.Parts {
		if part.Type == "text" {
			promptText = part.Text
			break
		}
	}
	
	setupSSE(w)
	
	scenario := chooseScenario(promptText)
	log.Printf("[Session %s] Running scenario: %s (prompt: %s)", sessionID, scenario, truncate(promptText, 50))
	
	switch scenario {
	case "thinking":
		streamWithThinking(w, sessionID, promptText)
	case "tool_use":
		streamWithToolUse(w, sessionID, promptText)
	case "error":
		streamError(w, sessionID)
	default:
		streamSimpleText(w, sessionID, promptText)
	}
}

func setupSSE(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.WriteHeader(http.StatusOK)
	
	if f, ok := w.(http.Flusher); ok {
		f.Flush()
	}
}

func sendEvent(w http.ResponseWriter, eventType string, properties map[string]any) {
	ev := SSEEvent{
		Type: eventType,
	}
	if properties != nil {
		data, _ := json.Marshal(properties)
		ev.Properties = data
	}
	
	payload, _ := json.Marshal(ev)
	fmt.Fprintf(w, "data: %s\n\n", payload)
	
	if f, ok := w.(http.Flusher); ok {
		f.Flush()
	}
}

func sendPartEvent(w http.ResponseWriter, eventType string, part MessagePart) {
	properties := map[string]any{
		"sessionID": part.ID[:8] + "...",
		"part":      part,
	}
	if part.Delta != "" {
		properties["delta"] = part.Delta
	}
	sendEvent(w, eventType, properties)
}

func chooseScenario(prompt string) string {
	lower := strings.ToLower(prompt)
	switch {
	case strings.Contains(lower, "think") || strings.Contains(lower, "思考"):
		return "thinking"
	case strings.Contains(lower, "tool") || strings.Contains(lower, "file") || strings.Contains(lower, "read") || strings.Contains(lower, "搜索"):
		return "tool_use"
	case strings.Contains(lower, "error") || strings.Contains(lower, "错误"):
		return "error"
	default:
		return "simple"
	}
}

// streamRunes streams text rune by rune to avoid UTF-8 slicing issues
func streamRunes(w http.ResponseWriter, partID string, partType string, text string, delay time.Duration) {
	runes := []rune(text)
	var accumulated []rune
	
	for _, r := range runes {
		accumulated = append(accumulated, r)
		sendPartEvent(w, "message.part.updated", MessagePart{
			ID:      partID,
			Type:    partType,
			Content: string(accumulated),
			Delta:   string(r),
		})
		time.Sleep(delay)
	}
}

// Scenario: Simple text response
func streamSimpleText(w http.ResponseWriter, sessionID string, prompt string) {
	messageID := generateID()
	partID := generateID()
	
	sendEvent(w, "message.updated", map[string]any{
		"info": map[string]any{
			"id":        messageID,
			"role":      "assistant",
			"sessionID": sessionID,
			"status":    "in_progress",
		},
	})
	
	response := fmt.Sprintf("这是一个模拟回复。你发送的消息是：\"%s\"\n\n我是 OpenCode Mock Agent，用于测试 Gateway 的流式处理能力。", prompt)
	streamRunes(w, partID, "text", response, 20*time.Millisecond)
	
	sendEvent(w, "message.updated", map[string]any{
		"info": map[string]any{
			"id":        messageID,
			"role":      "assistant",
			"sessionID": sessionID,
			"status":    "completed",
		},
	})
}

// Scenario: Text with thinking/reasoning
func streamWithThinking(w http.ResponseWriter, sessionID string, prompt string) {
	messageID := generateID()
	thinkingPartID := generateID()
	textPartID := generateID()
	
	sendEvent(w, "message.updated", map[string]any{
		"info": map[string]any{
			"id":        messageID,
			"role":      "assistant",
			"sessionID": sessionID,
			"status":    "in_progress",
		},
	})
	
	thinkingText := "让我分析一下这个问题... 用户想要我展示思考过程。我需要先理解需求，然后组织一个有逻辑的回答。"
	streamRunes(w, thinkingPartID, "reasoning", thinkingText, 15*time.Millisecond)
	
	time.Sleep(200 * time.Millisecond)
	
	response := "基于以上思考，这是一个带有 reasoning 过程的回复。思考块在真实 OpenCode 中会被折叠显示。"
	streamRunes(w, textPartID, "text", response, 20*time.Millisecond)
	
	sendEvent(w, "message.updated", map[string]any{
		"info": map[string]any{
			"id":        messageID,
			"role":      "assistant",
			"sessionID": sessionID,
			"status":    "completed",
		},
	})
}

// Scenario: Tool use
func streamWithToolUse(w http.ResponseWriter, sessionID string, prompt string) {
	messageID := generateID()
	textPartID := generateID()
	toolPartID := generateID()
	
	sendEvent(w, "message.updated", map[string]any{
		"info": map[string]any{
			"id":        messageID,
			"role":      "assistant",
			"sessionID": sessionID,
			"status":    "in_progress",
		},
	})
	
	initialText := "我来帮你查看一下文件内容。"
	streamRunes(w, textPartID, "text", initialText, 20*time.Millisecond)
	
	time.Sleep(300 * time.Millisecond)
	
	// Tool use
	sendPartEvent(w, "message.part.updated", MessagePart{
		ID:     toolPartID,
		Type:   "tool_use",
		Name:   "read_file",
		Input:  `{"path": "/workspace/README.md"}`,
		Status: "pending",
	})
	
	time.Sleep(500 * time.Millisecond)
	
	// Tool result
	sendPartEvent(w, "message.part.updated", MessagePart{
		ID:     toolPartID,
		Type:   "tool_result",
		Output: "# Project\n\nThis is a sample project.",
		Status: "completed",
	})
	
	time.Sleep(200 * time.Millisecond)
	
	// Final text - accumulate after initial text
	finalText := "根据文件内容，这是一个示例项目。你需要我做什么进一步的操作吗？"
	streamRunes(w, textPartID, "text", initialText+finalText, 20*time.Millisecond)
	
	sendEvent(w, "message.updated", map[string]any{
		"info": map[string]any{
			"id":        messageID,
			"role":      "assistant",
			"sessionID": sessionID,
			"status":    "completed",
		},
	})
}

// Scenario: Error
func streamError(w http.ResponseWriter, sessionID string) {
	sendEvent(w, "session.error", map[string]any{
		"error": map[string]any{
			"message": "模拟错误：处理请求时发生异常",
			"code":    500,
		},
	})
}

func generateID() string {
	return fmt.Sprintf("mock-%d", time.Now().UnixNano())
}

func truncate(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "..."
}
