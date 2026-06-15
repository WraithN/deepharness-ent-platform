package chat

type BrokerEvent struct {
	Type    string
	Payload Message
	Error   *ErrorInfo
}

type ErrorInfo struct {
	Code    string
	Message string
}
