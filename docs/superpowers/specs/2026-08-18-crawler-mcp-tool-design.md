# 爬虫服务改造为 MCP 工具（gatewayd 代理）

> 日期：2026-08-18
> 状态：设计已确认，待制定实施计划
> 涉及仓库：`deepharness-ent-platform`（crawler-service、dh-backend）、`deepharness-ent-desktop`（gatewayd）

## 1. 背景与目标

### 现状

crawler-service 是独立部署的 Fastify HTTP 服务，仅提供 `/scrape` POST 接口。dh-backend
在 `/prd-research` 指令时**主动拦截**并 HTTP 直连 crawler `/scrape`，把抓取内容**注入**到
agent 输入参数中（`agui_scrape.go` 的 `scrapeWebsiteDirect` + `buildScrapedArgs`）。agent 被
动接收抓取结果，无法自主决定何时抓取、抓取什么。

历史上 gatewayd 曾尝试过 MCP 聚合层，但因 crawler 与 gatewayd 各自独立服务器部署，而
MCP stdio 传输要求同机通信，与三服务器架构不符，遂放弃，改为 dh-backend HTTP 直连
（见 `agui_scrape.go:93` 注释）。

gatewayd（Rust，`deepharness-ent-desktop/crates/`）已有 MCP 聚合层
（`apps/gatewayd/src/mcp_aggregator.rs`），但：① `McpClient` 硬编码 `StdioTransport`，不支持
HTTP 传输；② `aggregate_tools` 仅用于 admin API，未注入 agent run 流程。

### 目标

将爬虫服务改造为 MCP 工具形式，由 agent 在会话中**自主调用** `web_scrape` 工具：

1. crawler-service 实现 MCP server，暴露 `web_scrape` 工具。
2. gatewayd 作为 MCP 代理：对 agent 是 MCP server（暴露聚合工具），对 crawler 是 MCP
   client（HTTP 传输连接）。统一治理/审计点。
3. agent 通过原生 MCP 调用 gatewayd，把 `web_scrape` 当自己的工具，不改 agent CLI 工具
   执行机制。
4. crawler-service 地址由 dh-backend 集中管理，gatewayd 启动时拉取。

### 非目标

- 不改 opencode/claude CLI 源码的内部工具执行机制。
- 不做工具注入 agent run 的拦截式重写（经评估不可行，见第 9 节）。
- 不改 crawler-service 的 Playwright 抓取逻辑本身。

## 2. 已确认决策

| 决策点 | 选择 |
|--------|------|
| MCP 传输方式 | Streamable HTTP（跨机，crawler 与 gatewayd 仍各自独立服务器） |
| 调用方 | agent 自主调用（agent 在会话中决定何时调 `web_scrape`） |
| gatewayd 角色 | MCP 代理 server（对 agent 暴露聚合工具，对 crawler 是 client） |
| agent 接入方式 | agent 原生 MCP（经 dh-config-adapter 渲染到 agent 配置，连 gatewayd `/mcp`） |
| cookie 传递 | 作为工具参数，agent 从对话上下文传入 |
| crawler 地址管理 | dh-backend 集中管理，gatewayd 启动时拉取一次 |
| maxDepth 默认值 | dh-backend 传默认值，gatewayd 在工具 schema 填 default |
| 工具命名空间 | 保留 `crawler:web_scrape`（避免多 server 工具重名） |
| gatewayd MCP server 会话 | 无状态（YAGNI，先不实现 Mcp-Session-Id） |
| `/prd-research` 指令 | 保留为快捷入口，改为提示 agent 使用 `crawler:web_scrape`，不再抓取注入 |
| cookie 管理功能 | 保留为"cookie 仓库"，前端可保存/复制，不自动注入 |

## 3. 整体架构与数据流

