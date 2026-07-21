# 2026-07-21 — AI 命令模板使用相对路径 projects/，导致文件创建到仓库根目录

## 现象

用户通过 DeepHarness 智能会话执行 `/prd-write`、`/proto-make`、`/code` 等命令时，AI 生成的文件落到了仓库根目录的 `projects/` 下（例如 `projects/products-jobs/prd/...`、`projects/user-login/...`），而不是预期的 `workspace_root/{workspace_id}/{user_id}/projects/...` 目录下。

这会导致：
- 源码仓库被运行时文件污染（`projects/` 出现在 `git status` 未跟踪文件列表中）。
- 不同用户/工作空间的文件没有隔离，可能互相覆盖。
- 文件预览/下载接口依赖 agent-stub 的 `workspace.root` 配置，仓库根目录下的 `projects/` 与实际 workspace 路径不一致，可能引发权限或访问问题。

## 根因

1. **AI Prompt 模板写死了相对路径 `projects/`**
   - `apps/dh-backend/config/commands.yaml` 和 `apps/dh-backend/gateway/handler/command_config_defaults.go` 中的多个指令模板要求 AI 将文件写入 `projects/...` 或 `projects/products-jobs/...`。
   - 例如 `/prd-write` 模板：`将 PRD 文档写入 projects/products-jobs/prd/ 目录下`。`{WORKSPACE_PATH}` 占位符缺失。

2. **模板渲染仅替换 `{ARGS}`，不注入 workspace 路径**
   - `apps/dh-backend/gateway/handler/command.go` 中的 `renderTemplate()` 只处理 `{ARGS}`，没有 `{WORKSPACE_PATH}`、`{WORKSPACE_ID}`、`{USER_ID}` 等占位符。
   - `interceptCommands()` 也没有接收 workspace 路径参数。

3. **agent 按自身 cwd 解析相对路径**
   - AI 收到相对路径 `projects/...` 后，会基于当前工作目录创建目录。当前 agent 实际运行的 cwd 是仓库根目录，因此 `projects/` 被创建到仓库根下。
   - 虽然 `CreateSession` 已经通过 `resolveWorkspacePath()` 正确计算出 `workspace_root/{workspace_id}/{user_id}` 并传给 gatewayd，但模板中并未使用这个路径，agent 无法据此推断目标目录。

4. **`.gitignore` 未排除根目录 `projects/`**
   - 运行时生成的 `projects/` 目录因此会出现在 git 未跟踪文件中，容易被误提交。

## 解决方案

1. **扩展模板渲染函数**
   - 修改 `apps/dh-backend/gateway/handler/command.go`：
     - `renderTemplate()` 增加 `workspacePath` 参数，替换模板中的 `{WORKSPACE_PATH}` 为 `workspace_root/{workspace_id}/{user_id}`。
     - `interceptCommands()` 增加 `workspacePath` 参数并传给 `renderTemplate()`。
   - 修改 `apps/dh-backend/gateway/handler/intent.go`：
     - `applyIntentCommand()` 同样接收 `workspacePath` 并传给 `renderTemplate()`，保证意图识别路径的模板渲染一致。

2. **在 AGUIHandler 中解析并传递 workspace 路径**
   - 修改 `apps/dh-backend/gateway/handler/agui.go`：
     - `NewAGUIHandler` 增加 `workspaceRoot` 参数。
     - `AgentRun` 中从 session 读取 `WorkspacePath`；若 session 未命中，则使用 `resolveWorkspacePath(workspaceID, userID, workspaceRoot)` 兜底计算。
     - 将计算出的 `workspacePath` 传给 `interceptCommands()` 和 `applyIntentCommand()`。

3. **更新所有命令模板为绝对路径**
   - 修改 `apps/dh-backend/config/commands.yaml` 和 `apps/dh-backend/gateway/handler/command_config_defaults.go`：
     - 所有 `projects/...` 路径改为 `{WORKSPACE_PATH}/projects/...`。
     - 输出标记示例 `[[FILE:...]]` / `[[PROJECT:...]]` 同样改为 `{WORKSPACE_PATH}/projects/...`。

4. **更新 `.gitignore`**
   - 在 `.gitignore` 中加入 `/projects/`，防止仓库根目录下运行时生成的 `projects/` 被误提交。

## 验证结果

- `cd apps/dh-backend && go build ./...` 通过。
- `cd apps/dh-backend && go vet ./...` 无 warning。
- `cd apps/agent-stub && go build ./...` 通过。
- `pnpm build` 构建全部应用成功。
- `pnpm check-types` 类型检查通过。
- 修复后，AI 收到的模板中 `projects/` 已替换为 `/home/nan/test/{workspace_id}/{user_id}/projects/...` 的绝对路径，不会再写入仓库根目录。

## 相关文件

- `apps/dh-backend/gateway/handler/command.go`
- `apps/dh-backend/gateway/handler/intent.go`
- `apps/dh-backend/gateway/handler/agui.go`
- `apps/dh-backend/gateway/server/server.go`
- `apps/dh-backend/config/commands.yaml`
- `apps/dh-backend/gateway/handler/command_config_defaults.go`
- `.gitignore`
