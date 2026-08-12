# 2026-08-10 CometClassic 长工具调用期间 SSE watchdog 120 秒超时导致 run 被误判 stalled

## 现象

会话 `run=1786339660745-qujblww` / `threadId=46001d13-3eb3-4ee1-9c30-0d0235b77629` 处理用户输入 `/code 增加一个评分机制，给生成的名称打分 1~5分` 时：

- 13:27:40 dh-backend 收到请求，开始走 Comet Classic 流程。
- 13:27:48 加载 `comet-classic` skill。
- 13:27:55 ~ 13:29:04 密集读取项目文件，随后 SSE 事件完全静默（opencode 实际正在调用 comet/openspec 工具，但工具未返回期间无 SSE 事件）。
- 13:32:17 gatewayd watchdog 判定 `agent stalled: no SSE events for 120s`，第一次重启 opencode。
- 13:34:34 第二次判定 stalled，第二次重启。
- 13:35:00 ~ 13:35:17 重启后，之前挂起的工具结果陆续返回，其中包含：
  - `Invalid CometIntentFrame:` schema 验证错误（comet CLI 返回的工具结果之一）；
  - `comet classic intent route` 结果 `{"route": {"name": "full", ...}}`；
  - `comet-open` skill 内容。
- 13:35:17 之后再次静默（opencode 继续调用 comet/openspec 工具），13:37:24 第三次 stalled，最终返回 `RUN_ERROR`。
- 总耗时 **9 分 43 秒**，用户侧表现为会话超时失败。

## 根因

### 1. 直接原因：gatewayd SSE 看门狗 120 秒阈值被合法长工具调用突破

`opencode_plugin` 的 stall 检测只看 SSE 事件流：120 秒内没有收到任何 `agent.token` / `agent.thinking` / `tool_call_start` / `tool_call_result` 等事件，就判定 `agent stalled: no SSE events for 120s` 并重启 agent。

Comet Classic / OpenSpec 流程会连续调用 `comet classic openspec -- ...`、`comet state init/select`、LLM 生成 proposal/design/tasks 等工具。这些工具执行期间 opencode 不会重复发送事件，一旦单个工具调用超过 120 秒，gatewayd 就会误判 agent 卡死。

从日志看：
- 13:28:58 发起多个 `read` 工具调用，其中 `9fbcd870` 在 7 分 20 秒后才返回（期间经历了 13:32:17 的 watchdog 重启）；
- 13:35:17 最后两个 `bash` 工具调用发起后，到 13:37:24 超时均未返回，期间无 SSE 事件。

这说明 **opencode 进程本身并未挂死，而是在等待工具执行结果**；工具结果没回来时 gatewayd 没有别的“agent 还活着”的信号，只能用 120 秒超时触发重启。

### 2. 配置根因：dh-backend 未将 `Timeout` 同步给 gatewayd，gatewayd 回退到 120 秒硬编码默认值

`agent.WorkspaceAgentConfig.Timeout` 字段含义就是 SSE 看门狗无事件超时阈值（秒），dh-backend 在 `CreateSession` 和 `UpdateAgentConfig` 时会通过 `/sessions/{sessionId}/agents/{instanceId}/config` 把该值推送给 gatewayd。但当空间级/超管默认配置均未设置 `Timeout` 时，dh-backend 传的是 `nil`，gatewayd 使用自己的默认 120 秒。

代码位置：
- `packages/go-sdk/domain/agent/agent.go:78`：Timeout 注释说明“默认 120 秒”。
- `apps/dh-backend/domain/agentconfig/service/db_service.go:35`：原 `defaultAgentTimeoutSeconds = 120`。
- `apps/dh-backend/gateway/handler/session.go:228-231`：只有 `cfg.Timeout != nil` 才同步给 gatewayd。

因此，Comet 长工具调用必然被 120 秒阈值截断，无论 opencode 实际是否在正常工作。

### 3. 伴随现象：`CometIntentFrame` 格式错误

13:35:00 返回的工具结果中有一条 `Invalid CometIntentFrame:` schema 验证错误：

```text
Invalid CometIntentFrame:
- slots.new_capability must be boolean or null
- evidence[0] must be an object
- evidence[0].field must be a non-empty string
- evidence[0].quote must be a non-empty string
```

这是 `comet classic intent route --stdin` 对意图框架 JSON 的校验失败。手动复现：

```bash
cd /home/nan/test/a0564de55589467d935d797611963493/056529ec51754cfcb38859c999aa86f0/dev-jobs/pefect-chinese-name

echo '{"schema_version":"comet.intent.v1","utterance":"增加评分","intent":{"name":"start_change","confidence":0.8},"slots":{"requested_action":"start","workflow_candidate":"full","user_explicit_workflow":null,"change_id":null,"existing_behavior":null,"new_capability":"yes","public_api_change":null,"schema_change":null,"cross_module_change":null},"context":{"active_changes_count":0,"active_change_names":[]},"evidence":["bad"],"proposed_route":{"name":"full","confidence":0.9}}' | comet classic intent route --stdin
```

