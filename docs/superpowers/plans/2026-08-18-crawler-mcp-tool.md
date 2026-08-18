# 爬虫服务改造为 MCP 工具（gatewayd 代理）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 crawler-service 改造为 MCP 工具，由 agent 经 gatewayd 代理自主调用 `web_scrape`，替代 dh-backend 的 `/prd-research` 主动抓取注入。

**Architecture:** gatewayd 双角色--对 agent 是 MCP server（`/mcp` endpoint 暴露聚合工具），对 crawler 是 MCP client（新增 `HttpTransport`）。agent 通过 `dh-config-adapter` 渲染的原生 MCP 配置连接 gatewayd，自主调用 `crawler:web_scrape`。crawler 地址由 dh-backend 集中管理，gatewayd 启动时拉取。全程 HTTP 传输，避免 stdio 同机限制。

**Tech Stack:** TypeScript（crawler-service, Fastify + `@modelcontextprotocol/sdk`）、Rust（gatewayd, axum + reqwest + tokio）、Go（dh-backend, net/http）。

**关联设计文档：** `docs/superpowers/specs/2026-08-18-crawler-mcp-tool-design.md`

## Global Constraints

- 跨两个 git 仓库：`deepharness-ent-platform`（本仓库，crawler-service + dh-backend）与 `deepharness-ent-desktop`（gatewayd）。各自仓库独立提交。
- crawler-service：Node >=20，Fastify ^4.28.1，TypeScript 5.5 strict。
- gatewayd：Rust，axum，现有 `crates/dh-core/src/mcp/` 已有 stdio 实现。
- dh-backend：Go 1.22，标准库 net/http。
- 代码风格遵循各仓库现有约定（中文注释、规则4 嵌套≤3 层、规则6 重复逻辑封装、规则7 禁魔法值、规则8 warnings 清零）。
- MCP 协议版本：`2024-11-05`（与 gatewayd 现有 `McpClient::initialize` 一致）。
- 验证手段：crawler-service 用 `pnpm --filter @repo/crawler-service check-types` + biome；gatewayd 用 `cargo build` + `cargo test`；dh-backend 用 `go vet ./...` + `go build ./...`。

## File Structure

**仓库1: `deepharness-ent-platform`（crawler-service）**
- `apps/crawler-service/src/services/merge.ts`（新增）：从 `routes/scrape.ts` 抽出的 `mergePageMarkdown`/`mergePageText`/`mergePageHtml`/`mergePageCleanedHtml`/`dedupe` 纯函数。
- `apps/crawler-service/src/routes/mcp.ts`（新增）：MCP server 装配 + `/mcp` endpoint。
- `apps/crawler-service/src/index.ts`（修改）：注册 `routes/mcp.ts`。
- `apps/crawler-service/src/routes/scrape.ts`（修改）：改引 `services/merge.ts`。
- `apps/crawler-service/package.json`（修改）：加 `@modelcontextprotocol/sdk` 依赖。

**仓库2: `deepharness-ent-desktop`（gatewayd）**
- `crates/dh-core/src/mcp/transport.rs`（修改）：新增 `McpTransport` trait + `HttpTransport`，`StdioTransport` 适配 trait。
- `crates/dh-core/src/mcp/client.rs`（修改）：`McpClient` 持有 `Box<dyn McpTransport>`，加 `connect_http`。
- `apps/gatewayd/src/mcp_aggregator.rs`（修改）：`McpServerConfig` 加 `transport`/`url`，`spawn_client` 分支，校验放宽，`load_remote_from_backend`。
- `apps/gatewayd/src/mcp_proxy_server.rs`（新增）：gatewayd MCP server `/mcp` endpoint。
- `apps/gatewayd/src/server.rs`（修改）：注册 `/mcp` 路由，启动时调 `load_remote_from_backend`。
- `crates/dh-db/src/schema.rs`（修改）：`mcp_servers` 表加 `transport`/`url` 列 migration。
- `crates/dh-config/src/schema.rs`（修改）：`McpServerConfig` 加 `transport`/`url` 字段。
- `crates/dh-config-adapter/src/claudecode/settings.rs`（修改）：`build_one_mcp` 支持 http 类型。
- `crates/dh-config-adapter/src/opencode/*`（修改）：opencode adapter 支持 http 类型。

**仓库1: `deepharness-ent-platform`（dh-backend）**
- `apps/dh-backend/gateway/handler/admin_crawler_config.go`（新增）：`GET /admin/services/crawler` handler。
- `apps/dh-backend/gateway/handler/agui_scrape.go`（删除）。
- `apps/dh-backend/gateway/handler/agui_prd_research.go`（修改）：移除抓取逻辑，改提示。
- `apps/dh-backend/gateway/handler/agui.go`（修改）：移除 crawler 三字段 + `crawlerCookieSvc` 字段。
- `apps/dh-backend/gateway/handler/agui_helpers.go`（修改）：文案。
- `apps/dh-backend/gateway/server/server.go`（修改）：`NewAGUIHandler` 调用清理 + 注册新 admin 路由。

---

## Phase 1: crawler-service 改造（仓库 `deepharness-ent-platform`）

### Task 1: 抽取 mergePage* 纯函数到 services/merge.ts

**Files:**
- Create: `apps/crawler-service/src/services/merge.ts`
- Modify: `apps/crawler-service/src/routes/scrape.ts`
- Test: `apps/crawler-service/src/services/merge.test.ts`

**Interfaces:**
- Produces: `mergePageMarkdown(pages: PageResult[]): string`、`mergePageText`、`mergePageHtml`、`mergePageCleanedHtml`、`dedupe(items: string[]): string[]`。`PageResult` 从 `services/browser.ts` 导入。

- [ ] **Step 1: 写 merge.ts 单元测试**

创建 `apps/crawler-service/src/services/merge.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { mergePageMarkdown, mergePageText, mergePageHtml, mergePageCleanedHtml, dedupe } from "./merge.js";
import type { PageResult } from "./browser.js";

function page(over: Partial<PageResult> = {}): PageResult {
  return {
    title: "T", url: "https://x.test/a", markdown: "md", text: "txt",
    html: "<h>h</h>", cleanedHtml: "<c>c</c>", links: [], ...over,
  };
}

describe("merge functions", () => {
  it("mergePageMarkdown 每页前加 URL 标题，空 body 回退 text", () => {
    const out = mergePageMarkdown([page({ url: "https://x.test/a", markdown: "", text: "fallback" })]);
    expect(out).toContain("https://x.test/a");
    expect(out).toContain("fallback");
  });

  it("mergePageCleanedHtml 每页前加 URL 注释", () => {
    const out = mergePageCleanedHtml([page({ url: "https://x.test/a", cleanedHtml: "<c/>" })]);
    expect(out).toContain("<!-- https://x.test/a -->");
    expect(out).toContain("<c/>");
  });

  it("多页用 PAGE_SEPARATOR 连接，空页被过滤", () => {
    const out = mergePageMarkdown([
      page({ url: "u1", markdown: "m1" }),
      page({ url: "u2", markdown: "", text: "" }),
    ]);
    expect(out).toContain("m1");
    expect(out).not.toContain("u2");
  });

  it("dedupe 去重保序", () => {
    expect(dedupe(["a", "b", "a", "c"])).toEqual(["a", "b", "c"]);
  });

  it("mergePageText 与 mergePageHtml 过滤空串", () => {
    expect(mergePageText([page({ text: "" }), page({ text: "t" })])).toBe("t");
    expect(mergePageHtml([page({ html: "" }), page({ html: "<h/>" })])).toBe("<h/>");
  });
});
```

