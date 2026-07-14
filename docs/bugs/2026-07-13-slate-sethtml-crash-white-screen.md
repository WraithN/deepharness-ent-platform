# 点击文档白页：Slate「Cannot find a descendant at path」崩溃

## 现象

产品空间点击文档后整页白屏，控制台报 `Cannot find a descendant at path [5]`（Slate 节点路径错误），错误发生在 `setHtml` 替换内容（切换文档/套用模板）时，整棵 React 树崩溃且页面无错误边界兜底。

## 根因

WangEditor 的 `setHtml` 会移除全部旧节点再插入新节点，该过程存在两个 Slate 时序陷阱：

1. **选区指向旧节点**：`setHtml` 时若编辑器存在选区（如用户刚做过加粗操作），旧节点被移除后选区悬空，Slate 规范化时抛 `Cannot find a descendant at path`，同步抛出导致 React 渲染树崩溃白屏。
2. **选区恢复早于 DOM 渲染**：`setHtml` 后 WangEditor 自动将选区恢复到文档末尾，但此时新节点 DOM 尚未渲染，slate-react 解析选区 DOM 抛 `Cannot resolve a DOM node from Slate node`。

## 解决方案

封装统一的 `setEditorHtml` 替代所有直接 `setHtml` 调用：

1. `setHtml` 前 `SlateTransforms.deselect(ed)` 取消选区；
2. `setTimeout(0)` 延迟到当前事件循环结束后执行，并用 `editorRef` 校验实例未更换；
3. `setHtml` 后 `requestAnimationFrame` 中再次 `deselect`，规避选区恢复早于 DOM 渲染的问题；
4. 新增 `EditorErrorBoundary` 错误边界包裹 Editor：即使 Slate 再次崩溃也只展示「重新加载编辑器」入口（经 `editorKey` 强制重建实例），不再整页白屏。

## 验证结果

- Playwright 真实浏览器回归（`pm@deepharness.com`）：
  - 快速连续切换 5 次文档（制造 setHtml 竞态）：编辑区存活，0 错误 ✓
  - 新建文档 → 输入 → 全选加粗 → 套 PRD 模板（用户原始崩溃路径）：内容正确，0 错误 ✓
  - 模板套用后切 Markdown → 切回可视化 → 切文档：全程 0 pageerror ✓
- `tsc --noEmit` 0 错误、Biome lint 无告警、`pnpm build` 6/6 成功
