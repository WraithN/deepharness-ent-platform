package constants

import "time"

const (
	MAX_MESSAGES_PER_SESSION = 1000
	RECONNECT_HISTORY_LIMIT  = 50
	WS_WRITE_TIMEOUT         = 10 * time.Second
	AGENT_REQUEST_TIMEOUT    = 120 * time.Second
	AGENT_SSE_RETRY_MAX      = 3
)
