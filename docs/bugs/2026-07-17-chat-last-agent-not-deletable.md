# 2026-07-17-chat-last-agent-not-deletable

## 现象

智能会话顶部的智能体 tab 关闭按钮始终可点击，用户可能把最后一个智能体也关闭，导致当前会话没有任何可用智能体，后续无法发送消息或切换智能体。

## 根因

`Chat.tsx` 中智能体 tab 的关闭按钮没有根据 tab 数量做限制，`agentTabs.length <= 1` 时仍然允许关闭。

## 解决方案

在关闭按钮上增加 `disabled={agentTabs.length <= 1}`，并提示“至少保留一个智能体”。当只剩最后一个智能体时，关闭按钮隐藏且不可点击，确保智能会话始终保留至少一个智能体。

## 验证

- 类型检查通过：`pnpm --filter @repo/dh-frontend check-types`
- 构建通过：`pnpm build`
- 本地开发环境启动后，关闭按钮在最后一个 tab 上不可点击。