```
agent (会话中自主决定抓取)
  │  调用 crawler:web_scrape(url, maxDepth?, cookies?)   [agent 原生 MCP 调用]
  ▼
gatewayd MCP server  (新增，HTTP /mcp endpoint，:2345)
  │  收到 tools/call，识别为 crawler 工具
  ▼
gatewayd MCP client (聚合层)  ── HttpTransport ──►  crawler MCP server (新增，HTTP /mcp endpoint)
                                                      │ 执行 Playwright 抓取
                                                      ▼
                                                  返回 markdown/cleanedHtml/...
  ◄──────────────── 结果回流 ────────────────────────
agent 得到网页内容，继续分析
```

**配置流向**：

```
dh-backend config (crawler_service.url + maxDepth)
  └─ GET /api/v1/admin/services/crawler
       └─ gatewayd 启动时拉取一次
            └─ McpRegistry 注册 crawler (HttpTransport, url)
                 └─ gatewayd MCP server /mcp 暴露 crawler:web_scrape 给 agent
                      └─ agent 调用
```

**全程 HTTP 传输**：gatewayd↔agent、gatewayd↔crawler 都用 MCP Streamable HTTP，避免 stdio
同机限制。gatewayd 本就是 HTTP 服务（:2345），新增 `/mcp` endpoint 作为 MCP server；crawler
同样新增 `/mcp` endpoint。

## 4. crawler-service 改造（本仓库 `apps/crawler-service/`）

### 4.1 新增 MCP server

在现有 Fastify app 上新增 `/mcp` endpoint，用 `@modelcontextprotocol/sdk` 的
`StreamableHTTPServerTransport` 实现 MCP server 三件套（`initialize` -> `tools/list` ->
`tools/call`）。复用现有 `crawlPagesWithBrowser`，不重写抓取逻辑。

### 4.2 `web_scrape` 工具定义

```ts
{
  name: "web_scrape",
  description: "抓取指定 URL 的网页内容（Playwright 多页 BFS 遍历），返回 markdown / 清洗后 HTML / 文本。供 agent 在会话中自主调用以获取网页内容进行分析。",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string", description: "目标网页 URL（http/https）" },
      maxDepth: { type: "integer", default: 0, description: "同域站内链接跟踪深度，0 表示只抓单页" },
      cookies: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            value: { type: "string" },
            domain: { type: "string" },
            path: { type: "string" }
          }
        },
        description: "可选，登录态 cookie（agent 从对话上下文或用户提供的 cookie 传入）"
      }
    },
    required: ["url"]
  }
}
```

`cookies` 字段结构与现有 `object.Cookie` 对齐（Playwright cookie 需要 name/value/domain/path）。

### 4.3 `tools/call` 处理

- 解析参数 -> 调 `crawlPagesWithBrowser(url, cookies, maxDepth, {})`。
- 合并多页：复用 `routes/scrape.ts` 的 `mergePageMarkdown`/`mergePageText`/`mergePageCleanedHtml`
  等纯函数，**抽到 `services/merge.ts`** 共享（遵循规则6 重复逻辑封装）。
- 返回 MCP `ToolResult`：`content: [{ type: "text", text: <markdown + cleanedHtml 拼接> }]`。
- 失败时返回 `is_error: true` + 结构化错误文本（而非 HTTP 502），让 agent 能读到失败原因。
- 超时/错误复用现有 Playwright 超时。

### 4.4 改动清单

| 文件 | 改动 |
|------|------|
| `src/index.ts` | 注册新 `routes/mcp.ts` |
| `src/routes/mcp.ts`（新增） | MCP server 装配 + `/mcp` POST/GET 处理 |
| `src/services/merge.ts`（新增） | 从 `routes/scrape.ts` 抽出 `mergePage*` 纯函数 |
| `src/routes/scrape.ts` | 改为引用 `services/merge.ts`，逻辑不变 |
| `package.json` | 加 `@modelcontextprotocol/sdk` 依赖 |
| 现有 `/scrape`、`/` 健康检查 | 保留不变（兼容） |

## 5. gatewayd 改造（`deepharness-ent-desktop` 仓库）

### 5.1 transport 抽象 + HttpTransport（`crates/dh-core/src/mcp/`）

