# 2026-08-10 dev 环境未初始化 PostgreSQL 导致 comet_flow 开关回退 false

## 现象

开发环境未启动 PostgreSQL，`platform_feature_flags` 表不存在，功能开关查询失败。后端 `queryFlagEnabled` 原本在数据库未初始化时安全回退为 `false`，导致 `/code` 指令没有走 `cometTemplate` 的 Comet Classic 流程，而是走了原普通模板。

用户反馈：
- “当前 dev 环境没有启动 PostgreSQL，DB 未初始化，开关默认回退 false。”
- “既然不走 comet 为啥不展示卡片？”
- “解决 comet 开关不生效的问题，要实际走 comet 流程。”

## 根因

### 1. 回退策略默认关闭 comet

`apps/dh-backend/gateway/handler/feature_flags.go` 中 `queryFlagEnabled` 在 `featureFlagDB == nil` 或 `QueryRow` 报错时直接返回 `false`：

```go
if featureFlagDB == nil {
    return false
}
...
if err != nil {
    return false
}
```

开发环境为了简化通常不启动 PostgreSQL，dh-backend 使用内存 mock 数据库，因此 `featureFlagDB` 为 nil 或表不存在。comet_flow 开关因此恒为 false，所有带 `cometTemplate` 的指令（`/code`、`/debug`、`/review` 等）全部走原 template。

### 2. 普通模板在复杂任务下产出卡片不稳定

`/code` 原普通模板要求 agent 先写技术文档，若用户未指定工程名还要调用 `question` 工具询问。该流程依赖 LLM 严格输出 `[[FILE:...]]` / `[[PROJECT:...]]` 标记才能生成卡片。实际运行中，模型可能只输出文本建议或未正确写入文件，导致前端没有可展示的卡片。

Comet Classic 流程通过 `comet-classic` skill 强制走 `open -> design -> build -> verify -> archive` 状态机，写入文件和输出标记的执行更确定，卡片展示更有保障。

### 3. 前后端开关状态不一致

`listFeatureFlags` 在 DB 不可用时返回空列表，前端管理页看不到 `comet_flow` 开关，也无法从 UI 开启。用户只能在请求日志中观察到“没有走 comet”。

## 解决方案

1. **DB 不可用时默认启用 comet_flow**  
   `apps/dh-backend/gateway/handler/feature_flags.go`：
   - 新增 `cometFlowDefaultEnabled()`：默认返回 `true`；可通过环境变量 `COMET_FLOW_DEFAULT_ENABLED=false` 显式关闭。
   - 新增 `defaultEnabledForFlag(flagKey)`：仅 `comet_flow` 在 DB 不可用时默认启用，其他开关仍安全回退 `false`。
   - `queryFlagEnabled` 在 `featureFlagDB == nil` 或 `QueryRow` 失败时，调用 `defaultEnabledForFlag(flagKey)` 并打印日志。

2. **前端接口返回默认开关**  
   - `listFeatureFlags` 在 DB 不可用时返回包含 `comet_flow` 默认值的列表，而非空列表，保证前端管理页能看到开关状态。
   - `getFeatureFlag` 在 DB 不可用时也返回默认值。

3. **生产环境显式关闭**  
   生产环境应正常启动 PostgreSQL 并初始化 `platform_feature_flags` 表；如确需在无 DB 时运行，可设置 `COMET_FLOW_DEFAULT_ENABLED=false` 显式关闭 Comet 流程。

## 验证

- 未启动 PostgreSQL 时，dh-backend 启动日志不再出现 comet_flow 被默认关闭的静默行为；
- `GET /api/v1/platform/feature-flags` 返回 `[{flagKey:"comet_flow", enabled:true}]`；
- `/code` 指令日志中应出现 `[AGUIHandler] comet flow enabled, using cometTemplate for /code`；
- 使用 `/code` 长工具调用场景时，结合 SSE watchdog 600 秒调整，避免 120 秒 stalled 误判。

## 相关代码

- `apps/dh-backend/gateway/handler/feature_flags.go` — `cometFlowDefaultEnabled`、`defaultEnabledForFlag`、`queryFlagEnabled`、`listFeatureFlags`、`getFeatureFlag`。
- `apps/dh-backend/gateway/handler/command.go` — `applyCommandConfig` 中根据 `IsCometFlowEnabled()` 选择 `cometTemplate` 或原 `template`。
- `apps/dh-backend/config/commands.yaml` — `/code` 的 `cometTemplate` 定义。
- `apps/dh-frontend/src/lib/feature-flags-api.ts` — 前端读取开关状态。
- `apps/dh-frontend/src/pages/CommandManagement.tsx` — 前端展示 Comet 流程开关。
