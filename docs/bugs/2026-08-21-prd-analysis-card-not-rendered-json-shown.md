# /prd-analysis 产出物显示为 JSON 而非 Excel 表格

## 现象

执行 `/prd-analysis` 后，消息区只显示一个 `analysis.json` 文件附件 chip，没有「竞品信息分析」表格卡片，也没有「下载 Excel」按钮。用户反馈「还是一个 json」，与「产出物需为 Excel 表格」的预期不符。

## 根因

`PrdAnalysisCard` 组件（表格预览 + 下载按钮）**从未在消息流中渲染**：

1. `PrdAnalysisCard` 仅被 `MessageMarkers.tsx` 的 `PrdAnalysisMarkerRenderer` 引用。
2. 而 `MessageMarkers` 组件本身**从未被任何组件导入/渲染**（全仓搜索仅命中其自身定义处），属于未接线的死代码。
3. 因此 `[[CARD:prd_analysis]]` 标记虽由 agent 输出，但前端没有任何组件消费它渲染卡片。
4. 用户唯一能看到的是 `AssistantMessage.tsx` 直接渲染的 `[[FILE:.../analysis.json]]` 文件附件 chip，故「还是一个 json」。

> 即原始 `/prd-analysis` 实现（见 `docs/superpowers/plans/2026-08-19-prd-analysis-command.md` Task 4）只创建了卡片与 MarkerRenderer，但未在 `AssistantMessage.tsx` 完成接线，feature 实际未生效。

## 解决方案

### 1. 在 `AssistantMessage.tsx` 接线渲染卡片
- 导入 `PrdAnalysisCard`。
- 新增渲染块（参照 `ReviewReportCard` 模式）：当 `cardTypes.includes('prd_analysis')` 且拿到 `analysis.json` 路径且非运行中时，渲染 `<PrdAnalysisCard jsonPath={...} />`。
- 新增 `prdAnalysisJsonPath` 变量（从 `fileAttachments` 中 `endsWith('analysis.json')` 定位）。

### 2. 隐藏 `analysis.json` 文件附件 chip
- `AssistantMessage.tsx` 的文件附件过滤链末尾新增一层：`hasPrdAnalysisFromMarker` 时过滤掉 `endsWith('analysis.json')` 的路径，使 JSON 不作为 chip 暴露。
- `MessageMarkers.tsx` 的 `FileMarkerCards` 同步加同样过滤（保持一致，供未来接线使用）。

### 3. 下载产出改为真正的 Excel
- `PrdAnalysisCard.tsx` 移除 CSV 逻辑，改用 `exceljs`（走 browser 字段 `dist/exceljs.min.js`，vite 预打包正常）在浏览器内生成 `.xlsx`：表头加粗居中+底色、列宽自适应、finding 列 wrapText、冻结首行，文件名 `竞品信息分析-{topic}.xlsx`。

### 4. 动态表头（提示词主题）
- `analysis.json` 新增顶层 `topic` 字段（agent 从提示词提取核心主题，如「提前还款手续费」）。
- 后端模板（`command_config_defaults.go` + `commands.yaml`）同步更新 JSON 结构示例与说明。
- 前端 `findingHeader = data.topic || "提示词提及的信息"`，预览表格与 Excel「信息」列表头均使用之。

### 5. 附件文件打包进 xlsx
- 用户希望把原始附件文件本身（非内容）放进 Excel。浏览器端无法生成 OLE 内嵌对象，故采用「打包进 xlsx 压缩包」：exceljs 生成 xlsx 缓冲后，用既有 `jszip` 载入，把所有 type=file/screenshot 且带 `path` 的本地文件（经后端 `/v1/files/download` 取原始字节）按原始相对路径写入压缩包，再输出最终 xlsx。用户改后缀 `.zip` 解压即可取出原文件。单个附件下载失败时跳过。
- **鉴权修复**：`/v1/files/download` 端点需 Authorization 头（返回 401），最初 `fetch(downloadUrl)` 未带 token 导致附件全部静默跳过、xlsx 内无文件。修复方式：给 `fileApi` 新增 `downloadBytes(path)`，从 `localStorage['token']` 取 token 注入 `Authorization: Bearer <token>`（与 `api.ts` 一致），PrdAnalysisCard 改用它取附件字节。

## 验证

- `npx tsc --noEmit`：本次改动文件（PrdAnalysisCard/AssistantMessage/MessageMarkers）0 error（3 个既有 error 位于无关文件 NotificationCenter/FileAttachmentCard/InlineFilePreview）。
- `pnpm build` 通过。
- vite dev server 已加载新代码（AssistantMessage 模块含 PrdAnalysisCard 引用，PrdAnalysisCard 模块 200）。
- 后端 `/api/v1/commands` 含 `/prd-analysis`，desc 与模板含 Excel 说明。
- 用户需在浏览器**硬刷新**（Ctrl+Shift+R）加载 HMR 更新后的代码后重新查看消息即可看到表格卡片 +「下载 Excel」。

## 影响范围

- 仅 `/prd-analysis` 指令的产出展示；不影响其他指令。
- 新增前端依赖 `exceljs@^4.4.0`。
