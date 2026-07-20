# 2026-07-15 模板管理页新建模板闪现后消失

## 现象

在超管模板管理页（`/admin/templates`）点击「新增」创建模板后：

- 新模板会短暂出现在左侧列表中；
- 约几百毫秒后列表恢复为创建前的状态，新模板「消失」；
- 右侧编辑器也回到「请选择或新增一个模板」的空状态；
- 刷新页面后，新模板正常显示。

## 根因

问题由 `MarkdownEditor` 中 WangEditor 的 `onChange` 闭包陈旧导致：

1. `MarkdownEditor` 将 `onChange` 放在 `editorConfig` 中传给 WangEditor；
2. WangEditor 在初始化后不会更新 `config.onChange`，因此一直持有第一次渲染时的 `onChange` 闭包；
3. 该闭包捕获了父组件 `TemplateManagement` 中当时的 `selectedTemplate`（第一个模板，如 `weekly`）和 `templates`（旧列表）；
4. 创建模板后，`TemplateManagement` 刷新列表并选中新建模板；
5. 此时 WangEditor 因外部 `value` 变化调用 `setHtml`，触发 `onChange`；
6. 陈旧的 `onChange` 调用 `handleContentChange`，其内部使用旧列表执行 `templates.map(...)`，并把结果 `setTemplates(oldList)`，从而把已更新的列表覆盖回旧数据，导致新模板消失、选中项失效。

此前对 `loadList` 增加 `requestId` 的修复只能处理请求响应乱序，无法阻止编辑器侧的陈旧闭包覆盖状态。

## 解决方案

1. **修复 `MarkdownEditor` 的 `onChange` 闭包**：
   - 使用 `onChangeRef` 保存最新的 `onChange` prop；
   - `editorConfig.onChange`、`flushRichToMarkdown`、`applyTemplate` 中统一通过 `onChangeRef.current()` 回调；
   - 这样即使 WangEditor 持有初始 config，实际触发时仍调用父组件的最新回调，避免旧状态覆盖。

2. **优化 `TemplateManagement` 创建流程**：
   - `loadList` 增加 `selectFirst` 选项，创建成功后先不自动选中第一项，避免列表闪现跳到顶部；
   - 创建前调用 `clearPendingSave()`，防止未保存内容被刷到错误模板；
   - 创建成功后显式 `setSelectedKey(key)` 并将新模板滚动到可视区域。

3. **全局 API 禁用浏览器缓存**：
   - 在 `api.ts` 中统一设置 `cache: "no-store"`，避免某些浏览器在 POST/PUT 后返回缓存的 GET 结果。

## 验证结果

- 使用 Playwright + 本地 Chromium 编写端到端脚本复现：创建前计数为 N，创建后稳定为 N+1，且新建模板被选中并保持可见；
- `pnpm check-types` 通过；
- `pnpm build` 通过（仅保留预存在的大 chunk 警告）；
- `pnpm lint` 通过（输出中的 `turndown-plugin-gfm`、`AgentPolicy`、`ast-grep` 错误为历史遗留，与本次修复无关）。
