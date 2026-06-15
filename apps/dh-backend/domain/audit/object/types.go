package object

import (
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/audit"
)

// Event 复用 SDK 中的审计事件领域模型。
type Event = audit.Event
