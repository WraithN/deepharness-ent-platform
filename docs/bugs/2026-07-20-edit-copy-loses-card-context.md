# 2026-07-20-edit-copy-loses-card-context.md

## 现象
用户消息中包含关联卡片（引用需求/缺陷/用例、代码库）以及 `/prd-write` 等指令时：
1. 点击 **编辑** 按钮：卡片信息丢失，仅文字回到输入框，引用卡片和代码库未恢复，指令变成纯文本
2. 点击 **复制** 按钮：仅复制纯文本，卡片上下文丢失，粘贴回会话框后卡片和指令的结构信息丢失

## 根因
- **`UserMessage.tsx`** 的编辑回调 `onEdit(textPart.text)` 仅传递纯文本，未传递 `quotedCard` / `selectedRepos` 元数据
- **`Chat.tsx`** 的 `onEditMessage` 处理器仅调用 `setInput(text)`，未调用 `setQuotedCard(...)` / `setSelectedRepos(...)` 恢复卡片状态
- 对比：重新生成（Regenerate）正确地从 `metadata.custom` 读取并传递了卡片上下文

## 解决方案

### 第一轮修复（编辑上下文恢复）
1. **`UserMessage.tsx`**：`onEdit` 改为传递 `(text, { quotedCard, selectedRepos })`，复制按钮附加卡片文本描述
2. **`ChatThread.tsx`**：`onEditMessage` 类型更新为 `(text: string, context?: SendContext) => void`
3. **`Chat.tsx`**：`onEditMessage` 处理器恢复 `quotedCard` 和 `selectedRepos` 状态

### 第二轮修复（结构化剪贴板 + 粘贴还原 + 编辑光标）
1. **`UserMessage.tsx`**：复制按钮使用 `ClipboardItem` 写入双格式（`text/plain` 纯文本 + `text/html` 内嵌 JSON），JSON 携带 `{ t: text, q: quotedCard, r: selectedRepos }`，fallback 到 `writeText`
2. **`Chat.tsx`**：新增 `handlePaste` 处理器，检测 `data-dh-chat-copy` 属性解析 JSON，恢复 `quotedCard` / `selectedRepos` 状态
3. **`Chat.tsx`**：`onEditMessage` 增加 `requestAnimationFrame` 内聚焦 textarea 并定位光标到文本末尾，确保命令高亮 overlay 正确渲染（对齐 `insertCommand` 的 focus 模式）

### 第三轮修复（粘贴文本替换 + 命令着色）
1. **`Chat.tsx` handlePaste**：原实现缺少 `e.preventDefault()`，浏览器仍会将 `text/plain` 原文（含 `[引用需求: …]` 前缀）插入输入框。修复：调用 `e.preventDefault()` 阻止默认粘贴，从 HTML 中解析 `payload.t` 原始文本，通过原生 `value` setter + `input` 事件替换 textarea 内容，同时从 `payload.q` / `payload.r` 恢复卡片状态。
2. **`Chat.tsx` commandTokens**：原实现仅包含 `${c.cmd} `（带尾随空格）的 token，如 `/user-story `。当输入末尾为裸命令 `/user-story`（无尾随空格、无参数）时，`indexOf` 无法匹配，命令块不着色。修复：`commandTokens` 同时包含 `${c.cmd} ` 和 `${c.cmd}` 两种 token，`highlightedInput` 的 `ranges.sort` 改为按 start 升序 + end 降序（长token优先），确保空格版本不会被裸版本覆盖，同时 `findAtomicRange` 也支持边界情况。
