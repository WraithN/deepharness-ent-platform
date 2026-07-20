# 2026-07-17-workspace-default-agent-selection

## 现象

空间设置 > 智能体设置中没有“默认智能体”选项，用户无法指定新建会话时优先使用哪个智能体；智能会话只能依赖硬编码优先级（`claude-code` > `opencode` > `codex`），与空间实际配置可能不一致。

## 根因

`workspace_agent_configs` 表及前后端类型中缺少 `is_default` 字段，前端 UI 没有展示默认智能体单选，后端保存时也没有确保同一空间只有一个默认智能体。

## 解决方案

1. 后端：在 `workspace_agent_configs` 表增加 `is_default BOOLEAN NOT NULL DEFAULT FALSE`，并在 `packages/go-sdk/domain/agent/agent.go`、`apps/dh-backend/domain/agentconfig/service` 中增加 `IsDefault` 字段；保存时开启事务，先清空同空间其他默认智能体，确保最多一个默认。
2. 前端：在 `WorkspaceAgentConfig` 类型、`agent-config-api.ts` 中增加 `isDefault`；在 `Settings.tsx` 的 `AgentConfigCard` 中增加“默认智能体”勾选框，并通过父组件状态处理单选互斥（勾选新的默认智能体时自动清空其他卡片的默认状态）。

## 验证

- 后端 `go vet ./apps/dh-backend/...` 通过。
- 前端类型检查与构建通过。
- 本地可在空间设置中勾选默认智能体，保存后刷新配置保持正确。
