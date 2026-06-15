package object

import "time"

// AgentSession 定义编排模块中的会话数据结构。
type AgentSession struct {
	ID        string    `json:"id"`
	Title     string    `json:"title"`
	AgentType string    `json:"agentType"`
	Model     string    `json:"model"`
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}
