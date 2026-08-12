# 架构设计工作台仓库同步后无法就绪

## 现象
用户在架构设计工作台（ArchDesignWorkspace）点击"同步架构库"按钮后，页面显示同步中动画，数分钟后仍停留在"not-synced"状态，
反复点击也无济于事。

## 根因
系统存在两套独立的仓库同步机制：

1. **仓库级同步**（`syncRepository`，`db_service.go:277`）：在 `Create`/`Update` 触发，克隆到 `r.LocalPath`，
   并通过 `updateStatus` 将 `CloneStatus` 更新为 `Cloned`/`Cloning`/`Failed`。

2. **用户级同步**（`SyncUserRepo`，`user_repo.go:52`）：由"同步架构库"按钮触发，克隆到 `userProjectPath`（与上述路径相同），
   使用锁文件追踪进度，但**从未更新 `CloneStatus` 字段**。

而 `isArchRepoCloned`（`arch_handler.go:196`）**强制要求** `repo.CloneStatus == CloneStatusCloned` — 仅检查文件系统存在性不够。
因此用户级别同步成功后，该检查始终返回 `false`，`archApi.graph()` 返回 `{ cloned: false }`，
前端转到 `not-synced` 页面。轮询仅检查 `status.synced`，若 `CloneStatus` 未更新则无限循环直至超时。

## 解决方案
1. **后端修复**：`SyncUserRepo` 的 goroutine 在 `gitClient.Clone` 成功后调用 `updateStatusAndSyncTime`，
   将 `CloneStatus` 更新为 `Cloned`，使 `isArchRepoCloned` 可以通过。

2. **前端修复**：轮询逻辑增加 `syncStatus === 'failed'` 检测，同步失败时立即显示错误提示并停止轮询，
   避免静默等待 5 分钟超时。

### 影响文件
- `apps/dh-backend/domain/repository/service/user_repo.go` — goroutine 中增加 `updateStatusAndSyncTime` 调用
- `apps/dh-frontend/src/components/workspace/ArchDesignWorkspace.tsx` — 轮询逻辑增加故障检测
- `apps/dh-frontend/src/lib/repository-api.ts` — `UserRepoStatus` 接口增加 `errorMessage` 字段
