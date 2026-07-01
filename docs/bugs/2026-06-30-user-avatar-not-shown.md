# 用户头像不展示 / 聊天消息挤压

## 现象

- 聊天界面中用户头像在右侧经常不显示，消息内容区似乎占满了整行。
- 在 1/4 预览窗口等窄宽度场景下，用户消息气泡和 AI 消息气泡出现挤压或溢出。
- 用户输入内容较短时气泡仍被拉伸到很宽，导致视觉不协调。

## 根因

1. `UserMessage.tsx` 中内容容器使用 `max-w-[85%]`，没有为右侧头像预留固定空间；在窄宽度或内容较长时头像被 flex 布局压缩甚至推出可视区域。
2. 用户头像 div 虽然设置了固定宽高，但没有额外强调 `shrink-0`，在某些浏览器/窄宽下仍可能被压缩。
3. 用户和 AI 的消息气泡都使用 `w-full`，导致短文本也被撑开到最大可用宽度，无法按内容自适应。

## 解决方案

- `UserMessage.tsx`：
  - 将内容区最大宽度改为 `max-w-[calc(100%-2.5rem)]`，为 8 (2rem) + gap (0.75rem) 的头像区域留出固定空间。
  - 给用户头像增加 `shadow-sm` 并确保 `shrink-0` 已存在，避免被压缩。
  - 将消息气泡从 `w-full` 改为 `w-fit max-w-full`，让短文本按内容宽度展示，长文本自动换行不溢出。
- `AssistantMessage.tsx`：
  - 同样将 AI 消息气泡改为 `w-fit max-w-full min-w-0`，保证内容自适应且不撑破父容器。
- `Chat.tsx`：
  - 恢复「新增智能体」为 Plus 图标按钮。
  - 在文件预览 1/4 窗口模式下，将智能体 tab 栏改为 Select 下拉；非预览模式保持原 tab 列表。

## 验证

- 执行 `pnpm --filter @repo/web check-types` 通过，无 TypeScript 错误。
- 执行 `pnpm --filter @repo/web build` 成功构建。
- 执行 `pnpm --filter @repo/dh-backend build` 与 `go vet ./...` 成功，无 Go warning。
- 开发服务器 `http://localhost:8888` 响应正常，前端 HMR 已自动加载更新。

## 后续迭代

1. 头像仍被截断一半 / 完全看不到：
   - 给 `ChatThread` 的 `Viewport` 增加 `px-2`，给 `ScrollArea` 增加 `pr-8`，从容器侧为右侧头像留出空间。
   - 尝试过绝对定位后发现头像会完全丢失，因此改回 flex 布局：内容区使用 `max-w-[calc(100%-2.75rem)] min-w-0`，精确预留 `gap-3`（0.75rem）+ 头像（2rem）的空间，避免总宽度超出父容器而被裁剪。
2. 预览模式 `+` 菜单：
   - 改为真正两级弹出：点击 `+` 先显示横向一级图标按钮（代码库 / 提示词 / 技能），hover 显示 `title` tooltip；点击图标后再弹出对应的上拉二级菜单。
3. 任务上拉弹窗改为固定高度 `h-[360px]`，内容区使用 `flex-1 overflow-y-auto`，保证竖向滚动条始终可用。
