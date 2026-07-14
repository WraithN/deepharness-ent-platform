# 可视化编辑器工具栏缺失且无法点击

## 现象

产品空间文档编辑器切换到「可视化编辑」模式后：WangEditor 工具栏不渲染，编辑区仅显示纯文本且所有交互（点击、输入、模式切换）无响应。浏览器控制台持续抛出 `Can not get editor instance` 异常。

## 根因

`@wangeditor/editor-for-react` 的 `Toolbar` 组件在挂载时会立即调用 `createToolbar` 并向编辑器实例注册菜单项（`registerItems → getEditorInstance`）。原实现中 `Toolbar` 与 `Editor` 同时挂载，此时 `Editor` 的 `onCreated` 回调尚未触发、`editor` state 仍为 `null`，导致 `getEditorInstance(null)` 抛错，工具栏初始化中断。

此外存在两个关联隐患：

1. 切换模式离开可视化模式时 `Editor` 子组件卸载，但编辑器实例未销毁；切回时 `Toolbar` 会先拿到已销毁的旧实例，再次触发同样错误。
2. 组件卸载清理的 `useEffect`（依赖 `[editor]`）在 `setEditor(null)` 触发时会对同一实例重复调用 `destroy()`。

## 解决方案

1. **延迟挂载工具栏**：`Toolbar` 仅在 `editor` state 非空（即 `onCreated` 已触发）后渲染——`{mode === 'rich' && editor && <Toolbar ... />}`。
2. **ref 管理生命周期**：新增 `editorRef`，`onCreated` 时同步写入 ref 与 state；封装 `destroyEditor()` 统一置空 ref/state 后再 `destroy()`，避免重复销毁。
3. **离开可视化模式时销毁实例**：`handleModeChange` 中 flush 内容后调用 `destroyEditor()`，保证切回时创建全新实例。
4. 组件卸载清理改为空依赖的 `useEffect`，只经 `destroyEditor()` 销毁一次。

## 验证结果

- Playwright 自动化回归（`pm@deepharness.com` 登录，真实浏览器）：
  - 可视化输入文本 → 加粗 → 切 Markdown 显示 `**可视化测试文本**` ✓
  - 切回可视化工具栏 15 个按钮正常、预览渲染 `<strong>` ✓
  - 「常用模板」套用会议纪要模板成功并正确转回 Markdown ✓
  - 控制台 0 pageerror ✓
- `tsc --noEmit` 0 错误、Biome lint 无告警、`pnpm build` 6/6 成功
