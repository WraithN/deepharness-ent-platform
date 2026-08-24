# /prd-analysis 产出物改为 Excel（前端浏览器生成）

> 关联设计：`docs/superpowers/specs/2026-08-19-prd-analysis-command-design.md`（原始指令设计）
> 关联实施计划：`docs/superpowers/plans/2026-08-19-prd-analysis-command.md`

## 1. 背景

`/prd-analysis`（竞品信息分析）当前产出 `analysis.json`，前端 `PrdAnalysisCard` 读 JSON 渲染表格预览，并提供「下载 CSV」（浏览器内拼接 CSV 文本）。用户要求：**产出物需为 Excel 表格，而不是 JSON**。

## 2. 方案选型

经确认采用「**前端浏览器生成**」方案：agent 仍写 `analysis.json`（卡片渲染数据源），前端用 xlsx 库在浏览器内生成真正的 `.xlsx` 供下载。

| 维度 | 前端浏览器生成（选定） | agent 直接生成 xlsx 文件 |
|------|----------------------|--------------------------|
| 可靠性 | 高（前端 npm 环境可控） | 低（依赖 gatewayd 容器具备 Python+openpyxl 等） |
| 产出物 | `.xlsx`（浏览器 Blob 下载） | `.xlsx` 文件（[[FILE]] 附件下载） |
| 预览 | 卡片表格预览复用现有 JSON 数据 | 需额外解析 xlsx 或写第二份数据文件 |

xlsx 库选型：选用 **`exceljs`**（可设表头加粗、列宽自适应、长文本 wrapText、冻结首行），不选 `xlsx`/SheetJS（npm 版本陈旧 0.18.5、样式能力弱）。

## 3. 架构与数据流（不变）

```
agent 写 analysis.json + 输出 [[CARD:prd_analysis]] [[FILE:.../analysis.json]]
  → dh-backend serve /v1/files/content 读取 JSON
  → 前端 PrdAnalysisCard 读 JSON 渲染表格 + 「下载 Excel」按钮
  → 点击按钮：exceljs 构建 worksheet → 生成 .xlsx Blob → 浏览器下载
```

`analysis.json` 仅作为卡片渲染的中间数据源，对用户不可见（不作为文件附件 chip 展示）。

## 4. 改动点

### 4.0 数据契约增强（`analysis.json` schema）
- 新增顶层 `topic` 字段：从提示词提取的核心主题（如「提前还款手续费」），用作表格表头，简短、不加标点。
- 前端 `findingHeader = data.topic || "提示词提及的信息"`，预览表格与 Excel 的「信息」列表头均使用 `findingHeader`。

### 4.1 前端依赖（`apps/dh-frontend/package.json`）
- 新增 `exceljs`（构建 worksheet + 样式）与复用既有 `jszip`（把本地附件文件打包进 xlsx 压缩包）。

### 4.2 `PrdAnalysisCard.tsx`（`apps/dh-frontend/src/components/chat/`）
- 移除 CSV 构建逻辑（`CSV_HEADERS`/`escapeCsvCell`/`buildCsv`/`downloadCsv`）。
- 新增 `buildExcel(rows, findingHeader, taskDir)`：
  - 用 exceljs 构建 worksheet（列：网站 / 公司 / **findingHeader(=topic)** / 信息来源）。
  - 表头行加粗、居中、填充底色；列宽自适应；finding 列 `alignment.wrapText`；冻结首行。
  - **附件打包**：`collectBundleFiles` 收集所有 type=file/screenshot 且带 `path` 的本地文件（page 仅为外链不打包），通过 `fetch(fileApi.downloadUrl(absPath))` 取原始字节，用 `JSZip.loadAsync(xlsxBuffer)` 载入 xlsx 后 `zip.file(source.path, bytes)` 写入，再 `generateAsync` 输出最终 xlsx。单个附件下载失败时跳过，不影响主表与其余文件。zipPath 用 source 原始相对路径，保留 `sources/attachments|screenshots/` 结构、避免重名。
- 任务目录 `taskDir = dirname(jsonPath)`，用于把 source 相对路径拼成绝对路径走后端下载端点。
- 按钮文案「下载 Excel」；文件名 `竞品信息分析-{topic}.xlsx`（topic 清洗非法字符，兜底无 topic）。
- 预览表格表头同步使用 `findingHeader`。

### 4.3 `MessageMarkers.tsx`（`apps/dh-frontend/src/components/chat/`）
- `FileMarkerCards` 增加过滤：当存在 `[[CARD:prd_analysis]]` 时，把以 `analysis.json` 结尾的路径从 `visibleFiles` 中排除（参照现有 `reviewFilePaths` 过滤模式），使 JSON 不作为文件附件 chip 展示。
- `PrdAnalysisMarkerRenderer` 的路径解析（`filePaths.find(p => p.endsWith('analysis.json'))`）不受影响（读全部 `files`，非 `visibleFiles`）。

### 4.4 后端模板（保持一致）
- `apps/dh-backend/gateway/handler/command_config_defaults.go` 与 `apps/dh-backend/config/commands.yaml` 的 `/prd-analysis` 模板「表格产出」段：agent 仍写 `analysis.json` + 输出两个标记。仅在 JSON 结构说明后补一句：该 JSON 为前端渲染数据源，最终 Excel 表格由前端生成。保持 `embeddedCommands` 与 `commands.yaml` 文案一致。

## 5. 不改动

- 意图识别（`intent_rules_defaults.go`）、agui 文案（`agui_helpers.go`）、commands 分类（`commands.ts`）、数据结构（`analysis.json` schema）。

## 6. 验证

- `npx tsc --noEmit -p apps/dh-frontend/tsconfig.check.json` 0 errors。
- `pnpm build` 通过。
- 重启服务后 `curl /api/v1/commands` 含 `/prd-analysis`。
- 手动触发一次 `/prd-analysis`：卡片展示「下载 Excel」按钮，点击导出 `.xlsx` 可用 Excel/WPS 打开，列与内容正确。

## 7. 影响范围

- `/prd-analysis` 是既有指令，改动仅影响其下载产出格式与文件附件展示，不影响其他指令。
- 新增前端依赖 `exceljs`，构建产物略增（可接受）。
