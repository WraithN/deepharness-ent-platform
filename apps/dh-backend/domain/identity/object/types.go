// Package object 定义 identity 模块对外暴露的数据结构。
// 当前模块主要复用 packages/go-sdk/domain/identity 中的领域模型，
// 后续可在此补充 HTTP 层专用的 DTO（如 CreateUserRequest、LoginRequest 等）。
package object

import (
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/identity"
)

// User 复用 SDK 中的用户领域模型。
type User = identity.User
