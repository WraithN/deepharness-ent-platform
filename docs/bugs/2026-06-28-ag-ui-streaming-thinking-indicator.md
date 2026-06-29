# AG-UI 流式输出与思考中占位符

## 现象

在完成 AG-UI 基础集成后，继续优化对话体验时发现：

1. 用户发送消息后，前端页面在长达 3-5 秒的 TTFT（首 token 时间）内没有任何反馈，看起来像是“卡住”。
2. AI 回复不是逐字出现，而是等全部内容生成完后一次性显示，流式体验缺失。
3. 后端事件流中 `THINKING_TEXT_MESSAGE_*` 事件极多，几乎每个 thinking token 都产生一组 `THINKING_START/END` 事件，前端状态机频繁刷新。
4. 在 `TEXT_MESSAGE_END` 之前会出现一条包含完整回复的 `TEXT_MESSAGE_CONTENT`，与之前的流式 delta 重复，导致前端内容抖动或重复。

## 根因

1. **Claude CLI 默认按 batch 输出**
   - `deepharness-ent-desktop/crates/claude-plugin/src/constants.rs` 未指定输出格式时，Claude CLI 把整段回复作为一个 `assistant` 事件返回。
   - 这导致 `gatewayd` 只能一次性收到完整文本，无法向前端发送逐 token 的 `TEXT_MESSAGE_CONTENT`。

2. **`thinking_delta` 逐 token 触发完整 thinking 序列**
   - 切换到 `--output-format=stream-json` 后，每个 `thinking_delta` 都会进入 `gatewayd` 的 `map_thinking`。
   - `map_thinking` 对每个 delta 都输出 `THINKING_START → THINKING_TEXT_MESSAGE_START → CONTENT → END → THINKING_END`，事件量爆炸。

3. **batch `assistant` 事件在流末尾重复发送完整文本**
   - stream-json 在生成结束后仍会 emit 一个包含完整 content 的 `assistant` 事件。
   - `claude-plugin` 的 `to_process_event` 把它转成 `ProcessEvent::TextDelta`，于是前端在收到所有 stream delta 后又收到整段文本，造成重复。

4. **前端空助手消息无占位动画**
   - `@assistant-ui/react-ag-ui` 在 `RUN_STARTED` 后会创建空的 assistant placeholder，但 `AssistantMessage` 对空 content 没有任何渲染。
   - 因此在 thinking/text 事件到达前，用户看不到任何 loading/思考中提示。

## 解决方案

1. **启用 Claude CLI stream-json 输出**
   - 将 `OUTPUT_FORMAT_FLAG` 改为 `"--output-format=stream-json"`，使 `text_delta` / `thinking_delta` / `message_stop` 等流式事件实时到达。
   - 涉及文件：`deepharness-ent-desktop/crates/claude-plugin/src/constants.rs`

2. **过滤 `thinking_delta` 流式片段**
   - 在 `to_process_event` 中把 `ClaudeStreamEvent::ThinkingDelta` 映射为 `None`，避免每个 thinking token 都触发一组 AG-UI thinking 事件。
   - 思考内容改由最终的 batch `assistant` 事件一次性输出。
   - 涉及文件：`deepharness-ent-desktop/crates/claude-plugin/src/parser.rs`

3. **忽略 batch `assistant` 中的重复文本**
   - 在 `to_process_event` 的 `ClaudeRawEvent::Assistant` 分支中，不再把 `Text` content 转成 `TextDelta`。
   - 仅保留 `Thinking` content 作为一次性“思考过程”展示。
   - 涉及文件：`deepharness-ent-desktop/crates/claude-plugin/src/parser.rs`

4. **前端增加“思考中...”占位动画**
   - 在 `AssistantMessage` 中检测：消息状态为 `running` 且没有任何可见 content（text、reasoning、tool-call、data）时，渲染带旋转 loading 和弹跳点的“思考中...”占位符。
   - 一旦收到 thinking/text 内容，占位符自动消失，显示实际内容。
   - 涉及文件：`apps/web/src/components/chat/AssistantMessage.tsx`

