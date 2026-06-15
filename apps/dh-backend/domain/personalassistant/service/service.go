package service

import (
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/personalassistant/object"
)

// PersonalAssistantService 定义个人助手领域服务接口。
type PersonalAssistantService interface {
	ListAssistants(userID string) ([]object.PersonalAssistant, error)
	CreateAssistant(userID, userName string, req CreateAssistantRequest) (object.PersonalAssistant, error)
	GetAssistant(id string) (object.PersonalAssistant, error)
	DeleteAssistant(id string) error

	ListSessions(assistantID string) ([]object.Session, error)
	CreateSession(assistantID, title string) (object.Session, error)
	DeleteSession(assistantID, sessionID string) error
	GetMessages(sessionID string) ([]object.Message, error)

	// ProcessMessage 处理用户消息并返回助手回复（当前为 mock 实现）。
	ProcessMessage(assistantID, sessionID, content string) (object.Message, error)
}

// CreateAssistantRequest 创建助手请求。
type CreateAssistantRequest struct {
	Name        string `json:"name"`
	Role        string `json:"role"`
	Description string `json:"description"`
}
