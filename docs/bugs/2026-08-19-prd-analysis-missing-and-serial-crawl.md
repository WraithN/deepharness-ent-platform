# /prd-analysis 指令缺失 + 多站爬取串行卡顿

## 现象

1. **指令未出现在产品分类**：前端指令菜单的「产品」分组里看不到 `/prd-analysis`（竞品信息分析）。即使 `apps/dh-frontend/src/lib/commands.ts:66` 已经把 `'/prd-analysis': 'product'` 加进 `COMMAND_CATEGORIES` 映射，前端依然不显示该指令。
2. **多站爬取卡顿**：执行 `/prd-analysis` 输入多个网站链接 + 提示词时，整体速度很慢、像卡住。agent 倾向于按顺序逐站调用 `crawler:web_scrape`，单站 5～15s，N 个站串行总耗时 ≈ N × 单站耗时，且全部爬完才返回，前端长时间无中间反馈。

## 根因

### 缺陷1：`/prd-analysis` 未加入 `commands.yaml`

后端 `command_config.go:181` 的 `readYamlCommands` 优先读取 `apps/dh-backend/config/commands.yaml`，**只有该文件不存在或为空时才回退到 `embeddedCommands`**。

- `apps/dh-backend/gateway/handler/command_config_defaults.go:100` 的 `embeddedCommands` 中包含 `/prd-analysis`，但 `apps/dh-backend/config/commands.yaml` 中**没有该指令**。
- 因此 `GET /api/v1/commands` 不返回 `/prd-analysis`，前端拿不到该指令，分类映射 `'product'` 自然也无法生效。

### 缺陷2：模板未指引 agent 并行调用

`embeddedCommands` 中 `/prd-analysis` 模板的【执行流程】第 2 步原文：

> 2. 对每个网站链接调用 crawler:web_scrape 工具，参数：url=链接, maxDepth=1, includeImages=true, includeAttachments=true, includeScreenshot=true。

未指明「同一轮并行发起」还是「逐站串行」。opencode / claude 等 agent 默认倾向于串行调用工具，导致多站抓取逐站累加，整体卡顿。同时模板未明确「单站抓取失败不阻断其他站点」，agent 收到某站 `isError` 时可能中止整个任务。

## 解决方案

### 修复1：在 `commands.yaml` 中补齐 `/prd-analysis` 指令

在 `apps/dh-backend/config/commands.yaml` 的 `/prd-research` 之后、`/proto-make` 之前，追加完整的 `/prd-analysis` 指令块（label/desc/icon/template 等字段从 `embeddedCommands` 同步），保证前端能通过 `/api/v1/commands` 拿到该指令，进而由 `commands.ts` 的 `COMMAND_CATEGORIES` 映射归入「产品」分组。

### 修复2：模板【执行流程】改为强制并行抓取

将【执行流程】第 2 步改写为「并行抓取·关键」段落，明确要求：

- 在**同一轮**对所有 URL 同时发起 `crawler:web_scrape` 工具调用，禁止串行排队。
- 单站典型耗时 5～15s，并行后总耗时 ≈ 最慢一站；串行会逐站累加导致整体卡顿。
- 若工具运行时不支持一轮多调用，则按可用并发度分批，每批同时发起，不要逐站串行。

新增第 5 步「失败容错」：某网站 `web_scrape` 返回 `isError` 或异常时，`finding` 填「抓取失败：<原因>」，`sources` 仅含 page URL；不因单站失败中断整体流程，其他站点继续处理。

### 同步修改

为保持 `embeddedCommands` 与 `commands.yaml` 一致（`commands.yaml` 不存在时回退到 `embeddedCommands` 也应有同样行为），同步修改 `apps/dh-backend/gateway/handler/command_config_defaults.go` 中 `/prd-analysis` 模板的【执行流程】段为相同并行抓取版本。

### 影响文件

- `apps/dh-backend/config/commands.yaml` —— 追加 `/prd-analysis` 指令块（template 含并行抓取指引）。
- `apps/dh-backend/gateway/handler/command_config_defaults.go` —— 同步 `embeddedCommands` 中 `/prd-analysis` 的【执行流程】段为并行版本。

### 验证结果

- `python3 -c "import yaml; ..."` 解析 `commands.yaml`：21 个指令，`/prd-analysis` 已存在。
- `go vet ./apps/dh-backend/...` 0 warnings。
- `bash scripts/restart-dev.sh` 重启通过，所有服务 ready。
- `curl -H "Authorization: Bearer admin" http://localhost:8080/api/v1/commands` 返回 21 条指令，含 `/prd-analysis`（label=`竞品信息分析`，desc=`输入若干网站链接+提示词，爬取并提取相关信息，生成可预览下载的对照表格`），模板前 400 字符含「并行抓取·关键」段落。
- 前端 `apps/dh-frontend/src/lib/commands.ts:66` 已有 `'/prd-analysis': 'product'` 映射，刷新前端后 `/prd-analysis` 将出现在「产品」分组中。