现有 `StdioTransport`（spawn 子进程 + stdin/stdout 行协议）与 HTTP 传输的请求-响应模型
不同。抽象为 trait：

```rust
// transport.rs 新增
#[async_trait]
pub trait McpTransport: Send {
    async fn send_request(&self, json: String) -> Result<String, McpError>;
    async fn is_alive(&self) -> bool;
    async fn close(&self) -> Result<(), McpError>;
}

pub struct HttpTransport { client: reqwest::Client, url: String, session_id: Option<String> }
```

- `StdioTransport` 适配 trait：内部维持现有 `pending` map + oneshot 模型，`send_request`
  发送后等对应 id 的响应。
- `HttpTransport`：POST JSON-RPC 到 crawler `/mcp`，处理 SSE/JSON 响应；维护
  `Mcp-Session-Id`（若 server 要求）。
- `client.rs`：`McpClient` 持有 `Box<dyn McpTransport>`，提供 `spawn(command,args,env,ws)`
  （stdio）与 `connect_http(url)`（http）两个构造函数。

### 5.2 聚合层 config + DB schema（`apps/gatewayd/src/mcp_aggregator.rs`）

`McpServerConfig` 加字段：

```rust
pub enum TransportKind { Stdio, Http }
pub struct McpServerConfig {
    pub name: String,
    // stdio 专用
    pub command: String, pub args: Vec<String>, pub env: HashMap<String,String>,
    // http 专用
    pub transport: TransportKind, pub url: Option<String>,
    pub enabled: bool,
}
```

- DB `mcp_servers` 表加列：`transport TEXT DEFAULT 'stdio'`、`url TEXT`
  （`dh-db/src/schema.rs` 的 migration）。用于其他 http 类型 MCP server。
- `load_from_db`：按 `transport` 字段读，`Stdio` 走 command/args，`Http` 走 url。
- `spawn_client` 分支：`Stdio` -> `McpClient::spawn`，`Http` -> `McpClient::connect_http`。
- 校验放宽（`McpServerConfig::validate`）：`Http` 类型只校验 url 是 http/https，跳过
  command/bin_dir 校验；`Stdio` 保持现有白名单。

### 5.3 crawler 配置从 dh-backend 拉取

**crawler 条目不进本地 `mcp_servers` 表**，由 dh-backend 远程注入：

- `McpRegistry` 新增 `load_remote_from_backend(backend_url, token)`：
  - 调 `GET /api/v1/admin/services/crawler` 拉取 crawler 配置。
  - 构造 `McpServerConfig { name: "crawler", transport: Http, url, .. }`，`connect_http`
    注册到 registry。
- 复用现有 platform config fetch 的认证/URL 机制（`runtime_reporter` 已有 dh-backend
  地址 + token 配置，见 `dh-config/src/schema.rs` 的 `PlatformConfig`）。
- 拉取时机：**启动时一次**，在 `McpRegistry::load_from_db` 之后。失败则 warn 不阻断
  启动（registry 没有 crawler 工具，agent 调用时报错）。
- 不做定期刷新（YAGNI）。

### 5.4 gatewayd MCP server（新增 `apps/gatewayd/src/mcp_proxy_server.rs`）

gatewayd 对 agent 暴露 MCP server，把聚合工具代理出去：

- 挂在现有 :2345 HTTP server，新增 `/mcp` endpoint（POST + GET，MCP Streamable HTTP
  server 协议）。
- 实现 `initialize` / `tools/list` / `tools/call`：
  - `tools/list` -> `registry.aggregate_tools()`（已有方法）。
  - `tools/call` -> `registry.call_tool(full_name, arguments)`（已有方法）。
