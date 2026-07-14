# 市场弹窗多选勾选失效（label 双触发抵消）

## 现象

空间设置 → 技能配置 / 提示词配置的「去市场添加」弹窗中，点击条目行（label 区域）无法勾选条目，底部「添加 (n)」按钮计数始终为 0，只有精确点击复选框本身才能选中。

## 根因

条目行使用 `<label>` 包裹 shadcn `<Checkbox>`（Radix UI，渲染为 `<button role="checkbox">`），同时在 label 上挂 `onClick` 切换选中态，并试图通过 `(e.target).closest('[data-slot="checkbox"]')` 过滤点击复选框本身的重复触发：

1. 本项目的 `components/ui/checkbox.tsx` **没有** `data-slot="checkbox"` 属性（新版 shadcn 才有），过滤条件永远为 null，形同虚设。
2. `<button>` 是 labelable 元素，点击 label 任意位置时浏览器会把点击**原生转发**到内部 button；该合成点击冒泡回 label 再次触发 onClick。
3. 于是点击行文字区域会触发**两次**切换（选中→取消），净效果为零。

## 解决方案

移除 label 上的 `onClick`，改为由 Checkbox 的 `onCheckedChange` 统一驱动选中态：

- 点击行文字 → 浏览器原生转发点击到内部 button → Radix 触发 `onCheckedChange`（一次）
- 直接点击复选框 → Radix 触发 `onCheckedChange`（一次）

两种路径均只触发一次切换，行为一致。技能市场弹窗与提示词市场弹窗存在相同代码模式，已一并修复（`apps/dh-frontend/src/pages/Settings.tsx`）。

## 验证结果

Playwright e2e：点击条目行文字区域后「添加 (1)/(2)」计数正确累加，批量添加成功且弹窗自动关闭。
