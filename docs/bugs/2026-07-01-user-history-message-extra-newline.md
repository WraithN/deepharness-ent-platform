# 用户历史消息多出额外 `\n`

> 日期：2026-07-01

## 现象

用户在聊天页面刷新或切换会话后，历史用户消息的文本开头会出现一个多余的换行符（`\n`）。当前会话中新发送的用户消息显示正常，但一旦从后端重新加载历史消息，就会出现此问题。

同时，会话标题（session title）也以 `\n` 开头，例如 `\n帮我写一个阿里的骡子快跑的产品调研报告`。

## 根因

前端 `useAgUiChat.ts` 在发送用户消息时，对 content 做了**双重 JSON 编码**：

```js
// 问题代码（第 304 行）
content: JSON.stringify(wrapUserPrompt(text)),
```

数据流如下：

1. `wrapUserPrompt(text)` 返回包含**真实换行符**的字符串 `S`
2. `JSON.stringify(S)` 将其编码为 JSON 字符串字面量 `J(S)`，真实换行符变成字面量 `\n`（反斜杠+n 两个字符），并添加首尾引号 `"`
3. `JSON.stringify(runInput)` 再次对整个请求体做 JSON 编码，`J(S)` 被编码为 `J(J(S))`

后端 `ContentText()` 只做了一层 `json.Unmarshal` 解码，从 `J(J(S))` 还原为 `J(S)`，而非原始的 `S`。因此存储到数据库的 content 是 `J(S)`——一个以 `"` 开头、以 `"` 结尾、换行为字面量 `\n` 的字符串。

后端 `extractOriginalUserPrompt` 用 `strings.TrimSpace()` 尝试去掉 `__USER_PROMPT__` 标记后的换行符，但 `TrimSpace` 只能移除真正的空白字符（如 `0x0A` 换行符），无法移除字面量 `\n`（`0x5C 0x6E`，即反斜杠+n）。因此提取出的 `originalText` 以字面量 `\n` 开头。

前端 `UserMessage.tsx` 优先使用 metadata 中的 `originalText`，导致显示时出现多余换行。

## 解决方案

### 1. 根因修复：移除多余的 `JSON.stringify`

**文件**：`apps/web/src/hooks/useAgUiChat.ts` 第 316 行

```js
// 修复前
content: JSON.stringify(wrapUserPrompt(text)),

// 修复后
content: wrapUserPrompt(text),
```

`JSON.stringify(runInput)` 在 HTTP 层已经负责 JSON 编码，无需对 content 单独编码。

### 2. 后端提取函数兼容历史数据

**文件**：`apps/dh-backend/gateway/handler/agui.go` — `extractOriginalUserPrompt`

增加一层 JSON 解码尝试：如果文本以 `"` 开头（说明是双重编码的历史数据），先 `json.Unmarshal` 解码一层再提取。

### 3. 前端提取函数兼容历史数据

**文件**：`apps/web/src/hooks/useAgUiChat.ts` — `extractUserPrompt`

同样的逻辑：如果文本以 `"` 开头，先 `JSON.parse` 解码一层。

### 4. 后端 API 实时修复历史数据

**文件**：`apps/dh-backend/gateway/handler/session.go` — `GetMessages`

在返回历史消息时，对 user 角色消息重新调用 `extractOriginalUserPrompt` 提取 `originalText`，覆盖 metadata 中的旧值。这样无需数据库迁移即可修复已有数据。

## 验证结果

1. `go vet ./apps/dh-backend/...` — 0 warnings
2. `tsc --noEmit` — 0 errors
3. 已有历史消息的 `originalText` 现在正确返回 `帮我写一个阿里的骡子快跑的产品调研报告`（无 `\n` 前缀，无尾部 `"`）
4. 前端 `extractUserPrompt` 对历史数据的提取结果同样正确
