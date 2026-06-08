package llm

import "context"

// Engine LLM 引擎抽象
type Engine interface {
	Chat(ctx context.Context, model string, messages []Message) (string, error)
	Stream(ctx context.Context, model string, messages []Message, handler func(chunk string)) error
}

// Message LLM 消息
type Message struct {
	Role    string
	Content string
}