该错误说明 opencode 构造 `CometIntentFrame` 时字段类型有误，但它是工具返回的正常错误结果，**不是导致 120 秒超时的根因**。真正的超时是因为工具调用链被 120 秒阈值打断。

### 4. 环境配置层面的问题

- 项目目录 `dev-jobs/pefect-chinese-name` 下没有 `.comet/config.yaml`（会话结束后才由 comet 创建，且为 `native`），而工作区根目录 `.comet/config.yaml` 配置为 `classic`。`comet workflow resolve . --activate --json` 在项目目录下返回 `workflow: native`，但当前 `.opencode/skills` 目录下没有 `comet-native` skill，导致 Comet Classic 流程与项目配置不一致。
- gatewayd 的 watchdog 策略为“120 秒无事件则重启，最多 3 次”，对合法长工具调用没有智能识别能力。

## 解决方案

### 已实施（当前仓库 dh-backend）

1. **放大 SSE watchdog 默认 timeout**  
   `apps/dh-backend/domain/agentconfig/service/db_service.go`：
   - 将 `defaultAgentTimeoutSeconds` 从 `120` 改为 `600`（10 分钟），覆盖 Comet Classic 单次 LLM 生成和 comet/openspec CLI 调用；
   - 在 `applyDefaultConfig` 中兜底：空间级和超管默认配置均未设置 `Timeout` 时，使用该默认值；
   - 新增 `ensureDefaultTimeout` 辅助函数，确保所有读取到的配置最终都有 timeout，gatewayd 不会回退到 120 秒。

2. **保证 `CreateSession` 时同步给 gatewayd**  
   `GetWorkspaceConfig` 返回的配置现在 `Timeout` 永不为 nil，`session.go` 在 `UpdateAgentConfig` 时会将 600 秒同步给 gatewayd，新会话立即生效。

### 后续可补充（依赖外部仓库或更深层改动）

1. **opencode 在长时间工具调用期间发送 heartbeat / thinking 事件**  
   让 gatewayd 在合法工具静默期仍能看到事件，彻底避免 120 秒阈值被突破。

2. **修复 `CometIntentFrame` 构造逻辑**  
   确保 `slots.new_capability` / `public_api_change` / `schema_change` / `cross_module_change` 等字段只输出 boolean 或 null；`evidence` 数组元素必须是 `{field, quote, source}` 对象。

3. **统一 comet 项目配置**  
   确保 `comet workflow resolve` 在项目目录下激活的 workflow 与 `.opencode/skills` 中可用的 skill 一致；缺失 `comet-native` skill 时，强制使用 `classic` 或提示安装。

4. **改进 gatewayd watchdog 策略**  
   区分“agent 进程无响应”和“工具执行中但无事件”：在 tool_call_start 之后未收到 tool_call_result 时，使用更长的工具超时而不是通用的 SSE 超时。

## 验证

- 手动运行错误格式的 comet intent route 命令可复现 `Invalid CometIntentFrame` 错误。
- 手动运行正确格式的命令可在 0.3 秒内返回正常路由，说明 comet CLI 本身不是性能瓶颈。
- 修改后 `GetWorkspaceConfig` 返回的 `Timeout` 永不为 nil，新 session 同步到 gatewayd 的 `WatchdogTimeoutSecs` 为 600 秒。
- 需要在新会话中重新测试 `/code` 长工具调用场景，确认 120 秒 watchdog 不再被触发。

## 相关代码

- `packages/go-sdk/domain/agent/agent.go:78` — `WorkspaceAgentConfig.Timeout` 字段定义。
- `apps/dh-backend/domain/agentconfig/service/db_service.go:35` — `defaultAgentTimeoutSeconds` 默认值。
- `apps/dh-backend/domain/agentconfig/service/db_service.go:236` — `applyDefaultConfig` / `ensureDefaultTimeout` 兜底逻辑。
- `apps/dh-backend/gateway/handler/session.go:228-231` — 向 gatewayd 同步 `WatchdogTimeoutSecs`。

## 相关日志

- `/tmp/dh-backend.log`：搜索 `run=1786339660745-qujblww`。
- `/tmp/gatewayd-a0564de55589467d935d797611963493.log`：搜索 `run=1786339660745-qujblww` 与 `opencode_plugin::instance`。
- `/tmp/personal-stub-a0564de55589467d935d797611963493.log`：显示 opencode 状态心跳仍在，但无进程崩溃日志。