- [ ] **Step 2: 装 vitest 并配 test 脚本**

仓库当前无测试运行器。在 `apps/crawler-service/package.json` 加：
```json
"scripts": { "test": "vitest run" },
"devDependencies": {
  "vitest": "^1.6.0",
  "@types/node": "^20.14.11"
}
```
（`vitest` 加到现有 devDependencies，不重复列 `@types/node`。）

根 `package.json` 若无 turbo test 透传，跳过；本仓单独 `pnpm --filter @repo/crawler-service test` 运行。

- [ ] **Step 3: 运行测试确认失败**

Run: `pnpm --filter @repo/crawler-service install && pnpm --filter @repo/crawler-service test`
Expected: FAIL（`merge.ts` 不存在）

- [ ] **Step 4: 实现 merge.ts**

创建 `apps/crawler-service/src/services/merge.ts`，把 `routes/scrape.ts` 中的 `mergePageMarkdown`/`mergePageText`/`mergePageHtml`/`mergePageCleanedHtml`/`dedupe` 原样搬入（含 `PAGE_SEPARATOR` 常量），从 `./browser.js` 导入 `PageResult` 类型：

```ts
import type { PageResult } from "./browser.js";

const PAGE_SEPARATOR = "\n\n---\n\n";

export function mergePageMarkdown(pages: PageResult[]): string {
  return pages
    .map((p) => {
      const body = p.markdown || p.text;
      return `## ${p.url}\n\n${body}`;
    })
    .filter((s) => s.trim().length > 0)
    .join(PAGE_SEPARATOR);
}

export function mergePageText(pages: PageResult[]): string {
  return pages.map((p) => p.text).filter((s) => s.trim().length > 0).join(PAGE_SEPARATOR);
}

export function mergePageHtml(pages: PageResult[]): string {
  return pages.map((p) => p.html).filter((s) => s.trim().length > 0).join(PAGE_SEPARATOR);
}

export function mergePageCleanedHtml(pages: PageResult[]): string {
  return pages
    .map((p) => `<!-- ${p.url} -->\n${p.cleanedHtml}`)
    .filter((s) => s.trim().length > 0)
    .join(PAGE_SEPARATOR);
}

export function dedupe(items: string[]): string[] {
  return [...new Set(items)];
}
```

- [ ] **Step 5: 改 scrape.ts 引用 merge.ts**

`apps/crawler-service/src/routes/scrape.ts`：删除文件内的 `PAGE_SEPARATOR` 常量与 4 个 `mergePage*`/`dedupe` 函数定义，顶部改为：
```ts
import { mergePageMarkdown, mergePageText, mergePageHtml, mergePageCleanedHtml, dedupe } from "../services/merge.js";
```
其余逻辑不变。

- [ ] **Step 6: 运行测试确认通过**

Run: `pnpm --filter @repo/crawler-service test`
Expected: PASS（5 个测试通过）

- [ ] **Step 7: 类型检查 + lint**

Run: `pnpm --filter @repo/crawler-service check-types && pnpm --filter @repo/crawler-service lint`
Expected: 0 errors，0 warnings

- [ ] **Step 8: 提交**

```bash
git add apps/crawler-service/src/services/merge.ts apps/crawler-service/src/services/merge.test.ts apps/crawler-service/src/routes/scrape.ts apps/crawler-service/package.json
git commit -m "refactor(crawler): 抽取 mergePage* 纯函数到 services/merge.ts"
```

---

### Task 2: crawler-service 新增 MCP server（/mcp endpoint + web_scrape 工具）

**Files:**
- Create: `apps/crawler-service/src/routes/mcp.ts`
- Modify: `apps/crawler-service/src/index.ts`
- Modify: `apps/crawler-service/package.json`（加 `@modelcontextprotocol/sdk`）

**Interfaces:**
- Consumes: `crawlPagesWithBrowser(url, cookies, maxDepth, opts)` from `services/browser.ts`；`mergePageMarkdown`/`mergePageCleanedHtml` from `services/merge.ts`；`Cookie` from `types.ts`。
- Produces: HTTP `POST /mcp` 与 `GET /mcp` endpoint，实现 MCP `initialize`/`tools/list`/`tools/call`，暴露 `web_scrape` 工具。

- [ ] **Step 1: 加 MCP SDK 依赖**

```bash
pnpm --filter @repo/crawler-service add @modelcontextprotocol/sdk@^1.0.0
```

- [ ] **Step 2: 实现 mcp.ts**

创建 `apps/crawler-service/src/routes/mcp.ts`：

```ts
import { FastifyInstance } from "fastify";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { crawlPagesWithBrowser } from "../services/browser.js";
import { mergePageMarkdown, mergePageCleanedHtml } from "../services/merge.js";
import type { Cookie } from "../types.js";

// web_scrape 工具的输入 schema。maxDepth 默认 0（单页），与 scrapeRequestSchema 的 min(1) 不同：
// MCP 工具允许 0 表示只抓起始页，crawlPagesWithBrowser 内部会把 0 clamp 到 MIN_CRAWL_DEPTH(1)。
const WEB_SCRAPE_INPUT = {
  url: z.string().url().describe("目标网页 URL（http/https）"),
  maxDepth: z.number().int().min(0).max(10).default(0).describe("同域站内链接跟踪深度，0 表示只抓单页"),
  cookies: z.array(z.object({
    name: z.string(),
    value: z.string(),
    domain: z.string().optional(),
    path: z.string().optional(),
  })).optional().describe("可选，登录态 cookie（agent 从对话上下文或用户提供的 cookie 传入）"),
};

function buildMcpServer(): McpServer {
  const server = new McpServer({ name: "crawler-service", version: "0.0.1" });
  server.tool(
    "web_scrape",
    "抓取指定 URL 的网页内容（Playwright 多页 BFS 遍历），返回 markdown / 清洗后 HTML / 文本。供 agent 在会话中自主调用以获取网页内容进行分析。",
    WEB_SCRAPE_INPUT,
    async (args) => {
      try {
        const cookies: Cookie[] = (args.cookies ?? []).map((c) => ({
          name: c.name, value: c.value, domain: c.domain, path: c.path ?? "/",
        }));
        const pages = await crawlPagesWithBrowser(args.url, cookies, args.maxDepth, {});
        if (pages.length === 0) {
          return { content: [{ type: "text" as const, text: "抓取失败：无法获取页面内容" }], isError: true };
        }
        const md = mergePageMarkdown(pages);
        const cleaned = mergePageCleanedHtml(pages);
        const text = md + (cleaned ? `\n\n--- 页面 HTML 结构 ---\n${cleaned}` : "");
        return { content: [{ type: "text" as const, text }] };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { content: [{ type: "text" as const, text: `抓取异常：${msg}` }], isError: true };
      }
    },
  );
  return server;
}

