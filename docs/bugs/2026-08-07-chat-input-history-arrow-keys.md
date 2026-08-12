# 聊天输入框支持 ↑/↓ 切换历史用户消息

## 现象

聊天页输入框无法通过键盘上下方向键快速回顾并复用最近发送过的用户消息；用户需要手动重新输入相同或相似的问题。

## 根因

前端未实现输入历史缓存与键盘回溯逻辑：

1. 没有统一的地方存储用户发送过的消息文本。
2. `textarea` 的 `onKeyDown` 只处理斜杠菜单、`@` 提及、原子块删除和 Enter 发送，没有处理 `ArrowUp` / `ArrowDown`。

## 解决方案

1. **新增历史缓存模块** `apps/dh-frontend/src/lib/input-history-cache.ts`：
   - 按 `workspaceId + userId` 在 `localStorage` 中存储最近 50 条用户发送的消息文本。
   - 重复消息只刷新到最新位置，自动裁剪上限。

2. **在 `apps/dh-frontend/src/pages/Chat.tsx` 中接入**：
   - 发送成功时（`handleSend`）把 `trimmedInput` 写入历史并刷新本地状态。
   - `handleInputKeyDown` 中新增 ↑/↓ 回溯逻辑：
     - 仅在斜杠菜单和 `@` 文档菜单都关闭时生效。
     - 首次按 ↑：当输入框为空或光标在文本最开头（`selectionStart === 0`）时，保存当前草稿并显示最近一条历史。
     - 继续按 ↑：显示更旧历史。
     - 按 ↓：显示更新历史，回到最新时恢复草稿。
     - 历史索引 0 为最近一条。
   - 历史缓存按工作区隔离，避免 `sessionId` 变化导致历史被清空。

3. **优化触发条件**：
   - 除光标在文本开头外，输入框为空时按 ↑ 也能直接唤起历史，更符合用户直觉。

## 验证结果

- `pnpm --filter @repo/dh-frontend check-types` 通过。
- `pnpm build` 全量构建成功（7 successful）。
- 通过 Puppeteer 回归脚本验证：注入测试历史后，在输入框中按 `Ctrl+Home` 将光标移到开头，再按 `↑`，textarea 值变为最近一条历史 `history test beta`。
- 截图保存在 `/tmp/dh-verify/input-history.png`。
