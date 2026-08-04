package service

import (
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/sessionmanager/object"
)

// SessionService 定义 Agent 编排模块的服务接口。
type SessionService interface {
	ListSessions() ([]object.AgentSession, error)
}
