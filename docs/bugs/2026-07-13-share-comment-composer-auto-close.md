# 分享页批注输入框打开后立即自动关闭

## 现象

分享文档页（`/s/{token}`）选中正文文本后点击浮动「批注」按钮，批注输入框不显示（打开后瞬间关闭），无法发表批注。浏览器实测：mousedown 后 `composerOpen` 状态被立即重置。

影响范围：ShareDoc.tsx 分享页选中文本批注功能。

## 根因

React 事件时序陷阱：

1. 浮动按钮的 `onMouseDown` 中调用 `setComposerOpen(true)` 打开输入框；
2. 输入框打开后，`useEffect([composerOpen])` 注册 document 级 `mousedown` 监听用于「点击外部关闭」；
3. 此时**打开输入框的同一个 mousedown 事件仍在冒泡**，新注册的 document 监听被该事件触发，判断点击目标（浮动按钮）在输入框外部，立即执行关闭逻辑。

即「打开操作的事件」被「外部关闭监听」捕获，形成自关闭。

## 解决方案

将 document 监听器的注册延迟到下一个事件循环（`setTimeout(..., 0)`），保证打开输入框的 mousedown 事件完成全部冒泡后监听才生效：

```ts
const timer = setTimeout(() => document.addEventListener('mousedown', handleMouseDown), 0);
return () => {
  clearTimeout(timer);
  document.removeEventListener('mousedown', handleMouseDown);
};
```

同时在浮动按钮 `onMouseDown` 中保留 `e.preventDefault()`，阻止浏览器默认行为清除文本选区（批注锚定的 quote 依赖选中文本）。

附带修复：浮动输入框 x 坐标增加视口钳制（`clampX`），避免贴边选区时输入框溢出屏幕左侧。

验证结果：

- 分步 mouse 事件调试确认 mousedown 后输入框保持打开（`COMPOSER_AFTER_DOWN: true`）
- 端到端浏览器测试：选中文本 → 批注 → 填昵称/内容 → 发表 → 侧栏显示、文档页面板显示、关闭批注，全链路通过，0 page error
- `tsc --noEmit` 0 错误、biome 0 告警、`pnpm build` 6/6 成功
