// Package agui 定义 AG-UI (Agent-User Interaction) 协议的类型。
// 与 ent-desktop gatewayd 的协议保持一致：
// https://github.com/ag-ui-protocol/ag-ui
package agui

import (
	"encoding/json"
	"fmt"
	"math/rand"
	"strings"
	"time"
)

// MessageRole 表示 AG-UI 消息角色。
type MessageRole string

const (
	RoleDeveloper MessageRole = "developer"
	RoleSystem    MessageRole = "system"
	RoleAssistant MessageRole = "assistant"
	RoleUser      MessageRole = "user"
	RoleTool      MessageRole = "tool"
)

// Message 是 AG-UI 标准消息。
// 为了兼容不同 role 的字段差异，使用可选字段承载 content/toolCalls/toolCallId 等。
// Content 使用 json.RawMessage 以同时兼容字符串与 content-block 数组（AG-UI 标准）。
type Message struct {
	Role       MessageRole     `json:"role"`
	ID         string          `json:"id"`
	Content    json.RawMessage `json:"content,omitempty"`
	Name       string          `json:"name,omitempty"`
	ToolCalls  json.RawMessage `json:"toolCalls,omitempty"`
	ToolCallID string          `json:"toolCallId,omitempty"`
	Error      string          `json:"error,omitempty"`
}

// UserMessage 快速构造一条用户消息（字符串内容）。
func UserMessage(id, content string) Message {
	if id == "" {
		id = generateID()
	}
	return Message{Role: RoleUser, ID: id, Content: json.RawMessage(fmt.Sprintf("%q", content))}
}

// ContentText 将 Content 解析为纯文本。
// 支持字符串直接内容或 AG-UI 的 [{"type":"text","text":"..."}, ...] 数组。
func (m Message) ContentText() string {
	if len(m.Content) == 0 {
		return ""
	}

	// 尝试解析为字符串（包括 JSON 编码的字符串）。
	var s string
	if err := json.Unmarshal(m.Content, &s); err == nil {
		return s
	}

	// 尝试解析为 content-block 数组。
	var blocks []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	}
	if err := json.Unmarshal(m.Content, &blocks); err != nil {
		return string(m.Content)
	}

	var texts []string
	for _, b := range blocks {
		if b.Type == "text" || b.Type == "" {
			texts = append(texts, b.Text)
		}
	}
	return strings.Join(texts, "")
}

// ToGatewaydMessage 转换为 gatewayd 接受的字符串 content 消息结构。
func (m Message) ToGatewaydMessage() map[string]any {
	content := m.ContentText()
	msg := map[string]any{
		"role":    string(m.Role),
		"id":      m.ID,
		"content": content,
		"name":    m.Name,
	}
	// gatewayd 要求 tool 角色消息必须携带 toolCallId，否则反序列化失败。
	if m.Role == RoleTool && m.ToolCallID != "" {
		msg["toolCallId"] = m.ToolCallID
	}
	return msg
}

// Tool 定义 RunAgentInput 中携带的工具。
type Tool struct {
	Name        string          `json:"name"`
	Description string          `json:"description,omitempty"`
	Parameters  json.RawMessage `json:"parameters"`
}

// ContextItem 是 RunAgentInput 中的上下文项。
type ContextItem struct {
	Name  string          `json:"name"`
	Value json.RawMessage `json:"value"`
}

// RunAgentInput 是启动 AG-UI agent run 的输入。
type RunAgentInput struct {
	ThreadID       string          `json:"threadId"`
	RunID          string          `json:"runId,omitempty"`
	State          json.RawMessage `json:"state"`
	Messages       []Message       `json:"messages"`
	Tools          []Tool          `json:"tools"`
	Context        []ContextItem   `json:"context"`
	ForwardedProps json.RawMessage `json:"forwardedProps"`
	// AgentPluginKey 指定要使用的 gatewayd agent 插件，如 claude-code、opencode、codex。
	// 为空时由后端使用默认值。
	AgentPluginKey string `json:"agentPluginKey,omitempty"`
	// AgentKey 与 AgentPluginKey 同义，优先使用 agent_key，便于前端统一字段命名。
	AgentKey string `json:"agent_key,omitempty"`

	// Workspace 仅在 dh-backend 内部使用，用于向 gatewayd 挂载 agent 时指定工作目录。
	// 该字段不会被序列化到 gatewayd。
	Workspace string `json:"-"`

}

