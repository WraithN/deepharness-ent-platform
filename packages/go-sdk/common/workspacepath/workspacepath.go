// Package workspacepath 提供工作空间路径的统一拼接与角色目录映射。
//
// 该包被 dh-backend 和 personal-stub 共享使用，确保两端对工作目录结构理解一致。
//
// 目录结构约定：
//
//	{workspaceRoot}/{userID}/{workspaceID}/
//	  ├── dev-jobs/          # 开发者：代码工程、技术文档
//	  │   └── {工程名}/
//	  ├── pm-jobs/           # 产品经理：PRD、调研、原型、需求拆分
//	  │   ├── docs/
//	  │   ├── prototypes/
//	  │   ├── prd/
//	  │   ├── research/
//	  │   └── req-breakdown/
//	  ├── uidesigner-jobs/   # UI 设计师：设计稿、组件库
//	  │   └── design/
//	  ├── tester-jobs/       # 测试工程师：测试用例、自动化脚本
//	  │   └── test-cases/
//	  └── files/             # 通用文件
//
// 角色与目录的映射关系：
//
//	developer -> dev-jobs
//	pm        -> pm-jobs
//	designer  -> uidesigner-jobs
//	tester    -> tester-jobs
//
// 如果一个用户有多个角色，则所有角色对应的目录都会被创建，
// 不同角色的材料分别放入各自的目录中。
package workspacepath

import (
	"errors"
	"fmt"
	"path/filepath"
	"strings"
)

// 角色常量，与 domain/workspace/object/types.go 中的 MemberSubRole* 保持一致。
const (
	RoleDeveloper = "developer"
	RolePM        = "pm"
	RoleDesigner  = "designer"
	RoleTester    = "tester"
)

// 角色工作目录名常量。
const (
	DirDevJobs      = "dev-jobs"
	DirPMJobs       = "pm-jobs"
	DirUIDesignJobs = "uidesigner-jobs"
	DirTesterJobs   = "tester-jobs"
	DirFiles        = "files"
)

// 角色目录下的子目录名常量。
const (
	SubDirPrototypes   = "prototypes"  // pm-jobs/prototypes
	SubDirDocs         = "docs"        // pm-jobs/docs
	SubDirPRD          = "prd"         // pm-jobs/prd
	SubDirResearch     = "research"    // pm-jobs/research
	SubDirReqBreakdown = "req-breakdown" // pm-jobs/req-breakdown
	SubDirDesign       = "design"      // uidesigner-jobs/design
	SubDirTestCases    = "test-cases"  // tester-jobs/test-cases
	SubDirArchDesign   = "arch-design" // dev-jobs/arch-design
)

// roleJobDir 将角色映射到工作目录名。
var roleJobDir = map[string]string{
	RoleDeveloper: DirDevJobs,
	RolePM:        DirPMJobs,
	RoleDesigner:  DirUIDesignJobs,
	RoleTester:    DirTesterJobs,
}

// jobDirRole 将工作目录名反向映射到角色。
var jobDirRole = map[string]string{
	DirDevJobs:      RoleDeveloper,
	DirPMJobs:       RolePM,
	DirUIDesignJobs: RoleDesigner,
	DirTesterJobs:   RoleTester,
}

// AllRoleDirs 返回所有角色工作目录名列表，用于批量创建目录。
func AllRoleDirs() []string {
	return []string{DirDevJobs, DirPMJobs, DirUIDesignJobs, DirTesterJobs}
}

// RoleJobDir 返回角色对应的工作目录名。
// 未知角色返回空字符串。
func RoleJobDir(role string) string {
	return roleJobDir[role]
}

// JobDirRole 返回工作目录名对应的角色。
// 未知目录返回空字符串。
func JobDirRole(dir string) string {
	return jobDirRole[dir]
}

// IsValidRole 判断角色值是否合法。
func IsValidRole(role string) bool {
	_, ok := roleJobDir[role]
	return ok
}

// RoleDirsForRoles 根据角色列表返回需要创建的工作目录名列表。
// 如果 roles 为空，返回所有角色目录（兜底创建全部）。
func RoleDirsForRoles(roles []string) []string {
	if len(roles) == 0 {
		return AllRoleDirs()
	}
	seen := make(map[string]bool, len(roles))
	dirs := make([]string, 0, len(roles))
	for _, r := range roles {
		d := RoleJobDir(r)
		if d == "" || seen[d] {
			continue
		}
		seen[d] = true
		dirs = append(dirs, d)
	}
	return dirs
}

