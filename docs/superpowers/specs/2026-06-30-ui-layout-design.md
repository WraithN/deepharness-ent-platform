# UI 布局改造设计文档

## 背景与目标

对 DeepHarness 前端进行三项布局改造：

1. 主侧边栏永久收缩，不再允许用户展开。
2. 当模型输出 `[[FILE:...]]` 文件预览卡片时，点击卡片在当前页面展开预览，与会话窗口同页并列展示（预览 3/4，会话 1/4），并带有平滑动画。
3. 工程代码、数据大盘、空间设置三个页面的内容区加宽，挤满整个内容区，与会话窗口当前宽度一致。

## 设计方案

### 1. 主侧边栏永久收缩

**涉及文件：**
- `apps/web/src/components/layout.tsx`

**改动：**
- 将桌面端侧边栏默认状态改为收缩：
  ```tsx
  const [isCollapsed, setIsCollapsed] = useState(true);
  ```
- 完全移除桌面端的展开/收缩切换按钮（`hidden lg:flex` 的绝对定位按钮），避免用户手动展开。
- 移动端侧边栏（`sidebarOpen`）保留，用于小屏幕导航，不受影响。
- 侧边栏宽度保持 `w-14`（约 56px），与现有收缩态一致。

**效果：**
- 主内容区始终获得侧边栏收缩后的可用宽度。
- 无法通过 hover 或点击展开侧边栏。

### 2. 文件预览卡片同页分栏展开

**涉及文件：**
- `apps/web/src/pages/Chat.tsx`：新增分栏状态与布局容器。
- `apps/web/src/components/chat/FileAttachmentCard.tsx`：将点击事件改为通知父组件，而非 `window.open`。
- `apps/web/src/pages/FileView.tsx`：提取文件内容获取逻辑，供内联预览复用（可选）。

**改动：**
- 在 `Chat` 组件中新增状态：
  ```tsx
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  ```
- `FileAttachmentCard` 的 `onClick` 不再直接打开新标签，而是调用父组件传入的 `onPreview(path)`。
- `Chat.tsx` 根容器在 `showPreview` 为 `true` 时切换为 flex 分栏布局：
  ```tsx
  <div className="h-[calc(100vh-6rem)] md:h-[calc(100vh-4rem)] flex flex-row ... w-full relative">
    {/* 预览区 */}
    <div className={cn(
      "h-full flex flex-col border-r bg-background overflow-hidden transition-all duration-500 ease-in-out",
      showPreview ? "w-3/4 opacity-100" : "w-0 opacity-0"
    )}>
      {previewPath && <InlineFilePreview path={previewPath} />}
    </div>

    {/* 聊天区 */}
    <div className={cn(
      "h-full flex flex-col min-w-0 transition-all duration-500 ease-in-out",
      showPreview ? "w-1/4" : "flex-1 w-full"
    )}>
      {/* 原有聊天内容 */}
    </div>
  </div>
  ```
- 新增内联预览组件 `InlineFilePreview`：
  - 接收 `path` prop。
  - 调用 `/api/v1/files/content` 获取文件内容。
  - 使用 `MarkdownView` 渲染代码内容（与 `FileView.tsx` 一致）。
  - 顶部提供关闭按钮，点击后 `setShowPreview(false)`，聊天区恢复全宽。
- 动画使用 Tailwind `transition-all duration-500 ease-in-out`，同时控制 `width` 与 `opacity`，实现平滑展开/收起。

**效果：**
- 点击文件预览卡片后，预览区从右侧平滑展开至 3/4 宽度，聊天区压缩至 1/4。
- 聊天区保留完整界面（消息列表 + 输入框），仅在水平方向压缩。
- 再次点击关闭按钮或选择其他文件时，布局平滑过渡。

### 3. 工程代码、数据大盘、空间设置内容区加宽

**涉及文件：**
- `apps/web/src/pages/ProjectCode.tsx`
- `apps/web/src/pages/Dashboard.tsx`
- `apps/web/src/pages/Settings.tsx`

**改动：**
- 将三个页面根容器的 `max-w-7xl mx-auto` 替换为 `w-full`（保留 `w-full`）。
- 移除内部不必要的居中 `max-w-*` 限制（如 `max-w-3xl`、`max-w-5xl`），使其内容充分利用加宽后的空间。
- 保持 `Layout` 外层 `p-4 md:p-6 lg:p-8` 的 padding 不变，因此内容区宽度 = 主区域宽度 - 外层 padding，与 Chat 页当前可用宽度一致。

**效果：**
- 三个页面的内容区横向铺满，不再局限于 1280px 居中宽度。
- 与 Chat 页在侧边栏收缩后的可用宽度保持一致。

## 数据流

```
用户点击 FileAttachmentCard
  → onPreview(path) 回调
  → Chat.tsx setPreviewPath(path) + setShowPreview(true)
  → Chat.tsx 根容器重新分配宽度（3/4 预览 + 1/4 聊天）
  → InlineFilePreview 加载 /api/v1/files/content 并渲染
```

## 依赖与约束

- 使用项目已有的 `tailwindcss-animate` 与 Tailwind transition 工具类实现动画，无需新增依赖。
- 复用现有 `MarkdownView` 组件渲染文件内容。
- 不修改后端 API。
- 保持移动端响应式：小屏幕下优先保证聊天可用，预览区可考虑全屏或抽屉 fallback（不在本次范围内，默认保持桌面行为）。

## 验收标准

- [ ] 侧边栏默认收缩，无展开按钮。
- [ ] 点击 `[[FILE:...]]` 预览卡片，当前页面平滑分栏为 3/4 预览 + 1/4 聊天。
- [ ] 工程代码、数据大盘、空间设置页面内容区宽度与 Chat 页一致，无额外 max-width 限制。
- [ ] `pnpm build`、`pnpm check-types`、`pnpm lint` 通过。
- [ ] 开发服务器启动后，上述功能可正常验证。
