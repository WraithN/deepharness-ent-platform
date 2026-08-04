# Agent 工作路径硬编码与角色目录不统一

## 现象

1. 提示词模板中硬编码了多种不一致的目录路径（`projects/`、`products/prototypes/`、`projects/products-jobs/`），与代码实际扫描的目录（`dev-jobs/`、`pm-jobs/prototypes/`）不匹配，导致 agent 产出后无法被自动识别。
2. `tester-jobs` 角色目录完全缺失（无常量、不创建、无提示词路径）。
3. `projects` 目录名在 `sync_lock.go`、`scanner.go`、`git.go`、提示词模板中各自独立硬编码，存在三套命名矛盾。
4. `pathutil.ResolveWorkspaceRoot` 和 `workspacepath.ResolveWorkspacePath` 两套路径校验逻辑并存。
5. `ProductSpaceRoot = "pm-jobs"` 与 `repository.DirPMJobs = "pm-jobs"` 重复定义。

## 根因

历史演进中，目录命名经历了多次变更但未统一收口：
- 最初使用 `projects/` 作为代码工程目录
- 后引入 `dev-jobs`/`pm-jobs`/`uidesign-jobs` 角色目录（go-sdk 常量）
- 提示词模板仍使用旧的 `projects/` 和 `products/prototypes/` 路径
- `products-jobs/` 作为 PM 子目录在提示词中使用，但代码中从未创建
- `tester-jobs` 角色已定义（`MemberSubRoleTester`）但无对应目录

## 解决方案

### 1. 创建共享 workspacepath 包

新增 `packages/go-sdk/common/workspacepath/workspacepath.go`，提供：
- 角色常量（`RoleDeveloper`/`RolePM`/`RoleDesigner`/`RoleTester`）
- 角色目录映射（`DirDevJobs`/`DirPMJobs`/`DirUIDesignJobs`/`DirTesterJobs`）
- 子目录常量（`SubDirPrototypes`/`SubDirDocs`/`SubDirPRD`/`SubDirResearch`/`SubDirReqBreakdown`/`SubDirDesign`/`SubDirTestCases`/`SubDirArchDesign`）
- 路径拼接函数（`ResolveWorkspacePath`/`RolePath`/`JobPath`/`PMJobPath`/`DevJobPath`/`DesignerJobPath`/`TesterJobPath`）
- 目录创建辅助（`EnsureDirs`/`AllRoleDirs`/`RoleDirsForRoles`）

### 2. 统一提示词路径

| 指令 | 旧路径 | 新路径 | 角色 |
|------|--------|--------|------|
| `/prd-write` | `projects/products-jobs/prd/` | `pm-jobs/prd/` | PM |
| `/prd-research` | `projects/products-jobs/research/` | `pm-jobs/research/` | PM |
| `/proto-make` | `products/prototypes/` | `pm-jobs/prototypes/` | PM |
| `/code` | `projects/{工程名}/` | `dev-jobs/{工程名}/` | Developer |
| `/test-case` | `projects/products-jobs/test-cases/` | `tester-jobs/test-cases/` | Tester |
| `/ui-design` `/ui-kit` | `projects/products-jobs/design/` | `uidesigner-jobs/design/` | Designer |
| `/req-breakdown` | `projects/products-jobs/req-breakdown/` | `pm-jobs/req-breakdown/` | PM |
| `/dev-doc` | `projects/{工程名}/docs/` | `dev-jobs/{工程名}/docs/` | Developer |
| `/arch-design` | `projects/arch-design/` | `dev-jobs/arch-design/` | Developer |

### 3. 统一代码扫描/克隆路径

- `sync_lock.go`: `"projects"` -> `workspacepath.DirDevJobs`
- `scanner.go`: `"dev-jobs"` -> `workspacepath.DirDevJobs`
- `git.go`: `domainRepo.DirDevJobs` -> `workspacepath.DirDevJobs`
- `agui_helpers.go`: `repository.DirPMJobs` + `protoProjectsDirName` -> `workspacepath.DirPMJobs` + `workspacepath.SubDirPrototypes`

### 4. 统一常量定义

- `repository/constants.go`: 所有常量改为引用 `workspacepath` 包
- `productspace/object/constants.go`: `ProductSpaceRoot` 改为引用 `workspacepath.DirPMJobs`
- `pathutil/pathutil.go`: 委托到 `workspacepath` 包，消除重复校验逻辑

### 5. 补全目录创建

`EnsureUserWorkspaceDirs` 使用 `workspacepath.EnsureDirs`，创建所有角色目录（含 `tester-jobs`）+ PM 子目录（`docs/`、`prototypes/`）+ `files/`。

### 验证结果

- `go build ./...` 通过（dh-backend + personal-stub + go-sdk）
- `go vet ./...` 通过
- `go test ./...` 通过（go-sdk）