- 工具命名空间保留 `crawler:web_scrape`（agent 调用时带 namespace）。
- 会话：无状态（每次 POST 独立）。
- 复用现有 `ApiState.mcp_registry`，不需新状态。
- `maxDepth` 默认值：crawler 自身定义 `web_scrape.inputSchema.maxDepth.default = 0`
  （4.2）。gatewayd 从 dh-backend 拉取的 crawler 配置携带 `maxDepth`，在代理转发
  `tools/list` 时**改写** `web_scrape` 工具的 `maxDepth.default` 为该值（aggregate_tools
  返回的工具可变，逐工具改写）。这样 dh-backend 的默认值经 gatewayd 注入到 agent 看到的
  工具定义，agent 调用时不传则用此默认。

### 5.5 dh-config-adapter 渲染（`crates/dh-config-adapter/`）

把 gatewayd MCP server 渲染到 agent 原生配置，让 agent 自主连接：

- `McpServerConfig`（dh-config schema）加 `transport`/`url` 字段（同 5.2）。
- `claudecode/settings.rs::build_one_mcp`：`Http` 类型渲染为
  `{ "type": "http", "url": "..." }`，`Stdio` 保持 `{ "command":..., "args":... }`。
- `opencode` adapter 同理渲染 http 类型。
- **gatewayd MCP server 作为内置条目**：gatewayd 启动时往配置注入一条
  `name=gatewayd, transport=Http, url=http://127.0.0.1:2345/mcp`，adapter 自动渲染给
  agent。

### 5.6 改动清单

| 文件 | 改动 |
|------|------|
| `crates/dh-core/src/mcp/transport.rs` | 新增 `McpTransport` trait + `HttpTransport`，`StdioTransport` 适配 trait |
| `crates/dh-core/src/mcp/client.rs` | `McpClient` 持有 `Box<dyn McpTransport>`，加 `connect_http` |
| `apps/gatewayd/src/mcp_aggregator.rs` | `McpServerConfig` 加 transport/url，`spawn_client` 分支，校验放宽，`load_remote_from_backend` |
| `apps/gatewayd/src/mcp_proxy_server.rs`（新增） | MCP server `/mcp` endpoint |
| `apps/gatewayd/src/server.rs` | 注册 `/mcp` 路由，启动时调 `load_remote_from_backend` |
| `crates/dh-db/src/schema.rs` | `mcp_servers` 表加 `transport`/`url` 列 migration |
| `crates/dh-config/src/schema.rs` | `McpServerConfig` 加 `transport`/`url` 字段 |
| `crates/dh-config-adapter/src/claudecode/settings.rs` | `build_one_mcp` 支持 http 类型 |
| `crates/dh-config-adapter/src/opencode/*` | opencode adapter 支持 http 类型 |

## 6. dh-backend 改造（本仓库 `apps/dh-backend/`）

### 6.1 新增 crawler 配置 API

```
GET /api/v1/admin/services/crawler
-> { "url": "http://<crawler-host>:<port>/mcp", "maxDepth": 2, "timeoutMs": 60000 }
```

- `url`：指向 crawler 的 **MCP endpoint**（`/mcp`）。从 `config.CrawlerServiceURL` 推导
  （原 `/scrape` 基址 + `/mcp`，或配置项直接写 MCP url）。
- `maxDepth`/`timeoutMs`：作为工具默认值传给 gatewayd。
- 认证：复用现有 admin API 鉴权。

### 6.2 移除抓取注入链路

| 文件 | 改动 |
|------|------|
| `gateway/handler/agui_scrape.go` | **删除整个文件**（`scrapeWebsite`/`scrapeWebsiteDirect`/`buildScrapedArgs`/`scrapeRequest`/`scrapeResponse`/`extractDomain`） |
| `gateway/handler/agui_prd_research.go` | **删除抓取逻辑**。`/prd-research` 指令保留为快捷入口，改为在参数末尾追加提示：「如需抓取网页内容，可调用 `crawler:web_scrape` 工具」 |
| `gateway/handler/agui.go` | 移除 `crawlerServiceURL`/`crawlerServiceTimeout`/`crawlerMaxDepth` 字段及 `NewAGUIHandler` 对应参数；移除 `crawlerCookieSvc` 字段（cookie 服务仅由 crawler handler 路由用，不进 AGUIHandler） |
| `gateway/handler/agui_helpers.go:115` | `"/prd-research": "正在进行产品爬虫调研"` 改为 `"正在进行产品调研"` |
| `gateway/server/server.go` | `NewAGUIHandler` 调用去掉 crawler 三参数 + `crawlerCookieSvc` 参数 |
| `config/config.go` | **保留** `crawler_service` 配置块（作为配置源，供 6.1 API 读取） |

