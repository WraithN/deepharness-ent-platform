// Package safego 提供 goroutine 安全启动工具，防止 panic 导致进程崩溃。
//
// 本包为向后兼容的薄封装，真实实现位于 packages/go-sdk/common/safego，
// 以避免 apps/dh-backend 与 packages/go-sdk 之间出现重复逻辑。
package safego

import gosafego "github.com/deepharness/deepharness-ent-platform/packages/go-sdk/common/safego"

// Go 启动一个受 recover 保护的 goroutine。
// name 用于标识 goroutine 用途，便于在日志中定位。
// fn 是 goroutine 中执行的函数。
// 如果 fn 中发生 panic，会记录日志并恢复，不会导致进程崩溃。
func Go(name string, fn func()) {
	gosafego.Go(name, fn)
}
