# 2026-08-10-comet-flow-not-triggered-due-to-workspace-root-mismatch.md

## 现象

在前端发送 `/code` 指令后，comet 工作流没有实际执行：

1. 数据库中 `comet_flow` 开关为 `true`，但 agent 运行时仍按普通指令流程处理，没有加载 `comet-classic` skill。
2. 直接调用 `POST /api/v1/agent` 后，gatewayd 端日志显示 `Process error: opencode serve did not become ready after 5 attempts`。
3. `dh-backend` 日志中 `ensureWorkspaceDir` 报错 `HTTP 403: path outside allowed root`。
4. `personal-stub` 启动日志显示 `workspaceRoot=/tmp/deepharness-workspace/{userId}`，而 `dh-backend` 配置中的 `workspace.root` 为 `/home/nan/test`，两者不一致。

## 根因

1. `apps/dh-backend/agent/provisioner/directhost/manager.go` 的 `NewManagerFromConfig` 在构造 `Manager` 时遗漏了 `WorkspaceRoot` 字段，导致 `m.resolveWorkspaceRoot(s)` 取到空值。
2. `resolveWorkspaceRoot` 在 `workspaceRoot` 为空时回退到 `filepath.Join(os.TempDir(), "deepharness-workspace")`，因此启动 `personal-stub` 时注入的 `WORKSPACE_ROOT` 环境变量是 `/tmp/deepharness-workspace/{userId}`。
3. `personal-stub` 根据该路径设置文件操作允许根目录，并上报 workspace path 给 `dh-backend`。
4. `dh-backend` 内部使用 `/home/nan/test/{userId}/{workspaceId}` 解析工作目录，并向 `personal-stub` 请求创建该目录；`personal-stub` 认为 `/home/nan/test/...` 超出了自身允许的 `/tmp/deepharness-workspace/...` 根目录，返回 `403 path outside allowed root`。
5. 工作目录最终未能创建，gatewayd 在启动 opencode 时发现 `invalid work_directory '/home/nan/test/...'`（目录不存在），反复重试 5 次后失败，agent run 无法完成，comet 流程自然无法触发。

## 解决方案

1. 在 `apps/dh-backend/config/config.go` 的 `DirectHostConfig` 中增加 `WorkspaceRoot` 字段，并在 `Load()` 阶段将上层 `Config.WorkspaceRoot` 注入到 `DirectHostConfig`。
2. 在 `apps/dh-backend/agent/provisioner/directhost/manager.go` 的 `NewManagerFromConfig` 中传递 `WorkspaceRoot: cfg.WorkspaceRoot`。
3. 保证 `dh-backend` 与 `personal-stub` 使用同一根目录（`/home/nan/test`），工作目录创建和 opencode 启动都能成功。

## 相关文件

- `apps/dh-backend/config/config.go`
- `apps/dh-backend/agent/provisioner/directhost/manager.go`

## 验证

- `go build -o dist/dh-backend .` 编译通过
- `go vet ./...` 无 warning
- `bash scripts/restart-dev.sh` 重启开发环境
- 重新触发 `/code` 请求：opencode 成功启动并完成 comet 工作流，最终返回包含 `[[PROJECT:...]]` 标记的回复
- 工作目录 `/home/nan/test/{userId}/{workspaceId}` 成功创建并写入文件
