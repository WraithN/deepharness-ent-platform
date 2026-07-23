# 2026-07-23 切出页面再切回后"思考中"状态丢失

## 现象

会话中发送消息、agent 仍在"思考中"时，切换到其他页面再切回来，思考中指示器消失，只剩用户消息。即使后端 run 仍在继续、最终也完成了回复，前端也无法恢复进行中的状态，用户只能看到一片空白。

## 根因

`apps/dh-frontend/src/hooks/use-ag-ui-chat.ts`：

1. **run 级状态不落盘**：`isRunning`/`runPhase` 只存在于 React state；已有的 localStorage 机制只快照"进行中的 assistant 消息"，而纯思考阶段（RUN_STARTED 之后、TEXT_MESSAGE_START 之前）还没有 assistant 消息，根本无可保存。
2. **卸载即清空**：SPA 路由切换触发 hook 卸载 → 中断 SSE fetch → AbortError → catch 分支调用 `clearInProgressMessage`，刚写的快照立刻被删。
3. **恢复语义错误**：重挂载时即使快照幸存，也被标记为 `incomplete/error`（"连接已中断，生成未完成"），且 `isRunning=false`，思考中指示器的渲染条件（`message.status.type==='running' && thread.isRunning`）永远不成立。
4. **从不重连**：后端早已提供断连恢复能力（断连后继续缓冲事件 + `GET /api/v1/sessions/{id}/sse` 重放端点 + run 完成后持久化 assistant 消息），前端从未调用。

## 解决方案

`apps/dh-frontend/src/hooks/use-ag-ui-chat.ts`（单文件修改）：

1. **run 级状态持久化**：新增 `dh_chat_active_run:{sessionId}`，在发送时写入 `{runId, sessionId, startedAt, phase:'connecting'}`，RUN_STARTED 时更新为 `'thinking'`；RUN_FINISHED / RUN_ERROR / 显式取消 / 切换会话 / 切换工作区时清除。
2. **导航中断不再清空**：AbortError 路径区分"路由卸载"与"真实失败"，卸载时保留 localStorage 中的快照与 active-run 记录。
3. **重挂载恢复**：`maybeRestoreActiveRun` 校验记录未过期（30 分钟 TTL）后：恢复 `isRunning`/`runPhase`，追加一条合成的 running assistant 占位消息使思考中指示器渲染，并启动 `startRunReattach` 轮询（每 3s 调 `GET /api/v1/sessions/{id}/sse`），把重放事件喂给与实时流相同的事件处理函数（`processAgUiEvent`，由原有 switch 提取复用）。收到终结事件后停止轮询并重新拉取服务端消息，用后端持久化的最终回复替换占位消息。
4. 过期记录（>30min）自动丢弃清理。

### 验证
- `npx tsc --noEmit -p tsconfig.check.json`：0 errors。
- `npx biome lint src/hooks/use-ag-ui-chat.ts`：0 errors / 0 warnings。
- 重启开发环境后浏览器实测见"验证结果"。
