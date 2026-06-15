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
	DEFAULT_PORT = "19090"
)

// SSEEvent represents a single Server-Sent Event
type SSEEvent struct {
	Type       string          `json:"type"`
	Properties json.RawMessage `json:"properties"`
}

// TaskItem represents a single task in a task list
type TaskItem struct {
	ID     string `json:"id"`
	Title  string `json:"title"`
	Status string `json:"status"` // pending | in_progress | completed
}

// MessagePart represents a part of a message
type MessagePart struct {
	ID      string     `json:"id"`
	Type    string     `json:"type"`   // text | reasoning | tool_use | tool_result | context_compression | diff | task_list
	Content string     `json:"content,omitempty"`
	Delta   string     `json:"delta,omitempty"`
	Name    string     `json:"name,omitempty"`    // for tool_use
	Input   string     `json:"input,omitempty"`   // for tool_use
	Output  string     `json:"output,omitempty"`  // for tool_result
	Status  string     `json:"status,omitempty"`  // pending | completed | failed | timeout
	Tasks   []TaskItem `json:"tasks,omitempty"`   // for task_list
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
	log.Fatal(http.ListenAndServe("127.0.0.1:"+port, mux))
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"status":  "ok",
		"version": "mock-2.0.0",
		"scenarios": []string{
			"simple", "thinking", "tool_use",
			"read_code", "write_code",
			"read_markdown", "write_markdown",
			"context_compression", "multi_step",
			"tool_timeout", "network_retry", "error",
			"tool_fail", "network_error",
		},
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
	case "read_code":
		streamReadCode(w, sessionID, promptText)
	case "write_code":
		streamWriteCode(w, sessionID, promptText)
	case "read_markdown":
		streamReadMarkdown(w, sessionID, promptText)
	case "write_markdown":
		streamWriteMarkdown(w, sessionID, promptText)
	case "context_compression":
		streamContextCompression(w, sessionID, promptText)
	case "multi_step":
		streamMultiStep(w, sessionID, promptText)
	case "tool_timeout":
		streamToolTimeout(w, sessionID, promptText)
	case "network_retry":
		streamNetworkRetry(w, sessionID, promptText)
	case "tool_fail":
		streamToolFail(w, sessionID, promptText)
	case "network_error":
		streamNetworkError(w, sessionID, promptText)
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

// ===================== 场景路由 =====================

func chooseScenario(prompt string) string {
	lower := strings.ToLower(prompt)
	switch {
	case strings.Contains(lower, "写代码") || strings.Contains(lower, "write code") || strings.Contains(lower, "create file") || strings.Contains(lower, "新建文件") || strings.Contains(lower, "生成代码") || (strings.Contains(lower, "写") && (strings.Contains(lower, "组件") || strings.Contains(lower, "文件") || strings.Contains(lower, "函数") || strings.Contains(lower, "类"))):
		return "write_code"
	case strings.Contains(lower, "读代码") || strings.Contains(lower, "read code") || strings.Contains(lower, "查看代码") || (strings.Contains(lower, "代码") && (strings.Contains(lower, "看") || strings.Contains(lower, "读"))) || ((strings.Contains(lower, "看") || strings.Contains(lower, "读")) && (strings.Contains(lower, "组件") || strings.Contains(lower, "文件"))):
		return "read_code"
	case strings.Contains(lower, "写md") || strings.Contains(lower, "写markdown") || strings.Contains(lower, "write markdown") || strings.Contains(lower, "写文档") || strings.Contains(lower, "写readme"):
		return "write_markdown"
	case strings.Contains(lower, "读md") || strings.Contains(lower, "读markdown") || strings.Contains(lower, "read markdown") || strings.Contains(lower, "文档") || strings.Contains(lower, "readme") || strings.Contains(lower, "api doc") || strings.Contains(lower, "接口文档"):
		return "read_markdown"
	case strings.Contains(lower, "think") || strings.Contains(lower, "思考") || strings.Contains(lower, "推理") || strings.Contains(lower, "分析"):
		return "thinking"
	case strings.Contains(lower, "压缩") || strings.Contains(lower, "compress") || strings.Contains(lower, "context compression") || (strings.Contains(lower, "上下文") && strings.Contains(lower, "压缩")):
		return "context_compression"
	case strings.Contains(lower, "多步骤") || strings.Contains(lower, "multi step") || strings.Contains(lower, "步骤") || strings.Contains(lower, "plan") || strings.Contains(lower, "规划") || strings.Contains(lower, "执行多个"):
		return "multi_step"
	case strings.Contains(lower, "超时") || strings.Contains(lower, "timeout") || strings.Contains(lower, "慢") || strings.Contains(lower, "slow"):
		return "tool_timeout"
	case strings.Contains(lower, "tool fail") || strings.Contains(lower, "工具失败") || strings.Contains(lower, "调用失败") || strings.Contains(lower, "tool error") || strings.Contains(lower, "工具错误"):
		return "tool_fail"
	case strings.Contains(lower, "network error") || strings.Contains(lower, "网络错误") || strings.Contains(lower, "connection error") || strings.Contains(lower, "连接错误") || strings.Contains(lower, "dns"):
		return "network_error"
	case strings.Contains(lower, "重试") || strings.Contains(lower, "retry") || strings.Contains(lower, "网络") || strings.Contains(lower, "network") || strings.Contains(lower, "断网") || strings.Contains(lower, "失败"):
		return "network_retry"
	case strings.Contains(lower, "tool") || strings.Contains(lower, "file") || strings.Contains(lower, "read") || strings.Contains(lower, "搜索") || strings.Contains(lower, "查找"):
		return "tool_use"
	case strings.Contains(lower, "error") || strings.Contains(lower, "错误"):
		return "error"
	default:
		return "simple"
	}
}

// ===================== 基础工具函数 =====================

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

func sendMessageStart(w http.ResponseWriter, sessionID string) string {
	messageID := generateID()
	sendEvent(w, "message.updated", map[string]any{
		"info": map[string]any{
			"id":        messageID,
			"role":      "assistant",
			"sessionID": sessionID,
			"status":    "in_progress",
		},
	})
	return messageID
}

func sendMessageEnd(w http.ResponseWriter, sessionID string, messageID string) {
	sendEvent(w, "message.updated", map[string]any{
		"info": map[string]any{
			"id":        messageID,
			"role":      "assistant",
			"sessionID": sessionID,
			"status":    "completed",
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

// ===================== 场景: 简单文本 =====================

func streamSimpleText(w http.ResponseWriter, sessionID string, prompt string) {
	messageID := sendMessageStart(w, sessionID)
	partID := generateID()

	response := fmt.Sprintf("这是一个模拟回复。你发送的消息是：\"%s\"\n\n我是 OpenCode Mock Agent，用于测试 Gateway 的流式处理能力。", prompt)
	streamRunes(w, partID, "text", response, 20*time.Millisecond)

	sendMessageEnd(w, sessionID, messageID)
}

// ===================== 场景: Thinking 思考过程 =====================

func streamWithThinking(w http.ResponseWriter, sessionID string, prompt string) {
	messageID := sendMessageStart(w, sessionID)
	thinkingPartID := generateID()
	textPartID := generateID()

	thinkingText := "让我分析一下这个问题...\n1. 用户想要我展示思考过程\n2. 我需要先理解需求\n3. 然后组织一个有逻辑的回答\n\n关键洞察：用户可能在测试 reasoning 块的渲染效果。"
	streamRunes(w, thinkingPartID, "reasoning", thinkingText, 15*time.Millisecond)

	time.Sleep(200 * time.Millisecond)

	response := "基于以上思考，这是一个带有 reasoning 过程的回复。思考块在真实 OpenCode 中会被折叠显示，用户可以展开查看详细推理过程。"
	streamRunes(w, textPartID, "text", response, 20*time.Millisecond)

	sendMessageEnd(w, sessionID, messageID)
}

// ===================== 场景: 工具调用 (通用文件读写) =====================

func streamWithToolUse(w http.ResponseWriter, sessionID string, prompt string) {
	messageID := sendMessageStart(w, sessionID)
	textPartID := generateID()
	toolPartID := generateID()

	initialText := "我来帮你查看一下文件内容。"
	streamRunes(w, textPartID, "text", initialText, 20*time.Millisecond)

	time.Sleep(300 * time.Millisecond)

	// Tool use - read_file
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
		Output: "# Project\n\nThis is a sample project.\n\n## Features\n- Feature A\n- Feature B\n- Feature C",
		Status: "completed",
	})

	time.Sleep(200 * time.Millisecond)

	// Final text
	finalText := "根据文件内容，这是一个示例项目，包含三个主要功能模块。你需要我做什么进一步的操作吗？"
	streamRunes(w, textPartID, "text", initialText+" "+finalText, 20*time.Millisecond)

	sendMessageEnd(w, sessionID, messageID)
}

// ===================== 场景: 读写代码文件 =====================

func streamReadCode(w http.ResponseWriter, sessionID string, prompt string) {
	messageID := sendMessageStart(w, sessionID)
	textPartID := generateID()
	toolReadPartID := generateID()

	introText := "我来读取这个代码文件，分析一下它的结构和逻辑。"
	streamRunes(w, textPartID, "text", introText, 15*time.Millisecond)

	time.Sleep(200 * time.Millisecond)

	// Tool: read_file for code
	sendPartEvent(w, "message.part.updated", MessagePart{
		ID:     toolReadPartID,
		Type:   "tool_use",
		Name:   "read_file",
		Input:  `{"path": "/workspace/src/components/Button.tsx"}`,
		Status: "pending",
	})

	time.Sleep(600 * time.Millisecond)

	// Tool result with code content
	codeContent := sampleButtonCode

	sendPartEvent(w, "message.part.updated", MessagePart{
		ID:     toolReadPartID,
		Type:   "tool_result",
		Output: codeContent,
		Status: "completed",
	})

	time.Sleep(200 * time.Millisecond)

	analysisText := "\n\n这个 Button 组件设计得很好：\n1. 使用了 TypeScript 接口定义 props\n2. 支持三种变体（primary/secondary/danger）\n3. 支持三种尺寸\n4. 使用了 cn 工具函数合并类名\n5. 包含 disabled 状态处理"
	streamRunes(w, textPartID, "text", introText+analysisText, 15*time.Millisecond)

	sendMessageEnd(w, sessionID, messageID)
}

func streamWriteCode(w http.ResponseWriter, sessionID string, prompt string) {
	messageID := sendMessageStart(w, sessionID)
	textPartID := generateID()
	toolWritePartID := generateID()

	introText := "好的，我来为你更新 Modal 对话框组件，添加一个确认按钮。"
	streamRunes(w, textPartID, "text", introText, 15*time.Millisecond)

	time.Sleep(200 * time.Millisecond)

	// Tool: write_file
	sendPartEvent(w, "message.part.updated", MessagePart{
		ID:     toolWritePartID,
		Type:   "tool_use",
		Name:   "write_file",
		Input:  `{"path": "/workspace/src/components/Modal.tsx"}`,
		Status: "pending",
	})

	time.Sleep(800 * time.Millisecond)

	// Tool result - file written
	sendPartEvent(w, "message.part.updated", MessagePart{
		ID:     toolWritePartID,
		Type:   "tool_result",
		Output: "File updated successfully: /workspace/src/components/Modal.tsx (2.6KB)",
		Status: "completed",
	})

	time.Sleep(200 * time.Millisecond)

	// Diff part showing changes
	diffPartID := generateID()
	diffText := sampleModalDiff
	streamRunes(w, diffPartID, "diff", diffText, 8*time.Millisecond)

	time.Sleep(100 * time.Millisecond)

	// Text summary
	finalText := "\n\nModal 组件已更新完成！主要变更：\n- 添加了 `onConfirm` 可选回调属性\n- 当传入 `onConfirm` 时，标题栏会显示确认按钮\n- 保持了向后兼容，未传入时不显示按钮"
	streamRunes(w, textPartID, "text", introText+finalText, 15*time.Millisecond)

	sendMessageEnd(w, sessionID, messageID)
}

// ===================== 场景: 读写 Markdown 文件 =====================

func streamReadMarkdown(w http.ResponseWriter, sessionID string, prompt string) {
	messageID := sendMessageStart(w, sessionID)
	textPartID := generateID()
	toolReadPartID := generateID()

	introText := "我来读取这个 Markdown 文档。"
	streamRunes(w, textPartID, "text", introText, 15*time.Millisecond)

	time.Sleep(200 * time.Millisecond)

	sendPartEvent(w, "message.part.updated", MessagePart{
		ID:     toolReadPartID,
		Type:   "tool_use",
		Name:   "read_file",
		Input:  `{"path": "/workspace/docs/API.md"}`,
		Status: "pending",
	})

	time.Sleep(500 * time.Millisecond)

	mdContent := sampleAPIDoc

	sendPartEvent(w, "message.part.updated", MessagePart{
		ID:     toolReadPartID,
		Type:   "tool_result",
		Output: mdContent,
		Status: "completed",
	})

	time.Sleep(200 * time.Millisecond)

	analysisText := "\n\n这是一份内容丰富的 API 文档，包含了认证方式、Token 作用域、用户和项目的 CRUD 接口、错误码定义（含重试建议）、速率限制说明以及请求示例。"
	streamRunes(w, textPartID, "text", introText+analysisText, 15*time.Millisecond)

	sendMessageEnd(w, sessionID, messageID)
}

func streamWriteMarkdown(w http.ResponseWriter, sessionID string, prompt string) {
	messageID := sendMessageStart(w, sessionID)
	textPartID := generateID()
	toolWritePartID := generateID()

	introText := "我来为你编写一份项目 README 文档。"
	streamRunes(w, textPartID, "text", introText, 15*time.Millisecond)

	time.Sleep(200 * time.Millisecond)

	sendPartEvent(w, "message.part.updated", MessagePart{
		ID:     toolWritePartID,
		Type:   "tool_use",
		Name:   "write_file",
		Input:  `{"path": "/workspace/README.md"}`,
		Status: "pending",
	})

	time.Sleep(600 * time.Millisecond)

	sendPartEvent(w, "message.part.updated", MessagePart{
		ID:     toolWritePartID,
		Type:   "tool_result",
		Output: "File written successfully: /workspace/README.md (3.1KB)",
		Status: "completed",
	})

	time.Sleep(200 * time.Millisecond)

	readmePartID := generateID()
	readmeContent := sampleReadme

	streamRunes(w, readmePartID, "text", readmeContent, 8*time.Millisecond)

	time.Sleep(100 * time.Millisecond)

	finalText := "\n\nREADME 已创建完成！包含了项目介绍、功能特性、技术栈、快速开始指南和架构概览。"
	streamRunes(w, textPartID, "text", introText+finalText, 15*time.Millisecond)

	sendMessageEnd(w, sessionID, messageID)
}

// ===================== 场景: 上下文压缩 =====================

func streamContextCompression(w http.ResponseWriter, sessionID string, prompt string) {
	messageID := sendMessageStart(w, sessionID)
	textPartID := generateID()
	compressionPartID := generateID()

	introText := "对话上下文已超出 token 限制，我需要对历史消息进行压缩。"
	streamRunes(w, textPartID, "text", introText, 15*time.Millisecond)

	time.Sleep(300 * time.Millisecond)

	// Context compression block
	compressionContent := sampleContextCompression

	sendPartEvent(w, "message.part.updated", MessagePart{
		ID:      compressionPartID,
		Type:    "context_compression",
		Content: compressionContent,
		Status:  "completed",
	})

	time.Sleep(200 * time.Millisecond)

	resumeText := "\n\n上下文已压缩完成。系统保留了关键决策点和当前任务状态。我们可以继续讨论会话管理的实现细节。"
	streamRunes(w, textPartID, "text", introText+resumeText, 15*time.Millisecond)

	sendMessageEnd(w, sessionID, messageID)
}

// ===================== 场景: 多步骤任务 =====================

func streamMultiStep(w http.ResponseWriter, sessionID string, prompt string) {
	messageID := sendMessageStart(w, sessionID)
	textPartID := generateID()

	introText := "好的，我来帮你完成这个多步骤任务。让我先规划一下执行步骤。"
	streamRunes(w, textPartID, "text", introText, 15*time.Millisecond)

	time.Sleep(300 * time.Millisecond)

	tasks := []TaskItem{
		{ID: "task-1", Title: "读取项目配置文件", Status: "pending"},
		{ID: "task-2", Title: "安装缺失的依赖包", Status: "pending"},
		{ID: "task-3", Title: "创建 API 客户端封装", Status: "pending"},
	}

	taskListPartID := generateID()

	// Initial task list
	sendPartEvent(w, "message.part.updated", MessagePart{
		ID:    taskListPartID,
		Type:  "task_list",
		Tasks: tasks,
	})

	time.Sleep(400 * time.Millisecond)

	for i := range tasks {
		// Mark current task as in_progress
		tasks[i].Status = "in_progress"
		sendPartEvent(w, "message.part.updated", MessagePart{
			ID:    taskListPartID,
			Type:  "task_list",
			Tasks: tasks,
		})
		time.Sleep(500 * time.Millisecond)

		// Mark current task as completed
		tasks[i].Status = "completed"
		sendPartEvent(w, "message.part.updated", MessagePart{
			ID:    taskListPartID,
			Type:  "task_list",
			Tasks: tasks,
		})
		time.Sleep(200 * time.Millisecond)
	}

	// Final summary
	finalText := "\n\n所有步骤执行完成！\n\n总结：\n1. 读取了 package.json 配置\n2. 安装了 axios 和 lodash 依赖\n3. 创建了 API 客户端封装\n\n你可以继续使用这些新添加的功能。"
	streamRunes(w, textPartID, "text", introText+finalText, 15*time.Millisecond)

	sendMessageEnd(w, sessionID, messageID)
}

// ===================== 场景: 工具调用超时 =====================

func streamToolTimeout(w http.ResponseWriter, sessionID string, prompt string) {
	messageID := sendMessageStart(w, sessionID)
	textPartID := generateID()
	timeoutToolPartID := generateID()

	introText := "我来执行一个可能会耗时的数据库查询操作。"
	streamRunes(w, textPartID, "text", introText, 15*time.Millisecond)

	time.Sleep(200 * time.Millisecond)

	// Tool starts
	sendPartEvent(w, "message.part.updated", MessagePart{
		ID:     timeoutToolPartID,
		Type:   "tool_use",
		Name:   "execute_command",
		Input:  `{"command": "db.query('SELECT * FROM large_table')"}`,
		Status: "pending",
	})

	// Simulate long wait with progress dots
	for i := 0; i < 5; i++ {
		time.Sleep(800 * time.Millisecond)
		progressText := fmt.Sprintf("\n查询执行中%s", strings.Repeat(".", i+1))
		streamRunes(w, textPartID, "text", introText+progressText, 5*time.Millisecond)
	}

	time.Sleep(1000 * time.Millisecond)

	// Tool timeout
	sendPartEvent(w, "message.part.updated", MessagePart{
		ID:     timeoutToolPartID,
		Type:   "tool_result",
		Output: "Error: command execution timeout after 30s\nThe database query took too long to complete. Consider adding indexes or limiting the result set.",
		Status: "timeout",
	})

	time.Sleep(200 * time.Millisecond)

	// Fallback response
	fallbackText := "\n\n查询超时了（30秒）。建议：\n1. 添加合适的索引优化查询性能\n2. 使用 LIMIT 限制返回结果数量\n3. 考虑分页查询\n4. 检查数据库连接池配置"
	streamRunes(w, textPartID, "text", introText+fallbackText, 15*time.Millisecond)

	sendMessageEnd(w, sessionID, messageID)
}

// ===================== 场景: 网络错误重试 =====================

func streamNetworkRetry(w http.ResponseWriter, sessionID string, prompt string) {
	messageID := sendMessageStart(w, sessionID)
	textPartID := generateID()
	retryToolPartID := generateID()

	introText := "我来调用外部 API 获取数据。"
	streamRunes(w, textPartID, "text", introText, 15*time.Millisecond)

	time.Sleep(200 * time.Millisecond)

	// Attempt 1 - fail
	sendPartEvent(w, "message.part.updated", MessagePart{
		ID:     retryToolPartID,
		Type:   "tool_use",
		Name:   "fetch_url",
		Input:  `{"url": "https://api.example.com/data"}`,
		Status: "pending",
	})

	time.Sleep(400 * time.Millisecond)

	retry1Text := "\n\n第 1 次尝试... 连接失败 (ECONNREFUSED)"
	streamRunes(w, textPartID, "text", introText+retry1Text, 10*time.Millisecond)

	sendPartEvent(w, "message.part.updated", MessagePart{
		ID:     retryToolPartID,
		Type:   "tool_result",
		Output: "Error: connection refused (attempt 1/3)",
		Status: "failed",
	})

	time.Sleep(500 * time.Millisecond)

	// Attempt 2 - fail
	retry2Text := "\n等待 1 秒后重试..."
	streamRunes(w, textPartID, "text", introText+retry1Text+retry2Text, 10*time.Millisecond)

	sendPartEvent(w, "message.part.updated", MessagePart{
		ID:     retryToolPartID,
		Type:   "tool_use",
		Name:   "fetch_url",
		Input:  `{"url": "https://api.example.com/data"}`,
		Status: "pending",
	})

	time.Sleep(400 * time.Millisecond)

	retry2FailText := "\n第 2 次尝试... 网络超时 (ETIMEDOUT)"
	streamRunes(w, textPartID, "text", introText+retry1Text+retry2Text+retry2FailText, 10*time.Millisecond)

	sendPartEvent(w, "message.part.updated", MessagePart{
		ID:     retryToolPartID,
		Type:   "tool_result",
		Output: "Error: request timeout (attempt 2/3)",
		Status: "failed",
	})

	time.Sleep(500 * time.Millisecond)

	// Attempt 3 - success
	retry3Text := "\n等待 2 秒后再次重试..."
	streamRunes(w, textPartID, "text", introText+retry1Text+retry2Text+retry2FailText+retry3Text, 10*time.Millisecond)

	sendPartEvent(w, "message.part.updated", MessagePart{
		ID:     retryToolPartID,
		Type:   "tool_use",
		Name:   "fetch_url",
		Input:  `{"url": "https://api.example.com/data"}`,
		Status: "pending",
	})

	time.Sleep(600 * time.Millisecond)

	retry3SuccessText := "\n第 3 次尝试... 成功！"
	streamRunes(w, textPartID, "text", introText+retry1Text+retry2Text+retry2FailText+retry3Text+retry3SuccessText, 10*time.Millisecond)

	apiData := `{
  "data": [
    {"id": 1, "name": "Project Alpha", "status": "active"},
    {"id": 2, "name": "Project Beta", "status": "completed"},
    {"id": 3, "name": "Project Gamma", "status": "in_progress"}
  ],
  "total": 3,
  "page": 1
}`

	sendPartEvent(w, "message.part.updated", MessagePart{
		ID:     retryToolPartID,
		Type:   "tool_result",
		Output: apiData,
		Status: "completed",
	})

	time.Sleep(200 * time.Millisecond)

	finalText := "\n\n虽然前两次尝试失败了（连接拒绝、网络超时），但第 3 次重试成功！\n\n获取到 3 个项目数据：\n- Project Alpha (active)\n- Project Beta (completed)\n- Project Gamma (in_progress)"
	streamRunes(w, textPartID, "text", introText+finalText, 15*time.Millisecond)

	sendMessageEnd(w, sessionID, messageID)
}

// ===================== 场景: 错误 =====================

func streamError(w http.ResponseWriter, sessionID string) {
	sendEvent(w, "session.error", map[string]any{
		"error": map[string]any{
			"message": "模拟错误：处理请求时发生异常",
			"code":    500,
		},
	})
}

// ===================== 场景: 工具调用失败 =====================

func streamToolFail(w http.ResponseWriter, sessionID string, prompt string) {
	messageID := sendMessageStart(w, sessionID)
	textPartID := generateID()
	toolPartID := generateID()

	introText := "我来运行测试套件，检查当前代码的覆盖率。"
	streamRunes(w, textPartID, "text", introText, 15*time.Millisecond)

	time.Sleep(200 * time.Millisecond)

	// Tool starts
	sendPartEvent(w, "message.part.updated", MessagePart{
		ID:     toolPartID,
		Type:   "tool_use",
		Name:   "execute_command",
		Input:  `{"command": "npm test -- --coverage"}`,
		Status: "pending",
	})

	time.Sleep(600 * time.Millisecond)

	// Tool fails
	sendPartEvent(w, "message.part.updated", MessagePart{
		ID:     toolPartID,
		Type:   "tool_result",
		Output: "Error: Test suite failed\n\nFAIL src/utils/math.test.ts\n  ● add › should return sum of two numbers\n    Expected: 3\n    Received: 2\n\n    at Object.<anonymous> (src/utils/math.test.ts:4:21)\n\nTest Suites: 1 failed, 1 total\nTests:       1 failed, 1 total",
		Status: "failed",
	})

	time.Sleep(200 * time.Millisecond)

	finalText := "\n\n测试运行失败！错误原因：\n1. `math.test.ts` 中的加法测试未通过\n2. 预期结果为 3，实际得到 2\n3. 请检查 `src/utils/math.ts` 中的 `add` 函数实现"
	streamRunes(w, textPartID, "text", introText+finalText, 15*time.Millisecond)

	sendMessageEnd(w, sessionID, messageID)
}

// ===================== 场景: 网络错误（多次重试均失败） =====================

func streamNetworkError(w http.ResponseWriter, sessionID string, prompt string) {
	messageID := sendMessageStart(w, sessionID)
	textPartID := generateID()
	toolPartID := generateID()

	introText := "我来调用外部 API 获取数据。"
	streamRunes(w, textPartID, "text", introText, 15*time.Millisecond)

	time.Sleep(200 * time.Millisecond)

	// Attempt 1 - DNS error
	sendPartEvent(w, "message.part.updated", MessagePart{
		ID:     toolPartID,
		Type:   "tool_use",
		Name:   "fetch_url",
		Input:  `{"url": "https://api.example.com/data"}`,
		Status: "pending",
	})

	time.Sleep(400 * time.Millisecond)

	retry1Text := "\n\n第 1 次尝试... DNS 解析失败"
	streamRunes(w, textPartID, "text", introText+retry1Text, 10*time.Millisecond)

	sendPartEvent(w, "message.part.updated", MessagePart{
		ID:     toolPartID,
		Type:   "tool_result",
		Output: "Error: getaddrinfo ENOTFOUND api.example.com (attempt 1/3)",
		Status: "failed",
	})

	time.Sleep(500 * time.Millisecond)

	// Attempt 2 - timeout
	retry2Text := "\n等待 1 秒后重试..."
	streamRunes(w, textPartID, "text", introText+retry1Text+retry2Text, 10*time.Millisecond)

	sendPartEvent(w, "message.part.updated", MessagePart{
		ID:     toolPartID,
		Type:   "tool_use",
		Name:   "fetch_url",
		Input:  `{"url": "https://api.example.com/data"}`,
		Status: "pending",
	})

	time.Sleep(400 * time.Millisecond)

	retry2FailText := "\n第 2 次尝试... 连接超时 (ETIMEDOUT)"
	streamRunes(w, textPartID, "text", introText+retry1Text+retry2Text+retry2FailText, 10*time.Millisecond)

	sendPartEvent(w, "message.part.updated", MessagePart{
		ID:     toolPartID,
		Type:   "tool_result",
		Output: "Error: connect ETIMEDOUT 203.0.113.45:443 (attempt 2/3)",
		Status: "failed",
	})

	time.Sleep(500 * time.Millisecond)

	// Attempt 3 - connection reset
	retry3Text := "\n等待 2 秒后再次重试..."
	streamRunes(w, textPartID, "text", introText+retry1Text+retry2Text+retry2FailText+retry3Text, 10*time.Millisecond)

	sendPartEvent(w, "message.part.updated", MessagePart{
		ID:     toolPartID,
		Type:   "tool_use",
		Name:   "fetch_url",
		Input:  `{"url": "https://api.example.com/data"}`,
		Status: "pending",
	})

	time.Sleep(400 * time.Millisecond)

	retry3FailText := "\n第 3 次尝试... 连接被重置 (ECONNRESET)"
	streamRunes(w, textPartID, "text", introText+retry1Text+retry2Text+retry2FailText+retry3Text+retry3FailText, 10*time.Millisecond)

	sendPartEvent(w, "message.part.updated", MessagePart{
		ID:     toolPartID,
		Type:   "tool_result",
		Output: "Error: read ECONNRESET (attempt 3/3)",
		Status: "failed",
	})

	time.Sleep(200 * time.Millisecond)

	finalText := "\n\n多次重试后仍然无法连接到外部 API：\n1. DNS 解析失败\n2. 连接超时\n3. 连接被重置\n\n请检查网络配置或稍后重试。"
	streamRunes(w, textPartID, "text", introText+finalText, 15*time.Millisecond)

	sendMessageEnd(w, sessionID, messageID)
}

// ===================== 示例数据常量 =====================

var (
	sampleButtonCode = `// Button.tsx
import React from 'react';
import { cn } from '@/lib/utils';

export interface ButtonProps {
  variant?: 'primary' | 'secondary' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'md',
  children,
  onClick,
  disabled = false,
}) => {
  return (
    <button
      className={cn(
        'rounded-lg font-medium transition-colors',
        {
          'bg-blue-500 text-white hover:bg-blue-600': variant === 'primary',
          'bg-gray-200 text-gray-800 hover:bg-gray-300': variant === 'secondary',
          'bg-red-500 text-white hover:bg-red-600': variant === 'danger',
        },
        {
          'px-3 py-1 text-sm': size === 'sm',
          'px-4 py-2 text-base': size === 'md',
          'px-6 py-3 text-lg': size === 'lg',
        },
        'disabled:opacity-50 disabled:cursor-not-allowed'
      )}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
};`

	sampleModalCode = `// Modal.tsx
import React, { useEffect } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

export const Modal: React.FC<ModalProps> = ({
  isOpen, onClose, title, children
}) => {
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = '';
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-2xl max-w-lg w-full mx-4 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">{title}</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
};`

	sampleAPIDoc = `# API Documentation

## Overview

Welcome to the **DeepHarness API**. This guide covers authentication, endpoints, error handling, and rate limits.

## Table of Contents

1. Authentication
2. Endpoints
3. Error Codes
4. Rate Limiting

---

## Authentication

All API requests require a Bearer token in the Authorization header.

` + "```http\nGET /api/v1/users\nAuthorization: Bearer <token>\n```" + `

### Token Scopes

| Scope | Description |
|-------|-------------|
| read  | Read access to resources |
| write | Write access to resources |
| admin | Full administrative access |

---

## Endpoints

### Users

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET    | /api/v1/users | List all users |
| POST   | /api/v1/users | Create a new user |
| GET    | /api/v1/users/:id | Get user by ID |
| PUT    | /api/v1/users/:id | Update user |
| DELETE | /api/v1/users/:id | Delete user |

#### Example Request

` + "```bash\ncurl -H \"Authorization: Bearer <token>\" \\\n     https://api.example.com/api/v1/users\n```" + `

#### Example Response

` + "```json\n{\n  \"data\": [\n    {\"id\": 1, \"name\": \"Alice\"},\n    {\"id\": 2, \"name\": \"Bob\"}\n  ],\n  \"total\": 2\n}\n```" + `

### Projects

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET    | /api/v1/projects | List all projects |
| POST   | /api/v1/projects | Create a new project |

---

## Error Codes

| Code | Description | Retry |
|------|-------------|-------|
| 400  | Bad Request | No |
| 401  | Unauthorized | No |
| 403  | Forbidden | No |
| 404  | Not Found | No |
| 429  | Too Many Requests | Yes |
| 500  | Internal Server Error | Yes |

---

## Rate Limiting

- **Authenticated users**: 100 requests per minute
- **Unauthenticated users**: 10 requests per minute

> Exceeding the limit returns 429 Too Many Requests.

## Notes

- Ensure your token is kept secure.
- Use pagination for large result sets.
- Contact support if you encounter persistent 500 errors.
`

	sampleReadme = `# DeepHarness Enterprise Platform

AI-driven multi-tenant coding assistance platform for development teams.

## Features

- AI Chat: Multi-turn conversations with context awareness
- Data Dashboard: Real-time project metrics and insights
- Smart Review: Automated code review and PR analysis
- Project Management: Integrated workitem tracking
- Multi-tenant: Secure workspace isolation

## Tech Stack

### Frontend
- React 18 + TypeScript
- Tailwind CSS + shadcn/ui
- Vite + Rolldown

### Backend
- Go 1.22
- Standard library HTTP server
- DDD architecture

## Quick Start

    # Install dependencies
    pnpm install

    # Start development server
    pnpm dev

## Architecture

    .
    |-- apps/web/              # Frontend application
    |-- services/              # Backend microservices
    |-- packages/              # Shared packages
    |-- infra/                 # Infrastructure config

## License

MIT License - see LICENSE for details.`

	sampleContextCompression = `【上下文摘要】
用户要求构建一个多租户 AI 编码平台。
已完成：
- 前端框架选型 (React + Vite)
- UI 组件库搭建 (shadcn/ui)
- 基础路由和布局
- API 网关设计

当前讨论：
- 会话管理 WebSocket 实现
- Agent 流式消息处理
- 消息合并与打字机效果`

	sampleModalDiff = `--- /workspace/src/components/Modal.tsx
+++ /workspace/src/components/Modal.tsx
@@ -5,6 +5,7 @@
 interface ModalProps {
   isOpen: boolean;
   onClose: () => void;
+  onConfirm?: () => void;
   title: string;
   children: React.ReactNode;
 }
@@ -30,6 +31,12 @@
           <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg">
             <X className="w-5 h-5" />
           </button>
+          {onConfirm && (
+            <button onClick={onConfirm} className="ml-2 px-4 py-2 bg-blue-500 text-white rounded-lg">
+              Confirm
+            </button>
+          )}
         </div>
         {children}
       </div>
`
)
