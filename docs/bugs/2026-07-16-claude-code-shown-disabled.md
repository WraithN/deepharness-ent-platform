# Claude Code 显示「平台未启用 / 已禁用」Bug

## 现象

在空间设置 → 智能体配置页面，Claude Code 卡片显示：

- 标签：**平台未启用 · 已禁用**
- Switch 开关为关闭且不可操作

用户反馈：超级管理员并未在平台级别禁用 Claude Code，但前端始终展示为已禁用。

## 根因

后端 `ListWorkspaceConfigs` 在组装空间级配置时，把 `platform_agent_types.enabled`（平台级开关）强制覆盖到了空间级 `Enabled` 字段：

```go
// 若平台级已禁用，则空间级也视为禁用。
if !platformEnabled {
    cfg.Enabled = false
}
```

而前端 `AgentConfigCard` 又额外通过 `/api/v1/agent-types` 再次判断 `platformEnabled`，并用它禁用 Switch、展示「平台未启用」。

这就造成了两层问题：

1. **超管配置（租户级 `allowed_agent_keys` / 默认配置）与空间配置没有真正联动**——超管在「租户策略」里允许并启用了 Claude Code，但空间级仍然被独立的 `platform_agent_types.enabled` 拦截。
2. 平台级开关没有对应的管理入口（前端 AdminPage 的 `toggleAgentType` 为死代码，没有 UI），导致该状态一旦为 `false` 就无法在前端恢复。

## 解决方案

把平台级开关与空间级启用状态解耦，改由**超管租户策略**作为空间智能体的统一闸门：

1. **后端**：移除 `scanWorkspaceAgentConfig` 中根据 `platform_agent_types.enabled` 强制把空间级 `Enabled` 置为 `false` 的逻辑。`workspace_agent_configs.enabled` 与租户默认配置决定空间级是否启用。
2. **后端**：`ListAvailableAgents` 注释同步修正为「仅当空间启用时才对外展示」。
3. **前端**：`AgentConfigCard` 不再显示「平台未启用」标签，Switch 也不再因 `platformEnabled` 被禁用；仅受 `readOnly` / `locked` 控制。`Settings.tsx` 也不再额外请求 `listAgentTypes` 来做平台启用判断。

修改后，只要超管在租户策略中允许该智能体，空间管理员即可正常启用/禁用；若超管未允许，该智能体根本不会出现在空间配置列表中。

## 验证结果

- `pnpm check-types` ✅
- `pnpm build` ✅
- 刷新空间设置页面，Claude Code 不再显示「平台未启用」，Switch 可正常操作。
