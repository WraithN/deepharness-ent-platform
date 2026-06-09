package store

import (
	"context"
	"github.com/deepharness/deepharness-ent-platform/services/api-gateway/internal/domain"
)

type SessionStore interface {
	Create(ctx context.Context, s domain.Session) error
	Get(ctx context.Context, id string) (domain.Session, error)
	UpdateActivity(ctx context.Context, id string) error
	Delete(ctx context.Context, id string) error
}

type MessageStore interface {
	Append(ctx context.Context, sessionID string, msg domain.Message) error
	GetHistory(ctx context.Context, sessionID string, limit int) ([]domain.Message, error)
}
