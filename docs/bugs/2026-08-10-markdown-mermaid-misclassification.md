# 2026-08-10 Markdown 代码块被误判为 Mermaid 图表导致渲染失败

## 现象

聊天消息中的普通代码块（尤其是 TypeScript/注释形式的代码）被错误识别为 Mermaid 图表，渲染失败并显示红色错误提示：

```text
图表渲染失败：No diagram type detected matching given configuration for text:
// 收集用户输入：englishName（文本） + vibe（三个按钮：gentle/bold/scholarly）
// 使用 react-hook-form + nameGenerationSchema 验证
...
```

同时，合法的 Mermaid 图表（如 `graph TD` 包含中文/括号标签）也偶发解析错误，原因是 `MarkdownView` 与 `ChatCodeBlock` 各自维护了一套启发式检测规则，规则不一致且兜底逻辑过于宽松。

## 根因

### 1. Mermaid 检测逻辑分散且不一致

- `MarkdownView.tsx` 通过 `isMermaidContent` 检测未声明语言或 `language-mermaid` 的代码块。
- `ChatCodeBlock.tsx` 通过 `looksLikeMermaid` 做兜底检测（当代码块语言被声明为普通语言但内容像 Mermaid 时）。
- 两套规则各自维护关键字、箭头、节点正则，导致同一内容在不同入口判断结果不一致。

### 2. 节点正则误把函数调用识别为 Mermaid 节点

`MarkdownView.tsx` 原 `MERMAID_NODE_PATTERN` 包含 `\(.*?\)` 分支，用于匹配 Mermaid 圆角矩形节点 `A(label)`。但该正则未排除普通函数调用，如：

```typescript
router.push("/ceremony")
```

行首的 `router.push(...)` 会被匹配为 `router(...)` 节点，导致整段注释代码被判定为 Mermaid，最终交给 `MermaidBlock` 渲染，报 `No diagram type detected`。

### 3. 箭头判定把纯文本流程/普通代码误判为 Mermaid

`isMermaidContent` 只要检测到 `-->` / `==>` 等箭头就返回 true。普通代码中常见箭头函数 `=>`、注释中的流程说明 `A -> B` 也会被误判，导致代码块被当作 Mermaid 图表处理。

### 4. 缺少单一事实来源

Mermaid 检测逻辑在 `MarkdownView` 和 `ChatCodeBlock` 中重复实现，修改一处无法保证另一处同步更新。

## 解决方案

1. **统一检测逻辑到单一模块**  
   新建 `apps/dh-frontend/src/lib/mermaid-utils.ts`，导出 `isMermaidDiagramCode(code)`：
   - 仅扫描代码块前 10 行；
   - 只匹配 Mermaid 图表类型关键字（`graph`、`flowchart`、`sequenceDiagram`、`classDiagram`、...）；
   - 遇到注释行 `//` / `#` / `%%` 和明显代码特征行（`import`/`const`/`function`/`return` 等）直接跳过；
   - 不再使用箭头或节点正则作为判定条件。

2. **两套入口统一使用 `isMermaidDiagramCode`**  
   - `MarkdownView.tsx` 的 `normalizeCodeBlocks`、`containsMermaid` 和代码块渲染逻辑全部使用新函数；
   - `ChatCodeBlock.tsx` 的兜底检测也使用新函数，仅保留 `language-mermaid` 直接渲染。

3. **纯文本流程仍由 `isTextFlow` 处理**  
   没有 Mermaid 关键字但用箭头连接的文本流程（如 `A → B → C`）继续走 `isTextFlow` -> `convertTextFlowToMermaid` 分支，避免被 `isMermaidDiagramCode` 误判，同时也不影响原本的文本流程自动渲染能力。

## 验证

- `pnpm --filter @repo/dh-frontend check-types` 通过，无类型错误。
- 包含 `router.push(...)` / `const x = obj[key]` 的 TypeScript 注释代码块不再被误判为 Mermaid。
- 显式声明 ` ```mermaid ` 的代码块和第一行为 `graph TD` / `flowchart LR` 的代码块仍可正常渲染。
- 纯文本流程（`A → B → C`）仍自动转换为 Mermaid flowchart 渲染。

## 相关代码

- `apps/dh-frontend/src/lib/mermaid-utils.ts` — 新增统一检测模块。
- `apps/dh-frontend/src/components/chat/MarkdownView.tsx` — 移除旧 `isMermaidContent` 与 `MERMAID_NODE_PATTERN`，统一使用 `isMermaidDiagramCode`。
- `apps/dh-frontend/src/components/chat/ChatCodeBlock.tsx` — 移除独立 `looksLikeMermaid` 与 `MERMAID_KEYWORDS`/`MERMAID_ARROW_PATTERN`，统一使用 `isMermaidDiagramCode`。
- `apps/dh-frontend/src/components/chat/MermaidBlock.tsx` — 继续负责 Mermaid 语法预处理与渲染（矩形节点加引号等）。