// validateID 校验 ID 不含路径遍历字符（/、\、..），防止拼接路径时逃逸。
func validateID(id string) error {
	if id == "" {
		return errors.New("ID is required")
	}
	if strings.ContainsAny(id, `/\`) {
		return fmt.Errorf("ID %q contains path separator", id)
	}
	if strings.Contains(id, "..") {
		return fmt.Errorf("ID %q contains path traversal sequence", id)
	}
	return nil
}

// ValidateID 校验 ID 不含路径遍历字符（/、\、..），防止通过 ID 拼接路径时逃逸到目标目录之外。
// 供外部包（如 pathutil）复用。
func ValidateID(id string) error {
	return validateID(id)
}

// ResolveWorkspacePath 返回用户工作空间根路径：{root}/{userID}/{workspaceID}。
// 三个参数均不允许为空，userID 和 workspaceID 会进行路径遍历校验。
// 调用方可继续用 RolePath 或 JobPath 追加角色子目录。
func ResolveWorkspacePath(root, userID, workspaceID string) (string, error) {
	if root == "" {
		return "", errors.New("workspace root must not be empty")
	}
	if err := validateID(userID); err != nil {
		return "", fmt.Errorf("invalid userID: %w", err)
	}
	if err := validateID(workspaceID); err != nil {
		return "", fmt.Errorf("invalid workspaceID: %w", err)
	}
	return filepath.Join(root, userID, workspaceID), nil
}

// RolePath 返回角色工作目录路径：{workspacePath}/{roleDir}。
// 未知角色返回空字符串和错误。
func RolePath(workspacePath, role string) (string, error) {
	dir := RoleJobDir(role)
	if dir == "" {
		return "", fmt.Errorf("unknown role: %s", role)
	}
	return filepath.Join(workspacePath, dir), nil
}

// JobPath 返回角色工作目录下指定子路径的完整路径：{workspacePath}/{roleDir}/{subPath}。
// subPath 可以是多级相对路径（如 "prototypes/user-login"）。
func JobPath(workspacePath, role, subPath string) (string, error) {
	base, err := RolePath(workspacePath, role)
	if err != nil {
		return "", err
	}
	if subPath == "" {
		return base, nil
	}
	return filepath.Join(base, subPath), nil
}

// PMJobPath 返回 PM 工作目录下指定子路径的完整路径（快捷方法）。
func PMJobPath(workspacePath, subPath string) string {
	return filepath.Join(workspacePath, DirPMJobs, subPath)
}

// DevJobPath 返回开发者工作目录下指定子路径的完整路径（快捷方法）。
func DevJobPath(workspacePath, subPath string) string {
	return filepath.Join(workspacePath, DirDevJobs, subPath)
}

// DesignerJobPath 返回设计师工作目录下指定子路径的完整路径（快捷方法）。
func DesignerJobPath(workspacePath, subPath string) string {
	return filepath.Join(workspacePath, DirUIDesignJobs, subPath)
}

// TesterJobPath 返回测试工程师工作目录下指定子路径的完整路径（快捷方法）。
func TesterJobPath(workspacePath, subPath string) string {
	return filepath.Join(workspacePath, DirTesterJobs, subPath)
}

// EnsureDirs 返回需要确保存在的所有目录路径列表（含角色目录和常用子目录）。
// 如果 roles 为空，则创建所有角色的目录。
// 该函数返回的路径列表可直接传给 MkdirAll 批量创建。
func EnsureDirs(workspacePath string, roles []string) []string {
	roleDirs := RoleDirsForRoles(roles)
	dirs := make([]string, 0, len(roleDirs)*3+1)

	for _, d := range roleDirs {
		dirs = append(dirs, filepath.Join(workspacePath, d))
	}

	// PM 角色特有的子目录（被代码扫描依赖，必须提前创建）
	for _, d := range roleDirs {
		switch d {
		case DirPMJobs:
			dirs = append(dirs,
				filepath.Join(workspacePath, d, SubDirDocs),
				filepath.Join(workspacePath, d, SubDirPrototypes),
			)
		}
	}

	// 通用文件目录
	dirs = append(dirs, filepath.Join(workspacePath, DirFiles))

	return dirs
}