## 验证结果

```bash
# 后端 SSE 事件流验证
curl -N -X POST http://localhost:8080/api/v1/agent \
  -H 'Content-Type: application/json' \
  -d '{"thread_id":"","run_id":"","messages":[{"role":"user","content":"hello"}]}'
```

典型事件分布：

```
  1 RUN_STARTED
  1 STATE_SNAPSHOT
  2 CUSTOM (status_changed)
  1 THINKING_START
  1 THINKING_TEXT_MESSAGE_START
  1 THINKING_TEXT_MESSAGE_CONTENT  (完整 thinking 内容)
  1 THINKING_TEXT_MESSAGE_END
  1 THINKING_END
  1 TEXT_MESSAGE_START
 18 TEXT_MESSAGE_CONTENT             (逐字/逐词 delta)
  1 TEXT_MESSAGE_END
  1 RUN_FINISHED
```

- `TEXT_MESSAGE_CONTENT` 按 token 流式到达，无一次性完整文本重复。
- `THINKING_*` 事件只有一组，不再 spam。
- `pnpm check-types` 在 `apps/web` 通过。
- `pnpm lint` 在 `apps/web` 通过（ast-grep 未安装，仅产生警告）。
- `pnpm build` 在整个 monorepo 通过。
- `dh-backend`（:8080）、`dh-gatewayd`（:2345）、`apps/web` dev server（:8890）均正常启动。

> 注：Playwright 在当前环境不可用，前端渲染效果需通过浏览器手动验证。已确认代码逻辑会在 assistant placeholder 创建后立刻显示“思考中...”占位符，并在第一个 thinking/text 事件到达后切换为实际内容。

---

## 后续优化：复用 Claude 进程降低 TTFT

### 现象

加日志后发现，即使文本已经改为流式输出，TTFT 仍然高达 6-7s：
- AttachAgent 创建 Claude 进程：~0.9s
- Claude CLI 初始化到 system/init：~1.5s
- DeepSeek API 首 token：~3.5s

### 根因

`dh-backend` 每次调用 `AttachAgent` 都传 `force: true`，导致 `gatewayd` 的 `agent-core` 每次都新建 Claude 实例。实际上 `agent-core` 在 `force=false` 时会按 `plugin_key` 复用全局已有的实例。

### 解决方案

修改 `apps/dh-backend/agent/client/agui_client.go` 的 `Run` 方法：

1. 先以 `force=false` 调用 `AttachAgent`。
2. 若返回 `session already has an agent instance`，说明可复用，视为成功。
3. 若返回 `session not found`，则新建 thread 并以 `force=true` 重新 attach。
4. 其他错误回退到 `force=true` 强制新建 instance。

这样同一 thread 的后续 run、以及跨 session 但 plugin_key 相同的场景都能复用已有 Claude 进程。

### 验证结果

同一 thread 连续两次请求：

**第一次（新建 instance）：**

| 阶段 | 耗时 |
|------|------|
| CreateThread | ~6ms |
| AttachAgent | ~2.37s |
| RUN_STARTED | ~2.38s |
| Claude CLI system/init | ~1.50s |
| first ProcessEvent (Thinking) | ~4.66s |
| **TEXT_MESSAGE_START (TTFT)** | **~7.03s** |

**第二次（复用 instance）：**

| 阶段 | 耗时 |
|------|------|
| AttachAgent | **~1.5ms** |
| RUN_STARTED | ~2.4ms |
| Claude CLI system/init | **~173ms** |
| first ProcessEvent (Thinking) | **~2.51s** |
| **TEXT_MESSAGE_START (TTFT)** | **~2.52s** |

复用后 TTFT 从 **~7s 降到 ~2.5s**，提升约 **4.5s**。剩余 ~2.5s 主要是 DeepSeek API 的首 token 延迟，无法通过本地优化消除。

> 注：gatewayd 的 session 仍是内存存储，重启后会丢失；前端使用同一 `threadId` 时复用效果最佳。
