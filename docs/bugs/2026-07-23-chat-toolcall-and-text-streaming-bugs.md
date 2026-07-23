# 聊天工具调用与文本流式渲染缺陷修复

## 涉及缺陷

1. 工具调用条目展示完整工作区绝对路径（含 `/home/.../prototypes/` 系统根路径）。
2. `/proto-make` 单页 HTML 分支未返回结果卡片（ProjectCard）。
3. 流式文本出现内容错乱（如 `marketing-c -managerampaign`，多个文本块 delta 互相穿插）。
4. run 结束后工具调用条目仍停留在「执行中」。

## 1. 工具调用展示系统根路径

### 现象
工具调用卡片（写入文件 / 执行命令）的参数预览直接展示 `/home/nan/test/{wsId}/{userId}/products/prototypes/...` 绝对路径，暴露系统根路径。

### 根因
- `ToolCallView.tsx` 的 `formatArgsPreview` 返回原始 `file_path` / `command`，未做脱敏。
- 既有脱敏函数 `sanitizeWorkspacePaths`（`lib/utils.ts`）正则 `/\/home\/nan\/test\/[^\/]+\//g` 只剥离**一层** ID 段，而工作区路径为 `{root}/{wsId}/{userId}/...` 两层 ID 段，导致仍残留 `{userId}/...`，且该函数未应用于工具调用。

### 解决方案
- 修正 `sanitizeWorkspacePaths`：先以 `/\/home\/nan\/test\/[^\/]+\/[^\/]+\//g` 剥离两层 ID 段，再剥离 `products/prototypes/` 业务前缀，仅保留原型工程名起头的相对路径。
- 在 `ToolCallView` 中对参数预览应用 `sanitizeWorkspacePaths`。
- 验证：`tsc` / `biome` 通过；路径展示为 `marketing-campaign/index.html`。

## 2. `/proto-make` 单页 HTML 分支无结果卡片

### 现象
`/proto-make` 在无工程模版时回退「拆分式单页 HTML」方案，仅产出 `[[FILE:...]]` 标记（文件附件 chip），无 `[[PROJECT:...]]` 工程卡片，用户看不到结果卡片。

### 根因
`config/commands.yaml` 中 `/proto-make` 的 HTML 分支只要求逐页输出 `[[FILE:]]`，未输出 `[[PROJECT:]]`；而 Vite 分支会输出 `[[PROJECT:]]` 并渲染为 ProjectCard。两分支结果展示不一致。

### 解决方案
- 在 HTML 分支末尾追加 `[[PROJECT:{WORKSPACE_PATH}/products/prototypes/{工程名}]]` 标记，使前端渲染 ProjectCard 作为结果卡片（同时保留逐页 `[[FILE:]]` 便于精准引用）。
- 验证：`go build` 通过；模板渲染时 `[[PROJECT:]]` 由 AssistantMessage 解析为 ProjectCard。

## 3. 流式文本内容错乱（多文本块 delta 穿插）

### 现象
返回消息出现 `marketing-c -managerampaign` 这类错乱文本，疑似同一文本的不同 chunk 被重新排序/穿插。

### 根因
`use-ag-ui-chat.ts` 的 `TEXT_MESSAGE_CONTENT` 处理始终把 delta 追加到「最后一个 text 部件」，且 `TEXT_MESSAGE_START` 在最后一个部件已是 text 时**不新建**部件：
- 单次 run 内若出现多个文本块（不同 `messageId`），后续块的 delta 会被追加到前一块的 text 部件。
- 路由不依据 `ev.messageId`，导致不同文本块的 delta 互相穿插，产生 `块A前段 + 块B + 块A后段` 的错乱。

### 解决方案
- 为每个文本块（按 `messageId`）创建独立的 text 部件，并在部件上标记 `messageId`。
- `TEXT_MESSAGE_CONTENT` 优先按 `ev.messageId`（回退到 `ctx.currentTextMessageId`）路由 delta 到对应部件，缺失时才回退到最后一个 text 部件。
- 在 `AgUiEventProcessContext` 增加 `currentTextMessageId`，并在两处 ctx 构造点初始化。
- 验证：`tsc` / `biome` 通过；多文本块 delta 各自归位，不再穿插。

### 补充根因（思考只有一段）
`THINKING_TEXT_MESSAGE_CONTENT` 在后端 `runParts` 与前端 reasoning 部件处理中，只要最后一个部件是 reasoning 就追加 delta，**不检查该 reasoning 是否已 `Done`（已收到 THINKING_END）**。导致多个思考阶段（START…END、START…END）被合并进同一段 reasoning，表现为「思考只有一段」。

