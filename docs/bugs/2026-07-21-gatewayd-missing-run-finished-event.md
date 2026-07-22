# Gatewayd 缺失 RUN_FINISHED 事件导致前端永久"思考中"

## 现象

通过 AGUI 端点（`/api/v1/agent`）发送非 greeting 消息时，前端一直显示"思考中"（thinking），永不结束。

## 根因

Gatewayd（`deepharness-ent-desktop`）中 `Event::RunFinished` 在 `agui/types.rs` 已定义，但从未被 emit。

`start_run()` 方法（`apps/gatewayd/src/session.rs:546`）在发送 `RunStarted` 后调用 `agent_service.send_message()` 阻塞等待 Agent 处理完成，但处理完成后未发送 `RunFinished`。

导致 dh-backend 的 AGUI handler 在收到 `TEXT_MESSAGE_END` 后继续等待 `RUN_FINISHED`，SSE 流永不结束，前端永远显示"思考中"。

## 解决方案

在 `apps/gatewayd/src/session.rs` 的 `start_run()` 中，`agent_service.send_message()` 成功返回后，emit `Event::RunFinished`：

```rust
let _ = session.event_tx.send(Event::RunFinished {
    base: BaseEvent {
        timestamp: Some(now()),
        raw_event: None,
    },
    thread_id: session_id.to_string(),
    run_id: run_id.clone(),
    result: None,
});
```

修复后编译 gatewayd，重启服务，验证 curl 测试中 `RUN_FINISHED` 事件正确到达、SSE 流正常结束。
