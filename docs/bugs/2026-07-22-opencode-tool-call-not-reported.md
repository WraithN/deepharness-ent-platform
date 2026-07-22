# 2026-07-22-opencode-tool-call-not-reported.md

## 现象

前端思考时间线里看不到 opencode 智能体执行文件写入、读取等工具调用时的卡片，只有普通的 thinking 文本和最终输出。用户执行 `/proto-make`、`/code` 等会触发文件操作的指令时，无法直观看到"写入文件 xxx"、"读取文件 yyy"这样的工具调用节点。

影响范围：
- 所有使用 opencode 智能体的会话；
- 前端已经能正确渲染 `TOOL_CALL_START`/`TOOL_CALL_ARGS`/`TOOL_CALL_RESULT` 事件，但 gatewayd 没有把这些事件发出来。

## 根因

1. `crates/opencode-plugin/src/mapper.rs` 的 `map_opencode_sse` 只映射了 `message.part.delta`（文本）、`thinking`（思考）、`message.part.updated` 中的 `step-start`、`session.idle`、`session.error` 这几类 SSE 事件，**完全没有处理 `tool_use`/`tool_result` 类型**。
2. `crates/agent-core/src/process/mapper.rs` 虽然能把 `ProcessEvent::ToolUse`/`ToolResult` 映射为 `agent.thinking` 事件，但 opencode-plugin 从不生成这两种 `ProcessEvent`。
3. `apps/gatewayd/src/agui/mapper.rs` 已经可以把 `agent.thinking` 的 `tool_use`/`tool_result` 类型进一步转成 AG-UI `TOOL_CALL_START`/`TOOL_CALL_ARGS`/`TOOL_CALL_RESULT`，但由于上游没有输入事件，整条链路断裂。

## 解决方案

### 1. 补齐 opencode-plugin 的工具调用事件映射

修改 `crates/opencode-plugin/src/mapper.rs`：
- `map_opencode_sse` 返回类型由 `Option<ProcessEvent>` 改为 `Vec<ProcessEvent>`，以支持单个 SSE 事件产生多个 `ProcessEvent`。
- 新增对 `tool_use` 和 `tool_result` 顶级事件类型的处理。
- 扩展 `message.part.updated` 中 `part.type == "tool" | "tool_use"` 的处理。
- 支持 OpenCode 的 `part.state` 格式（`status`/`input`/`output`）以及 legacy 的 `name`/`args` 格式。
- 空输入且未完成的工具调用不再生成无意义事件，避免时间线里出现空 args 的重复卡片。

### 2. 适配调用方

修改 `crates/opencode-plugin/src/instance.rs` 的 relay loop：
- 遍历 `map_opencode_sse` 返回的事件列表，逐个调用 `EventMapper::map`。

### 3. 验证

- `cargo test -p opencode-plugin -p agent-core`：26 个测试全部通过。
- `go vet ./apps/dh-backend/... ./apps/agent-stub/... ./packages/go-sdk/...`：无 warning。
- 通过 `curl` 直接调用 gatewayd 的 AG-UI chat 接口，请求写入文件，SSE 流中成功出现：

```
TOOL_CALL_START  toolCallName=write
TOOL_CALL_ARGS   delta={"content":"hello world","filePath":"..."}
TOOL_CALL_RESULT content="Wrote file successfully."
```

### 4. 服务状态

- 已重新构建 `dh-gatewayd` debug/release 二进制。
- 已执行 `bash scripts/restart-dev.sh` 重启所有服务。
- 前端 `http://localhost:8888`、后端 `http://localhost:8080`、gatewayd `http://localhost:2346` 均健康。
