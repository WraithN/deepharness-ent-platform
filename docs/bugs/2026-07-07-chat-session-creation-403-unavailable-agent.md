# 2026-07-07 Chat 页面会话创建失败（403 agent not available）

## 现象

在 Chat 页面初始化时，前端调用 `POST /api/v1/sessions` 创建会话，后端返回：

```json
{"code":1,"message":"agent not available in this workspace"}
```

HTTP 状态码为 `403`。页面上表现为「创建会话失败」toast，无法开始聊天。

## 根因

Chat 页面的默认智能体插件 key 逻辑如下：

```tsx
const DEFAULT_AGENT_OPTIONS: AvailableAgent[] = [
  { agentKey: 'claude-code', name: 'Claude Code', description: '', model: '' },
  { agentKey: 'opencode', name: 'OpenCode', description: '', model: '' },
];

const [availableAgentOptions, setAvailableAgentOptions] = useState<AvailableAgent[]>(DEFAULT_AGENT_OPTIONS);

// 初始化 tab 的 effect 在组件首次渲染时立即执行，
// 此时 /available-agents 尚未加载完成，
// availableAgentOptions 还是 DEFAULT_AGENT_OPTIONS，
// 因此 defaultKey = 'claude-code'。
const defaultKey = availableAgentOptions[0]?.agentKey ?? 'claude-code';
createSession(defaultKey)
```

但当前空间 `ws-default` 实际启用的可用智能体只有 `opencode` 和 `codex`：

```bash
curl /api/v1/workspaces/ws-default/available-agents
# => [{"agentKey":"opencode",...},{"agentKey":"codex",...}]
```

后端 `CreateSession` 在校验 `pluginKey` 时，发现 `claude-code` 不在可用列表中，直接返回 403，导致会话创建失败。

## 解决方案

在 `apps/dh-frontend/src/pages/Chat.tsx` 中：

1. 新增 `availableAgentsLoaded` 状态，用于标记 `/available-agents` 是否已加载完成。
2. 在可用智能体加载 effect 中设置 `setAvailableAgentsLoaded(true)`。
3. 将初始化默认 tab 的 effect 的触发条件从「组件挂载即执行」改为「等待 `availableAgentsLoaded === true` 后再执行」，这样 `defaultKey` 会取后端返回的第一个真实可用智能体（如 `opencode`），而不是写死的 `claude-code`。

关键代码变更：

```tsx
const [availableAgentsLoaded, setAvailableAgentsLoaded] = useState(false);

// 加载 /available-agents 后
setAvailableAgentOptions(runtimeAgents.length > 0 ? runtimeAgents : DEFAULT_AGENT_OPTIONS);
setAvailableAgentsLoaded(true);

// 初始化 tab
useEffect(() => {
  if (initializedRef.current || !availableAgentsLoaded || agentTabs.length > 0) return;
  initializedRef.current = true;
  const defaultKey = availableAgentOptions[0]?.agentKey ?? 'claude-code';
  // ... tryRestoreSession / createSession(defaultKey)
}, [availableAgentsLoaded, availableAgentOptions]);
```

## 验证结果

1. 重新执行 `pnpm check-types`、`pnpm lint`、`pnpm build`，均通过。
2. 使用可用智能体 `opencode` 调用创建会话接口：
   ```bash
   curl -X POST /api/v1/sessions -d '{"workspaceId":"ws-default","agentType":"chat","agent_key":"opencode"}'
   # => {"code":0,"data":{"sessionId":"..."},"message":"success"}
   ```
3. 使用不可用智能体 `claude-code` 调用同一接口，确认后端仍会正确返回 403（符合预期，因为该空间未启用此智能体）。
4. 开发服务器已保持运行，前端文件修改后通过 Vite HMR 生效。
