package chat

import (
	"context"
	"time"
)

// DateCount 按日期分组的计数（用于趋势图）。
type DateCount struct {
	Date  string `json:"date"`  // YYYY-MM-DD
	Count int    `json:"count"`
}

// SessionTrailInfo 会话轨迹信息（用于数据大盘成员会话轨迹表）。
type SessionTrailInfo struct {
	ID           string    `json:"id"`
	UserID       string    `json:"userId"`
	UserName     string    `json:"userName"`
	Title        string    `json:"title"`
	AgentType    string    `json:"agentType"`
	MessageCount int       `json:"messageCount"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

type SessionStore interface {
	Create(ctx context.Context, s Session) error
	Get(ctx context.Context, id string) (Session, error)
	UpdateActivity(ctx context.Context, id string) error
	UpdateTitle(ctx context.Context, id string, title string) error
	Delete(ctx context.Context, id string) error
	// ListSessions 按 workspace 与 user 隔离返回会话列表。
	ListSessions(ctx context.Context, workspaceID, userID string) ([]Session, error)
	// GetSessionTrend 返回指定工作空间最近 N 天每天的会话创建数量。
	GetSessionTrend(ctx context.Context, workspaceID string, days int) ([]DateCount, error)
	// GetSessionTrails 返回指定工作空间最近的会话轨迹（含消息数量），按更新时间倒序。
	GetSessionTrails(ctx context.Context, workspaceID string, limit int) ([]SessionTrailInfo, error)
	// UpdateWorkitemID 持久化会话关联的需求 ID（仅首次设置时写入，避免关联漂移）。
	UpdateWorkitemID(ctx context.Context, sessionID, workitemID string) error
	// GetWorkitemID 查询会话关联的需求 ID。
	GetWorkitemID(ctx context.Context, sessionID string) (string, error)
}

type MessageStore interface {
	Append(ctx context.Context, sessionID string, msg Message) error
	GetHistory(ctx context.Context, sessionID string, limit int) ([]Message, error)
	// MigrateMessages 将旧 sessionID 下的所有消息迁移到新 sessionID。
	// 当 gatewayd 创建了与原始 threadID 不同的实际 threadID 时调用，
	// 确保前后端 session ID 一致。
	MigrateMessages(ctx context.Context, oldSessionID, newSessionID string) error
}