export default async function mcpRoutes(app: FastifyInstance) {
  // Streamable HTTP 传输：POST 接收 JSON-RPC 请求，GET 用于 SSE 流（本实现无状态，GET 返回 405）。
  app.post("/mcp", async (req, reply) => {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    const server = buildMcpServer();
    server.connect(transport);
    // 将 Fastify 请求体转为 MCP 传输可消费的形式，再把响应写回。
    await transport.handleRequest(req.raw, reply.raw, req.body);
    // handleRequest 已 end 响应，避免 Fastify 再次写入。
  });
  app.get("/mcp", async (_req, reply) => {
    reply.code(405).send({ error: "GET not supported, use POST" });
  });
}
```

> 实现者注意：`StreamableHTTPServerTransport` 的具体 API（`sessionIdGenerator`、`handleRequest` 签名）以安装的 `@modelcontextprotocol/sdk` 版本为准。若版本 API 不同，以 SDK 文档为准调整调用方式，但保持「POST 处理 JSON-RPC、无状态、单次请求-响应」语义。`handleRequest` 已直接操作 `req.raw`/`reply.raw` 并 end 响应，Fastify 层不再 send。

- [ ] **Step 3: 注册路由**

`apps/crawler-service/src/index.ts`：在 `scrapeRoutes` 注册后加：
```ts
import mcpRoutes from "./routes/mcp.js";
// ...
await app.register(mcpRoutes, { prefix: "/" });
```

- [ ] **Step 4: 类型检查**

Run: `pnpm --filter @repo/crawler-service check-types`
Expected: 0 errors

- [ ] **Step 5: 启动并手动验证 MCP 协议可达性**

启动 crawler-service（后台）：
```bash
pnpm --filter @repo/crawler-service dev &
```
验证 initialize + tools/list：
```bash
curl -s -X POST http://localhost:3000/mcp -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1"}}}'
curl -s -X POST http://localhost:3000/mcp -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
```
Expected: initialize 返回 `protocolVersion`+`serverInfo`；tools/list 返回含 `web_scrape` 的工具数组。
停掉进程：`pkill -f 'tsx watch src/index'`

- [ ] **Step 6: 提交**

```bash
git add apps/crawler-service/src/routes/mcp.ts apps/crawler-service/src/index.ts apps/crawler-service/package.json pnpm-lock.yaml
git commit -m "feat(crawler): 新增 MCP server，暴露 web_scrape 工具（Streamable HTTP）"
```

---

## Phase 2: gatewayd 改造（仓库 `deepharness-ent-desktop`）

> 以下所有 `git` 命令在 `/home/nan/deepharness/deepharness-ent-desktop` 工作目录执行。提交到该仓库。

### Task 3: transport trait 抽象 + StdioTransport 适配

**Files:**
- Modify: `crates/dh-core/src/mcp/transport.rs`

**Interfaces:**
- Produces: `pub trait McpTransport: Send + Sync { async fn send_request(&self, json: String) -> Result<String, McpError>; async fn is_alive(&self) -> bool; async fn close(&self) -> Result<(), McpError>; }`。`StdioTransport` 实现 trait。

- [ ] **Step 1: 写 StdioTransport 适配 trait 的测试**

在 `crates/dh-core/src/mcp/transport.rs` 末尾加 `#[cfg(test)] mod tests`，用一个 fake stdin/stdout 验证 `send_request` 透传 JSON。由于 `StdioTransport` 依赖子进程，测试改为验证 trait 实现存在（编译期保证）：

```rust
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn stdio_transport_implements_trait() {
        // 编译期断言：StdioTransport 满足 McpTransport trait（无需构造实例）。
        fn _assert<T: McpTransport>() {}
        _assert::<StdioTransport>();
    }
}
```

- [ ] **Step 2: 运行测试确认编译失败**

Run: `cargo test -p dh-core mcp::transport`
Expected: 编译失败（trait 未定义）

- [ ] **Step 3: 定义 trait 并让 StdioTransport 实现它**

在 `transport.rs` 顶部加 trait 定义，并为 `StdioTransport` impl。`send_request` 复用现有「发送 + 等响应」逻辑：由于现有 `StdioTransport::send` 是发消息、`subscribe` 拿 stdout channel，trait 方法需把两者结合。改为在 `StdioTransport` 内部维护一个 `pending` map + `request_id`（与 `client.rs` 现有逻辑类似但下沉到 transport）。

> 实现者注意：现有 `StdioTransport` 的 send/receive 是解耦的（send 写 stdin，subscribe 拿 stdout）。为了让 trait 的 `send_request` 同步返回响应，需要在 `StdioTransport` 内部加 `pending: Arc<Mutex<HashMap<u64, oneshot::Sender<String>>>>` 与 stdout reader 任务（按 JSON-RPC id 路由）。参考 `client.rs` 现有 `pending` 机制，把 id 路由从 client 下沉到 transport。`client.rs` 在 Task 5 改为调 `transport.send_request(json)` 拿回响应字符串，再 `serde_json::from_str` 解析。
>
> **Notification 处理**：现有 client 有 `notification_handlers` 处理无 id 消息（如 `tools/list_changed`）。trait 化后，在 `McpTransport` trait 加 `fn set_notification_handler(&self, handler: Box<dyn Fn(String) + Send>)`，`StdioTransport` 在 stdout reader 中把无 id 消息交给 handler；`HttpTransport` 无连接级 notification（HTTP 模式下 server 不主动推送），空实现。`client.rs`（Task 5）通过 `set_notification_handler` 把 client 层的 notification 分发注册到 transport。

trait 定义：
```rust
use async_trait::async_trait;

#[async_trait]
pub trait McpTransport: Send + Sync {
    async fn send_request(&self, json: String) -> Result<String, McpError>;
    async fn is_alive(&self) -> bool;
    async fn close(&self) -> Result<(), McpError>;
}
```

`StdioTransport` impl `send_request`：生成 id（从 JSON 解析或自增）、登记 oneshot、`send` 发出、`timeout` 等 oneshot。需 `async_trait` 依赖：在 `crates/dh-core/Cargo.toml` 加 `async-trait = "0.1"`。

- [ ] **Step 4: 运行测试确认通过**

Run: `cargo test -p dh-core mcp::transport`
Expected: PASS

- [ ] **Step 5: cargo build + clippy**

Run: `cargo build -p dh-core && cargo clippy -p dh-core -- -D warnings`
Expected: 0 errors，0 warnings

- [ ] **Step 6: 提交**

```bash
git add crates/dh-core/src/mcp/transport.rs crates/dh-core/Cargo.toml
git commit -m "refactor(gatewayd): 抽象 McpTransport trait，StdioTransport 适配"
```

---

### Task 4: HttpTransport 实现

**Files:**
- Modify: `crates/dh-core/src/mcp/transport.rs`

**Interfaces:**
- Produces: `pub struct HttpTransport { ... }` + `impl HttpTransport { pub fn new(url: String) -> Self }`，实现 `McpTransport` trait。POST JSON-RPC 到 `<url>`，解析响应（JSON 或 SSE 单条 data），返回响应字符串。

- [ ] **Step 1: 写 HttpTransport 测试（用 mockito）**

在 `crates/dh-core/Cargo.toml` `[dev-dependencies]` 加 `mockito = "1"`。在 `transport.rs` 的 tests mod 加：