// EventType 是 AG-UI 事件类型枚举。
type EventType string

const (
	EventRunStarted                 EventType = "RUN_STARTED"
	EventRunFinished                EventType = "RUN_FINISHED"
	EventRunError                   EventType = "RUN_ERROR"
	EventTextMessageStart           EventType = "TEXT_MESSAGE_START"
	EventTextMessageContent         EventType = "TEXT_MESSAGE_CONTENT"
	EventTextMessageEnd             EventType = "TEXT_MESSAGE_END"
	EventThinkingStart              EventType = "THINKING_START"
	EventThinkingEnd                EventType = "THINKING_END"
	EventThinkingTextMessageStart   EventType = "THINKING_TEXT_MESSAGE_START"
	EventThinkingTextMessageContent EventType = "THINKING_TEXT_MESSAGE_CONTENT"
	EventThinkingTextMessageEnd     EventType = "THINKING_TEXT_MESSAGE_END"
	EventToolCallStart              EventType = "TOOL_CALL_START"
	EventToolCallArgs               EventType = "TOOL_CALL_ARGS"
	EventToolCallEnd                EventType = "TOOL_CALL_END"
	EventToolCallResult             EventType = "TOOL_CALL_RESULT"
	EventStateSnapshot              EventType = "STATE_SNAPSHOT"
	EventStateDelta                 EventType = "STATE_DELTA"
	EventMessagesSnapshot           EventType = "MESSAGES_SNAPSHOT"
	EventRaw                        EventType = "RAW"
	EventCustom                     EventType = "CUSTOM"
	EventStepStarted                EventType = "STEP_STARTED"
	EventStepFinished               EventType = "STEP_FINISHED"
)

// Event 是 AG-UI 标准事件。
// 采用 "type" 字段做事件分发；具体字段按事件类型可选。
// 注意：AG-UI 协议中多个事件类型共享字段名（如 delta），Go struct tag 不能重复，
// 因此对 STATE_DELTA 的数组 delta 单独用 StateDelta 字段存储，并在 MarshalJSON/UnmarshalJSON 中映射为 "delta"。
type Event struct {
	// Type 必须存在，用于区分事件类型。
	Type EventType `json:"type"`

	// 公共基础字段（协议中 flatten 在顶层）。
	Timestamp float64         `json:"timestamp,omitempty"`
	RawEvent  json.RawMessage `json:"rawEvent,omitempty"`

	// 生命周期事件字段
	ThreadID string          `json:"threadId,omitempty"`
	RunID    string          `json:"runId,omitempty"`
	Result   json.RawMessage `json:"result,omitempty"`

	// 错误事件字段
	Message string `json:"message,omitempty"`
	Code    string `json:"code,omitempty"`

	// 消息事件字段（TEXT_MESSAGE_* / THINKING_TEXT_MESSAGE_* / TOOL_CALL_ARGS）
	MessageID string `json:"messageId,omitempty"`
	Role      string `json:"role,omitempty"`
	Delta     string `json:"delta,omitempty"`

	// 工具调用事件字段
	ToolCallID   string `json:"toolCallId,omitempty"`
	ToolCallName string `json:"toolCallName,omitempty"`
	Content      string `json:"content,omitempty"`

	// 状态事件字段
	Snapshot   json.RawMessage   `json:"snapshot,omitempty"`
	StateDelta []json.RawMessage `json:"-"`
	Messages   []Message         `json:"messages,omitempty"`

	// Raw / Custom 事件字段
	Event  json.RawMessage `json:"event,omitempty"`
	Source string          `json:"source,omitempty"`
	Name   string          `json:"name,omitempty"`
	Value  json.RawMessage `json:"value,omitempty"`

	// Step 事件字段
	StepName string `json:"stepName,omitempty"`
}

