# /prd-analysis 卡在「正在进行竞品信息分析」且无工具调用

## 现象

用户执行 `/prd-analysis` 指令后，前端长时间停留在合成提示「正在进行竞品信息分析，可能需要一些时间，请稍候...」，agent 没有任何工具调用（未调用 `crawler:web_scrape`），任务最终卡死或长时间无进展。

## 根因

`/prd-analysis` 依赖 agent 通过 gatewayd 暴露的 MCP 工具 `crawler:web_scrape` 抓取网站。gatewayd 启动时通过 `DH_PLATFORM_URL` 向 platform 拉取 crawler MCP 配置，但该链路存在三层叠加缺陷，导致 crawler 工具始终未能注册：

### 缺陷1：personal-stub 未代理 crawler 配置端点

gatewayd 启动时调用 `GET {platform_url}/api/v1/admin/services/crawler` 拉取 crawler 配置。生产/开发环境下 gatewayd 的 `DH_PLATFORM_URL` 指向 **personal-stub（8090）**，而该端点实际由 **dh-backend（8080）** 提供（`apps/dh-backend/gateway/handler/admin_crawler_config.go`）。

personal-stub（`apps/personal-stub/gateway/server/server.go`）只代理了 `/api/v1/agent-runtimes/{id}/status`，**没有**代理 `/api/v1/admin/services/crawler`，导致 gatewayd 拿到 404。

> 日志：`load crawler from backend failed: fetch crawler config: error sending request for url (http://localhost:8090/api/v1/admin/services/crawler)` + `No MCP servers configured`

### 缺陷2：personal-stub 启动顺序竞态

即便补上代理，`apps/personal-stub/main.go` 中 `gatewaydMgr.StartSingle()` 在 `http.ListenAndServe` **之前**同步执行——gatewayd 子进程在 personal-stub HTTP server 尚未监听时就启动了，并在启动早期立刻拉取 crawler 配置，此时 personal-stub 仍不可达，拉取失败。

### 缺陷3：gatewayd 通知消息序列化带 `"id":null` 被 MCP SDK 拒绝

修复前两层后，gatewayd 能拉到 crawler 配置 URL（`http://127.0.0.1:8091/mcp`），但 MCP 握手时 `notifications/initialized` 通知序列化错误。

`apps/../deepharness-ent-desktop/crates/dh-core/src/mcp/codec.rs` 的 `JsonRpcRequest.id` 字段（`Option<Value>`）**未加** `skip_serializing_if`，导致 `id: None` 的通知被序列化为 `{"jsonrpc":"2.0","id":null,"method":"notifications/initialized",...}`。crawler-service 的 MCP SDK（`webStandardStreamableHttp.js` 的 `JSONRPCMessageSchema.parse`）要求通知消息不得含 id 字段，收到 `"id":null` 返回 400 `Parse error: Invalid JSON-RPC message`。

> 日志：`load crawler from backend failed: connect crawler MCP: MCP process error: HTTP 400 Bad Request`

三层叠加后，gatewayd 日志最终 `No MCP servers configured`，agent 无 `crawler:web_scrape` 工具，导致 `/prd-analysis` 无法执行。

## 解决方案

### 修复1：personal-stub 代理 crawler 配置端点

- `apps/personal-stub/gateway/handler/container.go`：新增 `CrawlerConfigProxy` handler，将 `GET /api/v1/admin/services/crawler` 代理到 dh-backend（携带 Bearer token 透传响应）；新增常量 `dhBackendCrawlerConfigPath`。
- `apps/personal-stub/gateway/server/server.go`：注册 `mux.HandleFunc("/api/v1/admin/services/crawler", handler.CrawlerConfigProxy)`。

### 修复2：personal-stub 先监听 HTTP 再启动 gatewayd

`apps/personal-stub/main.go` 重构启动顺序：
1. `net.Listen("tcp", ":"+cfg.Port)` 抢端口并 `go http.Serve(ln, srv)` 启动 HTTP server。
2. 再执行 `gatewaydMgr.StartSingle()` 启动 gatewayd 子进程。
3. `select {}` 阻塞主 goroutine（优雅关闭由信号 goroutine 处理）。

### 修复3：gatewayd 通知序列化省略 id

`apps/../deepharness-ent-desktop/crates/dh-core/src/mcp/codec.rs` 的 `JsonRpcRequest.id` 加 `#[serde(skip_serializing_if = "Option::is_none")]`，通知消息不再输出 `"id":null`。

### 影响文件

- `apps/personal-stub/gateway/handler/container.go` —— 新增 `CrawlerConfigProxy` + 常量
- `apps/personal-stub/gateway/server/server.go` —— 注册 crawler 配置代理路由
- `apps/personal-stub/main.go` —— 调整启动顺序（先 HTTP 监听再启动 gatewayd）
- `../deepharness-ent-desktop/crates/dh-core/src/mcp/codec.rs` —— `id` 字段 `skip_serializing_if`（跨仓库 gatewayd）

## 验证结果

- `go vet ./apps/personal-stub/...` 0 warnings；`go build` 通过。
- `cargo build -p dh-gatewayd`（ent-desktop）通过。
- `bash scripts/restart-dev.sh` 全量重启，personal-stub/gatewayd 按需启动成功。
- gatewayd 日志：`crawler MCP server loaded from backend: http://127.0.0.1:8091/mcp`（不再 `No MCP servers configured`）。
- crawler-service 日志：MCP 握手 `initialize` 200 → `notifications/initialized` 202（修复前为 400）。