### 6.3 cookie 管理保留为"cookie 仓库"

- **保留**：`domain/crawler/handler`（SaveCookies/GetCookies）、`domain/crawler/service`
  （`.crawler-sessions` 持久化）、`crawler-sessions` 路由不变。
- 前端语义调整（前端改造后续，不在本设计核心范围）：cookie 管理页面从"抓取登录态"
  改为"cookie 仓库"--用户保存 cookie 后，在前端复制，粘贴到对话里告诉 agent「用这些
  cookie 调用 web_scrape」。
- **不自动注入**：移除 `agui_prd_research.go` 里 `crawlerCookieSvc.Load(...)` 的自动加载
  逻辑（随抓取逻辑一起删）。

## 7. 配置迁移

- crawler-service 仍独立服务器，新增暴露 `/mcp` endpoint。
- crawler-service 地址配置在 dh-backend `crawler_service.url`（保留）。
- gatewayd 容器无需配 crawler 地址（从 dh-backend 拉取）。
- gatewayd 本地 `mcp_servers` 表仍保留（其他 stdio/http MCP server 用），crawler 条目
  不进表。

## 8. 风险与兼容

### 8.1 风险

1. **MCP Streamable HTTP 传输成熟度**：`@modelcontextprotocol/sdk` 的 Streamable HTTP
   传输较新，需确认稳定性。fallback：用 SSE 传输（旧版 MCP HTTP 传输）。
2. **gatewayd MCP server 并发**：agent 可能并发调用工具，`/mcp` endpoint 需支持并发
   POST。`McpRegistry` 已用 `Arc<tokio::sync::Mutex>`，需确认锁粒度不阻塞并发。
3. **crawler 地址变化**：启动时拉取一次，若 crawler 地址变化需重启 gatewayd。可接受
   （crawler 地址通常稳定）。
4. **agent 配置注入时机**：gatewayd MCP server 条目需在 agent 启动前注入配置。确认
   adapter 渲染时机早于 agent 进程启动。

### 8.2 兼容

- crawler 现有 `/scrape` HTTP 接口保留（兼容其他潜在调用方）。
- dh-backend `crawler-sessions` cookie 管理 API 保留。
- gatewayd 现有 stdio MCP server（本地 `mcp_servers` 表）不受影响，与新 http 类型并存。
- `/prd-research` 指令保留（语义改为提示），前端快捷入口不受影响。

## 9. 评估记录：为何不采用"工具注入 agent run"

曾评估方案A 纯路径：gatewayd 聚合层连 crawler，并把工具**注入 agent run 流程**（拦截
agent 的 `tool_use` 事件，代为调用 `registry.call_tool` 后把 `tool_result` 喂回 agent）。

**结论：不可行**。gatewayd 是事件中转，不代为执行工具。agent（opencode/claude CLI）自己
决定调用工具、自己执行（bash/文件/MCP），产出的 `tool_use`/`tool_result` 事件经 SSE 流过
gatewayd 的 `mapper.rs:map_tool_use` 转发，mapper 只做事件映射不执行。`AgentInstance`
trait（`agent-core/instance.rs`）只有 `send_message`/`respond`，没有"外部代为执行工具"
的接口。要实现拦截需重写 agent CLI 工具协议，成本极高且违反 opencode/claude 自身设计。

故采用 gatewayd **MCP server 代理**路径：agent 通过原生 MCP 调 gatewayd（gatewayd 是
普通 MCP server），gatewayd 代理转发到 crawler。不改 agent CLI 工具执行机制，agent 把
`crawler:web_scrape` 当作自己的工具自主调用。
