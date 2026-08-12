# 2026-08-10-code-command-text-flow-misdetect.md

## 现象

执行 `/code` 指令后，AI 返回的代码块（如 Next.js page.tsx 源码）没有正常展示为代码卡片（ChatCodeBlock），而是显示：

```
图表渲染失败：No diagram type detected matching given configuration for text: // 收集用户输入：englishName（文本）+ vibe ...
```

并回退展示原始代码文本。例如 `/apps/web/src/app/page.tsx` 和 `/apps/web/src/app/ceremony/page.tsx` 两个文件块均出现此问题。

## 根因

`apps/dh-frontend/src/components/chat/MarkdownView.tsx` 中有两处会把 TS/JS 代码块误判为 Mermaid 图表：

1. `isTextFlow` 函数仅通过是否包含箭头（`→`、`->`、`=>` 等）来判定是否为"文本流程"。AI 生成的 TS/JS 代码注释中经常包含箭头说明（如 `// 4个步骤：A → B → C → D`），这些注释会被误判为纯文本流程，进而被 `convertTextFlowToMermaid` 转成不合法的 Mermaid 代码交给 `MermaidBlock` 渲染，最终解析失败。
2. `isMermaidContent` 的节点检测正则 `MERMAID_NODE_PATTERN` 过于宽泛（`\w+\(.*\)`），会匹配代码中的链式方法调用，如 `router.push("/ceremony")` 中的 `push("/ceremony")` 被误判为 Mermaid 圆角节点；同时 `NON_MERMAID_LINE_PATTERN` 没有排除 `//` 开头的注释行，导致注释行里的函数调用也能命中节点检测，代码块被整体识别为 Mermaid。

上述两种误判都会使代码块绕过 `ChatCodeBlock` 普通代码渲染路径，最终展示"图表渲染失败"错误。

## 解决方案

修改 `apps/dh-frontend/src/components/chat/MarkdownView.tsx`：

1. 在 `isTextFlow` 中增加代码特征行检测：
   - 若代码块任意一行以 `//`、`#`、`/*`、`*` 开头，或包含 `import`、`export`、`const`、`let`、`var`、`function`、`return`、`if (`、`for (`、`while (`、`switch (` 等关键字，则直接判定不是文本流程。
2. 在 `isMermaidContent` 中：
   - 扩展 `NON_MERMAID_LINE_PATTERN`，同样排除 `//`、`#`、`/*`、`*` 开头的注释行。
   - 收紧 `MERMAID_NODE_PATTERN`，在节点 ID 前添加负向回顾后发 `(?<!\.)`，排除点号后的链式方法调用（如 `router.push(...)` 不再被误判为 Mermaid 节点）。

这样 TS/JS 注释块会回退到普通代码块路径，由 `ChatCodeBlock` 以代码卡片形式展示。

## 相关文件

- `apps/dh-frontend/src/components/chat/MarkdownView.tsx`
- `apps/dh-frontend/src/components/chat/ChatCodeBlock.tsx`

## 验证

- `pnpm --filter @repo/dh-frontend check-types`：0 errors
- `pnpm --filter @repo/dh-frontend lint`（Biome）：无报错
- `pnpm build`：7/7 successful
- `bash scripts/restart-dev.sh` 重启后，前后端服务正常响应（`/` 与 `/health` 返回 200）
