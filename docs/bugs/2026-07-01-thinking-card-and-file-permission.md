# 思考卡片状态/时间线颜色/文件权限修复

## 现象

1. **思考卡片"思考完毕"状态结束太早**：模型 THINKING_END 事件触发后 ThinkingCard 就显示"思考完毕"，但此时还没输出 TEXT 给用户，应保持"思考中"直到 TEXT 出现。
2. **时间线圆点颜色不符合需求**：原实现按 reasoning/tool-call 区分颜色（primary/muted），需求是灰色=仍在进行、绿色=已完成。
3. **思考卡片底部缺少转圈圈**：思考进行中时应在时间线底部显示 spinner，直到 TEXT 输出出现。
4. **生成的文件报没有权限访问**：文件预览/下载 API 仅允许 `filesRoot`（`/home/nan/deepharness-ent-platform`）下的路径，agent 在 `/home/nan/` 或其他目录创建的文件返回 403。

## 根因

### 思考卡片状态
`AssistantMessage.tsx` 中 `isThinkingRunning = isRunning && !reasoningAllDone`，`reasoningAllDone` 在收到 `THINKING_END` 事件时即为 true，但此时后续可能还有工具调用、再次思考，最终 TEXT 输出尚未出现。

### 时间线颜色
圆点颜色按 `item.type === 'tool-call' ? 'border-primary' : 'border-muted-foreground/60'` 区分，不符合"灰色=进行中、绿色=完成"的需求。

### 文件权限
`files.go` 的 `safeFilePath` 仅检查路径是否在 `filesRoot` 下，agent 创建文件的路径（如 `/home/nan/docs/`、`/tmp/`）不在允许范围内。

## 解决方案

### 1. 思考卡片状态（AssistantMessage.tsx）

改为 `isThinkingRunning = isRunning && !hasOutputText`：只有当最终给用户的 TEXT 输出出现时才认为思考完毕。

### 2. 时间线圆点颜色（AssistantMessage.tsx）

改为按"该步骤是否已完成"判断：最后一个步骤在思考进行中时为灰色，其余为绿色。

### 3. 思考卡片底部 spinner（AssistantMessage.tsx）

在时间线列表末尾，当 `isThinkingRunning` 为 true 时渲染一个 `<Loader2 className="animate-spin" />`。

### 4. 文件访问权限（files.go）

新增 `extraAllowedRoots` 列表（`/home/nan`、`/tmp`、`/root`），提取 `isPathAllowed` 函数检查路径是否在 `filesRoot` 或任一额外根目录下。

### 验证结果

- `go vet ./gateway/...` 通过
- `tsc --noEmit` 通过
- `pnpm build` 成功
- 文件 API 可访问 `/tmp/`、`/home/nan/`、原 root 下的文件
- 前端 dev server 正常运行
