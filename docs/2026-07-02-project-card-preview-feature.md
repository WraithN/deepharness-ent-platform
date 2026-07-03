# AI 工程项目卡片与预览功能

## 功能概述

当用户与 AI 进行对话时，AI 创建或修改的工程项目会以卡片形式展示在对话消息底部。

- **新建工程**：显示绿色卡片，点击「预览工程」可查看目录树和代码详情，点击「同步到仓库」可将工程提交到 Git 仓库
- **已有工程修改**：显示琥珀色卡片，点击「查看 Diff」可查看 git diff

## 目录结构

所有工程代码的根目录统一在：

```
WORKSPACE_ROOT/{workspace_id}/{user_id}/projects/{project-name}/
```

例如：`/home/nan/test/ws-default/default/projects/my-app/`

## 技术实现

### 后端 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/projects/check?path=...` | 检查工程状态（新建/已有），新工程自动初始化 git |
| GET | `/api/v1/projects/tree?path=...` | 获取工程文件树（尊重 .gitignore） |
| GET | `/api/v1/projects/diff?path=...` | 获取 git diff |
| POST | `/api/v1/projects/sync` | 提交所有更改到 git 仓库 |

文件位置：`apps/dh-backend/gateway/handler/projects.go`

### Git 工作流

1. **新建工程检测**：`ProjectCheck` 发现目录无 `.git` → 自动 `git init` + `git add .` + `git commit`（基线提交）
2. **已有工程修改检测**：`ProjectCheck` 发现有 `.git` → `git status --porcelain` 检查是否有未提交更改
3. **Diff 获取**：`ProjectDiff` 执行 `git diff HEAD` 获取与基线的差异
4. **同步**：`ProjectSync` 执行 `git add .` + `git commit`，返回提交 hash

### 前端组件

| 组件 | 文件 | 说明 |
|------|------|------|
| `ProjectCard` | `components/chat/ProjectCard.tsx` | 工程卡片（绿色=新建，琥珀色=修改） |
| `ProjectPreview` | `components/chat/ProjectPreview.tsx` | 预览面板（目录树+代码 / diff 视图） |
| `projectApi` | `lib/project-api.ts` | API 客户端 |

### 消息标记解析

AI 在回复末尾输出 `[[PROJECT:/abs/path/to/project-name]]` 标记。

`AssistantMessage.tsx` 解析标记后：
1. 从显示文本中移除标记
2. 在消息底部渲染 `ProjectCard` 组件
3. 卡片自动调用 `projectApi.check()` 判断工程类型

### 提示词模板

`useAgUiChat.ts` 中的 `buildPromptRules()` 指示 AI：
- 将工程文件写入 `projects/{项目名}/` 子目录
- 修改已有工程时直接在对应目录修改
- 工程完成后输出 `[[PROJECT:/abs/path]]` 标记
- 单文件仍使用 `[[FILE:/abs/path]]` 标记

## 预览交互

- 点击工程卡片的「预览工程」或「查看 Diff」→ Chat 页面分栏展示 `ProjectPreview`
- 文件预览模式：左侧目录树 + 右侧代码查看器（支持多 tab）
- Diff 预览模式：使用 `DiffView` 组件渲染 git diff
