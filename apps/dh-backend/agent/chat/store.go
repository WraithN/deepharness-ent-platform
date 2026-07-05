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
	ListSessions(ctx context.Context) ([]Session, error)
	// GetSessionTrend 返回最近 N 天每天的会话创建数量。
	GetSessionTrend(ctx context.Context, days int) ([]DateCount, error)
	// GetSessionTrails 返回最近的会话轨迹（含消息数量），按更新时间倒序。
	GetSessionTrails(ctx context.Context, limit int) ([]SessionTrailInfo, error)
}

type MessageStore interface {
	Append(ctx context.Context, sessionID string, msg Message) error
	GetHistory(ctx context.Context, sessionID string, limit int) ([]Message, error)
}
