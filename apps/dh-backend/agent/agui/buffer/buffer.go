package buffer

import (
	"context"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/agui"
)

// SSEBuffer 是 AG-UI SSE 事件的缓冲区接口。
// 用于在 dh-backend 和前端之间缓存事件，支持前端断开重连后的事件回放。
// 同时提供 run 级状态的 checkpoint 机制，防止服务器崩溃导致数据丢失。
type SSEBuffer interface {
	// Append 追加一条事件到缓冲区。
	Append(ctx context.Context, sessionID string, ev agui.Event) error

	// Pending 返回指定会话的所有待消费事件（不移除）。
	Pending(ctx context.Context, sessionID string) ([]agui.Event, error)

	// PopPending 原子地返回并清除指定会话的所有待消费事件。
	PopPending(ctx context.Context, sessionID string) ([]agui.Event, error)

	// Clear 清空指定会话的待消费事件。
	Clear(ctx context.Context, sessionID string) error

	// SaveRunState checkpoints 一次 run 的累积状态（序列化后的 contentPart 列表）。
	// 在 run 进行中周期性调用，崩溃后可据此恢复未持久化的消息。
	SaveRunState(ctx context.Context, sessionID, runID string, state []byte) error

	// LoadRunState 读取指定 run 的 checkpoint 状态。
	LoadRunState(ctx context.Context, sessionID, runID string) ([]byte, error)

	// ClearRunState 清除指定 run 的 checkpoint 状态（run 完成后调用）。
	ClearRunState(ctx context.Context, sessionID, runID string) error

	// LoadPendingRunStates 返回指定会话下所有尚未清除的 run 状态（runID → state）。
	// 用于服务启动时恢复因崩溃未持久化的消息。
	LoadPendingRunStates(ctx context.Context, sessionID string) (map[string][]byte, error)
}
