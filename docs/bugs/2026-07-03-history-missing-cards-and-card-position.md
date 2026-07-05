# 历史会话丢失用户卡片 & 卡片位置调整

## 现象

1. **历史会话丢失卡片**：用户发送消息时附带的引用卡片（quotedCard）和代码库（selectedRepos）在刷新页面或切换会话后消失。
2. **卡片位置错误**：卡片显示在用户消息文本上方，应在下方。
3. **卡片不可并排**：多个卡片没有并排一行展示。

## 根因

### 历史会话丢失卡片

前端通过 AG-UI 协议发送 `quotedCard` 时，将其放在 `runInput.context` 数组中（与 `messages` 平级），而非 message 本身的 metadata 中。后端 `saveUserMessages`（`agui.go:111`）只接收 `input.Messages`，从未接收 `input.Context`，因此 `quotedCard` 和 `selectedRepos` 从未写入 `agent_messages.metadata` JSONB 列。

**数据流**：
```
前端 → runInput.context: [{ name: 'quotedCard', value: {...} }]
后端 → saveUserMessages(input.Messages)  ← input.Context 被忽略
     → metadata 只写了 { originalText }
     → quotedCard 丢失 ★
```

### 卡片位置

`UserMessage.tsx` 中卡片块（quotedCard + selectedRepos）渲染在消息文本气泡之前（DOM 顺序在上），导致卡片显示在上方。

## 解决方案

### 1. 后端持久化卡片数据

- **`agui.go`**：`saveUserMessages` 签名新增 `ctxItems []agui.ContextItem` 参数，从中提取 `quotedCard` 和 `selectedRepos` 原始 JSON，写入 `metadata["quotedCard"]` 和 `metadata["selectedRepos"]`。
- **`agui.go`**：新增 `extractContextItemRaw()` 辅助函数，按名称从 ContextItem 列表中提取原始 JSON 值。
- **`use-ag-ui-chat.ts`**：前端 `contextItems` 新增 `selectedRepos` 项，确保代码库信息也传递到后端持久化。

### 2. 卡片移到消息下方

- **`UserMessage.tsx`**：将卡片块从消息文本气泡之前移到之后（`mt-2` 间距），多个卡片使用 `flex flex-wrap gap-2 justify-end` 并排排列。

### 3. 任务卡片点击打开详情抽屉

- 已有实现：`UserMessage.tsx` 中 `quotedCard` 卡片已绑定 `onClick={() => openDetail?.(quotedCard.type, quotedCard.id)}`，`openDetail` 由 `Chat.tsx` 传入，打开右侧任务详情 Drawer。

## 验证结果

- 前端 `pnpm build` ✓
- 前端 `tsc --noEmit` ✓
- 前端 `biome lint` ✓
- 后端 `go build` ✓
- 后端 `go vet` ✓

## 注意事项

- 修复前入库的旧历史消息无法恢复卡片（metadata 中从未写入过 quotedCard）。
- `selectedRepos` 同理，修复后新发送的消息才会持久化代码库信息。
