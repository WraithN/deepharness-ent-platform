// Package wsutil 提供 WebSocket 连接的通用工具，例如心跳保活。
//
// 心跳用于解决 WebSocket 连接因网络中断、对端崩溃等原因变成"半开"状态后，
// 读操作永久阻塞、无法感知连接已失效的问题。通过定期发送 ping 并在收到
// pong 时重置读超时，可在读超时到期后使阻塞的读操作返回错误，从而触发
// 连接关闭与资源回收。
package wsutil

import (
	"sync"
	"time"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/pkg/safego"
	"github.com/gorilla/websocket"
)

// WebSocket 心跳相关常量。
const (
	// PingInterval 发送 ping 的间隔。必须小于 PongWait，否则在对端无响应时
	// 仍可能先于读超时触发下一次 ping，造成无谓的写入。
	PingInterval = 30 * time.Second

	// PongWait 等待 pong（或任意消息）的最大时长，作为读超时使用。超过此
	// 时长未收到任何消息，则下一次读操作将返回超时错误，视为连接已断开。
	// 必须大于 PingInterval，以保证正常情况下 pong 能在超时前到达。
	PongWait = 60 * time.Second

	// WriteWait 控制消息（ping）写入的超时时长。控制消息体积极小，无需过长。
	WriteWait = 10 * time.Second
)

// Heartbeat 维护一个 WebSocket 连接的心跳。
//
// 工作原理：
//   - 在连接上设置初始读超时（PongWait）与 pong handler；
//   - 启动一个 goroutine 按 PingInterval 周期发送 ping；
//   - 对端收到 ping 后会自动回复 pong，pong handler 据此重置读超时，
//     表明对端存活；若 PongWait 内始终未收到任何消息，读操作超时失败。
//
// 并发安全：ping 通过 WriteControl 发送，gorilla/websocket 文档明确说明
// WriteControl 可与所有其他方法（包括 WriteMessage/WriteJSON）并发安全调用，
// 因此不会与既有的数据消息写入竞争，无需额外加锁。
type Heartbeat struct {
	conn *websocket.Conn
	done chan struct{}
	once sync.Once
}

// NewHeartbeat 在 conn 上启用心跳：设置初始读超时与 pong handler，并启动
// 定期发送 ping 的 goroutine。name 用于标识 goroutine 用途，便于在日志中定位。
//
// 调用方应在连接生命周期结束（关闭）时调用 Stop，以及时停止 ping goroutine，
// 避免 goroutine 泄漏。即使忘记调用 Stop，ping goroutine 也会在 WriteControl
// 因连接关闭而失败时自行退出。
func NewHeartbeat(conn *websocket.Conn, name string) *Heartbeat {
	hb := &Heartbeat{
		conn: conn,
		done: make(chan struct{}),
	}
	// 初始读超时：PongWait 内未收到任何消息（含 pong）则读操作超时失败。
	conn.SetReadDeadline(time.Now().Add(PongWait))
	// 每次收到 pong 重置读超时，表明对端存活。pong handler 在读 goroutine
	// 内部执行，与 ReadMessage 同 goroutine，故 SetReadDeadline 调用安全。
	conn.SetPongHandler(func(string) error {
		conn.SetReadDeadline(time.Now().Add(PongWait))
		return nil
	})
	safego.Go("ws-ping-"+name, func() {
		ticker := time.NewTicker(PingInterval)
		defer ticker.Stop()
		for {
			select {
			case <-hb.done:
				return
			case <-ticker.C:
				// WriteControl 可与数据消息写入并发安全调用。
				if err := conn.WriteControl(websocket.PingMessage, nil, time.Now().Add(WriteWait)); err != nil {
					return
				}
			}
		}
	})
	return hb
}

// Stop 停止心跳 ping goroutine。可安全地多次调用。
func (hb *Heartbeat) Stop() {
	hb.once.Do(func() { close(hb.done) })
}
