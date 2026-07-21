# 2026-07-20 — AI 响应的 [[FILE:]] 标记中包含未解析的中文占位符路径导致 404

## 现象

用户使用 DeepHarness 的智能会话功能时，AI 回复中出现的文件附件卡片链接（如 `[[FILE:绝对路径/到/projects/products-jobs/stories/需求名称-user-stories.md]]`）点击后返回 HTTP 404 错误。URL 中包含 `绝对路径`、`需求名称` 等中文占位符文字，而非真实的文件系统路径。

## 根因

1. **AI Prompt 模板语法错误**：`command_config_defaults.go` 中 `/prd-write`、`/prd-research`、`/story-write`、`/test-plan`、`/test-case`、`/test-report`、`/ui-design`、`/design-token`、`/data-analyze` 等命令的 Template 使用了形如 `[[FILE:绝对路径/到/projects/products-jobs/stories/需求名称-user-stories.md]]` 的文字。这导致 AI 模型有时会直接输出模板中的占位符文字，而非将其替换为真实路径。

2. `AssistantMessage.tsx` 中解析 `[[FILE:...]]` 标记时，未对提取到的路径做合法性校验，直接将其传入 `FileAttachmentCard` 组件，触发 `GET /api/v1/files/content?path=绝对路径/到/...` 请求。

3. `files.go` 的 `safeFilePath()` 中，安全校验（`isPathAllowed`）只检查路径前缀是否在允许的根目录下，未检查路径本身是否包含未解析的模板变量。

## 解决方案

三层防御修复：

1. **修改 AI Prompt 模板**（`command_config_defaults.go`）：将所有命令的 Template 中 `[[FILE:绝对路径/到/...]]` 和 `[[PROJECT:绝对路径]]` 等占位符写法改为描述性指令。例如：
   - 旧：`[[FILE:绝对路径/到/projects/products-jobs/stories/需求名称-user-stories.md]]`
   - 新：`在回复末尾用 [[FILE:文件完整路径]] 标记你实际创建的用户故事文件。务必使用真实的文件系统绝对路径，不要使用占位符。`

2. **前端防御**（`AssistantMessage.tsx`）：在提取 `[[FILE:...]]` / `[[PROJECT:...]]` 标记后，过滤掉包含已知未解析中文占位符（如 `绝对路径`、`需求名称`、`调研主题`等）的路径，阻止无效的 API 请求。

3. **后端防御**（`files.go`）：在 `safeFilePath()` 中添加显式的未解析占位符检测，对包含已知占位符子串的路径直接返回 400 Bad Request。