### 补充解决方案
- 后端 `agui.go` 与前端 `use-ag-ui-chat.ts` 的 thinking 处理：仅当最后一个 reasoning 部件「未结束（!Done）」时追加，否则新建 reasoning 部件，使每个思考阶段独立成段。
- 注：交替展示「思考段/输出段」的渲染改版（当前 AssistantMessage 仅把最后一段 text 作为输出、其余 text 归入思考卡）需依据真实事件流确认 agent 是否产出多轮 think/text 后再实施。

## 4. run 结束后工具调用仍「执行中」

### 现象
模型回复结束后，工具调用条目仍显示「执行中」状态；切换页面再切回时整个聊天崩溃。

### 根因（深层）
三层叠加：
1. **gatewayd AG-UI 协议缺陷**（`deepharness-ent-desktop/apps/gatewayd/src/agui/mapper.rs`）：
   - `map_tool_result` 只发 `ToolCallResult`，**从不发 `ToolCallEnd`**（AG-UI 协议要求 END 在 RESULT 之前）。
   - `current_tool_call_id` 为单槽 `Option<String>`，并行工具调用时后者覆盖前者，导致 RESULT 携带错误 ID。
2. **dh-backend FIFO 重映射**（`agui.go` processEvent）：`pendingToolCallIDs` 为 FIFO 队列，START 追加到尾、END/RESULT 从头弹出。并行调用乱序完成时 RESULT 被重映射到错误 ID，前端按 ID 匹配失败 -> 永久停留「执行中」。
3. **前端**：`isRunning` 由 `result === undefined` 派生，未匹配到 RESULT 的调用永远 running。

### 解决方案
- **gatewayd mapper.rs**：
  - `map_tool_result` 在 `ToolCallResult` 之前补发 `ToolCallEnd`。
  - 用 `pending_tool_call_ids: Vec<String>` + `tool_call_id_map: HashMap<String,String>`（claude tool_use_id → AG-UI tool_call_id）替换单槽，并行调用按 `tool_use_id` 精确关联，无 id 时回退 FIFO。
  - 新增 2 个单元测试验证 END/RESULT 顺序与并行 ID 关联。
- **dh-backend agui.go**：
  - 删除 FIFO 重映射逻辑（TOOL_CALL_ARGS / END / RESULT 均使用 gatewayd 原始 ID，不再 rewrite）。
  - `pendingToolCallIDs` 改为活跃调用 ID 集合（`removeToolCallID` helper 按 ID 移除），END 和 RESULT 各移除一次（去重保护）。
  - `flushPendingState` 同时补发 END + RESULT，确保异常结束时前端也能收尾。
- **前端**：保留 `withToolCallsFinalized` 作为 RUN_FINISHED 兜底。
- 验证：`cargo test` 5/5 通过；`go build` / `go vet` / `tsc` / `biome` 通过。

## 5. 切页面再切回聊天崩溃（isSameDay）

### 现象
从聊天页面切换到其他页面再切回时，控制台报 `TypeError: a.getFullYear is not a function`，整个聊天区域白屏。

### 根因
SSE 重放（replay）后消息的 `createdAt` 从 `Date` 序列化为 ISO 字符串。`ChatThread.tsx:35` 调用 `isSameDay(prevMessage.createdAt, message.createdAt)`，而 `isSameDay`（`utils.ts:65`）直接调用 `a.getFullYear()`，字符串无此方法 -> 崩溃。`formatDateLabel` 同样直接调用 `date.getFullYear()`。

### 解决方案
- `isSameDay` 和 `formatDateLabel` 入参类型放宽为 `Date | string | number`，内部用 `new Date()` 规整，无效值返回 false / 空字符串。
- 验证：`tsc` / `biome` 通过；切页面再切回不再崩溃。

## 6. 原型预览 iframe 返回 401/403 JSON

### 现象
生成的原型 `index.html` 在预览 iframe 中显示 JSON 错误（`{"code":2,"message":"unauthorized"}`）。

### 根因
iframe `<iframe src="/api/v1/workspaces/.../product-space/serve/...">` 是浏览器原生请求，无法设置 `Authorization: Bearer` 头。`Auth` 中间件（`middleware/auth.go`）仅从 header 提取 token -> 401。

### 解决方案
- 后端 `extractBearerToken` 增加 `?auth=` query 参数回退（header 优先，无 header 时取 query）。
- 前端 `PrototypeWorkspace.tsx` 构建 iframe src 时追加 `?auth=${encodeURIComponent(token)}`。
- 提取 `AUTH_TOKEN_KEY` 常量到 `constants.ts`，`api.ts` 与 `PrototypeWorkspace.tsx` 共用。
- 验证：`go build` / `go vet` / `tsc` / `biome` 通过。
