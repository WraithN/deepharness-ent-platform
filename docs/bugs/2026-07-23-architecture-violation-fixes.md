# 2026-07-23 修复 dh-backend 架构违规：直接 exec git/npm 和直接写共享目录

## 现象

dh-backend 多个 domain service 和 handler 中存在违反 AGENTS.md §5 三服务架构约束的代码：

1. **直接执行 agent CLI**：`standards_handler.go` 中的 `execAgent` 函数直接在 dh-backend 主机上运行 `opencode`/`claude` 命令。
2. **直接执行 git 命令**：`repository/service/db_service.go` 的 `gitExec` 函数和 `stats.go` 的 `execGitLogDates` 函数直接 `exec.Command("git", ...)`。
3. **直接执行 npm 命令**：`devserver_manager.go` 和 `projects.go` 中直接 `exec.Command("npm", ...)` / `exec.Command("git", ...)`。
4. **直接写共享目录**：`productspace/service/db_service.go`、`productdoc/service/materialize_service.go`、`repository/service/db_service.go`、`workspace/service/db_service.go`、`gateway/handler/workspace_path.go` 等多处直接使用 `os.WriteFile`/`os.MkdirAll`/`os.Remove`/`os.RemoveAll` 操作 `{workspaceRoot}/{wsID}/{userID}/` 下的文件。

影响范围：违反了 dh-backend "不直接写共享目录、不直接执行 agent/git/npm 命令" 的架构约束，导致 dh-backend 与 personal-stub 的职责边界模糊，存在安全和可维护性风险。

## 根因

三服务架构（dh-backend / personal-stub / gatewayd）是在 agent-stub 重命名为 personal-stub 时确立的。但历史代码中 dh-backend 一直直接操作文件系统和执行 git/npm 命令，未按新架构迁移。具体原因：

1. **StubProxy 部分覆盖**：前端面向的文件/工程/预览路由已通过 StubProxy 代理到 personal-stub，但 dh-backend 内部 domain service 仍直接操作文件系统。
2. **死代码残留**：`files.go`、`devserver_manager.go`、`projects.go`、`preview.go` 等 handler 被 StubProxy 影子化（路由被代理拦截），但仍保留在代码中。
3. **go-sdk GitClient 混用**：go-sdk 的 `GitClient.Clone` 在有进度回调时使用 `exec.Command("git", ...)`，无回调时使用 go-git 纯 Go 库。
4. **缺少 personal-stub 客户端**：dh-backend 没有调用 personal-stub API 的 HTTP 客户端，domain service 只能直接操作文件系统。

## 解决方案

### 1. 移除死代码（1,472 行）

删除了被 StubProxy 影子化的 4 个 handler 文件：
- `gateway/handler/files.go`（401 行）- 文件 CRUD，已被 StubProxy 代理
- `gateway/handler/devserver_manager.go`（330 行）- npm dev server 管理，已被 StubProxy 代理
- `gateway/handler/projects.go`（625 行）- git 操作，已被 StubProxy 代理
- `gateway/handler/preview.go`（116 行）- 预览代理，已被 StubProxy 代理

### 2. 移除 standards_handler.go 中的直接 agent CLI 执行

重写 `domain/repository/standards_handler.go`：
- 移除 `execAgent`、`runAgentsMdInit`、`runDesignMdGenerate`、`renameClaudeMdIfExists` 函数
- 移除 `os/exec`、`context`、`time` 导入
- `StandardFilesInit` 改为返回提示消息，引导用户通过聊天会话（/code 指令）让 agent 生成 AGENTS.md 和 DESIGN.md

### 3. 创建 stubclient 包

新建 `gateway/stubclient/client.go`，提供 personal-stub 的 HTTP 客户端：
- `WriteFile(ctx, path, content)` - 写文件
- `ReadFile(ctx, path)` - 读文件
- `DeleteFile(ctx, path)` - 删文件
- `MkdirAll(ctx, path)` - 创建目录
- `RemoveDir(ctx, path)` - 递归删除目录
- `ListDir(ctx, path)` - 列出目录条目
- `FileExists(ctx, path)` - 检查文件存在
- `GitExec(ctx, dir, args...)` - 执行 git 命令
- `Clone(ctx, req)` - 克隆仓库
- `SetDefault(c)` / `Default()` - 全局默认客户端（在 server.go 初始化时注入）

### 4. 扩展 personal-stub API

在 personal-stub 中新增 5 个端点：
- `POST /api/v1/files/mkdir` - 递归创建目录（`dir_ops.go`）
- `DELETE /api/v1/files/dir?path=...` - 递归删除目录（`dir_ops.go`）
- `GET /api/v1/files/list?path=...` - 列出目录条目（`dir_ops.go`）
- `GET /api/v1/files/exists?path=...` - 检查文件存在（`dir_ops.go`）
- `POST /api/v1/projects/git-exec` - 通用 git 命令执行（`git_exec.go`）
- `POST /api/v1/projects/clone` - 克隆远程仓库（`git_exec.go`）

### 5. 迁移 domain service 文件写入

| 文件 | 原操作 | 迁移后 |
|------|--------|--------|
| `productdoc/materialize_service.go` | `os.MkdirAll` + `os.WriteFile` | `stubclient.WriteFile` |
| `productspace/db_service.go` | `os.WriteFile`/`os.Remove`/`os.MkdirAll`/`os.Create` (15+ 处) | `stubWriteFile`/`stubDeleteFile`/`stubclient.MkdirAll`/`stubclient.ReadFile+WriteFile` |
| `repository/db_service.go` | `os.WriteFile`/`os.MkdirAll`/`os.Remove`/`os.RemoveAll` (12 处) | `stubclient.WriteFile`/`MkdirAll`/`DeleteFile`/`RemoveDir` |
| `workspace/db_service.go` | `os.MkdirAll` (2 处) | `stubclient.MkdirAll` |
| `gateway/handler/workspace_path.go` | `os.MkdirAll` (1 处) | `stubclient.MkdirAll` |

### 6. 迁移 git 命令执行

| 文件 | 原操作 | 迁移后 |
|------|--------|--------|
| `repository/db_service.go` `gitExec` | `exec.Command("git", ...)` (20+ 调用) | `stubclient.GitExec` |
| `stats.go` `execGitLogDates` | `exec.CommandContext("git", ...)` | `stubclient.GitExec` |
| `repository/db_service.go` Clone | `gitClient.Clone(url, dest, key, branch, func(int){})` (使用 exec) | `gitClient.Clone(url, dest, key, branch, nil)` (使用 go-git 纯 Go 库) |

### 7. 例外处理

- **prototypetemplate `npm install`**：运行在 `shares/prototypes-templates/` 目录下，属于 dh-backend 管理的共享资源（AGENTS.md §5 允许 dh-backend 写 shares/）。这是模版上传后的依赖安装（build-time 操作），添加了注释说明架构例外。
- **agui.go `logPrompt`**：写入 `/tmp/dh-prompts/` 调试日志，不涉及共享目录，无需迁移。

### 验证结果

- `go build ./...` - 通过
- `go vet ./...` - 通过
- `tsc --noEmit -p tsconfig.check.json` - 通过
- `pnpm build` - 6/6 任务成功
- `restart-dev.sh` - 所有服务启动成功
- personal-stub 新端点功能验证 - mkdir/write/list/removeDir 全部正常
- dh-backend health check - 正常
- 架构违规扫描 - 0 处直接 exec git/npm（除 shares/ 例外），0 处直接写共享目录（除 /tmp/ 和 shares/）
