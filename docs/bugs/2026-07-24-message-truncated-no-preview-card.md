# 2026-07-24 - 会话最后一条消息内容截断、预览卡片不展示

## 现象

智能会话执行原型生成（/proto-make）后，前端展示的最后一条 assistant 消息文字未输出完整
（在 "3. index.html - 活动列表页（统计卡片 + 筛选 +" 处戛然而止），且消息末尾应有的
工程预览卡片（`[[CARD:...]]` / `[[PROJECT:...]]` 标记渲染）未出现。
影响范围：所有通过 gatewayd + opencode 插件运行的长会话（事件数累积超过 1000 的 run 必现）。

## 根因

全链路定位为 **gatewayd（deepharness-ent-desktop）SSE 读取任务永久阻塞**：

1. opencode 侧数据完整：直接查 opencode 存储库，最后的 assistant 消息包含完整 reasoning
   part（281 字符）和最终 text part（1121 字符，内含 `[[FILE:...]]`、`[[PROJECT:...]]`、
   `[[CARD:营销活动创建与编辑]]` 标记）。
2. dh-backend 无丢失：其 SSE 重放缓冲中 782 个 TEXT_MESSAGE_CONTENT delta 累加结果与落库
   消息完全一致（1752 字符），即 gatewayd 只发了这么多；TEXT_MESSAGE_END / RUN_FINISHED
   正常到达（由 send_message HTTP 响应返回驱动）。
3. gatewayd 丢失点：`crates/agent-core/src/process/http.rs` 的 `forward_values` 将每条
   opencode SSE 事件同时转发到内部通道（`internal_tx`，容量 1000，读取端为
   `HttpHandle.receive()`）和外部通道（relay loop）。opencode 插件**从不调用 `receive()`**
   （`receive()` 仅被 claude/codex 的 stdio 传输使用），内部通道只进不出；累积约 1000 条
   事件后 `internal_tx.send().await` 永久阻塞，SSE 读取任务卡死，之后所有事件
   （reasoning 尾部约 180 字符 + 最终 text part 全部 1121 字符）无法被读取和转发。
   代码注释本意是"丢弃事件以避免阻塞 SSE reader"，但阻塞式 `send()` 与该意图不符。

时间线佐证：gatewayd relay 日志在 02:20:37.559 后再无任何事件，而 opencode 日志显示
deepseek 流持续到 02:20:43.69 才结束；阻塞发生时累积事件数（约 808 条已映射 +
未映射的 message.updated / part.updated / 心跳等）恰好达到 1000 上限。

## 解决方案

`crates/agent-core/src/process/http.rs` `forward_values`：

- 内部通道改为 `internal_tx.try_send(...)`（满则丢弃），与既有注释的设计意图一致；
  对从不拉取 `receive()` 的消费者（opencode 插件）不再构成阻塞点。
- 外部通道保持 `send().await` 阻塞式发送（relay loop 活跃消费，背压可接受），保证
  事件不丢失。

验证：

1. `cargo test -p agent-core` — 24 tests passed。
2. `cargo build --release -p dh-gatewayd` — 构建成功，0 warnings。
3. 端到端重放：重启开发环境后，以相同用户输入（/proto-make + 具体需求）在原会话经
   `POST /api/v1/agent` 重放长 run：
   - SSE 事件流完整：1800 个事件（含 1752 个 TEXT_MESSAGE_CONTENT delta，远超修复前
     约 1000 条的卡死阈值），TEXT_MESSAGE_END / RUN_FINISHED 正常收尾；
   - 最终文本 3872 字符完整到达，末尾含 5 个 `[[FILE:...]]` 与 `[[PROJECT:...]]` 标记；
   - dh-backend 落库的 assistant 消息与流式内容一致，前端可据此渲染完整文本与
     工程预览卡片。

## 修改文件

- `deepharness-ent-desktop/crates/agent-core/src/process/http.rs` — `forward_values`
  内部通道改 `try_send` 并补充注释说明阻塞风险。
