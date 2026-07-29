# Mermaid 图表被误判为目录树结构导致不渲染

## 现象

技术设计文档中的 Mermaid 流程图（`graph TB` 语法）在聊天预览中不显示为图表，
而是被渲染为乱码文本或完全不展示。用户看到的 Mermaid 代码未被渲染为 SVG 图形。

## 根因

`apps/dh-frontend/src/components/chat/TreeDirBlock.tsx` 的 `isTreeDirContent` 函数
使用 `TREE_CONNECTOR_CHARS.test(line.trimStart())` 检测目录树结构。该正则
`/[|+\-`\\/=\u2500-\u257F]/` 是字符类，`test()` 方法检查字符串中**是否包含**
任意一个匹配字符，而非检查行首。

Mermaid 代码中常见 `/` 字符（如 `<br/>` 标签、"SDK/API"、"路由/鉴权/限流" 等），
导致多行命中 `TREE_CONNECTOR_CHARS`。当命中行数 ≥ 3 时，`isTreeDirContent` 返回 `true`，
Mermaid 代码块被误判为目录树结构，渲染为 `TreeDirBlock` 而非 `MermaidBlock`。

同时，`MarkdownView.tsx` 的代码块处理顺序是先检测目录树、再检测 Mermaid，
加剧了误判：即使代码块声明了 `language-mermaid`，只要 `isTreeDirContent` 返回 true，
就不会进入 Mermaid 渲染分支。

此外，当 AI 输出 Mermaid 代码未显式声明 `mermaid` 语言标签时（用 ```` ``` ```` 而非
```` ```mermaid ````），`match` 为 null，也不会被识别为 Mermaid。

## 解决方案

### 修复1：Mermaid 检测优先于目录树检测

`apps/dh-frontend/src/components/chat/MarkdownView.tsx`：

新增 `isMermaidContent(code)` 函数，通过首行关键字（`graph`、`flowchart`、
`sequenceDiagram` 等 25+ 种 Mermaid 图表类型）启发式识别 Mermaid 内容。

代码块处理顺序调整为：**Mermaid 检测 -> 目录树检测 -> 普通代码块**。
Mermaid 检测同时支持显式 `language-mermaid` 标签和启发式关键字识别。

### 修复2：`isTreeDirContent` 改为检查行首字符

`apps/dh-frontend/src/components/chat/TreeDirBlock.tsx`：

```diff
- const treeLikeLines = lines.filter((line) => TREE_CONNECTOR_CHARS.test(line.trimStart()));
+ const treeLikeLines = lines.filter((line) => {
+   const trimmed = line.trimStart();
+   return trimmed.length > 0 && TREE_CONNECTOR_CHARS.test(trimmed[0]);
+ });
```

只检查行首字符是否为树形连接符，不再因行中包含 `/`、`-`、`=` 等常见字符而误判。

### 验证

- `pnpm --filter @repo/dh-frontend run check-types`：0 errors
- `pnpm --filter @repo/dh-frontend run lint`（biome）：Checked 186 files, No fixes applied
- `pnpm build`：6/6 successful
- 前端 HTTP 200，服务正常启动
