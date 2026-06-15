package chat

import "context"

type SessionStore interface {
	Create(ctx context.Context, s Session) error
	Get(ctx context.Context, id string) (Session, error)
	UpdateActivity(ctx context.Context, id string) error
	Delete(ctx context.Context, id string) error
}

type MessageStore interface {
	Append(ctx context.Context, sessionID string, msg Message) error
	GetHistory(ctx context.Context, sessionID string, limit int) ([]Message, error)
}
