package domain

import "time"

const (
	RECONNECT_HISTORY_LIMIT   = 50
	WS_WRITE_TIMEOUT          = 10 * time.Second
	MAX_MESSAGES_PER_SESSION  = 1000
	SESSION_TIMEOUT           = 30 * time.Minute
	AGENT_REQUEST_TIMEOUT     = 120 * time.Second
	AGENT_SSE_RETRY_MAX       = 3
)
