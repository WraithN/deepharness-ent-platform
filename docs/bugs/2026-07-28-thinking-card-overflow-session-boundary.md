# 思考块展开溢出会话窗口边界

## 现象

在智能会话窗口中，点击展开"思考中"折叠卡片后，当思考过程（reasoning）内容较长时，思考内容区会无限增高，撑爆会话消息列表视口，导致：
1. 用户输入框被遮挡或被推出可见区域，无法看到/输入内容；
2. 历史会话消息（包括用户刚发送的问题）被挤出可视范围；
3. 在不同窗口尺寸下表现不一致，小窗口下尤为严重。

## 根因

存在两个叠加问题：

### 根因1（主因）：ScrollArea 缺少 `min-h-0`

会话布局为三段式 flex 列（`apps/dh-frontend/src/pages/Chat.tsx:2646`）：

```
ResizablePanel (h-full flex flex-col overflow-hidden)
├── header   (shrink-0)
├── ScrollArea (flex-1)          ← 缺少 min-h-0
└── input    (shrink-0)
```

在 CSS flexbox 中，`flex-1` 子项的 `min-height` 默认为 `auto`（即内容最小高度）。
当 ScrollArea 内的消息内容（如展开的思考过程）超过可用空间时，ScrollArea **不会收缩滚动**，
而是**撑高到内容高度**。这导致三段式总高度超过面板高度，底部 input 被 `overflow-hidden`
裁剪，用户看不到输入框。

仅靠 ThinkingCard 加 `max-h` 无法解决此问题——只要消息总高度超过 ScrollArea 可用空间，
ScrollArea 依然会撑高。

### 根因2（加剧）：ThinkingCard 无高度约束

`apps/dh-frontend/src/components/chat/ThinkingCard.tsx` 展开后的内容区（line 62-67）仅使用了
`mt-2 rounded-lg bg-muted/30 px-3 py-2 text-sm` 样式，**没有任何 `max-height` 或 `overflow`
约束**。当 reasoning 文本很长时，内容区会随内容无限撑高，使问题更加严重。

## 解决方案

### 修复1（关键）：ScrollArea 加 `min-h-0`

`apps/dh-frontend/src/pages/Chat.tsx:2854`：

```diff
- <ScrollArea className={cn('flex-1', ...)}>
+ <ScrollArea className={cn('flex-1 min-h-0', ...)}>
```

`min-h-0` 将 flex 子项的 `min-height` 从 `auto` 改为 `0`，允许 ScrollArea 收缩到剩余空间
并启用 Radix 内部滚动，不再撑高挤掉输入框。

### 修复2（辅助）：ThinkingCard 内容区加高度限制

在 `ThinkingCard.tsx` 展开内容区中，将 `{children}` 包裹在一层带视口相对高度限制与内部滚动的
容器中：

```jsx
<div className="max-h-[50vh] overflow-y-auto overflow-x-hidden overscroll-contain">
  {children}
</div>
```

- `max-h-[50vh]`：高度上限为视口的一半，随窗口大小自适应，确保至少留出一半视口给输入框与
  其他消息，适配各种窗口情况且不超会话框边界。
- `overflow-y-auto`：超出高度时内部滚动，思考内容完整可读。
- `overflow-x-hidden`：防止长行文本水平溢出。
- `overscroll-contain`：防止滚动链穿透到外层消息列表（避免在思考块内滚到底后连带滚动整个会话）。

外层容器加 `overflow-hidden` 兜底裁剪。

"思考过程"标题保留在滚动区外，始终可见。

### 修复3：思考过程长行文字不折行

**问题**：reasoning 文本使用 `whitespace-pre-wrap`，仅在空格处换行。长串无空格文本（代码、
文件路径、URL、连续中文无标点等）不会断行，导致水平溢出、文字被截断。

**修复**：
- `AssistantMessage.tsx:437` reasoning 文本加 `break-words`（`overflow-wrap: break-word`），
  长串超出容器宽度时自动断行。
- `index.css` `.markdown-preview` 加 `overflow-wrap: break-word; word-break: break-word`，
  覆盖 markdown 渲染的长文本（text 类型思考项）。

### 验证

- `pnpm --filter @repo/dh-frontend run check-types`：0 errors
- `pnpm --filter @repo/dh-frontend run lint`（biome）：Checked 186 files, No fixes applied
- `pnpm build`：6/6 successful
- 前端 HTTP 200，服务正常启动
