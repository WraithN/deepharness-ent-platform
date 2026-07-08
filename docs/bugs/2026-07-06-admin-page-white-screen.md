# 2026-07-06 超管后台页面白屏

## 现象

访问 `/admin/spaces`（空间管理）等超管后台页面时，页面白屏，浏览器控制台报错：

```
AdminPage.tsx:402 Uncaught ReferenceError: Cannot access 'skills' before initialization
    at AdminPage (AdminPage.tsx:402:7)
```

该错误导致整个 `AdminPage` 组件崩溃，所有超管后台 Tab 均无法打开。

## 根因

在 `apps/dh-frontend/src/pages/AdminPage.tsx` 中，部分 `useEffect` 的依赖项引用了尚未声明的 `useState` 变量：

- 第 400 行的 `useEffect` 依赖了 `skills.length`，但 `skills` 在第 512 行才通过 `useState` 声明。
- 第 404 行的 `useEffect` 依赖了 `promptSearchTerm` 和 `promptStatusFilter`，但这两个状态在第 518、519 行才声明。

React 在渲染阶段评估 effect 依赖数组时，这些变量仍处于暂时性死区（TDZ），从而抛出 `ReferenceError`，引发白屏。

## 解决方案

1. 删除提前声明的、依赖未初始化状态的 `useEffect`：
   - 删除依赖 `skills.length` 的 effect。
   - 删除依赖 `promptSearchTerm/promptStatusFilter` 的重复 effect（后续已有包含 `promptCategoryFilter` 的完整版本）。
2. 在 `skills` 状态声明之后，重新放置依赖 `skills.length` 的 effect，确保 Hooks 调用顺序与变量声明顺序一致。
3. 运行 `pnpm check-types` 与 `pnpm build` 验证通过。

## 验证结果

- `pnpm check-types` 无错误。
- `pnpm build` 全量构建通过。
- 开发服务器 `pnpm dev` 仍在运行，前端 HMR 已自动加载修复后的代码。
