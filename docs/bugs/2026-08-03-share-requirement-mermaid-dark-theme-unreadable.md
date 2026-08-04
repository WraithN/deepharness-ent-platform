# 需求分享页 Mermaid 流程图在深色模式下看不清

## 现象
在 `/share/requirement/{token}` 页面查看含 Mermaid 流程图的 PRD 文档时，图表整体为深色背景且文字/节点对比度极低，用户难以辨认流程步骤与节点内容。例如：
`http://localhost:8888/share/requirement/38ujaVDRpe` 中 “2.2 用户流程” 的 Mermaid 图几乎无法阅读。

## 根因
`MermaidBlock` 组件在初始化 mermaid 时固定使用 `theme: 'default'`（浅色主题）。当前应用整体为深色主题（Dracula），分享页背景为 `bg-background` 深色，默认主题渲染出的图表颜色与背景混在一起，导致节点、文字、连线均不清晰。

## 解决方案
1. 在 `apps/dh-frontend/src/components/chat/MermaidBlock.tsx` 中引入 `useTheme`。
2. 根据 `resolvedTheme` 动态选择 mermaid 主题：深色模式使用 `theme: 'dark'`，非深色模式使用 `theme: 'default'`。
3. 初始化函数 `initializeMermaid(theme)` 在每次渲染前重新调用 `mermaid.initialize`，确保切换主题或系统主题变化后图表能按正确主题重新渲染。

## 验证结果
- `npx tsc --noEmit -p apps/dh-frontend/tsconfig.check.json` 0 错误。
- `pnpm build` 全部成功。
- 重启开发服务后各端口访问正常（前端 200、后端 /health 200）。
- 由于当前环境未安装 Chromium，无法直接截图验证，需用户刷新 `/share/requirement/38ujaVDRpe` 确认深色流程图已可正常阅读。
