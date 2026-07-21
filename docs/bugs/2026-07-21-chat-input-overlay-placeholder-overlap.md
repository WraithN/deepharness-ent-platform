# 2026-07-21 — 删除指令后聊天输入框占位符与高亮层重叠

## 现象

在 `apps/dh-frontend/src/pages/Chat.tsx` 的聊天输入区域，删除已插入的 `/code` 等指令后，textarea 已清空，但原生 placeholder 与残留的高亮覆盖层文字发生重叠，导致输入框展示混乱。

截图表现为：placeholder 文字上方仍能隐约看到被删除指令的高亮块（如 `/code`），两者叠在同一位置，影响用户感知输入框是否真正为空。

## 根因

1. **高亮层位于 textarea 前方且无 z-index 控制**
   - `mentionOverlayRef` 使用 `absolute inset-0`，默认堆叠在文档流后面元素之上，因此覆盖在 textarea 前面。
   - textarea 本身为 `relative` 且透明文字，placeholder 由浏览器在 textarea 背景层渲染，高亮层在前会遮挡/叠在 placeholder 上。

2. **删除后高亮内容未清空**
   - overlay 子节点始终渲染 `highlightedInput`，即使 `input` 已被清空为空字符串或仅空白，残留的高亮节点仍然存在。

3. **行高不一致**
   - textarea 默认 `line-height: normal`，而 overlay 继承的 `line-height: 1.5` 来自 Tailwind 基础样式，两者在部分字体/平台下可能出现错位，进一步放大视觉重叠。

## 解决方案

1. **调整堆叠顺序**
   - 高亮层增加 `z-0`，textarea 增加 `z-10`，使 textarea（含原生 placeholder）位于 overlay 上方，任何残留内容都不会遮挡 placeholder。

2. **input 为空时不再渲染高亮**
   - overlay 子节点改为 `{input.trim().length > 0 ? highlightedInput : null}`，清空 textarea 后高亮层不保留任何节点。

3. **统一行高**
   - textarea 增加 `leading-[1.5]`，与 overlay 的 `line-height: 1.5` 保持一致，避免文字纵向错位。

## 验证结果

- `pnpm build` 构建全部应用成功，无新增 warning。
- `pnpm check-types` 类型检查通过。
- `pnpm lint` 通过（ast-grep 命令未安装为既有环境问题，非本次改动引入）。
- 使用 Playwright 登录 `developer@deepharness.com`，通过「指令」菜单插入 `/code`，再多次按 Backspace 删除，textarea 为空且 placeholder 清晰显示，无重叠。

## 相关文件

- `apps/dh-frontend/src/pages/Chat.tsx`