```rust
#[cfg(test)]
mod http_tests {
    use super::*;
    use mockito::Server;

    #[tokio::test]
    async fn http_transport_posts_jsonrpc_and_returns_response() {
        let mut server = Server::new_async().await;
        let body = r#"{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}"#;
        let resp = r#"{"jsonrpc":"2.0","id":1,"result":{"tools":[]}}"#;
        let m = server
            .mock("POST", "/mcp")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(resp)
            .create_async().await;
        let t = HttpTransport::new(format!("{}/mcp", server.url()));
        let out = t.send_request(body.to_string()).await.unwrap();
        assert!(out.contains(r#""tools":[]"#));
        m.assert_async().await;
    }

    #[tokio::test]
    async fn http_transport_returns_err_on_5xx() {
        let mut server = Server::new_async().await;
        server.mock("POST", "/mcp").with_status(503).create_async().await;
        let t = HttpTransport::new(format!("{}/mcp", server.url()));
        let r = t.send_request(r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}"#.to_string()).await;
        assert!(r.is_err());
    }
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cargo test -p dh-core http_tests`
Expected: FAIL（`HttpTransport` 未定义）

- [ ] **Step 3: 实现 HttpTransport**

在 `transport.rs` 加（`reqwest` 已是 dh-core 依赖，若无需在 Cargo.toml 加 `reqwest = { version = "0.12", features = ["json"] }`）：

```rust
pub struct HttpTransport {
    client: reqwest::Client,
    url: String,
}

impl HttpTransport {
    pub fn new(url: String) -> Self {
        Self { client: reqwest::Client::new(), url }
    }
}

#[async_trait]
impl McpTransport for HttpTransport {
    async fn send_request(&self, json: String) -> Result<String, McpError> {
        let resp = self.client.post(&self.url)
            .header("Content-Type", "application/json")
            .header("Accept", "application/json, text/event-stream")
            .body(json)
            .send().await
            .map_err(|e| McpError::ProcessError(e.to_string()))?;
        if !resp.status().is_success() {
            return Err(McpError::ProcessError(format!("HTTP {}", resp.status())));
        }
        let ct = resp.headers().get("content-type").and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
        let body = resp.text().await.map_err(|e| McpError::ProcessError(e.to_string()))?;
        // SSE 响应：取首个 data: 行的 payload；JSON 响应：直接返回 body。
        if ct.contains("text/event-stream") {
            for line in body.lines() {
                if let Some(payload) = line.strip_prefix("data: ") {
                    return Ok(payload.to_string());
                }
            }
            return Err(McpError::ProtocolError("SSE response without data line".into()));
        }
        Ok(body)
    }
    async fn is_alive(&self) -> bool { true }
    async fn close(&self) -> Result<(), McpError> { Ok(()) }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cargo test -p dh-core http_tests`
Expected: PASS（2 个测试）

- [ ] **Step 5: clippy**

Run: `cargo clippy -p dh-core -- -D warnings`
Expected: 0 warnings

- [ ] **Step 6: 提交**

```bash
git add crates/dh-core/src/mcp/transport.rs crates/dh-core/Cargo.toml
git commit -m "feat(gatewayd): 实现 HttpTransport（MCP Streamable HTTP 客户端）"
```

---

### Task 5: McpClient 支持 transport 选择 + connect_http

**Files:**
- Modify: `crates/dh-core/src/mcp/client.rs`

**Interfaces:**
- Consumes: `McpTransport` trait、`StdioTransport`、`HttpTransport`。
- Produces: `McpClient::spawn(command, args, env, workspace)`（stdio，保持签名不变）+ `McpClient::connect_http(url)`（新增）。`McpClient` 内部持有 `Box<dyn McpTransport>`。

- [ ] **Step 1: 改造 McpClient 持有 Box<dyn McpTransport>**

把 `McpClient.transport: Arc<tokio::sync::Mutex<StdioTransport>>` 改为 `transport: Arc<dyn McpTransport>`。`spawn` 内部 `StdioTransport::spawn` 后包成 `Box`。新增 `connect_http`：
```rust
pub async fn connect_http(url: &str) -> Result<Self, McpError> {
    let transport: Box<dyn McpTransport> = Box::new(HttpTransport::new(url.to_string()));
    let client = Self {
        transport: Arc::from(transport),
        request_id: AtomicU64::new(1),
        pending: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
        notification_handlers: Arc::new(std::sync::Mutex::new(HashMap::new())),
        initialized: Arc::new(std::sync::Mutex::new(false)),
    };
    client.initialize().await?;
    Ok(client)
}
```

`send_request`/`send_notification` 改为调 `self.transport.send_request(json)`（trait 方法）。注意：现有 `send_request` 内部把 id 写入 `pending` 等 oneshot，这套逻辑已下沉到 `StdioTransport`（Task 3）。`HttpTransport::send_request` 直接同步返回响应。client 层只需调 `transport.send_request(json)` 拿回响应字符串，`serde_json::from_str::<JsonRpcResponse>` 解析。

- [ ] **Step 2: 修正现有 spawn 调用方**

`apps/gatewayd/src/mcp_aggregator.rs:188` 的 `McpClient::spawn(&config.command, &config.args, &config.env, &workspace)` 签名不变，无需改。

- [ ] **Step 3: 编译 + 测试**

Run: `cargo build -p dh-core && cargo test -p dh-core`
Expected: 0 errors

- [ ] **Step 4: 提交**

```bash
git add crates/dh-core/src/mcp/client.rs
git commit -m "refactor(gatewayd): McpClient 持有 trait，新增 connect_http"
```

---

### Task 6: McpServerConfig 加 transport/url + DB migration + spawn_client 分支 + 校验放宽

**Files:**
- Modify: `apps/gatewayd/src/mcp_aggregator.rs`
- Modify: `crates/dh-db/src/schema.rs`

**Interfaces:**
- Produces: `McpServerConfig` 加 `pub transport: TransportKind, pub url: Option<String>`；`TransportKind { Stdio, Http }`；`spawn_client` 按 transport 分支；`validate` 对 Http 只校验 url 是 http/https。DB `mcp_servers` 表加 `transport`/`url` 列。

- [ ] **Step 1: DB schema 加列 migration**

`crates/dh-db/src/schema.rs`：在 `CREATE TABLE IF NOT EXISTS mcp_servers` 的建表 SQL 加 `transport TEXT NOT NULL DEFAULT 'stdio'`、`url TEXT` 两列。同时新增 `ALTER TABLE` 兼容旧库（SQLite 不支持 IF NOT EXISTS 加列，用 PRAGMA 检查）。

> 实现者注意：现有 schema 用 `CREATE TABLE IF NOT EXISTS`（新库直接有新列）。对已存在的旧库，需在 schema 加载后执行 `ALTER TABLE mcp_servers ADD COLUMN transport TEXT NOT NULL DEFAULT 'stdio'` 等。参考 `dh-db` 现有 migration 机制（若有 `MIGRATIONS` 常量数组则追加；若无则加一个幂等 `ALTER`：先 `PRAGMA table_info(mcp_servers)` 查列名，缺则 `ALTER`）。

- [ ] **Step 2: McpServerConfig 加字段 + TransportKind**

`mcp_aggregator.rs`：
```rust
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum TransportKind { Stdio, Http }

#[derive(Debug, Clone)]
pub struct McpServerConfig {
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    pub env: HashMap<String, String>,
    pub transport: TransportKind,
    pub url: Option<String>,
    pub enabled: bool,
}
```

- [ ] **Step 3: validate 放宽**

