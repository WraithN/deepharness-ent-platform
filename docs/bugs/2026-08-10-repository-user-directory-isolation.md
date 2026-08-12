# 2026-08-10 工程代码页面仓库 local_path 未按用户隔离导致 B 看到 A 目录

## 现象

在工作空间设置中由用户 A 配置的仓库，DB 里 `repositories.local_path` 记录的是 A 的私有目录：

```text
{root}/{A_userID}/{workspaceID}/dev-jobs/{repoName}
```

其他用户 B 进入「个人工作台 → 工程代码」时：

- `/repositories/{id}/tree`、`/repositories/{id}/content`、`/repositories/{id}/branches`、`/repositories/{id}/push`、`/repositories/{id}/unpushed` 等接口全部读取 `repo.LocalPath`（即 A 目录）。
- B 点击「同步」按钮调用 `/user-repos/{id}/sync` 后，仓库确实被 clone 到 B 自己的目录：
  ```text
  {root}/{B_userID}/{workspaceID}/dev-jobs/{repoName}
  ```
  但读取接口没有切换到这个目录，仍然展示 A 目录。
- B 在 chat 中让 agent 修改代码，agent 写入的是 B 目录（chat 的 ProjectCard/LivePreview 直接走项目路径），所以 chat 里能看到改动；但「工程代码」页面看不到。

## 根因

### 1. 仓库记录只有一份创建者 local_path

`apps/dh-backend/domain/repository/service/db_service.go:134`：

```go
LocalPath: s.gitClient.DefaultLocalPath(userID, workspaceID, name)
```

创建时 `userID` 是 A，所以 `local_path` 永久指向 A 目录。该字段被当成所有用户读取的入口。

### 2. 用户级同步与读取接口路径不一致

`/user-repos/{id}/sync` 把仓库 clone 到 B 目录（`userProjectPath`），但：

- 没有更新 `repositories.local_path`（也不应该更新，因为那是共享配置）。
- 文件树/内容/保存/分支/push/未推送统计等接口没有按当前用户解析路径，仍用 DB 里的 A 目录。

### 3. 相关接口虽然传了 userID 但没有使用

`RepositoryService` 接口的 `GetFileTree`、`GetFileContent`、`SaveFileContent`、`GetBranches`、`Push`、`GetUnpushedCommits`、`GitCommit`、`GitStatus`、`SwitchBranch`、`GetDetails`、`StandardFiles` 等方法的签名都带 `userID`，但实现中直接操作 `repo.LocalPath`，没有按用户切换目录。

## 解决方案

统一引入「用户级仓库路径解析」：

1. 在 `apps/dh-backend/domain/repository/service/sync_lock.go` 新增：
   - `resolveUserLocalPath(repo, userID)`：当前用户是创建者时返回 `repo.LocalPath`，否则返回 `{root}/{userID}/{workspaceID}/dev-jobs/{repoName}`。
   - `extractCreatorUserIDFromLocalPath(localPath)`：从 `repo.LocalPath` 解析创建者 userID。

2. 修改 `ensureLocalPath(ctx, repo, userID)`：
   - 检查当前用户应使用的目录；
   - 目录不存在时触发 `SyncUserRepo` 异步同步，而不是只检查创建者目录。

3. 修改所有用户隔离操作的路径解析：
   - `apps/dh-backend/domain/repository/service/file_tree.go`：`GetFileTree`、`GetFileContent`、`SaveFileContent`。
   - `apps/dh-backend/domain/repository/service/branch_service.go`：`GetBranches`、`RefreshBranches`、`SwitchBranch`、`GitCommit`、`GitStatus`。
   - `apps/dh-backend/domain/repository/service/db_service.go`：`Push`、`GetUnpushedCommits`。
   - `apps/dh-backend/domain/repository/service/scanner.go`：`GetDetails`。
   - `apps/dh-backend/domain/repository/standards_handler.go`：`StandardFiles`、`StandardFilesInit` 读取当前用户目录下的 `AGENTS.md` / `DESIGN.md`。

4. 工作空间级创建/更新/删除/主仓库同步（`Create`、`Update`、`Delete`、`Sync`）仍使用 `repo.LocalPath`，保证配置记录和创建者目录一致。

## 验证

- `go vet ./apps/dh-backend/domain/repository/...` 通过。
- `go build -o /tmp/dh-backend ./apps/dh-backend` 通过。
- 重启 dev 环境后，B 用户在工程代码页面应能看到并编辑自己 `dev-jobs/{repoName}` 目录下的代码。
- A 用户仍看到自己目录，互不干扰。

## 相关代码

- `apps/dh-backend/domain/repository/service/sync_lock.go` — 新增 `resolveUserLocalPath` / `extractCreatorUserIDFromLocalPath`。
- `apps/dh-backend/domain/repository/service/branch_service.go` — 修改 `ensureLocalPath` 及分支/提交/状态操作。
- `apps/dh-backend/domain/repository/service/file_tree.go` — 文件树/内容/保存切换用户目录。
- `apps/dh-backend/domain/repository/service/db_service.go` — Push / 未推送统计切换用户目录。
- `apps/dh-backend/domain/repository/service/scanner.go` — 仓库详情统计切换用户目录。
- `apps/dh-backend/domain/repository/standards_handler.go` — 标准文件读取切换用户目录。
- `apps/dh-backend/domain/repository/service/user_repo.go` — `/user-repos/{id}/sync` 已存在的用户目录同步逻辑。
