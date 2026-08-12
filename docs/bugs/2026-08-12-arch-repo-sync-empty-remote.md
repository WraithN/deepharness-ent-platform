# 架构库同步失败：remote repository is empty

## 现象
在架构设计工作台点击「同步架构库」后，页面提示：
`同步架构库失败：克隆仓库失败: git clone failed: remote repository is empty`。
目标架构库（如 deepharness-ent-arch）是刚创建的空仓库（无任何提交），同步无法进行。

## 根因
`packages/go-sdk/infrastructure/repository/git.go` 的 `cloneWithGoGit` 本已为「空仓库」
准备了 `initEmptyRepo` 兜底路径（PlainInit + 设置 origin + fetch），但触发条件写的是
`errors.Is(err, transport.ErrEmptyRemoteRepository)`。

经核查 go-git v5.19.1 源码，`transport.ErrEmptyRemoteRepository` 哨兵错误**仅在 go-git
作为服务端**（`plumbing/transport/server/server.go`）时产生；客户端克隆路径从不返回它。
真实场景下错误来自远程 Git 服务器（Gitea/GitLab 等）在协议层返回的纯文本
`"remote repository is empty"`，`errors.Is` 无法识别，导致兜底路径成为死代码，
错误被直接包装为 `git clone failed: remote repository is empty` 抛给前端。

同样的问题也存在于 `initEmptyRepo` 内部的 fetch 容错判断（同样只用 `errors.Is`）。

## 解决方案
1. 新增 `isEmptyRemoteError(err)` 辅助函数：先 `errors.Is` 匹配哨兵错误，
   再用 `strings.Contains(err.Error(), transport.ErrEmptyRemoteRepository.Error())`
   做文本兜底匹配，兼容服务器返回的纯文本错误。
2. `cloneWithGoGit` 的空仓库判断改用 `isEmptyRemoteError`；空仓库错误不再走
   main/master 分支重试（避免无效网络往返），直接进入 `initEmptyRepo`。
3. `initEmptyRepo` 的 fetch 容错同样改用 `isEmptyRemoteError`。
4. 新增单元测试 `git_internal_test.go::TestIsEmptyRemoteError` 覆盖哨兵、
   包装哨兵、服务器文本、无关错误等场景。

### 影响文件
- `packages/go-sdk/infrastructure/repository/git.go` — 新增 `isEmptyRemoteError`，两处判断改用它
- `packages/go-sdk/infrastructure/repository/git_internal_test.go` — 新增单元测试

### 验证结果
- `go test ./infrastructure/repository/...`（packages/go-sdk）通过
- `go vet ./...`（packages/go-sdk、apps/dh-backend）0 warnings
- `go build ./...`（apps/dh-backend）通过