```rust
pub fn validate(&self) -> Result<(), McpValidationError> {
    match self.transport {
        TransportKind::Http => {
            let url = self.url.as_deref().unwrap_or("");
            if !url.starts_with("http://") && !url.starts_with("https://") {
                return Err(McpValidationError::DisallowedCommand(format!("http url required, got: {}", url)));
            }
            Ok(())
        }
        TransportKind::Stdio => { /* 现有 command/args 校验逻辑不变 */ }
    }
}
```

- [ ] **Step 4: load_from_db 按 transport 分支读**

```rust
// query 加 SELECT ... transport, url
let transport = match row.get::<_, String>(5).as_str() { "http" => TransportKind::Http, _ => TransportKind::Stdio };
let url: Option<String> = row.get(6)?;
// url 列可能为 NULL
```
构造 config 时填 transport/url。`Stdio` 行 url 可空，`Http` 行 command 可空。

- [ ] **Step 5: spawn_client 分支**

```rust
async fn spawn_client(config: &McpServerConfig) -> anyhow::Result<McpClient> {
    let workspace = std::env::current_dir().map(|p| p.to_string_lossy().to_string()).unwrap_or_else(|_| ".".into());
    let client = match config.transport {
        TransportKind::Stdio => McpClient::spawn(&config.command, &config.args, &config.env, &workspace).await?,
        TransportKind::Http => McpClient::connect_http(config.url.as_deref().unwrap_or("")).await?,
    };
    Ok(client)
}
```

- [ ] **Step 6: 编译 + 现有测试**

Run: `cargo build -p gatewayd && cargo test -p dh-db`
Expected: 0 errors

- [ ] **Step 7: 提交**

```bash
git add apps/gatewayd/src/mcp_aggregator.rs crates/dh-db/src/schema.rs
git commit -m "feat(gatewayd): McpServerConfig 支持 http transport + DB migration"
```

---

### Task 7: gatewayd MCP server（/mcp endpoint 代理聚合工具）

**Files:**
- Create: `apps/gatewayd/src/mcp_proxy_server.rs`
- Modify: `apps/gatewayd/src/server.rs`
- Modify: `apps/gatewayd/src/lib.rs`（声明 mod）

**Interfaces:**
- Consumes: `ApiState.mcp_registry`（`Arc<Mutex<McpRegistry>>`）、`McpRegistry::aggregate_tools`/`call_tool`。
- Produces: HTTP `POST /mcp` endpoint，实现 MCP `initialize`/`tools/list`/`tools/call`。无状态。

- [ ] **Step 1: 实现 mcp_proxy_server.rs**

创建 `apps/gatewayd/src/mcp_proxy_server.rs`。直接处理 JSON-RPC（不引入 MCP server SDK，gatewayd 侧自实现轻量 server）：

```rust
use axum::{extract::State, http::{HeaderMap, StatusCode}, response::Json};
use serde_json::{json, Value};
use super::ApiState;
use crate::mcp_aggregator::McpRegistry;

const MCP_PROTOCOL_VERSION: &str = "2024-11-05";
const MCP_DEFAULT_MAX_DEPTH: i64 = 2;

// 从 dh-backend 拉取的 crawler 配置携带的 maxDepth 默认值。
// 由 server.rs 启动时写入 ApiState（见 Task 8），此处读取用于改写工具 schema default。
pub fn rewrite_tool_defaults(tools: &mut Vec<Value>, max_depth: i64) {
    for t in tools.iter_mut() {
        if t.get("name").and_then(|v| v.as_str()) == Some("web_scrape") {
            if let Some(schema) = t.get_mut("inputSchema") {
                if let Some(props) = schema.get_mut("properties") {
                    if let Some(md) = props.get_mut("maxDepth") {
                        md["default"] = json!(max_depth);
                    }
                }
            }
        }
    }
}

pub async fn mcp_endpoint(
    State(state): State<ApiState>,
    Json(req): Json<Value>,
) -> Result<Json<Value>, StatusCode> {
    let method = req.get("method").and_then(|v| v.as_str()).unwrap_or("");
    let id = req.get("id").cloned().unwrap_or(Value::Null);
    match method {
        "initialize" => Ok(Json(json!({
            "jsonrpc": "2.0", "id": id,
            "result": {
                "protocolVersion": MCP_PROTOCOL_VERSION,
                "capabilities": { "tools": {} },
                "serverInfo": { "name": "gatewayd-mcp-proxy", "version": env!("CARGO_PKG_VERSION") }
            }
        }))),
        "notifications/initialized" => Ok(Json(Value::Null)),
        "tools/list" => {
            let registry = state.mcp_registry.as_ref().ok_or(StatusCode::SERVICE_UNAVAILABLE)?;
            let r = registry.lock().await;
            let mut tools: Vec<Value> = r.aggregate_tools().await.into_iter()
                .map(serde_json::to_value).filter_map(Result::ok).collect();
            rewrite_tool_defaults(&mut tools, state.crawler_max_depth.load(std::sync::atomic::Ordering::Relaxed));
            Ok(Json(json!({ "jsonrpc": "2.0", "id": id, "result": { "tools": tools } })))
        }
        "tools/call" => {
            let name = req.get("params").and_then(|p| p.get("name")).and_then(|v| v.as_str())
                .ok_or(StatusCode::BAD_REQUEST)?;
            let args = req.get("params").and_then(|p| p.get("arguments")).cloned().unwrap_or(json!({}));
            let registry = state.mcp_registry.as_ref().ok_or(StatusCode::SERVICE_UNAVAILABLE)?;
            let r = registry.lock().await;
            match r.call_tool(name, args).await {
                Ok(result) => Ok(Json(json!({ "jsonrpc": "2.0", "id": id, "result": result }))),
                Err(e) => Ok(Json(json!({ "jsonrpc": "2.0", "id": id, "error": { "code": -32603, "message": e.to_string() } }))),
            }
        }
        _ => Ok(Json(json!({ "jsonrpc": "2.0", "id": id, "error": { "code": -32601, "message": "method not found" } }))),
    }
}
```

