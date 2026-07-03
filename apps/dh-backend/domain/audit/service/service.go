package service

import (
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/audit/object"
)

// EventService 定义 audit 模块的服务接口。
type EventService interface {
	ListEvents() ([]object.Event, error)
}
