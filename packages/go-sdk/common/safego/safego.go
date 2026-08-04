// Package safego 提供 goroutine 安全启动工具，防止 panic 导致进程崩溃。
//
// 该包位于共享 SDK，因此 packages/go-sdk 内的 goroutine 也可使用，避免反向依赖 apps/dh-backend。
package safego

import (
	"fmt"
	"log"
)

// safeGoRecoverLimit 限制 recover 日志输出的长度，防止超长 panic 信息导致日志膨胀。
const safeGoRecoverLimit = 4096

// Go 启动一个受 recover 保护的 goroutine。
// name 用于标识 goroutine 用途，便于在日志中定位。
// fn 是 goroutine 中执行的函数。
// 如果 fn 中发生 panic，会记录日志并恢复，不会导致进程崩溃。
func Go(name string, fn func()) {
	go func() {
		defer func() {
			if r := recover(); r != nil {
				msg := fmt.Sprintf("%v", r)
				if len(msg) > safeGoRecoverLimit {
					msg = msg[:safeGoRecoverLimit] + "..."
				}
				log.Printf("[safeGo] panic recovered in %s: %s", name, msg)
			}
		}()
		fn()
	}()
}
