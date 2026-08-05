# 会话窗口智能体标签截断展示不正确

## 现象

会话窗口中智能体标签采用硬编码 `instanceId.slice(0, 6)` 截断，例如实例 ID `opencode-1` 被直接切成 `openco`，导致：

1. 被截断的文本末尾没有省略号（`...`），用户无法直观判断文本是否被截断。
2. 鼠标悬停时无法看到完整的实例 ID，因为显示文本本身已被截断，title 提示也受限于拼接逻辑。

影响位置：
- `apps/dh-frontend/src/pages/Chat.tsx` 中智能体下拉选择项、tab 标签、当前会话标题三处。
- 历史会话下拉中的 `getHistoryAgentLabel` 返回的 `short` 字段也存在同类问题（`slice(0, 8)`）。

## 根因

代码在 JSX 中直接使用字符串 `slice` 做硬截断，而不是交给 CSS `text-overflow: ellipsis` 处理：

```tsx
// 原代码示例
<span>{tab.instanceId ? `${tab.title} · ${tab.instanceId.slice(0, 6)}` : tab.title}</span>
```

这种做法的缺陷：
- 无论容器是否足够，都强制只显示前 6 个字符。
- 没有省略号视觉提示。
- hover 时无法还原完整内容（title 提示虽然写了完整 instanceId，但显示文本本身已被破坏）。

## 解决方案

1. **提取复用组件** `AgentInstanceLabel`：统一渲染 `title · instanceId` 文本，自带 `truncate` 和 `title` 提示。
2. **移除所有硬编码 `slice`**：让 CSS 根据容器宽度自动截断并显示省略号。
3. **保留 hover 展示完整内容**：通过 `title` 属性在鼠标悬停时展示完整文本。
4. **同步修复历史会话下拉**：将 `getHistoryAgentLabel` 中的 `short` 字段移除，显示文本统一使用 `full`，外层容器使用 `truncate`。

修改位置：
- `apps/dh-frontend/src/pages/Chat.tsx:422-440`：新增 `AgentInstanceLabel` 组件并简化 `getHistoryAgentLabel`。
- `apps/dh-frontend/src/pages/Chat.tsx:2940`：下拉选择项使用 `AgentInstanceLabel`，限制最大宽度。
- `apps/dh-frontend/src/pages/Chat.tsx:2964`：tab 标签使用 `AgentInstanceLabel`，父容器已有 `max-w-[180px]`。
- `apps/dh-frontend/src/pages/Chat.tsx:3017-3020`：当前会话标题使用 `AgentInstanceLabel`，并给外层 span 增加 `min-w-0` 以在 flex 布局中正确截断。
- `apps/dh-frontend/src/pages/Chat.tsx:3092-3097`：历史会话下拉展示使用 `full` + `truncate`。

## 验证结果

- `pnpm --filter @repo/dh-frontend check-types`：通过，无 TypeScript 错误。
- `pnpm build`：全部 7 个包构建成功。
- `bash scripts/restart-dev.sh`：前后端及 gatewayd、personal-stub 均正常启动。
- `curl` 健康检查：前端 `localhost:8888`、后端 `localhost:8080/health`、personal-stub `localhost:8090/health`、gatewayd `localhost:2346/health` 均返回 200。
