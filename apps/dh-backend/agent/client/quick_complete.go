package client

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/agui"
	"github.com/google/uuid"
)

// intentRecognitionTimeout 是意图识别 LLM 调用的超时时间。
const intentRecognitionTimeout = 60 * time.Second

// QuickComplete 向 agent 发送一条简短提示词，同步等待完整文本响应。
// 用于意图识别等不需要工具调用的轻量 LLM 交互。
// 内部创建临时 thread，消费完 SSE 事件后返回拼接的纯文本。
// 可选 workspace 参数指定 agent 工作目录，不传时使用 gatewayd 默认路径。
func (c *AGUIClient) QuickComplete(ctx context.Context, prompt string, workspace ...string) (string, error) {
	quickCtx, cancel := context.WithTimeout(ctx, intentRecognitionTimeout)
	defer cancel()

	ws := ""
	if len(workspace) > 0 {
		ws = workspace[0]
	}
	input := agui.RunAgentInput{
		ThreadID: "", // 创建新 thread
		RunID:    uuid.New().String(),
		Messages: []agui.Message{
			agui.UserMessage("", prompt),
		},
		State:          json.RawMessage(`{}`),
		Tools:          []agui.Tool{},
		Context:        []agui.ContextItem{},
		ForwardedProps: json.RawMessage(`{}`),
		Workspace:      ws,
	}

	_, events, err := c.Run(quickCtx, input)
	if err != nil {
		return "", fmt.Errorf("quick complete run failed: %w", err)
	}

	var sb strings.Builder
	for ev := range events {
		switch ev.Type {
		case agui.EventTextMessageContent:
			sb.WriteString(ev.Delta)
		case agui.EventRunError:
			return sb.String(), fmt.Errorf("agent error: %s", ev.Message)
		case agui.EventRunFinished:
			return sb.String(), nil
		}
	}

	return sb.String(), nil
}
