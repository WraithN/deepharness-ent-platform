# 2026-07-17-agent-model-dropdown-flash-close

## 现象

空间设置 > 智能体设置中，点击模型下拉框的输入/搜索区域时，下拉菜单会一闪而过立即关闭，导致无法选择模型。

## 根因

`ModelVendorSelect` 内部的 `Input` 没有阻止点击事件冒泡，点击输入框时会触发 `PopoverTrigger` 的 toggle 行为，导致 Popover 先打开再立即关闭。

## 解决方案

在输入框的 `onClick` 中调用 `e.stopPropagation()`，避免点击输入区域时触发 PopoverTrigger 的 toggle；下拉菜单由此保持打开状态，可正常选择模型。

## 验证

- 类型检查通过：`pnpm --filter @repo/dh-frontend check-types`
- 构建通过：`pnpm build`
- 本地开发环境启动后，点击模型下拉框输入区域菜单可正常展开并选择模型。
