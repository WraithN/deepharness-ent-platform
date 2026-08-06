# 2026-08-05-mermaid-syntax-error-bombs.md

## 现象

在流程追踪/会话等展示 Mermaid 图表的页面，AI 生成的 Mermaid 代码存在语法错误时，页面上出现多个 Mermaid 库自带的红色炸弹错误图（`Syntax error in text`），而不是友好的错误回退。影响包含 Mermaid 图表的会话消息、流程详情等展示区域。

## 根因

`MermaidBlock` 组件在渲染时直接调用 `mermaid.render()`。Mermaid 在某些情况下对非法语法不会抛异常，而是返回一个包含错误提示 SVG（红色炸弹图）的字符串。组件将该 SVG 当成成功结果插入 DOM，导致页面出现不友好的炸弹图。原有的 `catch` 错误回退只在 `render` 抛异常时才会触发，因此无法拦截这种“返回错误 SVG”的情况。

## 解决方案

在 `MermaidBlock` 的 `render` 之前先调用 `mermaid.parse()` 做语法校验。`parse` 在语法非法时会抛出错误（`suppressErrors: false`），从而进入组件的 `catch` 分支，渲染统一友好的错误回退（AlertCircle 图标 + 错误提示 + 原始代码）。这样非法 Mermaid 不再显示红色炸弹图。

## 相关文件

- `apps/dh-frontend/src/components/chat/MermaidBlock.tsx`

## 验证

- `pnpm --filter @repo/dh-frontend check-types` 通过。
- `pnpm --filter @repo/dh-frontend lint` 通过（Biome 无报错）。
- `pnpm build` 全量构建成功。
- `bash scripts/restart-dev.sh` 重启后，前后端服务均正常响应（`/` 与 `/health` 返回 200）。
