# 2026-07-27-adopt-prototype-no-design-version.md

## 现象

在「智能会话」中生成原型并点击「采纳到产品空间」后，产品空间中原型内容已更新，但切换到「需求设计」>「版本」标签页，仍显示「共 0 个版本」。

影响范围：所有通过 `/proto-make` 或文档「做原型」生成的原型，在聊天侧板中采纳时若未显式引用需求卡片，均不会生成需求级设计版本。

## 根因

设计版本（`workitem_design_versions`）仅在 `POST /api/v1/workspaces/{id}/product-space/import-prototype` 携带 `workitemId` 时创建（`apps/dh-backend/domain/productspace/handler.go:ImportPrototype`）。

前端原有两处传递 `workitemId`：

1. `Chat.tsx` 中 `PrototypePreviewPanel` 和 `ChatThread` 直接使用 `quotedCard?.type === 'req' ? quotedCard.id : undefined`。
2. `AssistantMessage.tsx` 中的 `PrototypeCard` 也使用上层传入的 `workitemId`。

这意味着只有用户在输入框中显式引用了需求卡片时，采纳才会带 `workitemId`；以下常见场景都会丢失关联：

- 用户从文档预览点击「做原型」时，`handleProtoMake` 原先会生成一个假的 `doc-${Date.now()}` ID 作为 `quotedCard`，这不是真实需求 ID，后端无法创建有效关联。
- 用户直接输入 `/proto-make 需求标题` 或 AI 在回复中通过 `[[REQ_NAME:需求名]]` 标记需求名时，没有任何机制把标题解析为真实需求 ID。

后端上次修复（commit `9f02d8b`）只解决了「已存在原型文件时更新内容并生成 `product_doc_versions` 快照」，但没有解决需求 ID 缺失导致 `workitem_design_versions` 未写入的问题。

## 解决方案

### 1. 聊天入口按标题自动匹配需求 ID

在 `Chat.tsx` 增加 `resolveWorkitemIdByTitle` 辅助函数，按标题大小写不敏感匹配已加载的需求列表，并引入 `effectivePrototypeWorkitemId`：

- 优先使用显式引用的需求卡片（`quotedCard`）。
- 否则根据当前原型相关的需求标题（`protoMakeRequirementTitle`）匹配已有需求。

该 ID 同时传递给 `PrototypePreviewPanel` 和 `ChatThread`，确保预览面板和消息中的原型卡片采纳时都携带正确 `workitemId`。

### 2. 文档「做原型」不再使用假 ID

修改 `handleProtoMake`：如果文档标题能匹配到已有需求，则引用真实需求卡片；否则清空 `quotedCard`，避免假 ID 误导后端。

### 3. 消息级原型卡片按标题二次解析

`AssistantMessage.tsx` 接收需求列表，对每条消息中的 `prototypeRequirementTitle`（来自 `[[REQ_NAME:...]]` 或父组件传入）再次匹配真实需求 ID，作为 `PrototypeCard` 的 `workitemId`。父组件传入的 ID 优先级更高。

### 4. 验证

- `pnpm --filter @repo/dh-frontend check-types`：无类型错误。
- `pnpm --filter @repo/dh-frontend build`：构建成功。
- `cd apps/dh-backend && go vet ./...`：无警告。

### 修改文件

- `apps/dh-frontend/src/pages/Chat.tsx`
- `apps/dh-frontend/src/components/chat/ChatThread.tsx`
- `apps/dh-frontend/src/components/chat/AssistantMessage.tsx`

### 后续注意

若聊天中生成的原型标题与现有需求标题不一致，仍无法自动关联。此时建议用户先创建同名需求，或在聊天中显式引用需求卡片后再生成/采纳原型。
