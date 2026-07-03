# 仓库同步状态持久化失效和进度百分比不显示

## 现象

1. **持久化 bug**：用户点击"同步"按钮后，仓库进入 `syncing` 状态并显示进度百分比。但切换到其他页面再返回后，状态回退为"未同步"（按钮显示"同步"而非进度条）。`syncing` 状态仅存在于内存，切换页面后丢失。

2. **进度百分比 bug**：同步过程中进度百分比始终不更新，始终显示 `0%`。go-git 库的 `CloneOptions.Progress` 字段（类型 `transport.ProgressSideband`）虽然实现了 `io.Writer` 接口，但实际运行时 `Write()` 方法从未被调用，导致 `cloneProgressWriter` 收不到任何进度数据。

## 根因

### Bug 1：`isUserRepoSynced()` 未检查内存状态

`db_service.go:268-276` 的 `isUserRepoSynced()` 仅依赖 `.git` 目录存在性判断是否已同步完成。go-git 的 `PlainClone()` 在 clone 早期就会创建 `.git` 目录，远在数据下载完成之前。因此：

- `ListUserRepos()` 在构建返回数据时，`Synced` 字段来自 `isUserRepoSynced()`（磁盘检查），而 `SyncStatus` 来自 `getUserSyncState()`（内存检查）
- 当 `syncing` 仍在进行时，`.git` 目录已存在，`isUserRepoSynced()` 返回 `true`，但 `SyncStatus` 为 `syncing`
- 前端切换页面后重新查询，由于后端不知道现在是否仍在 sync（内存状态不持久化的架构限制），前端依赖 `Synced: true` 判断，导致"同步中"状态丢失

### Bug 2：go-git Progress 未产出数据

`git.go:213-214` 设置了 `opts.Progress = &cloneProgressWriter{fn: progressFn}`，但 go-git v5 中 `CloneOptions.Progress` 的实际类型为 `transport.ProgressSideband`（`string` 类型的别名），其 `Write()` 方法为空实现。go-git 的智能 HTTP 传输层将其传给底层传输但不触发实际写入，导致进度数据未产出。

## 解决方案

### Bug 1：`isUserRepoSynced()` 改为优先检查内存状态

- `isUserRepoSynced()` 新增 `repoID` 参数，调用 `getUserSyncState()` 检查内存状态
- 若内存状态为 `STATE_SYNCED` → 返回 `true`（同步已完成）
- 若内存状态为 `STATE_SYNCING` → 返回 `false`（仍在同步，即使 `.git` 已存在）
- 若无内存状态或 `STATE_FAILED` → fallback 到 `.git` 目录检查
- 更新 `ListUserRepos` 和 `SyncUserRepo` 中的两处调用，传入 `repoID`

修改文件：`apps/dh-backend/domain/repository/service/db_service.go:270`、`320`、`357`

### Bug 2：改用 `os/exec git clone --progress` 获取可靠的进度输出

- `Clone()` 根据是否传入 `progressFn` 选择执行路径：
  - `progressFn != nil` → 调用 `cloneWithExec()`，使用原生 `git clone --progress`
  - `progressFn == nil` → 调用 `cloneWithGoGit()`，保持 go-git 路径（不改变无进度场景的行为）
- `cloneWithExec()` 通过 `cmd.StderrPipe()` 获取 stderr 输出，`bufio.Scanner` 逐行解析，`parseProgress()` 提取 `XX%` 模式
- clone 成功后回传 `100` 确保前端收到完成信号
- SSH 认证：将私钥写入临时文件（`0600` 权限），设置 `GIT_SSH_COMMAND` 环境变量，clone 完成后清理临时文件
- HTTPS 认证：通过 `embedCredentials()` 将凭证嵌入 clone URL（`user:token@host`）

修改文件：`packages/go-sdk/infrastructure/repository/git.go`
- 新增函数：`cloneWithExec`、`cloneWithGoGit`、`writeTempSSHKey`、`embedCredentials`
- 重构 `cloneProgressWriter` struct → 独立函数 `parseProgress`
- 添加 import：`bufio`、`os/exec`

### 验证

- `go vet ./...`（go-sdk + dh-backend）：0 warnings
- `pnpm run lint`：5 successful
- `npx tsc --noEmit`：0 errors
- `pnpm build`：5 successful
