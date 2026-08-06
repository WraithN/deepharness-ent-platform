# 2026-08-05 Mermaid 误匹配 TypeScript import 语句

## 现象

代码块（TypeScript/JavaScript）中包含 `import` 语句时，`isMermaidContent` 误判为 Mermaid，导致 `MermaidBlock` 渲染失败并抛出 `UnknownDiagramError`：

```
[MermaidBlock] render failed: UnknownDiagramError: No diagram type detected matching given configuration for text: import { useState } from 'react'
```

影响范围：聊天消息中所有包含 TypeScript import 语句的代码块。

## 根因

`MarkdownView.tsx` 中 `isMermaidContent` 函数的 `MERMAID_NODE_PATTERN` 正则表达式包含 `\w+\s*\{.*?\}`，该模式会匹配 TypeScript 的 `import { X } from 'Y'` 语句：

- `import` 匹配 `\w+`
- `{ X }` 匹配 `\{.*?\}`

导致代码块被错误分类为 Mermaid 代码并送入渲染器。

## 解决方案

在 `isMermaidContent` 中增加 `NON_MERMAID_LINE_PATTERN` 编程语言行检测，在检查 Mermaid 模式之前先跳过以以下关键字开头的行：

- `import ` / `export `
- `const ` / `let ` / `var `
- `function ` / `return `
- `if(` / `for(` / `while(` / `switch(`

修改文件：`apps/dh-frontend/src/components/chat/MarkdownView.tsx:30-42`
