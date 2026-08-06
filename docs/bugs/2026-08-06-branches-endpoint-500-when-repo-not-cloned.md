# 仓库分支接口返回 500 错误

## 现象

访问 `GET /api/v1/workspaces/{workspaceId}/repositories/{repoId}/branches` 接口时返回 500 Internal Server Error，前端显示"加载仓库列表失败"。

日志中仅记录：
```
GET /api/v1/workspaces/.../repositories/.../branches 500 1.071977ms
```
无具体错误原因输出。

## 根因

1. **仓库克隆失败**：该仓库 URL 为 `1233232`（无效 URL），克隆失败后 `local_path` 为空、`clone_status` 为 `failed`。
2. **错误处理不当**：`fetchBranchesFromGit` 在 `repo.LocalPath == ""` 时直接返回 `fmt.Errorf("repository not cloned yet")`，该错误不匹配 `ErrNotFound`，导致 `HandleServiceError` 返回 500。
3. **错误日志缺失**：`HandleServiceError` 未记录实际 error 对象，日志中无法看到具体失败原因，增加排查难度。

## 解决方案

1. **`branch_service.go`**：当 `LocalPath` 为空时，不再返回 error，改为记录日志并返回 `fallbackBranches`（仅默认分支），与"本地目录不存在"的降级逻辑保持一致。
2. **`common.go`**：在 `HandleServiceError` 中增加 `log.Printf` 输出实际 error，便于后续排查。

### 变更文件

- `apps/dh-backend/domain/repository/service/branch_service.go:63-66`：`LocalPath` 为空时返回 fallback 分支而非 error。
- `apps/dh-backend/gateway/handler/common.go:66-73`：`HandleServiceError` 增加 error 日志。

### 验证结果

修复后接口返回 200：
```json
[{"name":"master","isCurrent":true,"isRemote":false,"lastCommit":"","ahead":0,"behind":0}]
```
日志输出：
```
[Repository] local path empty for repo ... (status=failed, error=unsupported git URL scheme: ), returning fallback branches
GET /api/v1/workspaces/.../repositories/.../branches 200 2.018573ms
```