> 实现者注意：`state.crawler_max_depth` 是新增字段（`AtomicI64`），由 Task 8 从 dh-backend 拉取后写入。本 Task 先在 `ApiState` 加 `pub crawler_max_depth: Arc<std::sync::atomic::AtomicI64>` 字段并默认 `MCP_DEFAULT_MAX_DEPTH``，Task 8 再填真实值。`lib.rs` 需 `pub mod mcp_proxy_server;`。

- [ ] **Step 2: ApiState 加字段 + lib.rs 声明 mod**

`apps/gatewayd/src/lib.rs` 加 `pub mod mcp_proxy_server;`（或放到 mod 声明处）。
`lib.rs` 的 `ApiState` struct 加：
```rust
pub crawler_max_depth: Arc<std::sync::atomic::AtomicI64>,
```
`server.rs` 构造 `ApiState` 处加 `crawler_max_depth: Arc::new(std::sync::atomic::AtomicI64::new(MCP_DEFAULT_MAX_DEPTH))`（常量从 `mcp_proxy_server` re-export 或本地定义，值为 2）。

- [ ] **Step 3: 注册 /mcp 路由**

`server.rs::build_admin_router`：在现有 `/mcp/servers` 等路由块后加：
```rust
.route("/mcp", post(crate::mcp_proxy_server::mcp_endpoint))
```
（`use axum::routing::post;` 已有。注意区分 `/mcp/servers` admin 路由与 `/mcp` 代理端点，路径不冲突。）

- [ ] **Step 4: 编译**

Run: `cargo build -p gatewayd`
Expected: 0 errors

- [ ] **Step 5: 启动 gatewayd 手动验证 /mcp**

启动 gatewayd（需先有 dh-backend 在跑，或临时跳过 crawler 拉取）：
```bash
cargo run -p gatewayd &
sleep 3
curl -s -X POST http://127.0.0.1:2345/mcp -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}'
curl -s -X POST http://127.0.0.1:2345/mcp -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
pkill -f 'target/debug/gatewayd'
```
Expected: initialize 返回 serverInfo；tools/list 返回 tools 数组（可能为空，因 crawler 未拉取，Task 8 后才有 crawler:web_scrape）。

- [ ] **Step 6: 提交**

```bash
git add apps/gatewayd/src/mcp_proxy_server.rs apps/gatewayd/src/server.rs apps/gatewayd/src/lib.rs
git commit -m "feat(gatewayd): 新增 MCP proxy server /mcp endpoint，暴露聚合工具给 agent"
```

---

### Task 8: gatewayd 启动时从 dh-backend 拉取 crawler 配置

**Files:**
- Modify: `apps/gatewayd/src/mcp_aggregator.rs`（加 `load_remote_from_backend`）
- Modify: `apps/gatewayd/src/server.rs`（启动时调用，填 `crawler_max_depth`）

**Interfaces:**
- Consumes: dh-backend `GET /api/v1/admin/services/crawler` -> `{ url, maxDepth, timeoutMs }`。dh-backend 平台地址 + token 从现有 `PlatformConfig`（`dh-config/src/schema.rs`）读取。
- Produces: `McpRegistry::load_remote_from_backend(&mut self, backend_url, token)` 把 crawler 注册为 `Http` transport；`ApiState.crawler_max_depth` 写入拉取到的 maxDepth。

- [ ] **Step 1: 实现 load_remote_from_backend**

在 `mcp_aggregator.rs` 的 `impl McpRegistry` 加：
```rust
/// 从 dh-backend 拉取 crawler 配置并注册为 Http MCP server。
/// 拉取失败仅 warn，不阻断启动（registry 无 crawler 工具，调用时报错）。
pub async fn load_remote_from_backend(&mut self, backend_url: &str, token: &str) -> anyhow::Result<i64> {
    let client = reqwest::Client::new();
    let resp = client.get(format!("{}/api/v1/admin/services/crawler", backend_url.trim_end_matches('/')))
        .bearer_auth(token)
        .send().await;
    let resp = match resp {
        Ok(r) if r.status().is_success() => r,
        Ok(r) => { anyhow::bail!("dh-backend crawler config HTTP {}", r.status()); }
        Err(e) => { anyhow::bail!("fetch crawler config: {e}"); }
    };
    let body: serde_json::Value = resp.json().await?;
    let url = body.get("url").and_then(|v| v.as_str()).unwrap_or("");
    let max_depth = body.get("maxDepth").and_then(|v| v.as_i64()).unwrap_or(2);
    if url.is_empty() { anyhow::bail!("crawler config url empty"); }
    let config = McpServerConfig {
        name: "crawler".into(),
        command: String::new(), args: vec![], env: HashMap::new(),
        transport: TransportKind::Http, url: Some(url.into()), enabled: true,
    };
    match McpClient::connect_http(url).await {
        Ok(client) => {
            self.clients.insert("crawler".into(), McpClientEntry { config, client: Arc::new(client) });
            info!("crawler MCP server loaded from backend: {}", url);
            Ok(max_depth)
        }
        Err(e) => { anyhow::bail!("connect crawler MCP: {e}"); }
    }
}
```

- [ ] **Step 2: server.rs 启动时调用**

`server.rs` 在 `load_from_db` 之后：
```rust
let mut registry = crate::mcp_aggregator::McpRegistry::load_from_db(&db_path).await?;
// 从 platform 配置读 dh-backend 地址 + token（复用 runtime_reporter 用的 PlatformConfig）。
let crawler_max_depth = if let Some(b) = platform_backend_url.as_deref() {
    match registry.load_remote_from_backend(b, &platform_token).await {
        Ok(md) => md,
        Err(e) => { warn!("load crawler from backend failed: {e}"); 2 }
    }
} else { 2 };
```
`platform_backend_url` / `platform_token` 从现有 `PlatformConfig`（`platform.url` + `platform.token`）读取，gatewayd 启动参数或 config 中已有。`ApiState` 构造时 `crawler_max_depth: Arc::new(AtomicI64::new(crawler_max_depth))`。

- [ ] **Step 3: 编译**

Run: `cargo build -p gatewayd`
Expected: 0 errors

- [ ] **Step 4: 手动验证（需 dh-backend Task 10 已完成）**

此 Task 验证依赖 dh-backend 的 `GET /admin/services/crawler`（Task 10）。若 Task 10 未完成，先跳过手动验证，在 Task 12 集成验证时一起验证。本 Task 仅保证编译通过。

- [ ] **Step 5: 提交**

```bash
git add apps/gatewayd/src/mcp_aggregator.rs apps/gatewayd/src/server.rs
git commit -m "feat(gatewayd): 启动时从 dh-backend 拉取 crawler 配置并注册"
```

---

### Task 9: dh-config-adapter 渲染 http 类型 MCP + gatewayd 内置条目

**Files:**
- Modify: `crates/dh-config/src/schema.rs`（`McpServerConfig` 加 `transport`/`url`）
- Modify: `crates/dh-config-adapter/src/claudecode/settings.rs`（`build_one_mcp` 支持 http）
- Modify: `crates/dh-config-adapter/src/opencode/*`（opencode adapter 支持 http）
- Modify: `apps/gatewayd/src/server.rs`（注入 gatewayd 内置条目）

**Interfaces:**
- Produces: claudecode `settings.json` 的 `mcpServers` 对 http 类型渲染为 `{ "type": "http", "url": "..." }`；opencode config 同理。gatewayd 启动时往 `UnifiedConfig.mcp` 注入一条 `name=gatewayd, transport=Http, url=http://127.0.0.1:2345/mcp`。

- [ ] **Step 1: dh-config McpServerConfig 加字段**

`crates/dh-config/src/schema.rs` 的 `McpServerConfig` 加：
```rust
#[serde(default)]
pub transport: TransportKindCfg,
#[serde(skip_serializing_if = "Option::is_none")]
pub url: Option<String>,
```
```rust
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
pub enum TransportKindCfg { #[default] Stdio, Http }
```
（用 `TransportKindCfg` 与 gatewayd 的 `TransportKind` 区分，避免跨 crate 命名冲突；或 re-export。）

- [ ] **Step 2: build_one_mcp 支持 http**

`claudecode/settings.rs::build_one_mcp`：
```rust
fn build_one_mcp(entry: &McpServerConfig) -> Value {
    if entry.transport == TransportKindCfg::Http {
        let url = entry.url.clone().unwrap_or_default();
        return json!({ "type": "http", "url": url });
    }
    // 现有 stdio 渲染
    let mut env = Map::new();
    for (k, v) in &entry.env { env.insert(k.clone(), Value::String(v.clone())); }
    json!({ "command": entry.command, "args": entry.args, "env": Value::Object(env) })
}
```
更新 `includes_only_enabled_mcp_servers` 测试，加一个 http 类型用例。

- [ ] **Step 3: opencode adapter 支持 http**

在 `dh-config-adapter/src/opencode/` 下找到 mcp 渲染处，对 `TransportKindCfg::Http` 渲染为 opencode 的 http mcp 配置格式（参考 opencode 文档的 `mcp.servers.<name>.type = "http"` + `url`）。

- [ ] **Step 4: gatewayd 注入内置条目**

`apps/gatewayd/src/server.rs`：在生成 `UnifiedConfig`（渲染给 agent）的地方，注入：
```rust
cfg.mcp.push(McpServerConfig {
    name: "gatewayd".into(),
    transport: TransportKindCfg::Http,
    url: Some("http://127.0.0.1:2345/mcp".into()),
    enabled: true,
    scopes: vec![], // 所有 adapter
    ..Default::default()
});
```
> 实现者注意：需定位 server.rs / config 渲染流程中「生成 agent 配置」的函数，在 push mcp 时加此内置条目。若 gatewayd 配置渲染流程不经过 `UnifiedConfig`，则在 adapter 入口前注入。

- [ ] **Step 5: 编译 + 测试**

Run: `cargo build -p dh-config -p dh-config-adapter && cargo test -p dh-config -p dh-config-adapter`
Expected: 0 errors，现有测试 + 新 http 用例 PASS

- [ ] **Step 6: 提交**

```bash
git add crates/dh-config/src/schema.rs crates/dh-config-adapter/src/ apps/gatewayd/src/server.rs
git commit -m "feat(gatewayd): dh-config-adapter 渲染 http 类型 MCP + gatewayd 内置条目"
```

---

## Phase 3: dh-backend 改造（仓库 `deepharness-ent-platform`）

### Task 10: 新增 GET /admin/services/crawler 配置 API

**Files:**
- Create: `apps/dh-backend/gateway/handler/admin_crawler_config.go`
- Modify: `apps/dh-backend/gateway/server/server.go`（注册路由）

**Interfaces:**
- Consumes: `config.CrawlerServiceURL`、`config.CrawlerMaxDepth`、`config.CrawlerServiceTimeout`。
- Produces: `GET /api/v1/admin/services/crawler` -> `{ "url", "maxDepth", "timeoutMs" }`。`url` = CrawlerServiceURL 基址 + `/mcp`。

- [ ] **Step 1: 实现 handler**

创建 `apps/dh-backend/gateway/handler/admin_crawler_config.go`：

```go
package handler

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/config"
)

// crawlerConfigResponse 是 GET /admin/services/crawler 的响应，供 gatewayd 拉取 crawler MCP 配置。
type crawlerConfigResponse struct {
	URL       string `json:"url"`
	MaxDepth  int    `json:"maxDepth"`
	TimeoutMs int64  `json:"timeoutMs"`
}

// CrawlerConfigHandler 暴露 crawler-service 的 MCP endpoint 地址与默认参数。
// crawler 地址由 dh-backend 集中管理，gatewayd 启动时拉取（见设计文档第 5.3 节）。
type CrawlerConfigHandler struct {
	cfg *config.Config
}

func NewCrawlerConfigHandler(cfg *config.Config) *CrawlerConfigHandler {
	return &CrawlerConfigHandler{cfg: cfg}
}

func (h *CrawlerConfigHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	base := strings.TrimRight(h.cfg.CrawlerServiceURL, "/")
	mcpURL := base + "/mcp"
	timeoutMs := int64(h.cfg.CrawlerServiceTimeout.Seconds() * 1000)
	if timeoutMs <= 0 {
		timeoutMs = 60000
	}
	maxDepth := h.cfg.CrawlerMaxDepth
	if maxDepth <= 0 {
		maxDepth = 2
	}
	resp := crawlerConfigResponse{URL: mcpURL, MaxDepth: maxDepth, TimeoutMs: timeoutMs}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(resp)
}
```

- [ ] **Step 2: 注册路由**

`apps/dh-backend/gateway/server/server.go`：在路由常量区加：
```go
ROUTE_ADMIN_SERVICES_CRAWLER = API_V1_PREFIX + "/admin/services/crawler"
```
在路由注册区（其他 admin 路由附近）：
```go
crawlerCfgHandler := handler.NewCrawlerConfigHandler(cfg)
mux.Handle(ROUTE_ADMIN_SERVICES_CRAWLER, middleware.Auth(http.HandlerFunc(crawlerCfgHandler.ServeHTTP)))
```

- [ ] **Step 3: 编译 + vet**

Run: `cd apps/dh-backend && go vet ./... && go build ./...`
Expected: 0 warnings，0 errors

- [ ] **Step 4: 手动验证**

启动 dh-backend，调：
```bash
curl -s http://localhost:8080/api/v1/admin/services/crawler -H "Authorization: Bearer <token>"
```
Expected: 返回 `{ "url": "http://<crawler>/mcp", "maxDepth": 2, "timeoutMs": 60000 }`。

- [ ] **Step 5: 提交**

```bash
git add apps/dh-backend/gateway/handler/admin_crawler_config.go apps/dh-backend/gateway/server/server.go
git commit -m "feat(dh-backend): 新增 GET /admin/services/crawler 配置 API"
```

---

### Task 11: 移除抓取注入链路

**Files:**
- Delete: `apps/dh-backend/gateway/handler/agui_scrape.go`
- Modify: `apps/dh-backend/gateway/handler/agui_prd_research.go`
- Modify: `apps/dh-backend/gateway/handler/agui.go`
- Modify: `apps/dh-backend/gateway/handler/agui_helpers.go`
- Modify: `apps/dh-backend/gateway/server/server.go`

**Interfaces:**
- Produces: `AGUIHandler` 移除 `crawlerServiceURL`/`crawlerServiceTimeout`/`crawlerMaxDepth`/`crawlerCookieSvc` 字段及 `NewAGUIHandler` 对应参数。`/prd-research` 指令保留但不再抓取，改为追加提示。

- [ ] **Step 1: 删除 agui_scrape.go**

```bash
git rm apps/dh-backend/gateway/handler/agui_scrape.go
```

- [ ] **Step 2: 改造 agui_prd_research.go**

移除 `tryAugmentPRDResearchMessage` 中的抓取逻辑（`h.scrapeWebsite` 调用、`h.crawlerCookieSvc.Load`、`mergeCookies`、`buildScrapedArgs`）。保留指令识别，改为在参数末尾追加提示。新的核心逻辑：

```go
// tryAugmentPRDResearchMessage 检测最后一条用户消息是否为 /prd-research 指令。
// 不再主动抓取，改为在参数末尾追加提示，引导 agent 自主调用 crawler:web_scrape 工具。
func (h *AGUIHandler) tryAugmentPRDResearchMessage(r *http.Request, messages []agui.Message, workspaceID, runID string) (matched bool, abort bool) {
	for i := len(messages) - 1; i >= 0; i-- {
		if messages[i].Role != agui.RoleUser {
			continue
		}
		rawText := messages[i].ContentText()
		original := extractOriginalUserPrompt(rawText)
		if original == "" {
			original = rawText
		}
		cmd, args, ok := parseSlashCommand(original)
		if !ok || cmd != prdResearchCommand {
			return false, false
		}
		// 追加工具使用提示，不再抓取注入。
		augmentedArgs := strings.TrimRight(args, "\n") + "\n\n【提示】如需抓取网页内容，可调用 crawler:web_scrape 工具。"
		augmented := cmd + " " + augmentedArgs
		data, err := json.Marshal(augmented)
		if err != nil {
			log.Printf("[AGUIHandler] run=%s marshal prd-research message failed: %v", runID, err)
			return true, false
		}
		messages[i].Content = json.RawMessage(data)
		return true, false
	}
	return false, false
}
```

移除文件中不再使用的函数：`parsePRDResearchArgs`（若仅用于抓取路径）、`extractLabeledLine`、`nextValueLine`、`hasAnyParamLabel`、`normalizeResearchURL`、`parseCookieString`、`splitPlainCookie`、`splitArgsTokens`、`parseInlineCookie`、`mergeCookies`、`extractDomain`（后者在 agui_scrape.go 已删）。

> 实现者注意：`parsePRDResearchArgs` 等函数是否被其他文件引用，需 `rg` 确认。若仅本文件用，一并删除；保留 `maxInlineCookies`/`researchLinkLabels`/`researchCookieLabels` 仅当仍有引用。清理后确保 `import` 无未使用项（`net/url` 若不再用则删）。`object` 包 import 若不再用也删。

- [ ] **Step 3: 改 agui.go（移除 crawler 字段）**

`AGUIHandler` struct 移除字段：`crawlerCookieSvc`、`crawlerServiceURL`、`crawlerServiceTimeout`、`crawlerMaxDepth`。`NewAGUIHandler` 签名移除对应参数：
```go
func NewAGUIHandler(adminURL, pluginKey, workspaceRoot string, sessions chat.SessionStore, messages chat.MessageStore, buf buffer.SSEBuffer, workItemSvc workitemservice.WorkItemService) *AGUIHandler {
```
移除 `crawlerservice` import（若仅此用）。

- [ ] **Step 4: 改 agui_helpers.go 文案**

`agui_helpers.go:115`（`"/prd-research": "正在进行产品爬虫调研"`）改为 `"正在进行产品调研"`。

- [ ] **Step 5: 改 server.go 调用**

`server.rs`（实为 `gateway/server/server.go`）的 `NewAGUIHandler(...)` 调用移除 `crawlerCookieSvc, cfg.CrawlerServiceURL, cfg.CrawlerServiceTimeout, cfg.CrawlerMaxDepth` 实参。`crawlerCookieSvc` 仍用于 `crawlerHandler`（cookie 管理），保留创建，只是不传给 AGUIHandler。

- [ ] **Step 6: 编译 + vet**

Run: `cd apps/dh-backend && go vet ./... && go build ./...`
Expected: 0 warnings，0 errors。若有未使用 import 或函数，清理至 0 warning。

- [ ] **Step 7: 提交**

```bash
git add apps/dh-backend/gateway/handler/ apps/dh-backend/gateway/server/server.go
git commit -m "refactor(dh-backend): 移除 /prd-research 抓取注入，改为提示 agent 调用 web_scrape"
```

---

## Phase 4: 集成验证（两仓库）

### Task 12: 三端集成验证

**Files:** 无（验证任务）

- [ ] **Step 1: 确认两仓库改动已提交并构建通过**

本仓库（deepharness-ent-platform）：
```bash
cd /home/nan/deepharness/deepharness-ent-platform
pnpm --filter @repo/crawler-service check-types && pnpm --filter @repo/crawler-service test
cd apps/dh-backend && go vet ./... && go build ./... && cd ../..
```
gatewayd 仓库：
```bash
cd /home/nan/deepharness/deepharness-ent-desktop
cargo build -p gatewayd && cargo test -p dh-core -p dh-config -p dh-config-adapter
```
Expected: 全部 0 errors。

- [ ] **Step 2: 启动三服务**

```bash
# crawler-service
cd /home/nan/deepharness/deepharness-ent-platform && pnpm --filter @repo/crawler-service dev &
# dh-backend
pnpm --filter @repo/dh-backend dev &
# gatewayd（在 desktop 仓库）
cd /home/nan/deepharness/deepharness-ent-desktop && cargo run -p gatewayd &
```
等待各服务就绪（crawler :3000、dh-backend :8080、gatewayd :2345）。

- [ ] **Step 3: 验证 gatewayd 从 dh-backend 拉取 crawler 配置**

看 gatewayd 启动日志，应有 `crawler MCP server loaded from backend: http://<crawler>:3000/mcp`。
调 gatewayd MCP 列工具：
```bash
curl -s -X POST http://127.0.0.1:2345/mcp -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
```
Expected: 返回含 `crawler:web_scrape`，其 `inputSchema.properties.maxDepth.default` = dh-backend 配置的 maxDepth（如 2）。

- [ ] **Step 4: 验证 agent 经 gatewayd 调用 crawler 完成真实抓取**

```bash
curl -s -X POST http://127.0.0.1:2345/mcp -H 'Content-Type: application/json' -d '{
  "jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"crawler:web_scrape","arguments":{"url":"https://example.com","maxDepth":0}}
}'
```
Expected: 返回 `ToolResult`，`content[0].text` 含 example.com 的 markdown 内容。

- [ ] **Step 5: 验证 /prd-research 不再抓取**

通过 dh-backend 触发一个 `/prd-research <某URL>` 指令的 agent run（用现有前端或 curl 模拟会话）。检查 dh-backend 日志：不应出现 `prd-research message augmented, url=...`，应只有指令识别 + 提示追加。agent run 启动后，agent 应自主决定是否调 `crawler:web_scrape`。

- [ ] **Step 6: 停止服务 + 记录缺陷文档（若有问题）**

```bash
pkill -f 'target/debug/gatewayd'; pkill -f 'dh-backend'; pkill -f 'crawler-service'
```
若 Step 3-5 有问题，按规则3 在 `docs/bugs/2026-08-18-crawler-mcp-*.md` 记录现象/根因/解决。

- [ ] **Step 7: 全部通过则本计划完成**

确认两仓库改动均已 push：
```bash
cd /home/nan/deepharness/deepharness-ent-platform && git status   # clean
cd /home/nan/deepharness/deepharness-ent-desktop && git status    # clean
```

---

## Self-Review 备注

- **Spec 覆盖**：crawler MCP server（Task 2）、gatewayd HttpTransport（Task 3-5）、McpServerConfig http（Task 6）、gatewayd MCP server 代理（Task 7）、crawler 配置从 dh-backend 拉取（Task 8）、dh-config-adapter http 渲染 + 内置条目（Task 9）、dh-backend 配置 API（Task 10）、移除抓取注入（Task 11）、集成验证（Task 12）。设计文档每节均有对应 Task。
- **cookie 仓库**：设计文档第 6.3 节"cookie 管理保留"对应 dh-backend `domain/crawler/` 不动，Task 11 仅移除 AGUIHandler.crawlerCookieSvc 字段，crawler handler 路由保留。已覆盖。
- **maxDepth 默认值流**：dh-backend config -> admin API(Task 10) -> gatewayd 拉取写入 crawler_max_depth(Task 8) -> /mcp tools/list 改写 default(Task 7)。链路一致。
- **类型一致性**：`TransportKind`（gatewayd mcp_aggregator）与 `TransportKindCfg`（dh-config schema）跨 crate 分开命名，避免冲突；`McpServerConfig` 两处（mcp_aggregator 运行时 + dh-config 配置层）各自加字段，Task 9 注入内置条目时用 dh-config 的 `TransportKindCfg::Http`。
