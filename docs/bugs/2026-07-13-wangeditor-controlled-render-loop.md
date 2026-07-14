# 打开 Markdown 文档详情后页面无限刷新卡死

## 现象

产品空间打开任一 Markdown 文档详情后，页面持续刷新、浏览器卡死无响应。

## 根因

`MarkdownEditor` 可视化模式将 WangEditor 的 `Editor` 组件作为**受控组件**使用，形成无限渲染循环：

1. `Editor` 的 `value` 绑定 `richHtml` state；
2. 编辑器 `onChange` 中 `setRichHtml(ed.getHtml())` 回写 state；
3. WangEditor 的 `setHtml`/`getHtml` 对 HTML 会做规范化处理，每次回写得到的字符串与上次**不完全相等**；
4. state 变化 → React 重渲染 → `Editor` 检测到 `value` 变化再次 `setHtml` → 再次 `onChange` → 再次 setState……

循环在毫秒级持续触发，主线程被渲染占满，表现为页面卡死。

## 解决方案

将 WangEditor 内容改为**非受控**管理：

1. 移除 `richHtml` state 与 `Editor` 的 `value` 属性，编辑器内容只在 `onCreated` 时写入一次初始 HTML；
2. `onChange` 中不再 setState 存 HTML，仅防抖（300ms）将 HTML 转为 Markdown 后 `onChange` 上报父级；
3. 外部 `value` 变化（切换文档/套用模板）时，通过 `editorRef.current.setHtml()` imperative 刷新，并以 `lastEmittedRef` 识别自身编辑产生的回写、跳过刷新；
4. `flushRichToMarkdown` 改为直接从 `editorRef.current.getHtml()` 取当前内容。

## 验证结果

- Playwright 真实浏览器回归（`pm@deepharness.com`）：
  - 打开已有文档详情：页面稳定，1 秒级响应探测 0 次超时（无卡死）✓
  - 可视化输入 → 切 Markdown：内容正确同步 ✓
  - 模式反复切换、跨文档切换：工具栏与编辑区均正常 ✓
  - 控制台 0 pageerror ✓
- `tsc --noEmit` 0 错误、`pnpm build` 6/6 成功

## 补充：用户环境仍复现的排查（2026-07-13 下午）

用户环境（VS Code 端口转发）中修复后仍报“一直刷新”，控制台显示：

1. **Vite HMR WebSocket 连接失败**（`ws://localhost:8888` 握手失败）——端口转发环境不支持 ws，导致 HMR 修复无法实时送达浏览器，且 vite client 在 ws 异常断连/重连时存在 `location.reload()` 机制；
2. `Can not get editor instance` 累计 534 次——为旧代码（工具栏未加实例就绪保护）在反复页面 reload 下的累积报错。

**处理**：`vite.config.ts` 中关闭 HMR（`server.hmr: false`），远程开发环境下代码更新改为手动刷新页面生效。关闭后 Playwright 回归：打开文档 15 秒内 0 次自动 reload、0 pageerror、无 ws 请求。
