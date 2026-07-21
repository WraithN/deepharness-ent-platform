# 用户故事卡片未正确渲染

## 现象

1. `/user-story` 命令执行后，消息底部出现两个卡片：FileAttachmentCard（HTTP 404 报错）和 UserStoryCard
2. 文件被删除后未重新生成，导致 FileAttachmentCard 显示 404
3. UserStoryCard **从未实际渲染**（虽然组件代码已存在并设计完成）

## 根因

**核心问题**：`AssistantMessage.tsx` 中的 `hasUserStory` 判断逻辑依赖 `legacyDataParts` 中是否存在 `name='user_story'` 的 data part，但**后端从未创建过这种 data part**。

用户故事的实际传输方式：
- `/user-story` 命令模板（`commands.yaml` 第 363 行）要求 LLM 输出格式化的故事文本 + `[[FILE:.../stories/<name>-user-stories.md]]` 标记
- 后端将 LLM 输出作为纯文本流式传输，不会将用户故事包装为 `data` part
- 因此 `legacyDataParts` 中永远不会有 `name='user_story'` 的条目

**次要问题**：`[[FILE:...]]` 标记被 `parseFileMarkers` 解析后，用户故事文件路径被添加到 `fileAttachments`，触发了 `FileAttachmentCard` 渲染。由于文件不存在（LLM 只输出了标记但未实际创建文件），导致 HTTP 404。

## 解决方案

1. 移除了对不存在的 `legacyDataParts['user_story']` 的依赖
2. 新增路径模式检测：通过正则 `/\/stories\/[^/]+-user-stories\.md$/` 识别用户故事文件
3. 将 `fileAttachments` 拆分为 `userStoryFiles`（用户故事）和 `nonStoryFiles`（普通文件）
4. 对用户故事文件，从文本内容中解析 `UserStoryData`：
   - 从文件路径提取标题（需求名称）
   - 按"作为"模式拆分为独立故事块
   - 检测 P0/P1/P2 优先级
   - 提取 Given/When/Then 验收标准
5. 渲染 `UserStoryCard` 展示解析后的数据
6. 普通文件（`nonStoryFiles`）继续由 `FileAttachmentCard` 渲染

### 修改文件

- `apps/dh-frontend/src/components/chat/AssistantMessage.tsx`：新增 `USER_STORY_FILE_PATTERN` 常量、`parseUserStoryFromText()` 解析函数、文件过滤逻辑、UserStoryCard 渲染入口