// MarshalJSON 自定义序列化，处理 StateDelta 到 "delta" 的映射，并保证所有字段 flatten。
func (e Event) MarshalJSON() ([]byte, error) {
	// 先用匿名结构体序列化除 StateDelta 外的字段。
	type flat Event
	b, err := json.Marshal(flat(e))
	if err != nil {
		return nil, err
	}
	if len(e.StateDelta) == 0 {
		return b, nil
	}
	// 再把 StateDelta 写入 "delta" 字段。
	var m map[string]json.RawMessage
	if err := json.Unmarshal(b, &m); err != nil {
		return nil, err
	}
	deltaBytes, err := json.Marshal(e.StateDelta)
	if err != nil {
		return nil, err
	}
	m["delta"] = deltaBytes
	return json.Marshal(m)
}

// UnmarshalJSON 自定义反序列化，把 STATE_DELTA 的 "delta" 数组读入 StateDelta。
func (e *Event) UnmarshalJSON(data []byte) error {
	type flat Event
	if err := json.Unmarshal(data, (*flat)(e)); err != nil {
		return err
	}
	var m map[string]json.RawMessage
	if err := json.Unmarshal(data, &m); err != nil {
		return err
	}
	if raw, ok := m["delta"]; ok {
		// 根据事件类型决定解析为字符串还是数组。
		switch e.Type {
		case EventStateDelta:
			var arr []json.RawMessage
			if err := json.Unmarshal(raw, &arr); err == nil {
				e.StateDelta = arr
			}
		default:
			// 其他类型的 delta 已通过 Delta 字段反序列化，无需处理。
		}
	}
	return nil
}

// NewEvent 构造一个基础 AG-UI 事件。
func NewEvent(t EventType) Event {
	return Event{
		Type:      t,
		Timestamp: float64(time.Now().UnixMilli()) / 1000,
	}
}

// RunStartedEvent 构造 RUN_STARTED 事件。
func RunStartedEvent(threadID, runID string) Event {
	ev := NewEvent(EventRunStarted)
	ev.ThreadID = threadID
	ev.RunID = runID
	return ev
}

// RunFinishedEvent 构造 RUN_FINISHED 事件。
func RunFinishedEvent(threadID, runID string) Event {
	ev := NewEvent(EventRunFinished)
	ev.ThreadID = threadID
	ev.RunID = runID
	return ev
}

// RunErrorEvent 构造 RUN_ERROR 事件。
func RunErrorEvent(message, code string) Event {
	ev := NewEvent(EventRunError)
	ev.Message = message
	ev.Code = code
	return ev
}

// TextMessageStartEvent 构造 TEXT_MESSAGE_START 事件。
func TextMessageStartEvent(messageID, role string) Event {
	ev := NewEvent(EventTextMessageStart)
	ev.MessageID = messageID
	ev.Role = role
	return ev
}

// TextMessageContentEvent 构造 TEXT_MESSAGE_CONTENT 事件。
func TextMessageContentEvent(messageID, delta string) Event {
	ev := NewEvent(EventTextMessageContent)
	ev.MessageID = messageID
	ev.Delta = delta
	return ev
}

// TextMessageEndEvent 构造 TEXT_MESSAGE_END 事件。
func TextMessageEndEvent(messageID string) Event {
	ev := NewEvent(EventTextMessageEnd)
	ev.MessageID = messageID
	return ev
}

func generateID() string {
	// 简单时间戳+随机数，避免引入 uuid 依赖。
	return fmt.Sprintf("%d-%d", time.Now().UnixNano(), rand.Int())
}
