package domain

import "time"

type Message struct {
	ID        string
	SessionID string
	Role      string
	Type      string
	Content   string
	Metadata  map[string]any
	Timestamp time.Time
}
