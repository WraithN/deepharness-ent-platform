# UI 布局改造实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成三项前端布局改造：主侧边栏永久收缩、文件预览卡片同页 3/4 分栏展开、工程代码/数据大盘/空间设置内容区加宽。

**Architecture：** 在 `Layout` 中固定侧边栏为收缩态并隐藏切换按钮；在 `Chat` 中新增预览分栏状态，通过 `FileAttachmentCard` 的回调触发内联预览；在三个页面中移除 `max-w-7xl` 限制。全部使用现有 Tailwind 工具类与组件，不新增依赖。

**Tech Stack：** React + TypeScript + Tailwind CSS + shadcn/ui + Vite

---

## Task 1: 主侧边栏永久收缩

**Files:**
- Modify: `apps/web/src/components/layout.tsx`

- [ ] **Step 1: 将默认收缩状态改为 true**

```tsx
const [isCollapsed, setIsCollapsed] = useState(true);
```

- [ ] **Step 2: 移除桌面端展开/收缩切换按钮**

找到如下按钮并删除：

```tsx
<Button
  variant="outline"
  size="icon"
  className="absolute -right-3 top-1/2 -translate-y-1/2 h-6 w-6 rounded-full border-border/80 bg-background shadow-md opacity-0 group-hover:opacity-100 transition-opacity z-50 hidden lg:flex items-center justify-center text-muted-foreground hover:text-foreground"
  onClick={() => setIsCollapsed(!isCollapsed)}
  title={isCollapsed ? "展开侧边栏" : "收缩侧边栏"}
>
  {isCollapsed ? <PanelLeftOpen className="h-3.5 w-3.5" /> : <PanelLeftClose className="h-3.5 w-3.5" />}
</Button>
```

- [ ] **Step 3: 验证并提交**

Run: `cd apps/web && npx biome check src/components/layout.tsx`
Expected: no errors

---

## Task 2: 工程代码、数据大盘、空间设置内容区加宽

**Files:**
- Modify: `apps/web/src/pages/ProjectCode.tsx`
- Modify: `apps/web/src/pages/Dashboard.tsx`
- Modify: `apps/web/src/pages/Settings.tsx`

- [ ] **Step 1: ProjectCode.tsx 移除 max-w-7xl**

将根容器：
```tsx
<div className="flex flex-col h-[calc(100vh-6rem)] md:h-[calc(100vh-8rem)] min-h-[500px] gap-4 max-w-7xl mx-auto w-full pb-8">
```
改为：
```tsx
<div className="flex flex-col h-[calc(100vh-6rem)] md:h-[calc(100vh-8rem)] min-h-[500px] gap-4 w-full pb-8">
```

同时检查并移除内部不必要的 `max-w-3xl mx-auto`、`max-w-5xl mx-auto` 限制（保留在极小弹窗或卡片中的合理限制）。

- [ ] **Step 2: Dashboard.tsx 移除 max-w-7xl**

将：
```tsx
<div className="flex-1 space-y-6 max-w-7xl mx-auto w-full pb-12 overflow-x-hidden">
```
改为：
```tsx
<div className="flex-1 space-y-6 w-full pb-12 overflow-x-hidden">
```

- [ ] **Step 3: Settings.tsx 移除 max-w-7xl**

将：
```tsx
<div className="flex-1 space-y-6 max-w-7xl mx-auto w-full pb-12">
```
改为：
```tsx
<div className="flex-1 space-y-6 w-full pb-12">
```

- [ ] **Step 4: 验证并提交**

Run: `cd apps/web && npx biome check src/pages/ProjectCode.tsx src/pages/Dashboard.tsx src/pages/Settings.tsx`
Expected: no errors

---

## Task 3: 创建内联文件预览组件

**Files:**
- Create: `apps/web/src/components/chat/InlineFilePreview.tsx`
- Reference: `apps/web/src/pages/FileView.tsx`

- [ ] **Step 1: 创建 InlineFilePreview.tsx**

```tsx
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MarkdownView } from '@/components/chat/MarkdownView';
import { fileApi } from '@/lib/file-api';

interface InlineFilePreviewProps {
  path: string;
  onClose: () => void;
}

export const InlineFilePreview: React.FC<InlineFilePreviewProps> = ({ path, onClose }) => {
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fileApi.fetchContent(path)
      .then((text) => {
        if (cancelled) return;
        setContent(text);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : '加载失败');
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [path]);

  const fileName = path.split('/').pop() || path;
  const displayContent = '```' + fileName + '\n' + content + '\n```';

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <h3 className="text-sm font-medium truncate" title={path}>{fileName}</h3>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex-1 overflow-auto p-4">
        {loading && <p className="text-sm text-muted-foreground">加载中...</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}
        {!loading && !error && <MarkdownView content={displayContent} collapsible={false} />}
      </div>
    </div>
  );
};
```

> 注意：如果项目中不存在 `fileApi.fetchContent`，请参照 `FileView.tsx` 中的实际 API 调用方式（可能是 `api.get('/v1/files/content?path=' + encodeURIComponent(path))`）。

- [ ] **Step 2: 验证组件能编译**

Run: `cd apps/web && npx tsc --noEmit -p tsconfig.check.json`
Expected: no errors

---

## Task 4: 改造 FileAttachmentCard 支持预览回调

**Files:**
- Modify: `apps/web/src/components/chat/FileAttachmentCard.tsx`
- Modify: `apps/web/src/components/chat/AssistantMessage.tsx`

- [ ] **Step 1: FileAttachmentCard 新增 onPreview 回调**

