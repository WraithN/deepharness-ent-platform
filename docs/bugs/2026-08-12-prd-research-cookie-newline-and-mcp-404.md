# /prd-research 抓取跳转登录页且 MCP 通道 404

## 现象
用户执行 `/prd-research` 调研 Apifox（附调研链接与登录 Cookie），结果：
1. 抓取的网页内容是登录页（微信扫码页，markdown 仅 147 字符），登录 Cookie 未生效。
2. 日志显示 `MCP scrape failed, fallback to direct crawler-service: mcp tool returned 404`，
   MCP 爬虫通道从未生效，每次都回退直连 crawler-service。
3. 用户同时反馈「调研的工作目录是项目目录而非 pm-jobs」。

## 根因
### 1. Cookie 解析为空（主因）
用户输入格式为「登录Cookie：」后**换行**再写 Cookie 字符串。`extractLabeledLine`
（agui_prd_research.go）只取标签**同一行**的内容，标签行内容为空即返回空，
导致 inline cookie 解析结果为 0（日志 `cookies=0`），爬虫在无登录态下抓取，
被 Apifox 重定向到登录页。

### 2. MCP 调用路径错误
dh-backend 调用 gatewayd 的 URL 为 `POST /mcp/tools/crawler:scrape`，
而 gatewayd 实际路由是 `POST /mcp/tools/{server}:{tool}/call`
（`apps/gatewayd/src/server.rs` → `mcp_aggregator::call_mcp_tool`），
缺少 `/call` 后缀导致恒定 404，MCP 通道成为摆设，始终走直连 fallback。

### 3. 工作目录问题（会话复用所致，已通过提示词加固）
调研运行复用了之前的聊天线程（gatewayd session 46001d13 ↔ opencode session
"增加名称评分功能"），agent 上下文中的锚定摘要残留了上一编码任务的
「工作目录：pefect-chinese-name/」描述，造成「工作目录是项目目录」的观感。
实际产物按指令模板的绝对路径 `{WORKSPACE_PATH}/pm-jobs/prd-research/apifox-com/`
正确落盘（文件时间与 run 日志的 write 工具调用一一对应）。

缓解措施（提示词层）：在 `/prd-research` 指令模板顶部新增
【任务独立性与路径约束（最高优先级）】段落，明确要求忽略会话历史中残留的
工作目录/任务结论、所有产物必须使用 `{WORKSPACE_PATH}/pm-jobs/prd-research/`
开头的绝对路径、历史上下文与本条消息冲突时以本条消息为准。
`config/commands.yaml` 与 `command_config_defaults.go` 内嵌默认值已同步更新。
建议：调研类指令仍应尽量在**新会话**中执行，从根本上避免上下文串扰。

## 解决方案
1. `agui_prd_research.go`：`extractLabeledLine` 在标签行内容为空时，回退取后续首个
   非空且非参数标签（调研链接/登录Cookie）的行作为值；若先遇到其他标签行则视为无值。
   新增 `nextValueLine` / `hasAnyParamLabel` 辅助函数。
2. `agui_scrape.go`：MCP 调用 URL 补上 `/call` 后缀，与 gatewayd 路由对齐。
3. 新增单元测试 `agui_prd_research_test.go::TestParsePRDResearchArgs`，覆盖同行格式、
   换行 Cookie、链接换行、标签空值、仅产品名称、裸参数六种场景。

### 影响文件
- `apps/dh-backend/gateway/handler/agui_prd_research.go` — 标签值换行回退解析
- `apps/dh-backend/gateway/handler/agui_scrape.go` — MCP URL 补 `/call`
- `apps/dh-backend/gateway/handler/agui_prd_research_test.go` — 新增单元测试

### 验证结果
- `go test ./gateway/handler/ -run TestParsePRDResearchArgs` 通过，`go vet` 0 warnings
- `pnpm build` 全量通过，`scripts/restart-dev.sh` 已重启
- 端到端：`POST http://localhost:2346/mcp/tools/crawler:scrape/call` 抓取 example.com
  返回 200 及完整 markdown（修复前同路径 404）
- 注意：Apifox 的 `Authorization=Bearer ...` Cookie 若已过期，即使正确传递仍会跳转
  登录页，需用户保证 Cookie 新鲜有效。
