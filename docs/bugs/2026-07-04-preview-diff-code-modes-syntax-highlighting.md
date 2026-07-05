# 2026-07-04 — 工程预览重构：Diff/代码/预览三模式 + 语法高亮

## 现象

1. 代码模式下点击文件提示"加载文件失败"——`AddAllowedRoot` 在 dev server 启动之后才调用，若 dev server 启动失败则文件 API 返回 403。
2. 预览界面只有代码/预览两个 tab，无法查看 git diff。
3. 代码内容使用 MarkdownView 渲染 code block，无语法高亮。
4. ProjectCard 的新建工程只有"预览工程"按钮，已有工程只有"查看 Diff"或"预览工程"按钮，无法自由切换模式。
5. 远程访问时 `localhost:4002` 拒绝连接——iframe URL 硬编码 `localhost`，远程浏览器无法访问。

## 根因

### 1. AddAllowedRoot 时序错误
`PreviewStart` handler 中 `AddAllowedRoot(req.Path)` 在 `devServerMgr.Start()` 之后调用。如果 dev server 启动失败（如 Next.js 不识别 `--host` 参数），handler 返回 500，`AddAllowedRoot` 未执行，导致文件内容 API 返回 403。

### 2. 缺少 Diff 模式
`LivePreview` 组件只有 `preview` 和 `code` 两个 tab，没有 diff 支持。`ProjectPreview` 组件虽有 `DiffPane` 但在 Chat 流程中未被渲染（dead code）。

### 3. 无语法高亮
代码内容通过 `MarkdownView` 渲染 `` ```\n${content}\n``` `` code block，未使用 `react-syntax-highlighter`（项目已安装但未在此处使用）。

### 4. Diff 策略不正确
后端 `ProjectDiff` 使用 `git diff HEAD`，仅对比工作区与最后一次提交，未对比 master/main 分支差异。且使用 `git diff main...HEAD`（三点点）仅显示提交差异，不包含未提交修改。

### 5. iframe URL 硬编码 localhost
后端返回 `http://localhost:{port}/`，远程访问时浏览器 iframe 中的 `localhost` 指向用户本机而非服务器。

## 解决方案

### 后端

1. **`preview.go`**：`AddAllowedRoot` 移到 dev server 启动之前，确保即使 dev server 失败文件浏览仍可用。
2. **`projects.go`**：`ProjectDiff` 改用 `git diff {baseBranch}`（两点 diff，对比工作区与基准分支），新增 `detectBaseBranch()` 自动检测 main/master。
3. **`devserver_manager.go`**：`detectDevFramework()` 根据框架类型选择正确参数（Vite 用 `--host`，Next.js 用 `--hostname`）；`waitForPort()` 等待端口就绪后才返回。
4. **`preview.go`**：不再返回 `previewUrl`，前端用 `window.location.hostname` 构建预览 URL。

### 前端

1. **`LivePreview.tsx` 重写**：
   - 三种模式：`diff`（side-by-side 文件对比）、`code`（文件树 + 语法高亮）、`preview`（纯 iframe）
   - 取消 tab 切换，改为顶部模式按钮（Diff / 代码 / 预览，预览仅前端工程显示）
   - Diff 视图使用 `react-diff-viewer-continued` 的 `splitView` 模式，左侧旧内容、右侧新内容
   - 代码内容使用 `react-syntax-highlighter` + `vscDarkPlus` 主题
   - Diff 无差异时自动切换到代码模式
   - Diff 左侧文件列表显示变更状态（+/-/M），点击切换文件
2. **`ProjectCard.tsx`**：三个按钮——"查看 Diff"、"预览页面"、"查看工程"，`onPreview` 回调传递 `PreviewMode`
3. **`Chat.tsx`**：`handleProjectPreview` 接收 `PreviewMode`；传递 `mode` 和 `onModeChange` 给 `LivePreview`
4. **`AssistantMessage.tsx` / `ChatThread.tsx`**：`onProjectPreview` 类型更新为 `(path, mode: PreviewMode) => void`
5. **`project-api.ts`**：新增 `FileDiffEntry` 类型，`ProjectDiffResponse` 增加 `files` 字段

### 验证结果

- `go build` / `go vet`：通过
- `tsc --noEmit`：通过
- `pnpm build`：通过
- `biome lint`：通过
- Diff API 返回正确差异（xiaohongshu-translator vs main：11292 字符）
- 预览 API 成功启动 Next.js dev server（port 4010）
- 文件内容 API 返回 200
