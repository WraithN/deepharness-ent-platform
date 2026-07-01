# 优化：预览模式下的会话主窗口布局

## 需求

1. 预览模式下（右侧文件预览展开，聊天区占 1/4 宽度）输入框底部只展示"任务"和一个"加号"图标按钮，点击加号展开代码库/提示词/技能选择。
2. 会话主窗口内容需适配窄宽度：消息、卡片、用户输入完整展示，不被截断。
3. agent 选择从 Plus 按钮弹窗改为下拉 Select 切换。

## 实现

1. `apps/web/src/pages/Chat.tsx`
   - 输入框底部按钮区域根据 `showPreview` 条件渲染：预览模式下只保留"任务"按钮和加号菜单，加号菜单内按代码库/提示词/技能三个分组展示可选项。
   - 顶部"新增智能体" Plus 按钮改为 `Select` 下拉，选择 agent 后切换已有 tab 或新增 tab。
2. `apps/web/src/components/chat/AssistantMessage.tsx`
   - 移除固定 `max-w-[760px]`，使用 `w-full` 让消息气泡自适应容器宽度。
3. `apps/web/src/components/chat/FileAttachmentCard.tsx`
   - 文件附件卡片移除固定 `max-w-[760px]`，右侧缩略图宽度从 `w-48` 缩小到 `w-24`，避免窄窗口下溢出。

## 验证

- `pnpm check-types` ✅
- `pnpm lint` ✅
- `pnpm build` ✅
