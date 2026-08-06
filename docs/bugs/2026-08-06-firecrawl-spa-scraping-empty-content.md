# Firecrawl 抓取 SPA 应用返回空内容

## 现象

当用户使用 PRD 分析功能抓取 SPA（单页应用）网站时，Firecrawl 返回空内容或极少内容，导致 PRD 分析指令只能基于 URL 进行推测分析，无法获取目标网站的真实页面结构和功能信息。

具体表现：
- Firecrawl scrape 调用未包含 `waitFor` 参数，页面加载后立即提取内容
- SPA 应用的 JS 渲染尚未完成，DOM 中没有有效内容
- 合并逻辑 `firecrawlResult?.markdown || pageResult.markdown` 中，Firecrawl 返回的空字符串覆盖了 Playwright 已正确渲染的内容（因空字符串为 falsy 实际回退到 Playwright，但 Firecrawl 返回极少内容时不会回退）
- 登录态 cookies 仅传递给 Playwright，未传递给 Firecrawl，导致需要认证的页面抓取失败

## 根因

1. **Firecrawl 缺少 SPA 渲染等待**：`apps/crawler-service/src/services/firecrawl.ts` 中 `scrape()` 函数的 `ScrapeParams` 仅包含 `formats` 和 `onlyMainContent`，未设置 `waitFor` 参数。Firecrawl 在页面加载后立即提取内容，此时 SPA 应用的 JavaScript 尚未完成 DOM 渲染。

2. **合并逻辑不够智能**：`apps/crawler-service/src/routes/scrape.ts` 中使用 `firecrawlResult?.markdown || pageResult.markdown` 进行合并。当 Firecrawl 返回非空但极少内容时（如仅包含 `<noscript>` 标签内的文本），会覆盖 Playwright 正确渲染的完整内容。

3. **Cookies 未传递给 Firecrawl**：Firecrawl 作为独立抓取服务，需要 cookies 来访问需要登录的页面。原实现仅将 cookies 注入 Playwright 浏览器上下文，未传递给 Firecrawl API。

## 解决方案

### 1. Firecrawl 添加 `waitFor` 参数

在 `apps/crawler-service/src/services/firecrawl.ts` 中：
- 新增常量 `SPA_WAIT_FOR_MS = 5000`（5 秒等待 JS 渲染）
- `scrape()` 和 `crawl()` 函数的参数中添加 `waitFor: SPA_WAIT_FOR_MS`
- 确保 Firecrawl 在页面加载后等待足够时间让 SPA 内容完成渲染

### 2. Cookies 传递给 Firecrawl

- 新增 `cookiesToHeader()` 工具函数，将 cookies 数组转换为 `name=value; name=value` 格式的 Cookie header
- `scrapeWithFirecrawl()` 函数新增 `cookies` 参数
- `scrape()` 和 `crawl()` 函数接收 cookies，通过 `headers.Cookie` 传递给 Firecrawl API

### 3. 智能合并逻辑

在 `apps/crawler-service/src/routes/scrape.ts` 中：
- 比较 Firecrawl 和 Playwright 返回的 markdown 长度
- 当 Firecrawl markdown 长度 >= Playwright markdown 长度的 50% 时使用 Firecrawl 结果
- 否则回退到 Playwright 渲染结果（SPA 场景下 Playwright 已正确渲染内容）
- `crawlSource` 元数据反映实际使用的数据源

### 验证

- `pnpm build` 全部通过（7 tasks successful）
- `pnpm check-types` 全部通过（6 tasks successful）
- `go vet ./...` 0 warnings（dh-backend + personal-stub）
- crawler-service TypeScript 编译无错误
