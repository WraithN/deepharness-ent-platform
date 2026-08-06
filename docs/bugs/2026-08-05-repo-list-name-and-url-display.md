# 2026-08-05-repo-list-name-and-url-display.md

## 现象

空间设置 → 基础配置 → 代码仓库列表中存在以下问题：

1. 每一行只展示了仓库地址输入框、分支输入框、类型下拉和操作按钮，缺少本地工程名展示。
2. 未配置远程地址的仓库没有明确的“配置远程”入口，交互不清晰。
3. 所有仓库共用底部的“保存仓库配置”按钮，无法针对单个仓库保存。
4. 设置/修改远程地址后没有实际执行 `git remote set-url`，仅更新了数据库配置。
5. 对输入的 Git URL 没有前端/后端校验，用户可以输入任意无效字符串（如 `1233232`）。
6. 没有展示本地未推送到远程的提交数量，也没有远程推送按钮。

影响范围：空间设置页的代码仓库列表，以及仓库领域服务/接口。

## 根因

前端把仓库列表渲染为一组紧凑的输入控件，没有表头区分，也没有把工程名、远程地址、分支/类型、操作按列展示；后端 `Update` 仅更新数据库字段，未同步本地 git 仓库的 remote origin URL，且缺少 URL 校验、推送、未推送提交检测等能力。

## 解决方案

### 前端：仓库列表重新设计

参考设计图改为类表格布局，表头为：工程名称 / Git 仓库地址 / 分支 / 仓库类型 / 操作。

1. **工程名称**：左侧固定宽度列展示 `repo.name`，为空时显示灰色“未命名”。
2. **Git 仓库地址**：
   - 已配置远程地址：直接展示为可编辑输入框，可直接修改。
   - 未配置远程地址：显示“未配置远程仓库” + “配置远程”按钮；点击后弹出 Dialog 输入远程地址。
3. **分支 / 仓库类型**：列表中只展示文本；统一放到操作列“设置”按钮弹窗中编辑。新增仓库默认分支 `main`、类型 `开发库`。
4. **操作**：每行提供“设置（齿轮）”、“保存（保存图标）”、“推送（上传图标）”、“删除（垃圾桶）”四个图标按钮；删除原来底部的“保存仓库配置”按钮。
5. **保存按钮禁用**：引入 `dirtyRepoIds` 记录存在未保存变更的仓库；保存成功后清除。以下情况置灰禁用：只读模式、本地未入库且未配置远程地址、无变更、URL 格式无效。
6. **推送按钮与未推送提示**：后端提供未推送提交数量接口；操作列显示橙色角标数量，数量大于 0 时推送按钮可点击，推送成功后刷新为 0。
7. **URL 校验**：前端增加 `isValidGitUrl` 校验，支持 `https://`、`ssh://`、`git://`、`git@host:path` 等格式，不仅限于 GitHub。

### 后端：仓库远程操作能力

1. **Update 接口增加 URL 校验**：复用 `gitrepo.IsValidGitURL`。
2. **Update 时同步本地 remote**：当仓库已克隆且 URL 变更时，调用 `gitClient.SetRemoteURL` 执行 `git remote set-url origin` 等效操作，再更新数据库。
3. **新增 SetRemoteURL 接口**：`POST /api/v1/workspaces/{id}/repositories/{repoId}/remote`，用于“配置远程”弹窗；校验 URL 后直接设置本地 remote 并更新数据库。
4. **新增 Push 接口**：`POST /api/v1/workspaces/{id}/repositories/{repoId}/push`，使用 go-git 推送当前分支到 origin，支持 SSH Key 认证。
5. **新增 UnpushedCommits 接口**：`GET /api/v1/workspaces/{id}/repositories/{repoId}/unpushed`，通过 `git rev-list --count HEAD --not --remotes` 统计未推送提交数量。

### 后续优化：默认远程地址、行内提示与工程名刷新

1. 移除“配置远程”弹窗，未配置远程地址的仓库直接在同一行展示 URL 输入框，可立即编辑或保存。
2. 加载仓库列表时，自动为已有本地工程名但无远程地址的仓库填充默认 GitHub 远程地址：`https://github.com/{workspace.name}/{repo.name}.git`；`{org}` 取当前空间名，未加载时 fallback 为 `org`。
3. 输入框下方增加详细提示：
   - 地址格式无效时以红色列出支持的 Git 远程格式（HTTPS / SSH / SCP / Git 协议）。
   - URL 解析出的仓库名称与当前本地工程名不一致时，以黄色提示“保存后工程名将由「当前名」变更为「新名」”。
4. 保存成功后使用后端返回的仓库对象刷新前端列表，确保工程名与数据库/本地 remote 保持一致，解决“本地工程名与远程解析名不一致”的问题。

## 相关文件

- `apps/dh-frontend/src/pages/Settings.tsx`
- `apps/dh-frontend/src/lib/repository-api.ts`
- `apps/dh-backend/domain/repository/handler.go`
- `apps/dh-backend/domain/repository/service/service.go`
- `apps/dh-backend/domain/repository/service/db_service.go`
- `apps/dh-backend/domain/repository/object/types.go`
- `apps/dh-backend/gateway/server/server.go`
- `packages/go-sdk/infrastructure/repository/git.go`

## 验证

- `pnpm --filter @repo/dh-frontend check-types` 通过。
- `pnpm --filter @repo/dh-frontend lint` 通过（Biome 无报错）。
- `cd apps/dh-backend && go vet ./...` 通过。
- `pnpm build` 全量构建成功。
- `bash scripts/restart-dev.sh` 重启后，前后端服务均正常响应（`/` 与 `/health` 返回 200）。
