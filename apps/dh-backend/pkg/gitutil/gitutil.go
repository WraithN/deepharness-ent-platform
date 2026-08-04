// Package gitutil 封装通过 personal-stub 执行 git 命令的通用逻辑，
// 避免多个 domain 重复实现 gitExec 包装函数。
package gitutil

import (
	"context"
	"fmt"
	"strings"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/stubclient"
)

// Exec 通过 personal-stub 在指定目录执行 git 命令，返回原始 stdout 与 error。
// 架构合规：dh-backend 不直接 exec git，统一委托 personal-stub 执行。
func Exec(ctx context.Context, dir string, args ...string) (string, error) {
	sc := stubclient.FromContext(ctx)
	if sc == nil {
		return "", fmt.Errorf("personal-stub client not initialized")
	}
	return sc.GitExec(ctx, dir, args...)
}

// ExecTrimmed 执行 git 命令并返回去除首尾空格的 stdout；出错时返回空字符串。
// 适用于仅需展示、可容忍失败的场景。
func ExecTrimmed(ctx context.Context, dir string, args ...string) string {
	out, err := Exec(ctx, dir, args...)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(out)
}
