# /prd-research 抓取 PingCode 超时失败 + Cookie 解析为空 + SPA 渲染不充分

## 现象
用户执行 `/prd-research` 调研 PingCode（附调研链接与登录 Cookie），抓取阶段失败，存在三个独立缺陷：
1. **BFS 超时**：dh-backend 日志 `prd-research scrape failed: call crawler-service: ... context deadline exceeded`，抓取结果为空（`markdownLen=0`）。crawler-service 请求只有 `incoming request`，无 `request completed`，60s 被强制中断、零结果返回。
2. **Cookie 解析为空**：用户用裸参数格式 `/prd-research <URL> <cookie字符串>`（直接粘贴浏览器 cookie，无 `ck:` 前缀），`parseInlineCookie` 要求 `ck:`/`cookie:` 前缀，全部跳过，`cookies=0`，导致无登录态、被重定向到登录页（title="登录 - PingCode"）。
3. **SPA 渲染不充分**：即使 cookie 有效、成功进入页面，`innerText` 为空或极少（如仅"快速开始"）。PingCode 是 Angular SPA，`domcontentloaded` + 固定 3s 等待不足以完成渲染；且导航栏用折叠模式（`thy-menu-collapsed`），菜单文本被 CSS 隐藏，`innerText` 不包含。

## 根因
### BFS 多页遍历无总体超时（主因）
crawler-service 的 `crawlPagesWithBrowser`（browser.ts）按 BFS 串行抓取站内链接，`maxDepth=2` 时会抓取起始页 + 第一层所有同域链接。PingCode 工作台（`/workspace/home/overview`）带有效登录 Cookie 后可正常进入，页面含 **17 个站内链接**（/ship、/pjm、/testhub、/wiki 等模块入口），BFS 需串行抓取 18 页，每页约 10s（domcontentloaded + 3s SPA 渲染等待），总耗时约 180s。

BFS 循环只有 `MAX_CRAWL_PAGES=30` 的页数上限，**没有总体时间 deadline**，不会在超时前中断返回部分结果。

### 三层 60s 超时双重夹击
抓取链路中有三处独立的 60s 超时同时生效，BFS 在第 60s 被双重中断：
1. **dh-backend HTTP 客户端超时**：`CrawlerServiceTimeout = 60s`（config.yaml），`context.WithTimeout(ctx, 60s)` 在 60s 后断开连接。
2. **crawler-service Fastify requestTimeout**：`config.requestTimeoutMs = 60000`（config.ts），Fastify 在 60s 后强制终止请求。
3. **page.goto 单页超时**：`config.requestTimeoutMs = 60000` 同时用作单页 `page.goto` 的 timeout。

三层超时均为 60s，BFS 串行抓取 18 页（~180s）远超 60s，在 60s 时 dh-backend 客户端与 crawler-service Fastify 同时中断，BFS 循环未来得及返回任何已抓取页面，导致零结果。

### 单页超时与总体超时未分离
`page.goto` 直接复用 `requestTimeoutMs`（60s）作为单页超时。即使增加总体 deadline，单页 60s 超时也会让末页占满全部剩余时间，无法在 deadline 前返回。

## 解决方案
将三层超时分离为协调的梯度，并让 BFS 在总体 deadline 前主动中断、返回已抓取的部分结果。

### 超时梯度（修复后）
| 层级 | 配置项 | 修复前 | 修复后 | 说明 |
|------|--------|--------|--------|------|
| 单页 page.goto | `PAGE_TIMEOUT_MS` | 60s（复用） | 30s | 单页加载上限，BFS 中取 min(30s, 剩余时间) |
| BFS 总体 | `CRAWL_TIMEOUT_MS` | 无 | 90s | 超时后停止开新页，返回已抓取的部分结果 |
| Fastify requestTimeout | `REQUEST_TIMEOUT_MS` | 60s | 100s | > BFS 总体超时，确保部分结果能返回 |
| dh-backend HTTP 客户端 | `crawler_service.timeout` | 60s | 105s | > Fastify requestTimeout，确保能接收响应 |

### BFS deadline 实现（browser.ts `crawlPagesWithBrowser`）
1. 循环开始前记录 `crawlDeadline = Date.now() + config.crawlTimeoutMs`。
2. 每次循环前计算 `remaining = crawlDeadline - Date.now()`，若 `remaining <= 5000ms`（`MIN_REMAINING_FOR_NEW_PAGE_MS`）则 break，不再开新页。
3. 单页 `page.goto` 超时取 `min(config.pageTimeoutMs, remaining)`，防止末页 goto 超时越过 deadline。
4. 超时 break 后返回已抓取的 `pages`（部分结果），scrape.ts 正常返回 200 与部分内容。

### 裸参数 Cookie 解析为空（缺陷2）
`parsePRDResearchArgs` 的裸参数路径用 `parseInlineCookie` 解析 cookie，要求 token 以 `ck:`/`cookie:` 前缀开头。用户直接粘贴浏览器 cookie 字符串（`name=value; name2=value2`，无前缀），全部被跳过，`cookies=0`。

