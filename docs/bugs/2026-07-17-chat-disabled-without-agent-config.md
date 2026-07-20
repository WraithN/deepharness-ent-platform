# 2026-07-17-chat-disabled-without-agent-config

## 现象

当空间没有启用任何智能体时，智能会话页面仍然显示可输入的输入框和欢迎卡片，用户尝试发送消息会失败，且没有明确提示。

## 根因

`Chat.tsx` 只加载了 `availableAgents` 和 `availableAgentOptions`，没有加载 `workspaceAgentConfigs`，因此无法判断当前空间是否启用了智能体；默认智能体选择也依赖硬编码优先级，未与空间配置联动。

## 解决方案

1. 在 `Chat.tsx` 中加载 `agentConfigApi.listWorkspaceConfigs`，并把 `workspaceAgentConfigs` 纳入加载完成判断。
2. 改写 `resolveDefaultAgentKey`，优先从已启用配置中找 `isDefault` 的 agentKey，否则取第一个已启用配置；没有任何已启用配置时返回 `undefined`。
3. 派生 `enabledAgentOptions` 和 `chatEnabled` 状态：
   - 无可用智能体时，显示“智能会话不可用：空间管理员没有配置智能体，请联系空间管理员”的提示占位。
   - 输入框 `disabled` 并替换占位文字。
   - 新增智能体按钮禁用，防止创建无配置支持的会话。

## 验证

- 类型检查与构建通过。
- 本地开发环境启动后，若空间未启用智能体，智能会话页面显示不可用提示且无法输入。
