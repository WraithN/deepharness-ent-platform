# 同步架构库后架构看板不出现（路径段索引错误）

## 现象
在架构设计工作台点击「同步架构库」后，同步动画结束、前端轮询判定 `synced=true`，
但页面仍停留在「架构库尚未同步到本地」的 not-synced 状态，预期的架构看板始终不出现。
反复点击同步按钮无效（每次后端返回 202，但 `arch/graph` 仍返回 `cloned:false`）。

## 根因
仓库 `local_path` 记录的是**创建者**的目录：`{root}/{creatorID}/{workspaceID}/dev-jobs/{repoName}`。
当当前操作用户不是创建者时，`resolveUserLocalPathStatic`（`standards_handler.go:126`）需把
creatorID 段替换为当前 userID。但该函数及 `extractCreatorUserIDFromLocalPath` 对路径段的
索引有误：

路径实际结构（split("/") 后）：
- `parts[len-1]` = repoName
- `parts[len-2]` = "dev-jobs"
- `parts[len-3]` = workspaceID
- `parts[len-4]` = creatorID

代码却用 `parts[len(parts)-3]` 校验是否等于 `dev-jobs`（实际该位置是 workspaceID），
导致校验恒为 false：
- `extractCreatorUserIDFromLocalPath` 始终返回 ""（无法识别创建者）；
- `resolveUserLocalPathStatic` 非创建者分支的前置校验失败，直接 `return repo.LocalPath`
  （返回创建者的原始路径，而非当前用户路径）。

于是 `isArchRepoCloned`（`arch_handler.go:196`）用**创建者的路径**通过当前用户的
personal-stub 检查文件是否存在 -> 当前用户目录下无该路径 -> `FileInfo` 返回不存在 ->
`cloned:false` -> 前端回到 not-synced。

而前端轮询的 `isUserRepoSynced`（`sync_lock.go:214`）用 `userProjectPath`（按当前 userID
重新拼接，不依赖 `repo.LocalPath`），所以 `synced=true`，触发 `loadGraph` -> `arch/graph`
返回 `cloned:false` -> not-synced。两套路径计算函数口径不一致，且 `resolveUserLocalPathStatic`
的索引错误使非创建者用户永远拿不到自己的路径。

> DB 实证：`local_path=/home/nan/test/8d7bdbea91df40ea8f2fd44881a1ec85/056529ec.../dev-jobs/deepharness-ent-arch`，
> `clone_status=cloned`；当前用户 `a0564de5...` 的 dev-jobs 目录下 `.git` 确实存在。
> 即文件系统与 DB 均正常，唯独 `resolveUserLocalPathStatic` 算错了路径。

## 解决方案
1. **修正路径段索引（核心修复）**：`extractCreatorUserIDFromLocalPath` 与
   `resolveUserLocalPathStatic` 中 `dev-jobs` 的校验从 `parts[len-3]` 改为 `parts[len-2]`
   （creatorID 取 `parts[len-4]` 保持不变）。涉及 `sync_lock.go` 与 `standards_handler.go`
   共三处。
2. **附带修复：SyncUserRepo 提前返回时修正 CloneStatus**：当文件系统已就绪但 DB
   `CloneStatus` 非 cloned 时（如空仓库 `initEmptyRepo` 后 fetch 失败残留 `.git`），
   调用 `markClonedIfStale` 修正 DB，消除"文件系统已就绪但 DB 滞后"的不一致。
3. **前端超时反馈改进**：轮询 5 分钟超时后不再静默停止，改为提示并重新 `loadGraph`
   确认最终状态。

### 影响文件
- `apps/dh-backend/domain/repository/standards_handler.go` - `resolveUserLocalPathStatic`
  与 `extractCreatorUserIDFromLocalPath` 索引修正。
- `apps/dh-backend/domain/repository/service/sync_lock.go` -
  `extractCreatorUserIDFromLocalPath` 索引修正。
- `apps/dh-backend/domain/repository/service/user_repo.go` - 提前返回分支调用
  `markClonedIfStale`；新增 `markClonedIfStale` 方法。
- `apps/dh-frontend/src/components/workspace/ArchDesignWorkspace.tsx` - 轮询超时回调
  增加 toast 提示与 `loadGraph` 重载。

### 验证结果
- `go vet ./...`（apps/dh-backend）0 warnings
- `go build ./...`（apps/dh-backend）通过
- `restart-dev.sh` 启动后端服务正常
- 注：架构库 `deepharness-ent-arch` 为空仓库（仅 `.git`，无 domains/services YAML），
  修复后 `cloned` 将变为 true，架构看板进入 ready 状态；但需点击「重新全局解析」
  生成 YAML 元数据后才会显示架构节点。