### SPA 渲染不充分（缺陷3）
1. **固定 3s 等待不够**：PingCode 是 Angular SPA，`domcontentloaded` 后需引导 Angular、执行 change detection、渲染组件，3s 内 `innerText` 可能仍为空。
2. **innerText 漏折叠导航文本**：PingCode 导航栏用 `thy-menu-collapsed` 折叠模式，菜单名称被 CSS 隐藏，`innerText` 不包含，导致获取的文本极少。

### 其他修复
- `normalizeCookies`：对 cookie `name` 做 `trim()`，防御上游解析残留的前后空白导致 Playwright `addCookies` 报 "Invalid cookie fields"。
- `openPageWithCookies`：opts 新增 `pageTimeoutMs` 参数，`page.goto` 不再直接读 `config.requestTimeoutMs`。

### 裸参数 Cookie 解析修复（agui_prd_research.go）
1. 新增 `splitPlainCookie` 解析无前缀的 `name=value` 格式，提取为公共函数供 `parseCookieString` 复用（规则6）。
2. 裸参数路径逐 token 先尝试 `parseInlineCookie`（带前缀，向后兼容），再尝试 `splitPlainCookie`（无前缀，直接粘贴格式）；末尾分号先 `TrimSuffix` 去除。
3. 新增测试用例覆盖"直接粘贴浏览器 cookie，无前缀"场景。

### SPA 渲染修复（browser.ts）
1. **内容稳定轮询**：用 `page.evaluate` 每秒轮询 `body.innerText`，连续 2 次相同且非空则认为渲染稳定，替代固定 `waitForTimeout(3000)`。`SPA_RENDER_WAIT_MS` 从 3000 调为 8000（上限）。
2. **textContent 兜底**：`innerText` 少于 50 字符时（折叠导航等 CSS 隐藏场景），回退到 `cloneNode(true)` + 移除 `script/style/noscript` + `textContent`，获取 DOM 全部文本节点。

### 清洗后 HTML 输出（替代简陋 markdown 作为主要内容源）
爬虫原本就通过 `page.content()` 拿了完整 HTML，但 dh-backend `buildScrapedArgs` 用 fallback 链 `Markdown -> Text -> HTML`，markdown 非空时 HTML 被完全忽略。而 markdown 提取只选 `h1/p/li/h2/h3/h4`，对 Angular SPA（PingCode 用 thy-* 自定义组件）几乎提取不到内容，agent 拿到的页面信息严重不足。

修复：crawler-service 新增 `cleanedHtml` 输出（移除 `script/style/noscript/svg` 噪音，保留 body 结构化 HTML）；dh-backend `buildScrapedArgs` 同时输出文本摘要（markdown/text）和清洗后 HTML，agent 既有文本概览又有完整页面结构可供分析 UI 布局与组件。

### 影响文件
- `apps/crawler-service/src/config.ts` - 新增 `crawlTimeoutMs`、`pageTimeoutMs`，`requestTimeoutMs` 默认改为 100s
- `apps/crawler-service/src/services/browser.ts` - BFS deadline + 单页超时分离 + normalizeCookies 防御 + SPA 内容稳定轮询 + textContent 兜底 + cleanedHtml 提取
- `apps/crawler-service/src/types.ts` - `ScrapeResponse` 新增 `cleanedHtml` 字段
- `apps/crawler-service/src/routes/scrape.ts` - 合并多页 cleanedHtml
- `apps/crawler-service/.env.example` - 补充新配置项说明
- `apps/dh-backend/config.yaml` - `crawler_service.timeout` 从 60s 放宽到 105s
- `apps/dh-backend/gateway/handler/agui_prd_research.go` - 裸参数路径支持无前缀 cookie + `splitPlainCookie` 公共函数
- `apps/dh-backend/gateway/handler/agui_prd_research_test.go` - 新增裸参数无前缀 cookie 测试用例
- `apps/dh-backend/gateway/handler/agui_scrape.go` - `scrapeResponse` 新增 `CleanedHTML`；`buildScrapedArgs` 同时输出文本摘要 + 清洗后 HTML

### 验证结果
- `tsc --noEmit`（crawler-service）0 errors，`biome check` 0 warnings，`go vet ./...`（dh-backend）0 warnings
- `go test ./gateway/handler/ -run TestParsePRDResearchArgs` 通过（含新增用例）
- `scripts/restart-dev.sh` 全量重启通过
- 直接调用 crawler-service 抓取 PingCode 工作台（maxDepth=1，带 Cookie）：
  - title="工作台 - PingCode"（成功进入页面，非登录页）
  - mdLen=620, textLen=549, cleanedHtmlLen=43187
  - cleanedHtml 无 script/style/svg 噪音，含完整 Angular 组件结构（导航栏、菜单项、布局）
- 直接调用 crawler-service 抓取 PingCode 工作台（maxDepth=2，带 Cookie）：
  - 修复前：150s+ 超时，0 页，markdownLen=0，cookies=0（登录页）
  - 修复后：**90s 返回 200，6 页部分结果**，markdownLen=1645，title="工作台 - PingCode"，每页含导航结构与模块名称
- crawler-service 日志确认 deadline 早退：`crawl deadline approaching, stopping early: pages=8 remaining=173ms`
