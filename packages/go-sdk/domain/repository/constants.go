package repository

import "github.com/deepharness/deepharness-ent-platform/packages/go-sdk/common/workspacepath"

// 角色工作目录名常量，统一引用 workspacepath 包，保持单一事实来源。
// 保留这些别名是为了向后兼容已有调用方，新代码请直接使用 workspacepath 包。
const (
	DirDevJobs      = workspacepath.DirDevJobs
	DirPMJobs       = workspacepath.DirPMJobs
	DirUIDesignJobs = workspacepath.DirUIDesignJobs
	DirTesterJobs   = workspacepath.DirTesterJobs
)