修改 `FileAttachmentCardProps`：
```tsx
interface FileAttachmentCardProps {
  path: string;
  onPreview?: (path: string) => void;
}
```

修改 `handlePreview`：
```tsx
const handlePreview = () => {
  if (onPreview) {
    onPreview(path);
  } else {
    const params = new URLSearchParams();
    params.set('path', path);
    window.open(`/file-view?${params.toString()}`, '_blank', 'noopener,noreferrer');
  }
};
```

- [ ] **Step 2: AssistantMessage 透传 onFilePreview 回调**

修改 `AssistantMessageProps`：
```tsx
interface AssistantMessageProps {
  message: Message;
  onArtifactClick?: () => void;
  onRegenerate?: () => void;
  onFilePreview?: (path: string) => void;
}
```

在渲染 `FileAttachmentCard` 时传入 `onPreview`：
```tsx
{fileAttachments.map((path) => (
  <FileAttachmentCard key={path} path={path} onPreview={onFilePreview} />
))}
```

- [ ] **Step 3: 验证并提交**

Run: `cd apps/web && npx biome check src/components/chat/FileAttachmentCard.tsx src/components/chat/AssistantMessage.tsx`
Expected: no errors

---

## Task 5: Chat 页实现 3/4 预览分栏

**Files:**
- Modify: `apps/web/src/pages/Chat.tsx`
- Import: `InlineFilePreview` from `apps/web/src/components/chat/InlineFilePreview.tsx`

- [ ] **Step 1: 新增预览状态**

在 `Chat` 组件顶部添加：
```tsx
const [previewPath, setPreviewPath] = useState<string | null>(null);
const showPreview = previewPath !== null;
```

- [ ] **Step 2: 添加预览打开/关闭处理函数**

```tsx
const handleFilePreview = useCallback((path: string) => {
  setPreviewPath(path);
}, []);

const closePreview = useCallback(() => {
  setPreviewPath(null);
}, []);
```

- [ ] **Step 3: 将 Chat 根容器改为分栏布局**

找到 Chat 页根容器：
```tsx
<div className="h-[calc(100vh-6rem)] md:h-[calc(100vh-4rem)] flex flex-row border-0 md:border md:border-border/50 rounded-none md:rounded-2xl overflow-hidden bg-background soft-shadow max-w-full mx-auto w-full relative">
```

保留外层容器，将内部直接子 `div`（原主聊天区）改造为两个兄弟区域：

```tsx
<div className="h-[calc(100vh-6rem)] md:h-[calc(100vh-4rem)] flex flex-row border-0 md:border md:border-border/50 rounded-none md:rounded-2xl overflow-hidden bg-background soft-shadow max-w-full mx-auto w-full relative">
  {/* 内联预览区 */}
  <div
    className={cn(
      'h-full flex flex-col border-r bg-background overflow-hidden transition-all duration-500 ease-in-out',
      showPreview ? 'w-3/4 opacity-100' : 'w-0 opacity-0'
    )}
  >
    {previewPath && <InlineFilePreview path={previewPath} onClose={closePreview} />}
  </div>

  {/* 聊天区 */}
  <div
    className={cn(
      'h-full flex flex-col min-w-0 transition-all duration-500 ease-in-out',
      showPreview ? 'w-1/4' : 'flex-1 w-full'
    )}
  >
    {/* 原有聊天内容整体移入此处 */}
  </div>
</div>
```

确保 `cn` 工具函数已导入：
```tsx
import { cn } from '@/lib/utils';
```

- [ ] **Step 4: 将原有聊天内容移入聊天区 div**

将原根容器内的所有内容（包括 header、ScrollArea、输入框、drawer 等）整体作为第二个 `div` 的子元素。不要改变这些子组件的内部结构。

- [ ] **Step 5: 将 onFilePreview 传入 AssistantMessage**

在 `ChatThread` 或 `AssistantMessage` 的渲染处传入：
```tsx
<AssistantMessage
  message={message}
  onArtifactClick={...}
  onRegenerate={...}
  onFilePreview={handleFilePreview}
/>
```

- [ ] **Step 6: 验证并提交**

Run: `cd apps/web && npx tsc --noEmit -p tsconfig.check.json`
Expected: no errors

---

## Task 6: 端到端验证

- [ ] **Step 1: 构建前端**

Run: `cd /home/nan/deepharness-ent-platform && pnpm build`
Expected: all packages build successfully

- [ ] **Step 2: 类型检查**

Run: `pnpm check-types`
Expected: no errors

- [ ] **Step 3: Lint 检查**

Run: `pnpm lint`
Expected: no errors (ast-grep 未安装警告可忽略)

- [ ] **Step 4: 启动开发服务器并验证**

Run: `pnpm dev`
Verify:
- 侧边栏默认收缩，无展开按钮。
- 工程代码 / 数据大盘 / 空间设置页面内容区铺满。
- 在聊天中让模型生成 `[[FILE:/path/to/file.md]]`，点击文件卡片，页面平滑分栏为 3/4 预览 + 1/4 聊天。
- 点击预览区关闭按钮，聊天区恢复全宽。

---

## 自检

- [ ] 侧边栏默认 `isCollapsed = true` 且切换按钮已删除。
- [ ] ProjectCode / Dashboard / Settings 的 `max-w-7xl mx-auto` 已替换为 `w-full`。
- [ ] `InlineFilePreview` 能正确加载并渲染文件内容。
- [ ] `FileAttachmentCard` 在传入 `onPreview` 时不再 `window.open`。
- [ ] `Chat.tsx` 分栏动画使用 `transition-all duration-500 ease-in-out`。
- [ ] 所有构建、类型、Lint 检查通过。
