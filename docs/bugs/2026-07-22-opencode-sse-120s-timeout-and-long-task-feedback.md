# 2026-07-22-opencode-sse-120s-timeout-and-long-task-feedback

## 现象

在主会话中通过 `/proto-make`、 `/user-story` 等长耗时指令让 AI 生成工程或拆分用户故事时，运行约 2 分钟后前端提示：

> 无法连接模型服务，请检查网络或模型配置的 Base URL 地址。
> 原始错误：sse scanner error: read tcp 127.0.0.1:xxxxx->127.0.0.1:2346: use of closed network connection

同样的提示词直接复制到本地 `opencode` 命令行可以正常完成（耗时约 2.5 分钟），但走 gatewayd 就会稳定失败。简单问候类请求（如"你好"）秒级返回，只有复杂长任务会触发该错误。

## 根因

1. **gatewayd 与 opencode 插件的 HTTP 超时硬编码为 120s**：`deepharness-ent-desktop/crates/opencode-plugin/src/transport.rs` 中 `OpenCodeClient` 的 `DEFAULT_TIMEOUT_SECS = 120`，且 `send_message` 同步等待 opencode 返回完整 JSON 响应。复杂任务（生成工程、写文件、多轮工具调用）超过 120s 后，底层 TCP 被关闭，gatewayd 向前端返回 `use of closed network connection`。
2. **DH Backend 对 gatewayd SSE 流的空闲超时也过短**：`apps/dh-backend/agent/client/agui_client.go` 中 `SSE_IDLE_TIMEOUT = 2 * time.Minute`，在工具调用后模型长时间无 token 时，后端会主动断开 SSE 流。
3. **前端无事件超时同样过短**：`apps/dh-frontend/src/hooks/use-ag-ui-chat.ts` 中 `NO_EVENT_TIMEOUT_MS = 180000`，长任务执行过程中 3 分钟无事件就会取消请求。
4. **缺少中间进度反馈**：长任务开始后，前端长时间看不到任何回复，一直显示"思考中"，无法判断任务是否在进行。
5. **提示词路径错误**：`/proto-make` 指令模板要求写入 `{WORKSPACE_PATH}/projects/`，但用户期望原型目录为 `products/prototypes/工程名`。
6. **缺少提示词落盘排查能力**：排查时无法直接查看最终发给 agent 的完整提示词，只能依赖日志片段。

## 解决方案

1. **统一把关键超时从 120s/2min/3min 延长到 10min**：
   - 修改 `deepharness-ent-desktop/crates/opencode-plugin/src/transport.rs`：`DEFAULT_TIMEOUT_SECS = 600`。
   - 修改 `apps/dh-backend/agent/client/agui_client.go`：`SSE_IDLE_TIMEOUT = 10 * time.Minute`。
   - 修改 `apps/dh-frontend/src/hooks/use-ag-ui-chat.ts`：`NO_EVENT_TIMEOUT_MS = 600000`。
2. **长任务首事件后发送合成进度反馈**：在 `apps/dh-backend/gateway/handler/agui.go` 中，收到 gatewayd 第一个 SSE 事件后，对 `/proto-make`、 `/code`、 `/user-story` 等长指令发送 `THINKING_TEXT_MESSAGE_CONTENT` + `THINKING_END`，告诉用户任务已启动，避免"思考中"空等。
3. **修正原型工程输出目录**：在 `apps/dh-backend/gateway/handler/command_config_defaults.go` 中把 `/proto-make` 模板的 `projects/` 改为 `products/prototypes/`。
4. **提示词落盘便于排查**：新增 `logPrompt` 辅助函数，将最终发给 agent 的完整提示词写入 `/tmp/dh-prompts/{runID}.txt`，主日志只记录路径和长度，避免主日志膨胀。
5. **重启开发环境验证**：使用 `bash scripts/restart-dev.sh` 统一重新编译 gatewayd、后端、前端，并用 curl 测试 `/proto-make` 长任务，确认不再 120s 断开且能收到进度反馈。

## 验证结果

- 重启后简单问候请求仍然秒级返回。
- `/proto-make 营销活动管理系统后台` 可完整执行超过 2 分钟，不再触发 `use of closed network connection`。
- 前端在长任务开始后不久显示"正在生成原型工程，可能需要一些时间，请稍候..." 的进度提示。
- `/tmp/dh-prompts/` 下可按 runID 查看完整提示词。
