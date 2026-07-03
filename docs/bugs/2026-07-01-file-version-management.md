# 文件版本管理与会话目录结构

## 现象

1. AI 生成的文件没有统一的目录结构，散落在各处，难以管理。
2. 同名文件重复生成时直接覆盖，无法追溯历史版本。
3. 文件预览页面无法查看或切换历史版本。
4. 文件访问权限使用硬编码的 `extraAllowedRoots`（`/home/nan`、`/tmp`、`/root`），不可配置。

## 根因

- 提示词模板仅要求 agent 用 `[[FILE:path]]` 标记文件路径，但未指定文件应写入的目录结构，agent 自由选择写入位置。
- 没有版本管理机制，agent 每次用相同文件名 Write 时直接覆盖。
- 后端 `files.go` 的 `extraAllowedRoots` 硬编码了开发者机器路径，无法适应不同环境。
- 文件预览页面 `FileView.tsx` 只展示单个文件，无版本概念。

## 解决方案

### 1. 提示词模板：指定文件目录与版本命名（useAgUiChat.ts）

将 `PROMPT_TEMPLATE_RULES` 改为 `buildPromptRules(sessionId)` 函数，动态注入 session_id：
- 文件必须写入 `{session_id}/files/` 子目录（相对于 agent 工作目录）
- 同名同扩展名文件已存在时，新文件追加版本后缀 `-v2`、`-v3` 等
- 首次创建不带版本后缀

最终文件路径结构：`WORKSPACE_ROOT/{workspace_id}/{user_id}/{session_id}/files/{name}-v{N}.{ext}`

### 2. 后端文件版本检测（files.go）

新增版本解析与检测：
- `parseFileVersion(filename)`：从文件名解析 baseName、版本号、扩展名
  - `report-v2.md` → `("report", 2, ".md")`
  - `report.md` → `("report", 0, ".md")`
- `findFileVersions(absPath)`：扫描同目录下相同 baseName + ext 的所有版本文件，按版本号升序返回

新增 `FileVersions` 端点 `GET /api/v1/files/versions?path=...`，返回版本列表。

`FileContent` 端点响应增加版本字段：`baseName`、`ext`、`version`、`versions`。

### 3. 文件访问权限可配置（files.go + server.go）

- 移除硬编码的 `extraAllowedRoots`
- 新增 `SetAllowedRoots(roots []string)` 函数，由 `server.go` 传入 `cfg.RepositoryRoot`
- `isPathAllowed` 检查 `filesRoot`（AGUIWorkspace）和 `allowedRoots`（RepositoryRoot）

### 4. 前端版本切换器（FileView.tsx + file-api.ts）

- `file-api.ts` 新增 `FileVersionInfo` 类型和 `fileApi.versions()` 方法
- `FileView.tsx` 标题栏展示 `文件名 v版本号`（如 `report.md v2`）
- 多版本时显示版本切换下拉菜单，默认最新版本
- 切换版本时更新 URL path 参数，重新加载文件内容

### 验证结果

- `go vet ./gateway/...` 通过
- `tsc --noEmit` 通过
- `pnpm build` 成功
- 文件版本 API 测试通过：
  - `GET /api/v1/files/versions` 正确返回 `[v1, v2]` 版本列表
  - `GET /api/v1/files/content` 响应包含 `baseName`、`version`、`versions` 字段
- 文件路径 `repositoryRoot` 下的文件可正常访问
