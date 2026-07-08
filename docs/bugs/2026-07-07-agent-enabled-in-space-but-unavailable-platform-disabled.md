# 2026-07-07 空间设置里启用了智能体但仍不可用

## 现象

在**空间设置 > 智能体配置**中把 `claude-code` 的开关打开后，回到 Chat 页面仍然无法使用该智能体创建会话，后端返回：

```json
{"code":1,"message":"agent not available in this workspace"}
```

用户困惑：「已经在空间里启用了，为什么还是不可用？」

## 根因

智能体可用性由**两级开关**共同决定：

1. **平台级** (`platform_agent_types.enabled`)：控制该智能体是否在整个平台范围内对外开放。
2. **空间级** (`workspace_agent_configs.enabled`)：控制当前工作空间是否启用该智能体。

后端 `ListAvailableAgents` 只有在**两级都启用**时才会把智能体加入可用列表：

```go
// 若平台级已禁用，则空间级也视为禁用。
if !platformEnabled {
    cfg.Enabled = false
}
```

但 `claude-code` 在 `platform_agent_types` 中默认是 `enabled = false`。因此即使空间设置里把它打开，`available-agents` 接口也不会返回它。

## 解决方案

### 正确启用方式

要真正启用 `claude-code`，需要**超级管理员/平台管理员**在**管理后台 > 智能体范围配置**里把 `Claude Code` 的平台级开关打开。之后空间级的启用/禁用才会生效。

### UI 优化

为避免继续误导用户，在 `apps/dh-frontend/src/pages/Settings.tsx` 的智能体配置卡片中增加了平台级状态提示：

- 加载平台级智能体类型列表 (`/api/v1/agent-types`)。
- 当某智能体的平台级开关未开启时，卡片上显示「平台未启用」提示。
- 同时禁用该卡片的空间级启用开关，避免用户做无效操作。

## 验证结果

1. `pnpm check-types`、`pnpm lint`、`pnpm build` 均通过。
2. 通过 API 把 `claude-code` 的平台级状态切为 `true` 后，`/available-agents` 立即返回 `claude-code`。
3. 把平台级状态切回 `false` 后，`/available-agents` 不再返回 `claude-code`，与空间级开关无关，符合设计。
4. 刷新空间设置页，未启用平台级的智能体会显示「平台未启用」提示。
