# 仓库分支接口 404：本地目录缺失未自动重新克隆

## 现象

访问 `GET /api/v1/workspaces/{id}/repositories/{repoId}/branches` 返回 404，
前端项目代码页面无法加载分支列表。浏览器控制台报错：
```
api/v1/workspaces/ws-default/repositories/71bc4b31-.../branches 404 (Not Found)
```

## 根因

数据库中仓库 `clone_status = 'cloned'`，但本地目录已被删除（磁盘清理/迁移）。
`fetchBranchesFromGit` 检测到 `os.Stat(repo.LocalPath)` 失败时返回
`fmt.Errorf("repository local path not found")`，错误消息包含 "not found"，
被 `HandleServiceError` 匹配为 404 响应。

问题链路：
1. 仓库创建时异步 clone 到本地目录 -> DB 记录 `clone_status = 'cloned'`
2. 本地目录被外部清理（磁盘清理/手动删除/系统迁移）
3. DB 状态仍为 `cloned`，未感知到目录缺失
4. 请求分支列表 -> `os.Stat` 失败 -> 返回 "not found" -> 404
5. 前端无法显示分支，页面功能不可用

受影响的接口（6 处）：
- `GetBranches` / `RefreshBranches`
- `GetFileTree`
- `GetFileContent`
- `SwitchBranch`
- `WriteFile`
- `GitCommit` / `GitStatus`

## 解决方案

### 1. 新增 `ensureLocalPath` 辅助方法

检测本地目录是否存在。若不存在：
- 标记 DB 状态为 `pending`（触发重新克隆）
- 异步调用 `syncRepository` 执行重新克隆
- 返回明确错误（不包含 "not found" 以避免被误判为 404）

### 2. `fetchBranchesFromGit` 降级处理

分支列表接口在本地目录缺失时：
- 触发异步重新克隆
- 返回默认分支作为降级（HTTP 200 + `[{"name":"main","isCurrent":true}]`）
- 前端页面正常加载，用户重新刷新后可看到完整分支列表

### 3. 统一替换所有路径检查

将 6 处 `repo.LocalPath == "" + os.Stat` 模式统一替换为 `ensureLocalPath` 调用，
确保所有仓库操作在本地目录缺失时自动触发重新克隆。

### 涉及文件

- `apps/dh-backend/domain/repository/service/db_service.go`：
  - 新增 `ensureLocalPath` 方法
  - 新增 `fallbackBranches` 方法
  - `fetchBranchesFromGit`：本地目录缺失时降级返回默认分支
  - `GetFileTree` / `GetFileContent` / `SwitchBranch` / `WriteFile` / `GitCommit` / `GitStatus`：统一使用 `ensureLocalPath`

### 验证

- `go vet ./...`：0 warnings
- `GET /branches` 从 404 变为 200，返回 `[{"name":"main","isCurrent":true}]`
- 后端日志显示 `triggering re-clone`
- 10 秒后 DB 状态变为 `cloned`，本地目录恢复
- 再次请求返回完整分支列表
