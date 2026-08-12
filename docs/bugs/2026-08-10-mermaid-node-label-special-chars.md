# 2026-08-10-mermaid-node-label-special-chars.md

## 现象

在聊天会话、需求文档、流程详情等展示 Mermaid 图表的页面中，AI 生成的 `graph TD` 流程图节点标签若包含括号、斜杠、逗号、`&` 等特殊字符（例如 `E1d[视图切换(列表/看板/甘特)]`、`E1[组织级项目视图 /pjm/projects/organization]`），Mermaid 解析会失败，页面显示：

```
图表渲染失败：Parse error on line 21:
...
Expecting 'SQE', 'DOUBLECIRCLEEND', 'PE', '-)', ...
```

并回退展示原始 Mermaid 代码块，而不是正常的 SVG 图表。

## 根因

1. Mermaid 的矩形节点语法为 `ID[label]`。当 `label` 中包含 `(`、`)`、`[`、`]`、`{`、`}`、`/`、`&`、`,`、`"`、`'` 等特殊字符时，必须用引号包裹（如 `ID["label"]`），否则解析器会把这些字符误判为节点形状结束符或运算符，导致 `Parse error`。
2. `apps/dh-frontend/src/components/chat/MermaidBlock.tsx` 中原有的 `preprocessMermaidCode` 只处理了反斜杠转义引号和 HTML 实体引号，没有自动为未加引号的节点标签补充引号。
3. 原有 `"` -> `'` 的替换会破坏 label 中本意显示为双引号的内容（如 `A["label with \"quote\""]` 会被替换为单引号显示）。

## 解决方案

修改 `apps/dh-frontend/src/components/chat/MermaidBlock.tsx`：

1. 新增 `quoteMermaidNodeLabels` 函数，按行扫描 Mermaid 代码，识别未加引号的矩形节点标签 `ID[label]`；当 `label` 包含特殊字符时，自动用双引号包裹，并把 label 内部的双引号替换为 `&quot;` HTML 实体。
2. 调整 `preprocessMermaidCode`：
   - `\"` -> `&quot;`
   - `\'` -> `&#39;`
   - `&quot;` / `&#34;` 保持为 `&quot;`
3. 跳过 `classDef`、`style`、`linkStyle`、`class`、`click`、`subgraph`、`end`、`direction` 等指令行，避免误替换。

这样 AI 生成的 `E1d[视图切换(列表/看板/甘特)]` 会被预处理为 `E1d["视图切换(列表/看板/甘特)"]`，`E1[组织级项目视图 /pjm/projects/organization]` 会被预处理为 `E1["组织级项目视图 /pjm/projects/organization"]`，Mermaid 解析即可通过。

## 相关文件

- `apps/dh-frontend/src/components/chat/MermaidBlock.tsx`

## 验证

- `pnpm --filter @repo/dh-frontend check-types`：0 errors
- `pnpm --filter @repo/dh-frontend lint`（Biome）：无报错（`ast-grep` 命令缺失为环境无关问题）
- `pnpm build`：7/7 successful
- `bash scripts/restart-dev.sh` 重启后，前后端服务正常响应：`curl http://localhost:8888` 与 `curl http://localhost:8080/health` 均返回 200
- 通过本地 Mermaid 11 parse 验证，预处理后的 `E1d["视图切换(列表/看板/甘特)"]` 等示例可正常通过 `mermaid.parse`
